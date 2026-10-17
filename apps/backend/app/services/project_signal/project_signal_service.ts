import app from '@adonisjs/core/services/app'
import { DateTime } from 'luxon'
import { ConflictException, ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'
import ProjectSignal from '#models/project_signal'
import Project from '#models/project'
import { formatProjectCode } from '@aiproj/types'
import TrizCopilotAnalysis from '#models/triz_copilot_analysis'
import TenantScope from '#services/tenant_scope'
import AuditService, { AuditEvent, type AuditEventType } from '#services/audit_service'
import { hashParameters } from '#services/ai_tools/ai_tools_audit_helper'
import ProjectSignalDetectionService from './project_signal_detection_service.js'
import {
  PROJECT_SIGNAL_TYPE_LABELS,
  windowExpiry,
  type ProjectSignalDetectionResult,
  type ProjectSignalEvidence,
  type ProjectSignalStatus,
  type ProjectSignalTier,
  type ProjectSignalType,
} from './signal_contracts.js'
import { SIGNAL_EXPIRY_SWEEP_LIMIT, SIGNAL_EXPIRY_TTL_DAYS } from './signal_thresholds.js'
import {
  redactSignalEvidence,
  requiredPermissionFor,
  type SignalDomainAccess,
} from './signal_permissions.js'

/**
 * v3-triz-contradiction-copilot W3 任务 3.3 / 3.4 —— 雷达信号持久化、幂等、过期与状态机。
 *
 * 分层职责：
 * - 检测（`ProjectSignalDetectionService`）**只读**；本服务是信号表唯一的写入入口；
 * - 读取（`list` / `findById`）**零写入**——超期转 expired 只发生在检测写入路径与显式
 *   `expireDue` 中，避免「读一次列表就改了状态」的隐式副作用（RL-06）；
 * - 组织隔离：全部查询双列（`organization_id` + `project_id`）过滤，跨组织 / 不存在统一 404。
 *
 * 幂等与状态机（spec「信号去重、过期与状态流转」）：
 * - 同一「项目 + 类型 + 观测窗」库层唯一；重复检测命中既有行**更新读数**、绝不新建重复行；
 * - `open → dismissed / adopted / expired`；已忽略（dismissed）信号不因同观测窗证据再次出现；
 *   新观测窗产生新行 ⇒ 自然重新激活（新的证据变化）；
 * - 状态流转记录操作人、时间、前后状态并产生审计事件；分层变更保留旧分层痕迹。
 *
 * RL-12：审计只落 `parametersHash` / 状态 / 枚举 / 计数，不落证据正文或陈述原文。
 */
export const PROJECT_SIGNAL_RADAR_TOOL_NAME = 'project_signal_radar'

export const PROJECT_SIGNAL_LIST_DEFAULT_PER_PAGE = 20
export const PROJECT_SIGNAL_LIST_MAX_PER_PAGE = 100

export interface ProjectSignalServiceDeps {
  detectionService?: Pick<ProjectSignalDetectionService, 'detect'>
  audit?: AuditService
}

export interface ProjectSignalRequestContext {
  organizationId: number
  projectId: number
  user: User
  requestId?: string | null
}

export interface ProjectSignalDetectRequest extends ProjectSignalRequestContext {
  asOfDate?: string
  windowDays?: number
  evaluatedAt?: string
}

export interface ProjectSignalDetectResult {
  detection: ProjectSignalDetectionResult
  /** 本次检测新建的信号 */
  created: ProjectSignal[]
  /** 命中既有行并刷新读数的信号 */
  refreshed: ProjectSignal[]
  /** 本次检测顺带转 expired 的信号数（超期未处理） */
  expired: number
}

export interface ProjectSignalListRequest extends ProjectSignalRequestContext {
  /** 缺省 `open`（活跃卡片视图）；历史查询显式传 `all` 或具体状态 */
  status?: ProjectSignalStatus | 'all'
  confidenceTier?: ProjectSignalTier
  signalType?: ProjectSignalType
  page?: number
  perPage?: number
  /** 领域权限持有情况（由 Policy 解析；缺省空表 = fail-closed 裁剪全部证据） */
  domainAccess?: SignalDomainAccess
}

export interface OrganizationSignalListRequest {
  organizationId: number
  user: User
  status?: ProjectSignalStatus | 'all'
  confidenceTier?: ProjectSignalTier
  signalType?: ProjectSignalType
  /** 按信号 ID 精确查（信号编号 `PROJ-8#S10` 定位用；仍受组织隔离与状态过滤） */
  signalId?: number
  page?: number
  perPage?: number
  domainAccess?: SignalDomainAccess
}

export interface ProjectSignalListResult {
  data: ProjectSignalDTO[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface ProjectSignalTransitionRequest extends ProjectSignalRequestContext {
  signalId: number
  domainAccess?: SignalDomainAccess
  note?: string | null
}

export interface ProjectSignalAdoptRequest extends ProjectSignalTransitionRequest {
  /** 关联既有分析记录（可空：先标记采纳、后补关联） */
  analysisId?: number | null
}

export interface ProjectSignalDTO {
  id: number
  organizationId: number
  projectId: number
  /** 列表接口附带：所属项目名称与编号（信号编号 = 项目编号#S信号ID） */
  projectName?: string | null
  projectCode?: string
  signalType: ProjectSignalType
  signalTypeLabel: string
  confidenceTier: ProjectSignalTier
  tierReasons: Record<string, unknown>
  severity: string
  /** 低敏证据；无领域权限时为 null（裁剪，不泄露受限数据） */
  evidence: ProjectSignalEvidence | null
  evidenceRedacted: boolean
  /** 裁剪原因（如 `missing_permission:risk:view`） */
  redactedReason: string | null
  /** 读取该类型证据所需领域权限（供前端做物理阻断与中性说明） */
  requiredPermission: string
  idempotencyKey: string
  observationWindow: string
  expiresAt: string | null
  status: ProjectSignalStatus
  previousStatus: ProjectSignalStatus | null
  statusChangedBy: number | null
  statusChangedAt: string | null
  adoptedAnalysisId: number | null
  createdBy: number | null
  createdAt: string | null
  updatedAt: string | null
}

export default class ProjectSignalService {
  readonly #deps: ProjectSignalServiceDeps

  constructor(deps: ProjectSignalServiceDeps = {}) {
    this.#deps = deps
  }

  // ── 检测并落库（唯一的写入路径） ─────────────────────────────────────

  /**
   * 检测 → 落库。顺序：先让超期信号转 expired，再按观测窗 upsert 候选信号。
   * 业务表（任务 / 风险 / 议题 / 里程碑 / 资源）零写入：检测只读，写入仅限 `project_signals`。
   */
  async detectAndPersist(request: ProjectSignalDetectRequest): Promise<ProjectSignalDetectResult> {
    const startedAt = Date.now()
    const audit = await this.#resolveAudit()
    const detection = await this.#detectionService().detect({
      organizationId: request.organizationId,
      projectId: request.projectId,
      asOfDate: request.asOfDate,
      windowDays: request.windowDays,
      evaluatedAt: request.evaluatedAt,
    })

    const expired = await this.expireDue({
      organizationId: request.organizationId,
      projectId: request.projectId,
      asOfDate: detection.asOfDate,
      user: request.user,
      requestId: request.requestId ?? null,
    })

    const created: ProjectSignal[] = []
    const refreshed: ProjectSignal[] = []

    for (const candidate of detection.signals) {
      const existing = await this.#findByWindow(
        request.organizationId,
        request.projectId,
        candidate.signalType,
        candidate.observationWindow.key,
      )

      if (!existing) {
        const record = await ProjectSignal.create({
          organizationId: request.organizationId,
          projectId: request.projectId,
          signalType: candidate.signalType,
          confidenceTier: candidate.confidenceTier,
          tierReasons: candidate.tierReasons as unknown as Record<string, unknown>,
          severity: candidate.severity,
          evidence: candidate.evidence as unknown as Record<string, unknown>,
          idempotencyKey: candidate.idempotencyKey,
          observationWindow: candidate.observationWindow.key,
          expiresAt: DateTime.fromISO(
            windowExpiry(candidate.observationWindow.to, SIGNAL_EXPIRY_TTL_DAYS),
          ),
          status: 'open',
          previousStatus: null,
          statusChangedBy: null,
          statusChangedAt: null,
          adoptedAnalysisId: null,
          createdBy: Number(request.user.id),
          deletedAt: null,
        })
        created.push(record)
        await this.#audit(audit, {
          event: AuditEvent.AI_RECOMMENDATION_GENERATED,
          status: 'SUCCESS',
          action: 'generate',
          request,
          record,
          startedAt,
          extra: {
            confidenceTier: candidate.confidenceTier,
            compositeTypes: candidate.tierReasons.compositeTypes,
          },
        })
        continue
      }

      const tierChanged = existing.confidenceTier !== candidate.confidenceTier
      existing.tierReasons = {
        ...(candidate.tierReasons as unknown as Record<string, unknown>),
        // 分层变更痕迹：保留旧分层（spec「置信分层与呈现路由」第 4 条）
        previousTier: tierChanged ? existing.confidenceTier : null,
      }
      existing.confidenceTier = candidate.confidenceTier
      existing.severity = candidate.severity
      existing.evidence = candidate.evidence as unknown as Record<string, unknown>
      existing.idempotencyKey = candidate.idempotencyKey
      existing.expiresAt = DateTime.fromISO(
        windowExpiry(candidate.observationWindow.to, SIGNAL_EXPIRY_TTL_DAYS),
      )
      // 状态保持不变：已忽略不会被同观测窗的证据重新激活（新观测窗另起一行）。
      await existing.save()
      refreshed.push(existing)

      if (tierChanged) {
        await this.#audit(audit, {
          event: AuditEvent.AI_RECOMMENDATION_STATUS_CHANGED,
          status: 'SUCCESS',
          action: 'tier_changed',
          request,
          record: existing,
          startedAt,
          extra: {
            confidenceTier: candidate.confidenceTier,
            previousTier: existing.tierReasons.previousTier,
          },
        })
      }
    }

    return { detection, created, refreshed, expired }
  }

  // ── 过期（显式写入路径；读取不触发） ─────────────────────────────────

  /**
   * 把超期未处理的 `open` 信号转为 `expired`（历史仍可查）。返回转换条数。
   *
   * 过期比较在应用层按 `expires_at` 逐条判定（不依赖方言的时间串比较），
   * 单次扫描上限 `SIGNAL_EXPIRY_SWEEP_LIMIT`，按最早超期优先，余量留待下次扫描。
   */
  async expireDue(input: {
    organizationId: number
    projectId: number
    asOfDate: string
    user: User
    requestId?: string | null
  }): Promise<number> {
    const startedAt = Date.now()
    const audit = await this.#resolveAudit()
    const deadline = DateTime.fromISO(`${input.asOfDate}T23:59:59.000Z`)

    const candidates = await TenantScope.forOrganization(
      ProjectSignal.query(),
      input.organizationId,
    )
      .where('project_id', input.projectId)
      .whereNull('deleted_at')
      .where('status', 'open')
      .orderBy('expires_at', 'asc')
      .limit(SIGNAL_EXPIRY_SWEEP_LIMIT)

    const due = candidates.filter((record) => {
      if (!record.expiresAt) return false
      return record.expiresAt.toMillis() < deadline.toMillis()
    })

    for (const record of due) {
      record.previousStatus = record.status
      record.status = 'expired'
      record.statusChangedBy = Number(input.user.id)
      record.statusChangedAt = DateTime.now()
      await record.save()

      await this.#audit(audit, {
        event: AuditEvent.AI_RECOMMENDATION_STATUS_CHANGED,
        status: 'SUCCESS',
        action: 'expire',
        request: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          user: input.user,
          requestId: input.requestId ?? null,
        },
        record,
        startedAt,
        extra: { previousStatus: 'open' },
      })
    }

    return due.length
  }

  // ── 读取（零写入） ──────────────────────────────────────────────────

  async list(request: ProjectSignalListRequest): Promise<ProjectSignalListResult> {
    const page = normalizePositive(request.page, 1)
    const perPage = Math.min(
      normalizePositive(request.perPage, PROJECT_SIGNAL_LIST_DEFAULT_PER_PAGE),
      PROJECT_SIGNAL_LIST_MAX_PER_PAGE,
    )
    const domainAccess = request.domainAccess ?? {}
    const status = request.status ?? 'open'

    const query = TenantScope.forOrganization(ProjectSignal.query(), request.organizationId)
      .where('project_id', request.projectId)
      .whereNull('deleted_at')

    if (status !== 'all') query.where('status', status)
    if (request.confidenceTier) query.where('confidence_tier', request.confidenceTier)
    if (request.signalType) query.where('signal_type', request.signalType)

    query.orderBy('created_at', 'desc').orderBy('id', 'desc')

    const countRows = (await query.clone().clearOrder().count('* as total')) as unknown as Array<{
      $extras: { total: number | string }
    }>
    const total = Number(countRows[0]?.$extras?.total ?? 0)
    const rows = await query.offset((page - 1) * perPage).limit(perPage)
    const projects = await this.#projectLabels(request.organizationId, rows)

    return {
      data: rows.map((row) => ({
        ...this.toDTO(row, domainAccess),
        ...projects(Number(row.projectId)),
      })),
      meta: {
        total,
        page,
        perPage,
        totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0,
      },
    }
  }

  /** 组织级信号列表（跨项目聚合查询，按当前组织强制过滤，零写入）。 */
  async listForOrganization(
    request: OrganizationSignalListRequest,
  ): Promise<ProjectSignalListResult> {
    const page = normalizePositive(request.page, 1)
    const perPage = Math.min(
      normalizePositive(request.perPage, PROJECT_SIGNAL_LIST_DEFAULT_PER_PAGE),
      PROJECT_SIGNAL_LIST_MAX_PER_PAGE,
    )
    const domainAccess = request.domainAccess ?? {}
    const status = request.status ?? 'open'

    const query = TenantScope.forOrganization(
      ProjectSignal.query(),
      request.organizationId,
    ).whereNull('deleted_at')

    if (status !== 'all') query.where('status', status)
    if (request.confidenceTier) query.where('confidence_tier', request.confidenceTier)
    if (request.signalType) query.where('signal_type', request.signalType)
    if (request.signalId) query.where('id', request.signalId)

    query.orderBy('created_at', 'desc').orderBy('id', 'desc')

    const countRows = (await query.clone().clearOrder().count('* as total')) as unknown as Array<{
      $extras: { total: number | string }
    }>
    const total = Number(countRows[0]?.$extras?.total ?? 0)
    const rows = await query.offset((page - 1) * perPage).limit(perPage)
    // 跨多个项目：带上项目名与项目编号（原先只能显示「项目 #8」，信号编号也拼不出来）
    const projects = await this.#projectLabels(request.organizationId, rows)

    return {
      data: rows.map((row) => ({
        ...this.toDTO(row, domainAccess),
        ...projects(Number(row.projectId)),
      })),
      meta: {
        total,
        page,
        perPage,
        totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0,
      },
    }
  }

  /** 列表行所属项目的名称与编号（组织内查；查不到给 null，编号回退 `PROJ-{id}`）。 */
  async #projectLabels(organizationId: number, rows: ProjectSignal[]) {
    const projectIds = [...new Set(rows.map((row) => Number(row.projectId)))]
    const projects =
      projectIds.length > 0
        ? await Project.query()
            .where('organization_id', organizationId)
            .whereIn('id', projectIds)
            .select('id', 'name', 'code')
        : []
    const byId = new Map(projects.map((project) => [Number(project.id), project]))
    return (projectId: number) => {
      const project = byId.get(projectId)
      return {
        projectName: project?.name ?? null,
        projectCode: formatProjectCode({ id: projectId, code: project?.code ?? null }),
      }
    }
  }

  /** 详情：组织 + 项目双隔离，跨组织 / 不存在统一 404。 */
  async findById(organizationId: number, projectId: number, signalId: number) {
    return this.#requireRecord(organizationId, projectId, signalId)
  }

  // ── 状态流转 ────────────────────────────────────────────────────────

  /** 忽略：`open → dismissed`；同观测窗证据不再复发。 */
  async dismiss(request: ProjectSignalTransitionRequest): Promise<ProjectSignal> {
    const record = await this.#requireRecord(
      request.organizationId,
      request.projectId,
      request.signalId,
    )
    return this.#transition({
      request,
      record,
      to: 'dismissed',
      action: 'dismiss',
      event: AuditEvent.AI_RECOMMENDATION_STATUS_CHANGED,
    })
  }

  /** 采纳：`open → adopted`，可关联分析记录（双向可追溯）。 */
  async adopt(request: ProjectSignalAdoptRequest): Promise<ProjectSignal> {
    const record = await this.#requireRecord(
      request.organizationId,
      request.projectId,
      request.signalId,
    )

    let analysisId: number | null = null
    if (request.analysisId !== undefined && request.analysisId !== null) {
      const analysis = await TenantScope.forOrganization(
        TrizCopilotAnalysis.query(),
        request.organizationId,
      )
        .where('project_id', request.projectId)
        .where('id', request.analysisId)
        .whereNull('deleted_at')
        .first()
      if (!analysis) throw new ResourceNotFoundException('分析记录不存在或不属于当前项目')
      analysisId = Number(analysis.id)
    }

    return this.#transition({
      request,
      record,
      to: 'adopted',
      action: 'adopt',
      event: AuditEvent.AI_RECOMMENDATION_STATUS_CHANGED,
      mutate: async (target) => {
        target.adoptedAnalysisId = analysisId ?? target.adoptedAnalysisId ?? null
        if (analysisId !== null) {
          // 双向可追溯：从分析记录可反查来源信号（`triz_copilot_analyses.source_signal_id`）。
          await TrizCopilotAnalysis.query()
            .where('organization_id', request.organizationId)
            .where('project_id', request.projectId)
            .where('id', analysisId)
            .update({ source_signal_id: Number(target.id) })
        }
      },
    })
  }

  // ── 投影 ────────────────────────────────────────────────────────────

  /** DTO 投影：无领域权限时证据字段整体裁剪为 null（不泄露受限数据内容）。 */
  toDTO(record: ProjectSignal, domainAccess: SignalDomainAccess = {}): ProjectSignalDTO {
    const signalType = record.signalType
    const requiredPermission = requiredPermissionFor(signalType)
    const { evidence, evidenceRedacted, redactedReason } = redactSignalEvidence(
      signalType,
      record.evidence,
      domainAccess,
    )

    return {
      id: Number(record.id),
      organizationId: Number(record.organizationId),
      projectId: Number(record.projectId),
      signalType,
      signalTypeLabel: PROJECT_SIGNAL_TYPE_LABELS[signalType] ?? String(signalType),
      confidenceTier: record.confidenceTier,
      tierReasons: record.tierReasons ?? {},
      severity: String(record.severity),
      evidence,
      evidenceRedacted,
      redactedReason,
      requiredPermission: String(requiredPermission),
      idempotencyKey: String(record.idempotencyKey),
      observationWindow: String(record.observationWindow),
      expiresAt: record.expiresAt ? record.expiresAt.toISO() : null,
      status: record.status,
      previousStatus: record.previousStatus ?? null,
      statusChangedBy: toNullableNumber(record.statusChangedBy),
      statusChangedAt: record.statusChangedAt ? record.statusChangedAt.toISO() : null,
      adoptedAnalysisId: toNullableNumber(record.adoptedAnalysisId),
      createdBy: toNullableNumber(record.createdBy),
      createdAt: record.createdAt ? record.createdAt.toISO() : null,
      updatedAt: record.updatedAt ? record.updatedAt.toISO() : null,
    }
  }

  // ── 内部 ────────────────────────────────────────────────────────────

  async #transition(input: {
    request: ProjectSignalTransitionRequest
    record: ProjectSignal
    to: ProjectSignalStatus
    action: string
    event: AuditEventType
    mutate?: (record: ProjectSignal) => Promise<void>
  }): Promise<ProjectSignal> {
    const startedAt = Date.now()
    const { record, request } = input

    if (record.status !== 'open') {
      const actionLabel =
        input.to === 'adopted' ? '采纳' : input.to === 'dismissed' ? '忽略' : input.to
      throw new ConflictException(
        `信号当前状态为『${record.status}』，只有待处理（open）信号可以流转为${actionLabel}`,
      )
    }

    await input.mutate?.(record)

    record.previousStatus = record.status
    record.status = input.to
    record.statusChangedBy = Number(request.user.id)
    record.statusChangedAt = DateTime.now()
    await record.save()

    await this.#audit(await this.#resolveAudit(), {
      event: input.event,
      status: 'SUCCESS',
      action: input.action,
      request,
      record,
      startedAt,
      extra: {
        previousStatus: record.previousStatus,
        adoptedAnalysisId: record.adoptedAnalysisId ?? null,
        // 备注只入哈希，不落正文（RL-12）
        noteHash: request.note ? hashParameters({ note: request.note }) : null,
      },
    })

    return record
  }

  async #findByWindow(
    organizationId: number,
    projectId: number,
    signalType: ProjectSignalType,
    observationWindow: string,
  ): Promise<ProjectSignal | null> {
    return TenantScope.forOrganization(ProjectSignal.query(), organizationId)
      .where('project_id', projectId)
      .where('signal_type', signalType)
      .where('observation_window', observationWindow)
      .whereNull('deleted_at')
      .first()
  }

  async #requireRecord(
    organizationId: number,
    projectId: number,
    signalId: number,
  ): Promise<ProjectSignal> {
    const record = await TenantScope.forOrganization(ProjectSignal.query(), organizationId)
      .where('project_id', projectId)
      .where('id', signalId)
      .whereNull('deleted_at')
      .first()
    if (!record) {
      // 跨组织 / 不存在 / 已软删统一同一响应（RL-05：不泄露存在性）
      throw new ResourceNotFoundException('信号不存在')
    }
    return record
  }

  #detectionService(): Pick<ProjectSignalDetectionService, 'detect'> {
    return this.#deps.detectionService ?? new ProjectSignalDetectionService()
  }

  async #resolveAudit(): Promise<AuditService | null> {
    if (this.#deps.audit) return this.#deps.audit
    try {
      return await app.container.make(AuditService)
    } catch {
      return null
    }
  }

  /** 低敏审计：信号 ID / 项目 / 用户 / 组织 + 动作、状态、前后状态、参数哈希（无正文，RL-12）。 */
  async #audit(
    audit: AuditService | null,
    input: {
      event: AuditEventType
      status: string
      action: string
      request: ProjectSignalRequestContext
      record: ProjectSignal
      startedAt: number
      extra?: Record<string, unknown>
    },
  ): Promise<void> {
    if (!audit) return
    // 信号自身的业务状态（open/dismissed/adopted/expired）与审计生命周期状态（SUCCESS/REJECTED…）
    // 必须并存可读：前者落 `signalStatus`，后者沿用仓库既有 `status` 约定（RL-12：均为枚举码）。
    const parameters = {
      action: input.action,
      signalId: Number(input.record.id),
      signalType: input.record.signalType,
      signalStatus: input.record.status,
      previousStatus: input.record.previousStatus ?? null,
      observationWindow: input.record.observationWindow,
    }
    await audit.log({
      event: input.event,
      userId: Number(input.request.user.id),
      organizationId: input.request.organizationId,
      projectId: input.request.projectId,
      requestId: input.request.requestId ?? null,
      entityType: 'project_signal',
      entityId: Number(input.record.id),
      metadata: {
        toolName: PROJECT_SIGNAL_RADAR_TOOL_NAME,
        parametersHash: hashParameters(parameters),
        durationMs: Date.now() - input.startedAt,
        errorCode: null,
        ...parameters,
        status: input.status,
        ...(input.extra ?? {}),
      },
    })
  }
}

function normalizePositive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : fallback
}

function toNullableNumber(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value)
}
