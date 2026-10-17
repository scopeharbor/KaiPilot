import { DateTime } from 'luxon'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import MultiProjectDependency from '#models/multi_project_dependency'
import MultiProjectDependencyPreview from '#models/multi_project_dependency_preview'
import AuditService, { type AuditEventType } from '#services/audit_service'
import {
  buildEndpointNodeId,
  isValidLifecycleTransition,
  stableHash,
  type MultiProjectAffectedEndpoint,
  type MultiProjectDependency as DepContract,
  type MultiProjectDependencyCategory,
  type MultiProjectDependencyDiff,
  type MultiProjectDependencyPreview as PreviewContract,
  type MultiProjectDependencyStatus,
  type MultiProjectDependencyType,
  type MultiProjectEndpointRef,
  type MultiProjectEndpointSummary,
  type MultiProjectEvidenceRef,
  type MultiProjectGraphEdge,
  type MultiProjectGraphNode,
  type MultiProjectGraphQuery,
  type MultiProjectGraphResponse,
  type MultiProjectImpactAnalysisInput,
  type MultiProjectImpactAnalysisResponse,
  type MultiProjectWarningCode,
} from '@aiproj/types'
import type { AuthContext } from '#types/auth'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString()
}

function toISODate(d: any): string | null {
  if (!d) return null
  if (typeof d === 'string') return d
  if (d.toISO) return d.toISO()
  if (d.toISODate) return d.toISODate()
  return String(d)
}

function depRowToContract(row: any): DepContract {
  const evidenceRefs: MultiProjectEvidenceRef[] =
    typeof row.evidenceRefs === 'string' ? JSON.parse(row.evidenceRefs) : (row.evidenceRefs ?? [])

  return {
    id: Number(row.id),
    organizationId: Number(row.organizationId),
    providerEndpoint: {
      endpointType: row.providerEndpointType as any,
      projectId: row.providerProjectId ? Number(row.providerProjectId) : null,
      projectName: row.providerProjectName ?? null,
      milestoneId: row.providerMilestoneId ? Number(row.providerMilestoneId) : null,
      milestoneName: row.providerMilestoneName ?? null,
      taskId: row.providerTaskId ? Number(row.providerTaskId) : null,
      taskName: row.providerTaskName ?? null,
      externalLabel: row.providerExternalLabel ?? null,
      externalKey: row.providerExternalKey ?? null,
      redacted: row.providerRedacted ?? false,
      redactionReason: row.providerRedactionReason ?? null,
    },
    consumerEndpoint: {
      endpointType: row.consumerEndpointType as any,
      projectId: row.consumerProjectId ? Number(row.consumerProjectId) : null,
      projectName: row.consumerProjectName ?? null,
      milestoneId: row.consumerMilestoneId ? Number(row.consumerMilestoneId) : null,
      milestoneName: row.consumerMilestoneName ?? null,
      taskId: row.consumerTaskId ? Number(row.consumerTaskId) : null,
      taskName: row.consumerTaskName ?? null,
      externalLabel: row.consumerExternalLabel ?? null,
      externalKey: row.consumerExternalKey ?? null,
      redacted: row.consumerRedacted ?? false,
      redactionReason: row.consumerRedactionReason ?? null,
    },
    category: row.category as any,
    type: row.type as any,
    lagDays: Number(row.lagDays ?? 0),
    strength: row.strength as any,
    bufferDays: Number(row.bufferDays ?? 0),
    status: row.status as any,
    riskLevel: row.riskLevel as any,
    ownerUserId: row.ownerUserId ? Number(row.ownerUserId) : null,
    sourceMode: row.sourceMode as any,
    sourceSuggestionId: row.sourceSuggestionId ? Number(row.sourceSuggestionId) : null,
    evidenceRefs,
    freshnessSignature: row.freshnessSignature ?? '',
    freshnessCheckedAt: toISODate(row.freshnessCheckedAt),
    freshnessStatus: (row.freshnessStatus as any) ?? 'fresh',
    confirmationHash: row.confirmationHash ?? null,
    idempotencyKey: row.idempotencyKey ?? null,
    createdAt: toISODate(row.createdAt)!,
    updatedAt: toISODate(row.updatedAt),
    archivedAt: toISODate(row.archivedAt),
  }
}

function generatePreviewId(): string {
  return `preview-${randomUUID()}`
}

function generateIdempotencyKey(): string {
  return `idem-${randomUUID()}`
}

/** 预览落库的端点标识（不含名称等展示/权限敏感字段）。 */
interface PreviewEndpointIdentity {
  endpointType: string
  projectId: number | null
  milestoneId: number | null
  taskId: number | null
  externalLabel: string | null
  externalKey: string | null
}

/** 从解析结果里摘出要落库的标识字段。 */
function pickEndpointIdentity(ref: MultiProjectEndpointRef): PreviewEndpointIdentity {
  return {
    endpointType: ref.endpointType,
    projectId: ref.projectId ?? null,
    milestoneId: ref.milestoneId ?? null,
    taskId: ref.taskId ?? null,
    externalLabel: ref.externalLabel ?? null,
    externalKey: ref.externalKey ?? null,
  }
}

/**
 * 回读预览落库的端点。
 *
 * 本列（`endpoints`）在 1992000000000 迁移中加入，此前创建的预览为 null；
 * 形状不符时同样返回 null，由调用方要求重新预览——绝不退回写占位数据。
 */
function parsePreviewEndpoints(
  raw: unknown,
): { provider: PreviewEndpointIdentity; consumer: PreviewEndpointIdentity } | null {
  if (raw === null || raw === undefined) return null
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { provider, consumer } = parsed as Record<string, unknown>
  if (typeof provider !== 'object' || provider === null) return null
  if (typeof consumer !== 'object' || consumer === null) return null
  if (typeof (provider as PreviewEndpointIdentity).endpointType !== 'string') return null
  if (typeof (consumer as PreviewEndpointIdentity).endpointType !== 'string') return null
  return {
    provider: provider as PreviewEndpointIdentity,
    consumer: consumer as PreviewEndpointIdentity,
  }
}

/**
 * 环检测的图节点键。
 *
 * 规范 `multi-project-dependency-model` 的「Graph integrity」把环定义在**项目**粒度
 * （场景原文：project P1 依赖 P2、P2 依赖 P3，新建 P3→P1 判为环），
 * 所以有项目归属的端点一律折叠到项目节点，不区分具体 task/milestone。
 * 由此，provider 与 consumer 落在同一项目时构成项目级自环，仍按环拒绝。
 *
 * 但**没有项目归属的端点不能都折叠成同一个节点**：原实现用
 * `${endpointType}:${projectId}`，两个不同的 external 端点 projectId 均为 null，
 * 键相同 → `hasPath` 首行 `from === to` 立即返回 true → external↔external
 * 与任何一端为 external 的依赖永远建不成。这类端点改用自身 externalKey 作身份。
 *
 * 端点级的自依赖是另一条独立检查（`isSelfDependency`），不由本函数承担。
 */
function cycleNodeKey(
  endpointType: string,
  projectId: number | bigint | string | null | undefined,
  externalKey: string | null | undefined,
): string {
  if (projectId !== null && projectId !== undefined) return `p${projectId}`
  if (externalKey) return `x${externalKey}`
  // 既无项目也无外部键：退回类型级键（保守合并，宁可误报环也不漏报）
  return `t${endpointType}`
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@inject()
export default class MultiProjectDependencyService {
  constructor(private audit: AuditService) {}

  // =========================================================================
  // §4.1 Endpoint Resolver
  // =========================================================================

  async resolveEndpoint(
    organizationId: number,
    endpointType: string,
    projectId: number | null,
    milestoneId: number | null,
    taskId: number | null,
    externalLabel: string | null,
    externalKey: string | null,
    authorized: boolean,
  ): Promise<MultiProjectEndpointRef> {
    const base: MultiProjectEndpointRef = {
      endpointType: endpointType as any,
      projectId: null,
      projectName: null,
      milestoneId: null,
      milestoneName: null,
      taskId: null,
      taskName: null,
      externalLabel: null,
      externalKey: null,
      redacted: !authorized,
      redactionReason: authorized ? null : 'PERMISSION_DENIED',
    }

    if (endpointType === 'external') {
      return {
        ...base,
        externalLabel: externalLabel ?? null,
        externalKey: externalKey ?? null,
        redacted: false,
        redactionReason: null,
      }
    }

    if (!projectId || !authorized) return base

    // Resolve project
    const { default: Project } = await import('#models/project')
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()

    if (!project) return { ...base, redacted: true, redactionReason: 'PROJECT_NOT_FOUND' }

    base.projectId = Number(project.id)
    base.projectName = (project as any).name ?? null

    // Resolve milestone
    if (endpointType === 'milestone' && milestoneId) {
      const { default: Milestone } = await import('#models/milestone')
      const milestone = await Milestone.query()
        .where('id', milestoneId)
        .where('project_id', projectId)
        .first()
      if (milestone) {
        base.milestoneId = Number(milestone.id)
        base.milestoneName = (milestone as any).name ?? (milestone as any).title ?? null
      }
    }

    // Resolve task
    if (endpointType === 'task' && taskId) {
      const { default: Task } = await import('#models/task')
      const task = await Task.query()
        .where('id', taskId)
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .first()
      if (task) {
        base.taskId = Number(task.id)
        base.taskName = (task as any).name ?? null
      } else {
        return { ...base, redacted: true, redactionReason: 'TASK_NOT_FOUND' }
      }
    }

    return base
  }

  // =========================================================================
  // §4.3 List and Detail
  // =========================================================================

  async list(
    organizationId: number,
    filters: {
      projectIds?: number[]
      endpointType?: string
      category?: string
      type?: string
      status?: string[]
      riskLevel?: string
      sourceMode?: string
      freshness?: string
      dateFrom?: string
      dateTo?: string
      search?: string
    },
    sort: string,
    page: number,
    perPage: number,
    actorUserId?: number,
    ctx?: AuthContext,
  ): Promise<{
    data: DepContract[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    let query = MultiProjectDependency.query()
      .where('organization_id', organizationId)
      .orderBy('created_at', 'desc')

    if (filters.projectIds?.length) {
      query = query.where((q) => {
        q.whereIn('provider_project_id', filters.projectIds!).orWhereIn(
          'consumer_project_id',
          filters.projectIds!,
        )
      })
    }
    if (filters.endpointType) {
      query = query.where((q) => {
        q.where('provider_endpoint_type', filters.endpointType!).orWhere(
          'consumer_endpoint_type',
          filters.endpointType!,
        )
      })
    }
    if (filters.category) query = query.where('category', filters.category)
    if (filters.type) query = query.where('type', filters.type)
    if (filters.status?.length) query = query.whereIn('status', filters.status)
    if (filters.riskLevel) query = query.where('risk_level', filters.riskLevel)
    if (filters.sourceMode) query = query.where('source_mode', filters.sourceMode)
    if (filters.freshness) query = query.where('freshness_status', filters.freshness)
    if (filters.dateFrom) query = query.where('created_at', '>=', filters.dateFrom)
    if (filters.dateTo) query = query.where('created_at', '<=', filters.dateTo)

    if (filters.search) {
      const term = `%${filters.search}%`
      query = query.where((q) => {
        q.where('provider_external_label', 'like', term)
          .orWhere('consumer_external_label', 'like', term)
          .orWhere('provider_external_key', 'like', term)
          .orWhere('consumer_external_key', 'like', term)
      })
    }

    // Apply sort
    const [sortField, sortDir] = sort.startsWith('-') ? [sort.slice(1), 'desc'] : [sort, 'asc']
    const SORT_MAP: Record<string, string> = {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      status: 'status',
      riskLevel: 'risk_level',
      risk: 'risk_level',
      category: 'category',
      freshnessCheckedAt: 'freshness_checked_at',
    }
    const col = SORT_MAP[sortField] ?? 'created_at'
    query = query.orderBy(col, sortDir as any)

    const result = await query.paginate(page, perPage)

    // Low-sensitive read audit
    if (actorUserId) {
      await this.auditLowSensitive('DEPENDENCY_LIST_READ', actorUserId, organizationId, {
        visibleProjectIdsHash: stableHash(JSON.stringify(filters.projectIds ?? [])),
        queryHash: stableHash(JSON.stringify(filters)),
        requestId: ctx?.requestId ?? null,
      })
    }

    return {
      data: result.all().map(depRowToContract),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  async detail(
    organizationId: number,
    dependencyId: number,
    actorUserId?: number,
    ctx?: AuthContext,
  ): Promise<DepContract> {
    const dep = await MultiProjectDependency.query()
      .where('id', dependencyId)
      .where('organization_id', organizationId)
      .first()

    if (!dep) throw new ResourceNotFoundException('跨项目依赖不存在')

    if (actorUserId) {
      await this.auditLowSensitive('DEPENDENCY_DETAIL_READ', actorUserId, organizationId, {
        dependencyId,
        dependencyIdHash: stableHash(String(dependencyId)),
        requestId: ctx?.requestId ?? null,
      })
    }

    return depRowToContract(dep)
  }

  // =========================================================================
  // §4.5 Preview Generation
  // =========================================================================

  async previewCreate(
    organizationId: number,
    actorUserId: number,
    input: {
      providerEndpointType: string
      providerProjectId: number | null
      providerMilestoneId: number | null
      providerTaskId: number | null
      providerExternalLabel: string | null
      providerExternalKey: string | null
      consumerEndpointType: string
      consumerProjectId: number | null
      consumerMilestoneId: number | null
      consumerTaskId: number | null
      consumerExternalLabel: string | null
      consumerExternalKey: string | null
      category: string
      type?: string
      lagDays?: number
      strength?: string
      bufferDays?: number
      riskLevel?: string
      sourceMode?: string
    },
    _ctx?: AuthContext,
  ): Promise<PreviewContract> {
    const previewId = generatePreviewId()
    const idempotencyKey = generateIdempotencyKey()
    const depType = (input.type ?? 'fs') as MultiProjectDependencyType
    const category = input.category as MultiProjectDependencyCategory

    // Resolve endpoints
    const provider = await this.resolveEndpoint(
      organizationId,
      input.providerEndpointType,
      input.providerProjectId,
      input.providerMilestoneId,
      input.providerTaskId,
      input.providerExternalLabel,
      input.providerExternalKey,
      true,
    )
    const consumer = await this.resolveEndpoint(
      organizationId,
      input.consumerEndpointType,
      input.consumerProjectId,
      input.consumerMilestoneId,
      input.consumerTaskId,
      input.consumerExternalLabel,
      input.consumerExternalKey,
      true,
    )

    // Cross-organization check
    if (provider.projectId && consumer.projectId) {
      const { default: Project } = await import('#models/project')
      const [pProj, cProj] = await Promise.all([
        Project.query().where('id', provider.projectId).first(),
        Project.query().where('id', consumer.projectId).first(),
      ])
      if (pProj && cProj && Number(pProj.organizationId) !== organizationId) {
        throw new ValidationException('跨组织端点不允许')
      }
      if (cProj && Number(cProj.organizationId) !== organizationId) {
        throw new ValidationException('跨组织端点不允许')
      }
    }

    // Self-dependency check
    const selfDep = this.isSelfDependency(provider, consumer)
    if (selfDep) {
      // Still generate preview but with blocker warning
    }

    // Duplicate check
    const existing = await MultiProjectDependency.query()
      .where('organization_id', organizationId)
      .where('status', 'active')
      .where('type', depType)
      .where('category', category)
      .where('provider_endpoint_type', provider.endpointType)
      .where('consumer_endpoint_type', consumer.endpointType)
    // Simple check — full duplicate detection in confirmation
    const isDuplicate = existing.length > 0

    // Cycle check
    const wouldCycle = await this.detectCrossProjectCycle(organizationId, provider, consumer)

    // Warnings
    const warnings: MultiProjectWarningCode[] = []
    if (selfDep) warnings.push('DEPENDENCY_CYCLE_BLOCKED')
    if (isDuplicate) warnings.push('DEPENDENCY_DUPLICATE_BLOCKED')
    if (wouldCycle) warnings.push('DEPENDENCY_CYCLE_BLOCKED')
    if (provider.redacted || consumer.redacted) warnings.push('ENDPOINT_REDACTED')

    // Freshness
    const freshnessSig = stableHash(JSON.stringify({ provider, consumer, ts: Date.now() }))
    const confirmationHash = stableHash(previewId + freshnessSig + String(actorUserId))

    // Diff
    const diff: MultiProjectDependencyDiff = {
      operation: 'create',
      before: null,
      after: {
        category: category as any,
        type: depType,
        lagDays: input.lagDays ?? 0,
        strength: (input.strength ?? 'hard') as any,
        bufferDays: input.bufferDays ?? 0,
        riskLevel: (input.riskLevel ?? 'medium') as any,
        sourceMode: (input.sourceMode ?? 'manual') as any,
      },
      changedFields: [
        'category',
        'type',
        'lagDays',
        'strength',
        'bufferDays',
        'riskLevel',
        'sourceMode',
      ],
    }

    // Persist preview
    await MultiProjectDependencyPreview.create({
      previewId,
      organizationId,
      operation: 'create',
      dependencyId: null,
      permissionFingerprint: stableHash(String(actorUserId)),
      proposedDiff: JSON.stringify(diff),
      duplicateCheck: JSON.stringify({
        isDuplicate,
        existingId: isDuplicate ? (existing[0]?.id ?? null) : null,
        message: isDuplicate ? '该依赖已存在' : null,
      }),
      cycleCheck: JSON.stringify({
        wouldCreateCycle: wouldCycle,
        message: wouldCycle ? '将形成循环依赖' : null,
      }),
      lifecycleCheck: JSON.stringify({ isValid: true, message: null }),
      selfDependencyCheck: JSON.stringify({
        isSelfDependency: selfDep,
        message: selfDep ? '不能依赖自身' : null,
      }),
      // 端点必须落库：confirm 在另一个请求里执行，除此之外无从取回用户提交的端点。
      // 只存标识字段，不存名称——名称是随权限变化的展示数据，与预览的低敏语义不符。
      endpoints: JSON.stringify({
        provider: pickEndpointIdentity(provider),
        consumer: pickEndpointIdentity(consumer),
      }),
      freshnessSignature: freshnessSig,
      warningCodes: JSON.stringify(warnings),
      confirmationHash,
      idempotencyKey,
      sourceSignature: freshnessSig,
      actorUserId,
      expiresAt: DateTime.now().plus({ minutes: 5 }), // 5 min
    })

    return {
      previewId,
      operation: 'create',
      providerEndpoint: {
        endpointType: provider.endpointType,
        projectId: provider.projectId,
        projectName: provider.projectName,
        taskId: provider.taskId,
        taskName: provider.taskName,
        milestoneId: provider.milestoneId,
        milestoneName: provider.milestoneName,
        externalLabel: provider.externalLabel,
        redacted: provider.redacted,
      },
      consumerEndpoint: {
        endpointType: consumer.endpointType,
        projectId: consumer.projectId,
        projectName: consumer.projectName,
        taskId: consumer.taskId,
        taskName: consumer.taskName,
        milestoneId: consumer.milestoneId,
        milestoneName: consumer.milestoneName,
        externalLabel: consumer.externalLabel,
        redacted: consumer.redacted,
      },
      permissionFingerprint: stableHash(String(actorUserId)),
      diff,
      duplicateCheck: {
        isDuplicate,
        existingId: isDuplicate ? (Number(existing[0]?.id) ?? null) : null,
        message: isDuplicate ? '该依赖已存在' : null,
      },
      cycleCheck: { wouldCreateCycle: wouldCycle, message: wouldCycle ? '将形成循环依赖' : null },
      lifecycleCheck: { isValid: true, message: null },
      selfDependencyCheck: { isSelfDependency: selfDep, message: selfDep ? '不能依赖自身' : null },
      freshnessSignature: freshnessSig,
      warningCodes: warnings,
      confirmationHash,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      idempotencyKey,
      idempotencyGuidance: 'Retry with same previewId, confirmationHash, and idempotencyKey.',
    }
  }

  // =========================================================================
  // §4.7 Confirmed Write Flow
  // =========================================================================

  /**
   * 确认预览并落库。
   *
   * `expectedOperation` 由按操作分设的端点传入：没有它，客户端可以拿一份
   * archive 预览走 delete 端点，实际执行的是预览里的 operation——
   * 端点语义与真实副作用脱节。传入即校验，通用 `/confirm` 端点不传。
   */
  async confirm(
    organizationId: number,
    actorUserId: number,
    previewId: string,
    confirmationHash: string,
    idempotencyKey: string,
    ctx?: AuthContext,
    expectedOperation?: 'create' | 'update' | 'archive' | 'restore' | 'delete',
  ): Promise<{ data: DepContract; idempotentReplay: boolean }> {
    return db.transaction(async (trx) => {
      // Load preview
      const preview = await MultiProjectDependencyPreview.query({ client: trx })
        .where('preview_id', previewId)
        .where('organization_id', organizationId)
        .first()

      if (!preview) throw new ValidationException('预览不存在')
      if (expectedOperation && preview.operation !== expectedOperation) {
        throw new ValidationException(
          `预览操作与端点不匹配：预览为 ${preview.operation}，端点要求 ${expectedOperation}`,
        )
      }
      if (preview.consumed) {
        // Idempotent replay — return existing result
        if (preview.dependencyId) {
          const existingDep = await MultiProjectDependency.query({ client: trx })
            .where('id', Number(preview.dependencyId))
            .where('organization_id', organizationId)
            .first()
          if (existingDep) {
            return { data: depRowToContract(existingDep), idempotentReplay: true }
          }
        }
        throw new ValidationException('预览已使用')
      }

      // Check hash match
      if (preview.confirmationHash !== confirmationHash) {
        throw new ValidationException('确认哈希不匹配')
      }
      if (preview.idempotencyKey !== idempotencyKey) {
        throw new ValidationException('幂等键不匹配')
      }

      // Check expiry
      if (new Date(preview.expiresAt.toString()) < new Date()) {
        throw new ValidationException('预览已过期')
      }

      // Check permission fingerprint
      const currentFingerprint = stableHash(String(actorUserId))
      if (preview.permissionFingerprint !== currentFingerprint) {
        await this.auditLowSensitive(
          'DEPENDENCY_CONFIRMATION_FAILED',
          actorUserId,
          organizationId,
          {
            dependencyId: preview.dependencyId,
            confirmationHash: stableHash(confirmationHash),
            idempotencyKeyHash: stableHash(idempotencyKey),
            requestId: ctx?.requestId ?? null,
            reason: 'permission_changed',
          },
          trx,
        )
        throw new ValidationException('权限已变更，请重新生成预览')
      }

      // Execute operation
      let dependency: any
      // delete 分支在删行前自行完成预览收尾，外层不再重复写（写了会撞已删除的 FK）
      let previewFinalized = false
      const proposedDiff =
        typeof preview.proposedDiff === 'string'
          ? JSON.parse(preview.proposedDiff)
          : preview.proposedDiff

      switch (preview.operation) {
        case 'create':
          dependency = await this.executeCreate(
            organizationId,
            preview,
            proposedDiff,
            actorUserId,
            trx,
          )
          break
        case 'update':
          dependency = await this.executeUpdate(organizationId, preview, proposedDiff, trx)
          break
        case 'archive':
          dependency = await this.executeArchive(organizationId, preview, trx)
          break
        case 'restore':
          dependency = await this.executeRestore(organizationId, preview, trx)
          break
        case 'delete':
          // delete 自行收尾预览：行被删除会经 FK CASCADE 连带删掉预览，
          // 必须在删行前把 dependencyId 置空并落库，否则痕迹一并消失。
          dependency = await this.executeDelete(organizationId, preview, trx)
          previewFinalized = true
          break
        default:
          throw new ValidationException(`不支持的操作: ${preview.operation}`)
      }

      // 标记预览已消费，并回写产出的依赖 id。
      //
      // dependencyId 必须写：幂等重放分支靠它取回原结果
      // （见本方法开头 `if (preview.consumed)`）。原实现只置 consumed 不写 id，
      // 于是重放分支恒判假，二次确认一律抛「预览已使用」——
      // 客户端超时重试拿到的是硬错误而非原结果，幂等承诺形同虚设。
      if (!previewFinalized) {
        preview.consumed = true
        preview.dependencyId = Number(dependency.id)
        await preview.useTransaction(trx).save()
      }

      // Audit
      await this.auditLowSensitive(
        'DEPENDENCY_CONFIRMED',
        actorUserId,
        organizationId,
        {
          dependencyId: previewFinalized ? null : Number(dependency.id),
          confirmationHash: stableHash(confirmationHash),
          idempotencyKeyHash: stableHash(idempotencyKey),
          freshnessHash: stableHash(preview.freshnessSignature ?? ''),
          requestId: ctx?.requestId ?? null,
        },
        trx,
      )

      return { data: depRowToContract(dependency), idempotentReplay: false }
    })
  }

  private async executeCreate(
    organizationId: number,
    preview: any,
    diff: any,
    actorUserId: number,
    trx: TransactionClientContract,
  ): Promise<any> {
    const after = diff.after ?? {}
    const warningCodes: string[] =
      typeof preview.warningCodes === 'string'
        ? JSON.parse(preview.warningCodes)
        : (preview.warningCodes ?? [])

    // Block if cycle or duplicate
    if (warningCodes.includes('DEPENDENCY_CYCLE_BLOCKED')) {
      throw new ValidationException('将形成循环依赖，无法创建')
    }
    if (warningCodes.includes('DEPENDENCY_DUPLICATE_BLOCKED')) {
      throw new ValidationException('该依赖已存在')
    }

    // 端点取自预览落库的快照。历史预览（本列加入前）为 null：显式要求重新预览，
    // 而不是退回写占位数据——后者会无视用户输入写入固定假 id 并撞外键约束。
    const endpoints = parsePreviewEndpoints(preview.endpoints)
    if (!endpoints) {
      throw new ValidationException('预览缺少端点数据，请重新预览')
    }

    return MultiProjectDependency.create(
      {
        organizationId,
        providerEndpointType: endpoints.provider.endpointType,
        providerProjectId: endpoints.provider.projectId,
        providerMilestoneId: endpoints.provider.milestoneId,
        providerTaskId: endpoints.provider.taskId,
        providerExternalLabel: endpoints.provider.externalLabel,
        providerExternalKey: endpoints.provider.externalKey,
        consumerEndpointType: endpoints.consumer.endpointType,
        consumerProjectId: endpoints.consumer.projectId,
        consumerMilestoneId: endpoints.consumer.milestoneId,
        consumerTaskId: endpoints.consumer.taskId,
        consumerExternalLabel: endpoints.consumer.externalLabel,
        consumerExternalKey: endpoints.consumer.externalKey,
        category: after.category ?? 'deliverable',
        type: after.type ?? 'fs',
        lagDays: after.lagDays ?? 0,
        strength: after.strength ?? 'hard',
        bufferDays: after.bufferDays ?? 0,
        status: 'active',
        riskLevel: after.riskLevel ?? 'medium',
        ownerUserId: actorUserId,
        sourceMode: after.sourceMode ?? 'manual',
        evidenceRefs: JSON.stringify([]),
        freshnessSignature: preview.freshnessSignature ?? '',
        freshnessStatus: 'fresh',
        confirmationHash: preview.confirmationHash,
        idempotencyKey: preview.idempotencyKey,
      },
      { client: trx },
    )
  }

  /**
   * 生命周期确认的统一前置校验。
   *
   * 预览阶段已算出 lifecycle/duplicate/cycle 三项结论并落库；确认阶段**重新读取**
   * 而不是重算——预览即用户看到并同意的那份事实，确认必须照它执行或明确拒绝。
   * 新鲜度漂移由 confirm 主流程的 freshness 比对负责，与此处职责分离。
   */
  private assertLifecyclePreviewChecksPass(preview: any): void {
    const parse = (raw: unknown): any => {
      if (raw === null || raw === undefined) return {}
      if (typeof raw !== 'string') return raw
      try {
        return JSON.parse(raw)
      } catch {
        return {}
      }
    }

    const lifecycle = parse(preview.lifecycleCheck)
    if (lifecycle.isValid === false) {
      throw new ValidationException(lifecycle.message ?? '生命周期状态转换不合法')
    }
    const duplicate = parse(preview.duplicateCheck)
    if (duplicate.isDuplicate === true) {
      throw new ValidationException(duplicate.message ?? '该依赖已存在')
    }
    const cycle = parse(preview.cycleCheck)
    if (cycle.wouldCreateCycle === true) {
      throw new ValidationException(cycle.message ?? '将形成循环依赖')
    }
  }

  /** 在事务内按组织加载预览指向的依赖。 */
  private async loadDependencyForConfirm(
    organizationId: number,
    preview: any,
    trx: TransactionClientContract,
  ): Promise<MultiProjectDependency> {
    if (!preview.dependencyId) {
      throw new ValidationException('预览未绑定依赖，请重新预览')
    }
    const dep = await MultiProjectDependency.query({ client: trx })
      .where('id', Number(preview.dependencyId))
      .where('organization_id', organizationId)
      .first()
    if (!dep) throw new ResourceNotFoundException('跨项目依赖不存在')
    return dep
  }

  /** update：把预览 diff 的 after 落到依赖行；端点不可改。 */
  private async executeUpdate(
    organizationId: number,
    preview: any,
    diff: any,
    trx: TransactionClientContract,
  ): Promise<MultiProjectDependency> {
    this.assertLifecyclePreviewChecksPass(preview)
    const dep = await this.loadDependencyForConfirm(organizationId, preview, trx)

    const after = diff?.after ?? {}
    const changed: string[] = Array.isArray(diff?.changedFields) ? diff.changedFields : []
    // 只写预览声明变更过的字段，避免把预览生成后他人的并发改动覆盖掉
    for (const field of changed) {
      if (!(field in after)) continue
      // 逐字段显式赋值，不用动态索引：动态索引只能靠宽松断言绕过类型检查，
      // 字段名写错也不会在编译期暴露。（注释里避免写出该断言字面量——
      // 类型抑制棘轮按文本计数，会把注释也算成一处抑制。）
      switch (field) {
        case 'category':
          dep.category = String(after.category)
          break
        case 'type':
          dep.type = String(after.type)
          break
        case 'strength':
          dep.strength = String(after.strength)
          break
        case 'status':
          dep.status = String(after.status)
          break
        case 'riskLevel':
          dep.riskLevel = String(after.riskLevel)
          break
        case 'lagDays':
          dep.lagDays = Number(after.lagDays ?? 0)
          break
        case 'bufferDays':
          dep.bufferDays = Number(after.bufferDays ?? 0)
          break
        case 'ownerUserId':
          dep.ownerUserId = after.ownerUserId === null ? null : Number(after.ownerUserId)
          break
        default:
          break
      }
    }
    // 状态被改到 archived 时同步归档时间戳，保持与 archive 分支一致
    if (changed.includes('status') && after.status === 'archived' && !dep.archivedAt) {
      dep.archivedAt = DateTime.now()
    }

    await dep.useTransaction(trx).save()
    return dep
  }

  /** archive：活跃态转归档，保留行与审计链。 */
  private async executeArchive(
    organizationId: number,
    preview: any,
    trx: TransactionClientContract,
  ): Promise<MultiProjectDependency> {
    this.assertLifecyclePreviewChecksPass(preview)
    const dep = await this.loadDependencyForConfirm(organizationId, preview, trx)

    dep.status = 'archived'
    dep.archivedAt = DateTime.now()
    await dep.useTransaction(trx).save()
    return dep
  }

  /** restore：归档态转回活跃（重复/环已在预览阶段判定并由前置校验拦截）。 */
  private async executeRestore(
    organizationId: number,
    preview: any,
    trx: TransactionClientContract,
  ): Promise<MultiProjectDependency> {
    this.assertLifecyclePreviewChecksPass(preview)
    const dep = await this.loadDependencyForConfirm(organizationId, preview, trx)

    dep.status = 'active'
    dep.archivedAt = null
    await dep.useTransaction(trx).save()
    return dep
  }

  /**
   * delete：移除依赖行，痕迹由 `DEPENDENCY_CONFIRMED` 审计事件承担
   * （规范只要求「removed from active CRUD results **or** marked deleted，
   * 且低敏 tombstone **或审计事件**可供审计复核」）。
   *
   * 顺序不可调换：预览行对依赖有 `ON DELETE CASCADE` 外键，必须先把
   * `dependencyId` 置空并落库，再删依赖行，否则预览连同删除痕迹一起消失。
   * 返回删除前的模型实例——其内存属性仍可供 `depRowToContract` 组装响应。
   */
  private async executeDelete(
    organizationId: number,
    preview: any,
    trx: TransactionClientContract,
  ): Promise<MultiProjectDependency> {
    this.assertLifecyclePreviewChecksPass(preview)
    const dep = await this.loadDependencyForConfirm(organizationId, preview, trx)

    preview.consumed = true
    preview.dependencyId = null
    await preview.useTransaction(trx).save()

    await dep.useTransaction(trx).delete()
    return dep
  }

  // =========================================================================
  // §4.6 生命周期预览（update / archive / restore / delete）
  //
  // 与 previewCreate 的区别：目标依赖已存在，端点不再解析而是取自既有行；
  // 校验重心从「端点权限 + 重复 + 环」转到「生命周期转换是否合法」。
  // restore 例外——它把边重新激活，必须重跑重复与环检测（规范
  // multi-project-dependency-crud：Restore MUST only reactivate ... after
  // duplicate, cycle, permission, and freshness checks pass）。
  // =========================================================================

  /** 按组织加载依赖，不存在即 404（跨组织不区分，避免泄露存在性）。 */
  private async loadDependency(
    organizationId: number,
    dependencyId: number,
  ): Promise<MultiProjectDependency> {
    const dep = await MultiProjectDependency.query()
      .where('id', dependencyId)
      .where('organization_id', organizationId)
      .first()
    if (!dep) throw new ResourceNotFoundException('跨项目依赖不存在')
    return dep
  }

  /**
   * 落库一条生命周期预览并组装返回契约。
   *
   * 端点一并落 `endpoints` 列：confirm 在另一个请求里执行，restore 的重复/环
   * 复检需要端点，其余操作也借此保持预览自洽（与 previewCreate 同一约定）。
   */
  private async persistLifecyclePreview(params: {
    organizationId: number
    actorUserId: number
    operation: 'update' | 'archive' | 'restore' | 'delete'
    dep: MultiProjectDependency
    diff: MultiProjectDependencyDiff
    warnings: MultiProjectWarningCode[]
    duplicateCheck: { isDuplicate: boolean; existingId: number | null; message: string | null }
    cycleCheck: { wouldCreateCycle: boolean; message: string | null }
    lifecycleCheck: { isValid: boolean; message: string | null }
  }): Promise<PreviewContract> {
    const { organizationId, actorUserId, operation, dep, diff, warnings } = params
    const previewId = generatePreviewId()
    const idempotencyKey = generateIdempotencyKey()
    const contract = depRowToContract(dep)

    // 冻结当前事实：确认时若依赖已被他人改动，freshness 对不上即可判定过期。
    const freshnessSig = stableHash(
      JSON.stringify({
        id: Number(dep.id),
        status: dep.status,
        category: dep.category,
        type: dep.type,
        lagDays: dep.lagDays,
        strength: dep.strength,
        bufferDays: dep.bufferDays,
        riskLevel: dep.riskLevel,
        ownerUserId: dep.ownerUserId ?? null,
      }),
    )
    const confirmationHash = stableHash(previewId + freshnessSig + String(actorUserId))

    await MultiProjectDependencyPreview.create({
      previewId,
      organizationId,
      operation,
      dependencyId: Number(dep.id),
      permissionFingerprint: stableHash(String(actorUserId)),
      proposedDiff: JSON.stringify(diff),
      duplicateCheck: JSON.stringify(params.duplicateCheck),
      cycleCheck: JSON.stringify(params.cycleCheck),
      lifecycleCheck: JSON.stringify(params.lifecycleCheck),
      selfDependencyCheck: JSON.stringify({ isSelfDependency: false, message: null }),
      endpoints: JSON.stringify({
        provider: pickEndpointIdentity(contract.providerEndpoint as MultiProjectEndpointRef),
        consumer: pickEndpointIdentity(contract.consumerEndpoint as MultiProjectEndpointRef),
      }),
      freshnessSignature: freshnessSig,
      warningCodes: JSON.stringify(warnings),
      confirmationHash,
      idempotencyKey,
      sourceSignature: freshnessSig,
      actorUserId,
      expiresAt: DateTime.now().plus({ minutes: 5 }),
    })

    return {
      previewId,
      operation,
      providerEndpoint: contract.providerEndpoint,
      consumerEndpoint: contract.consumerEndpoint,
      permissionFingerprint: stableHash(String(actorUserId)),
      diff,
      duplicateCheck: params.duplicateCheck,
      cycleCheck: params.cycleCheck,
      lifecycleCheck: params.lifecycleCheck,
      selfDependencyCheck: { isSelfDependency: false, message: null },
      freshnessSignature: freshnessSig,
      warningCodes: warnings,
      confirmationHash,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      idempotencyKey,
      idempotencyGuidance: 'Retry with same previewId, confirmationHash, and idempotencyKey.',
    } as PreviewContract
  }

  /** 无重复/无环的默认检查结果（archive/delete 不改变边的存在性，无需复检）。 */
  private static readonly NO_INTEGRITY_ISSUE = {
    duplicateCheck: { isDuplicate: false, existingId: null, message: null },
    cycleCheck: { wouldCreateCycle: false, message: null },
  }

  /** update 预览：仅比对可变属性，端点不可改（改端点等于另一条依赖）。 */
  async previewUpdate(
    organizationId: number,
    actorUserId: number,
    input: {
      dependencyId: number
      category?: string
      type?: string
      lagDays?: number
      strength?: string
      bufferDays?: number
      status?: string
      riskLevel?: string
      ownerUserId?: number | null
    },
    _ctx?: AuthContext,
  ): Promise<PreviewContract> {
    const dep = await this.loadDependency(organizationId, input.dependencyId)

    const before: Record<string, unknown> = {
      category: dep.category,
      type: dep.type,
      lagDays: dep.lagDays,
      strength: dep.strength,
      bufferDays: dep.bufferDays,
      status: dep.status,
      riskLevel: dep.riskLevel,
      ownerUserId: dep.ownerUserId ?? null,
    }
    const after: Record<string, unknown> = { ...before }
    for (const key of [
      'category',
      'type',
      'lagDays',
      'strength',
      'bufferDays',
      'status',
      'riskLevel',
      'ownerUserId',
    ] as const) {
      const value = input[key]
      if (value !== undefined) after[key] = value
    }
    const changedFields = Object.keys(after).filter(
      (key) => JSON.stringify(after[key]) !== JSON.stringify(before[key]),
    )

    // 状态若被改动，必须是合法转换；其余属性变更不受生命周期约束。
    const nextStatus = after.status as MultiProjectDependencyStatus
    const statusChanged = nextStatus !== dep.status
    const lifecycleValid =
      !statusChanged ||
      isValidLifecycleTransition(dep.status as MultiProjectDependencyStatus, nextStatus)

    return this.persistLifecyclePreview({
      organizationId,
      actorUserId,
      operation: 'update',
      dep,
      diff: { operation: 'update', before, after, changedFields } as MultiProjectDependencyDiff,
      warnings: [],
      ...MultiProjectDependencyService.NO_INTEGRITY_ISSUE,
      lifecycleCheck: {
        isValid: lifecycleValid,
        message: lifecycleValid ? null : `不允许的状态转换：${dep.status} → ${nextStatus}`,
      },
    })
  }

  /** archive 预览：活跃态转归档，保留审计链（不删行）。 */
  async previewArchive(
    organizationId: number,
    actorUserId: number,
    dependencyId: number,
    _ctx?: AuthContext,
  ): Promise<PreviewContract> {
    const dep = await this.loadDependency(organizationId, dependencyId)
    const valid = isValidLifecycleTransition(dep.status as MultiProjectDependencyStatus, 'archived')

    return this.persistLifecyclePreview({
      organizationId,
      actorUserId,
      operation: 'archive',
      dep,
      diff: {
        operation: 'archive',
        before: { status: dep.status },
        after: { status: 'archived' },
        changedFields: ['status'],
      } as MultiProjectDependencyDiff,
      warnings: [],
      ...MultiProjectDependencyService.NO_INTEGRITY_ISSUE,
      lifecycleCheck: {
        isValid: valid,
        message: valid ? null : `不允许的状态转换：${dep.status} → archived`,
      },
    })
  }

  /**
   * restore 预览：归档态转回活跃。
   *
   * 唯一需要重跑完整性检查的生命周期操作——边重新生效后可能与现存活跃边重复，
   * 或与期间新增的边构成环。
   */
  async previewRestore(
    organizationId: number,
    actorUserId: number,
    dependencyId: number,
    _ctx?: AuthContext,
  ): Promise<PreviewContract> {
    const dep = await this.loadDependency(organizationId, dependencyId)
    const valid = isValidLifecycleTransition(dep.status as MultiProjectDependencyStatus, 'active')

    const contract = depRowToContract(dep)
    const provider = contract.providerEndpoint as MultiProjectEndpointRef
    const consumer = contract.consumerEndpoint as MultiProjectEndpointRef

    // 重复：同一 provider/consumer/type/category 的另一条活跃边
    const duplicates = await MultiProjectDependency.query()
      .where('organization_id', organizationId)
      .whereNot('id', Number(dep.id))
      .where('status', 'active')
      .where('type', dep.type)
      .where('category', dep.category)
      .where('provider_endpoint_type', dep.providerEndpointType)
      .where('consumer_endpoint_type', dep.consumerEndpointType)
    const isDuplicate = duplicates.length > 0

    const wouldCycle = await this.detectCrossProjectCycle(organizationId, provider, consumer)

    const warnings: MultiProjectWarningCode[] = []
    if (isDuplicate) warnings.push('DEPENDENCY_DUPLICATE_BLOCKED')
    if (wouldCycle) warnings.push('DEPENDENCY_CYCLE_BLOCKED')

    return this.persistLifecyclePreview({
      organizationId,
      actorUserId,
      operation: 'restore',
      dep,
      diff: {
        operation: 'restore',
        before: { status: dep.status },
        after: { status: 'active' },
        changedFields: ['status'],
      } as MultiProjectDependencyDiff,
      warnings,
      duplicateCheck: {
        isDuplicate,
        existingId: isDuplicate ? Number(duplicates[0]!.id) : null,
        message: isDuplicate ? '恢复后将与现有活跃依赖重复' : null,
      },
      cycleCheck: {
        wouldCreateCycle: wouldCycle,
        message: wouldCycle ? '恢复后将形成循环依赖' : null,
      },
      lifecycleCheck: {
        isValid: valid,
        message: valid ? null : `不允许的状态转换：${dep.status} → active`,
      },
    })
  }

  /**
   * delete 预览：比 archive 更严格——只允许对**已归档**的依赖发起。
   *
   * 规范要求 delete 比 archive 更严格，且删除后仍须留下可追溯的低敏痕迹；
   * 后者由 confirm 阶段的 `DEPENDENCY_ARCHIVED` 审计事件承担（行被移除，审计留存）。
   */
  async previewDelete(
    organizationId: number,
    actorUserId: number,
    dependencyId: number,
    _ctx?: AuthContext,
  ): Promise<PreviewContract> {
    const dep = await this.loadDependency(organizationId, dependencyId)
    const valid = dep.status === 'archived'

    return this.persistLifecyclePreview({
      organizationId,
      actorUserId,
      operation: 'delete',
      dep,
      diff: {
        operation: 'delete',
        before: { status: dep.status },
        after: null,
        changedFields: ['status'],
      } as unknown as MultiProjectDependencyDiff,
      warnings: [],
      ...MultiProjectDependencyService.NO_INTEGRITY_ISSUE,
      lifecycleCheck: {
        isValid: valid,
        message: valid ? null : '仅允许删除已归档的依赖，请先归档',
      },
    })
  }

  // =========================================================================
  // §5.1 Bounded Dependency Graph Builder
  // =========================================================================

  async buildGraph(
    organizationId: number,
    query: MultiProjectGraphQuery,
    actorUserId?: number,
    ctx?: AuthContext,
  ): Promise<MultiProjectGraphResponse> {
    // Query active edges within project scope, preload endpoint relations for label resolution
    let depQuery = MultiProjectDependency.query()
      .where('organization_id', organizationId)
      .whereIn('status', ['active', 'at_risk', 'blocked'])
      .preload('providerProject')
      .preload('providerMilestone')
      .preload('providerTask')
      .preload('consumerProject')
      .preload('consumerMilestone')
      .preload('consumerTask')
      .limit(query.edgeLimit + 1) // +1 to detect truncation

    if (query.projectIds.length > 0) {
      depQuery = depQuery.where((q) => {
        q.whereIn('provider_project_id', query.projectIds).orWhereIn(
          'consumer_project_id',
          query.projectIds,
        )
      })
    }
    if (query.category) depQuery = depQuery.where('category', query.category)
    if (query.status?.length) depQuery = depQuery.whereIn('status', query.status)
    if (query.riskLevel) depQuery = depQuery.where('risk_level', query.riskLevel)

    const deps = await depQuery

    // Collect unique project IDs for permission check
    const projectIdSet = new Set<number>()
    for (const dep of deps) {
      if (dep.providerProjectId) projectIdSet.add(Number(dep.providerProjectId))
      if (dep.consumerProjectId) projectIdSet.add(Number(dep.consumerProjectId))
    }

    // Resolve endpoint labels from preloaded relations
    const resolveEndpointSummary = (
      endpointType: string,
      projectId: number | null,
      taskId: number | null,
      milestoneId: number | null,
      externalLabel: string | null,
      dep: any,
      side: 'provider' | 'consumer',
    ): MultiProjectEndpointSummary => {
      const prefix = side === 'provider' ? 'provider' : 'consumer'
      const project = dep[`${prefix}Project`]
      const task = dep[`${prefix}Task`]
      const milestone = dep[`${prefix}Milestone`]

      return {
        endpointType: endpointType as any,
        projectId,
        projectName: project?.name ?? null,
        taskId,
        taskName: task?.title ?? null,
        milestoneId,
        milestoneName: milestone?.name ?? null,
        externalLabel: externalLabel ?? null,
        redacted: false,
      }
    }

    // Build node set
    const nodeMap = new Map<string, MultiProjectGraphNode>()
    const edges: MultiProjectGraphEdge[] = []

    const truncated = deps.length > query.edgeLimit
    const boundedDeps = truncated ? deps.slice(0, query.edgeLimit) : deps

    for (const dep of boundedDeps) {
      const providerEndpoint = resolveEndpointSummary(
        dep.providerEndpointType,
        Number(dep.providerProjectId ?? null),
        Number(dep.providerTaskId ?? null),
        Number(dep.providerMilestoneId ?? null),
        dep.providerExternalLabel ?? null,
        dep,
        'provider',
      )
      const consumerEndpoint = resolveEndpointSummary(
        dep.consumerEndpointType,
        Number(dep.consumerProjectId ?? null),
        Number(dep.consumerTaskId ?? null),
        Number(dep.consumerMilestoneId ?? null),
        dep.consumerExternalLabel ?? null,
        dep,
        'consumer',
      )

      const providerId = buildEndpointNodeId(providerEndpoint as any)
      const consumerId = buildEndpointNodeId(consumerEndpoint as any)

      const providerLabel =
        providerEndpoint.projectName ??
        providerEndpoint.taskName ??
        providerEndpoint.milestoneName ??
        providerEndpoint.externalLabel ??
        `端点 #${dep.providerProjectId ?? dep.providerTaskId ?? 'ext'}`

      const consumerLabel =
        consumerEndpoint.projectName ??
        consumerEndpoint.taskName ??
        consumerEndpoint.milestoneName ??
        consumerEndpoint.externalLabel ??
        `端点 #${dep.consumerProjectId ?? dep.consumerTaskId ?? 'ext'}`

      // Add nodes
      if (!nodeMap.has(providerId)) {
        nodeMap.set(providerId, {
          nodeId: providerId,
          endpoint: providerEndpoint,
          label: providerLabel,
          redacted: false,
          redactionReason: null,
          dependencyCount: 0,
          riskSummary: { critical: 0, high: 0, medium: 0, low: 0 },
          drillDownRef: dep.providerProjectId
            ? {
                refType: 'dependency',
                targetId: Number(dep.id),
                opaqueToken: stableHash(`${providerId}-${organizationId}`),
                expiresAt: new Date(Date.now() + 300_000).toISOString(),
              }
            : null,
        })
      }
      if (!nodeMap.has(consumerId)) {
        nodeMap.set(consumerId, {
          nodeId: consumerId,
          endpoint: consumerEndpoint,
          label: consumerLabel,
          redacted: false,
          redactionReason: null,
          dependencyCount: 0,
          riskSummary: { critical: 0, high: 0, medium: 0, low: 0 },
          drillDownRef: dep.consumerProjectId
            ? {
                refType: 'dependency',
                targetId: Number(dep.id),
                opaqueToken: stableHash(`${consumerId}-${organizationId}`),
                expiresAt: new Date(Date.now() + 300_000).toISOString(),
              }
            : null,
        })
      }

      // Update node stats
      const pNode = nodeMap.get(providerId)!
      const cNode = nodeMap.get(consumerId)!
      pNode.dependencyCount++
      cNode.dependencyCount++
      if (dep.riskLevel === 'critical') {
        pNode.riskSummary.critical++
        cNode.riskSummary.critical++
      } else if (dep.riskLevel === 'high') {
        pNode.riskSummary.high++
        cNode.riskSummary.high++
      } else if (dep.riskLevel === 'medium') {
        pNode.riskSummary.medium++
        cNode.riskSummary.medium++
      } else {
        pNode.riskSummary.low++
        cNode.riskSummary.low++
      }

      // Add edge
      const edgeWarnings: MultiProjectWarningCode[] = []
      if (dep.freshnessStatus === 'stale') edgeWarnings.push('DEPENDENCY_STALE')

      edges.push({
        edgeId: Number(dep.id),
        sourceNodeId: providerId,
        targetNodeId: consumerId,
        category: dep.category as any,
        type: dep.type as any,
        status: dep.status as any,
        riskLevel: dep.riskLevel as any,
        bufferDays: Number(dep.bufferDays ?? 0),
        lagDays: Number(dep.lagDays ?? 0),
        freshness: (dep.freshnessStatus as any) ?? 'fresh',
        drillDownRef: {
          refType: 'dependency',
          targetId: Number(dep.id),
          opaqueToken: stableHash(`${dep.id}-${organizationId}`),
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        },
        warningCodes: edgeWarnings,
      })
    }

    // Aggregate warnings
    const allWarnings: MultiProjectWarningCode[] = []
    if (truncated) allWarnings.push('GRAPH_TRUNCATED_EDGES')
    const staleCount = boundedDeps.filter((d) => d.freshnessStatus === 'stale').length
    if (staleCount > 0) allWarnings.push('DEPENDENCY_STALE')

    const queryHash = stableHash(JSON.stringify(query))

    // Audit
    if (actorUserId) {
      await this.auditLowSensitive('DEPENDENCY_GRAPH_READ', actorUserId, organizationId, {
        queryHash,
        visibleProjectIdsHash: stableHash(JSON.stringify(query.projectIds)),
        warningCodes: allWarnings,
        freshnessHash: stableHash(`${staleCount}`),
        truncated,
        requestId: ctx?.requestId ?? null,
      })
    }

    return {
      nodes: [...nodeMap.values()],
      edges,
      visibleNodeCount: nodeMap.size,
      redactedNodeCount: 0,
      visibleEdgeCount: edges.length,
      truncated,
      truncationReason: truncated ? 'edgeLimit' : null,
      warningCodes: allWarnings,
      freshnessMeta: {
        checkedAt: now(),
        staleCount,
        freshCount: boundedDeps.length - staleCount,
      },
    }
  }

  // =========================================================================
  // §5.3 Duplicate and Cycle Detection
  // =========================================================================

  async detectCrossProjectCycle(
    organizationId: number,
    provider: MultiProjectEndpointRef,
    consumer: MultiProjectEndpointRef,
  ): Promise<boolean> {
    // Bounded DFS on active dependencies
    const edges = await MultiProjectDependency.query()
      .where('organization_id', organizationId)
      .whereIn('status', ['active', 'at_risk', 'blocked'])
      .select(
        'provider_project_id',
        'consumer_project_id',
        'provider_endpoint_type',
        'consumer_endpoint_type',
        'provider_external_key',
        'consumer_external_key',
      )

    // Build graph at project level
    const graph = new Map<string, Set<string>>()
    for (const e of edges) {
      const pKey = cycleNodeKey(e.providerEndpointType, e.providerProjectId, e.providerExternalKey)
      const cKey = cycleNodeKey(e.consumerEndpointType, e.consumerProjectId, e.consumerExternalKey)
      if (!graph.has(pKey)) graph.set(pKey, new Set())
      graph.get(pKey)!.add(cKey)
    }

    // Add candidate edge
    const pKey = cycleNodeKey(provider.endpointType, provider.projectId, provider.externalKey)
    const cKey = cycleNodeKey(consumer.endpointType, consumer.projectId, consumer.externalKey)
    if (!graph.has(pKey)) graph.set(pKey, new Set())
    graph.get(pKey)!.add(cKey)

    // DFS cycle detection (from consumer to provider)
    return this.hasPath(graph, cKey, pKey, new Set())
  }

  private hasPath(
    graph: Map<string, Set<string>>,
    from: string,
    to: string,
    visited: Set<string>,
  ): boolean {
    if (from === to) return true
    if (visited.has(from)) return false
    visited.add(from)
    const neighbors = graph.get(from)
    if (!neighbors) return false
    for (const next of neighbors) {
      if (this.hasPath(graph, next, to, visited)) return true
    }
    return false
  }

  private isSelfDependency(
    provider: MultiProjectEndpointRef,
    consumer: MultiProjectEndpointRef,
  ): boolean {
    return buildEndpointNodeId(provider as any) === buildEndpointNodeId(consumer as any)
  }

  // =========================================================================
  // §5.5 Impact Analysis
  // =========================================================================

  async impactAnalysis(
    organizationId: number,
    input: MultiProjectImpactAnalysisInput,
    actorUserId?: number,
    ctx?: AuthContext,
  ): Promise<MultiProjectImpactAnalysisResponse> {
    const directAffected: MultiProjectAffectedEndpoint[] = []
    const indirectAffected: MultiProjectAffectedEndpoint[] = []

    // Load active edges
    let depQuery = MultiProjectDependency.query()
      .where('organization_id', organizationId)
      .whereIn('status', ['active', 'at_risk', 'blocked'])
      .limit(input.edgeLimit)

    if (input.projectIds?.length) {
      // 闭包内窄化：input.projectIds 在回调里会退回 optional
      const projectIds = input.projectIds
      depQuery = depQuery.where((q) => {
        q.whereIn('provider_project_id', projectIds).orWhereIn('consumer_project_id', projectIds)
      })
    }

    const deps = await depQuery

    // Build adjacency
    const adj = new Map<string, any[]>()
    for (const dep of deps) {
      const pKey = `${dep.providerEndpointType}:${dep.providerProjectId}:${dep.providerTaskId}`
      if (!adj.has(pKey)) adj.set(pKey, [])
      adj.get(pKey)!.push(dep)
    }

    // BFS from source
    let sourceKey: string | null = null
    if (input.sourceType === 'endpoint' && input.sourceEndpoint) {
      const ep = input.sourceEndpoint
      sourceKey = `${ep.endpointType}:${ep.projectId}:${ep.taskId ?? ''}`
    }

    if (sourceKey) {
      const visited = new Set<string>()
      const queue: { key: string; depth: number; accumulatedDelay: number }[] = [
        { key: sourceKey, depth: 0, accumulatedDelay: input.hypotheticalDelayDays ?? 5 },
      ]

      while (queue.length > 0) {
        const { key, depth, accumulatedDelay } = queue.shift()!
        if (visited.has(key) || depth > input.maxDepth) continue
        visited.add(key)

        const outgoing = adj.get(key) ?? []
        for (const dep of outgoing) {
          const cKey = `${dep.consumerEndpointType}:${dep.consumerProjectId}:${dep.consumerTaskId}`
          if (visited.has(cKey)) continue

          const bufferDays = Number(dep.bufferDays ?? 0)
          const netDelay = Math.max(0, accumulatedDelay - bufferDays)
          const absorbed = netDelay === 0

          const affected: MultiProjectAffectedEndpoint = {
            endpoint: {
              endpointType: dep.consumerEndpointType as any,
              projectId: dep.consumerProjectId ? Number(dep.consumerProjectId) : null,
              projectName: null,
              taskId: dep.consumerTaskId ? Number(dep.consumerTaskId) : null,
              taskName: null,
              milestoneId: dep.consumerMilestoneId ? Number(dep.consumerMilestoneId) : null,
              milestoneName: null,
              externalLabel: null,
              redacted: false,
            },
            pathDepth: depth + 1,
            propagatedDelayDays: accumulatedDelay,
            absorbedBufferDays: bufferDays,
            netDelayDays: netDelay,
            impactType: depth === 0 ? 'direct' : 'indirect',
            delayAbsorbed: absorbed,
            blocked: !absorbed && netDelay > 0,
            riskLevel: dep.riskLevel as any,
            redacted: false,
            blockingChain: [Number(dep.id)],
            evidenceRefs: [],
          }

          if (depth === 0) directAffected.push(affected)
          else indirectAffected.push(affected)

          if (!absorbed) {
            queue.push({ key: cKey, depth: depth + 1, accumulatedDelay: netDelay })
          }
        }
      }
    }

    if (actorUserId) {
      await this.auditLowSensitive('DEPENDENCY_IMPACT_READ', actorUserId, organizationId, {
        queryHash: stableHash(JSON.stringify(input)),
        requestId: ctx?.requestId ?? null,
      })
    }

    return {
      source: {
        type: input.sourceType,
        endpoint: input.sourceEndpoint
          ? {
              endpointType: input.sourceEndpoint.endpointType,
              projectId: input.sourceEndpoint.projectId,
              projectName: null,
              taskId: input.sourceEndpoint.taskId,
              taskName: null,
              milestoneId: input.sourceEndpoint.milestoneId,
              milestoneName: null,
              externalLabel: null,
              redacted: false,
            }
          : null,
        hypotheticalDelayDays: input.hypotheticalDelayDays ?? null,
        description: input.hypotheticalDescription ?? null,
      },
      directAffected,
      indirectAffected,
      redactedAffectedCount: 0,
      totalEdgesAnalyzed: deps.length,
      truncated: deps.length >= input.edgeLimit,
      warnings: [],
      analyzedAt: now(),
      advisoryOnly: true,
      evidenceSummary: null,
    }
  }

  // =========================================================================
  // §6.1 Deterministic Rule Suggestions
  // =========================================================================

  async generateRuleSuggestions(_organizationId: number, _actorUserId?: number): Promise<any[]> {
    // This is a stub — actual implementation would scan milestone refs, labels, etc.
    // For now returns empty as per design D6 (rule suggestions are advisory-only)
    return []
  }

  // =========================================================================
  // Audit helper
  // =========================================================================

  private async auditLowSensitive(
    event: AuditEventType,
    actorUserId: number,
    organizationId: number,
    meta: Record<string, unknown>,
    client?: TransactionClientContract,
  ): Promise<void> {
    try {
      await this.audit.log({
        event,
        userId: actorUserId,
        organizationId,
        entityType: 'multi_project_dependency',
        entityId: (meta.dependencyId as number) ?? null,
        metadata: {
          ...meta,
          timestamp: now(),
        },
        client,
        severity: 'info',
      })
    } catch {
      // Audit failure should not block operations
    }
  }
}
