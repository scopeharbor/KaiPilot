import ProjectContradiction from '#models/project_contradiction'
import AuditService, { AuditEvent } from '#services/audit_service'
import ContradictionInputCollector from '#services/triz_contradiction/input_collector'
import ContradictionDetectionRuleset from '#services/triz_contradiction/ruleset'
import PrincipleSuggestionMapper from '#services/triz_contradiction/principle_mapper'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type {
  CandidateContradiction,
  ContradictionDTO,
  ContradictionStatus,
  ContradictionInputSnapshot,
  SuggestedPrinciple,
} from '@aiproj/types'
import {
  computeDedupeKey,
  computeInputSignature,
  CONTRADICTION_RULESET_VERSION,
  severityRank,
} from '@aiproj/types'

export interface RefreshOutcome {
  created: number
  updated: number
  unchanged: number
  superseded: number
  total: number
  ruleVersion: string
  inputSignature: string
  outputHash: string | null
}

/**
 * 矛盾服务（v2-triz-contradiction-model-foundation D5/D6）。
 *
 * 只读编排：收集输入 → 确定性规则 → 持久化/状态流转。
 * 输入收集、签名、规则、output hash 在**事务外**完成；事务只持久化，不在事务内二次查询
 * （规避 SQLite 单连接自锁）。所有读写强制 organization_id + project_id 双隔离。
 * 禁止修改任务/依赖/资源/风险/计划——矛盾只产出上游对立信号。
 */
@inject()
export default class ProjectContradictionService {
  constructor(
    private audit: AuditService,
    private collector: ContradictionInputCollector,
    private ruleset: ContradictionDetectionRuleset,
    private principleMapper: PrincipleSuggestionMapper,
  ) {}

  // ──────── 刷新（幂等派生 + upsert）────────

  /**
   * 创建或更新项目矛盾快照。
   *
   * 对外保留任务命名中的 createOrUpdate；实现复用 refresh 的确定性管线：
   * 事务外收集/计算，事务内仅持久化。
   */
  async createOrUpdate(
    organizationId: number,
    projectId: number,
    userId: number,
    requestId?: string | null,
  ): Promise<RefreshOutcome> {
    return this.refresh(organizationId, projectId, userId, requestId)
  }

  /**
   * 重新收集输入并幂等刷新项目矛盾。
   * 签名一致 → 不新建/不重写，仅复算 stale；签名变化 → upsert 候选，旧 draft 标记 superseded。
   */
  async refresh(
    organizationId: number,
    projectId: number,
    userId: number,
    requestId?: string | null,
  ): Promise<RefreshOutcome> {
    // 事务外：收集 → 签名 → 规则 → output hash（确定性、不触网）
    const snapshot = await this.collector.collect(organizationId, projectId)
    const inputSignature = computeInputSignature(snapshot)
    const { candidates, outputHash, ruleVersion, warnings } = this.ruleset.evaluate(snapshot)

    // 读取当前已存草稿/确认记录（事务外读，避免事务内自锁）
    const existing = await ProjectContradiction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereIn('status', ['draft', 'confirmed'])
      .orderBy('updated_at', 'desc')
      .select('id', 'dedupe_key', 'status', 'input_signature', 'stale', 'severity', 'confidence')

    // 签名一致：判定无变化，仅复算 stale（无候选也允许，代表项目无对立）
    const lastSignature = existing.length > 0 ? existing[0].inputSignature : null
    if (lastSignature === inputSignature) {
      await this.applyStaleFlags(organizationId, projectId, inputSignature)
      return {
        created: 0,
        updated: 0,
        unchanged: existing.length,
        superseded: 0,
        total: existing.length,
        ruleVersion,
        inputSignature,
        outputHash,
      }
    }

    // 签名变化：事务内 upsert（仅持久化，不在事务内二次查询）
    return db.transaction(async (trx) => {
      const existingByDedupe = new Map<string, ProjectContradiction>()
      for (const e of existing) existingByDedupe.set(e.dedupeKey, e)
      const candidateDedupeKeys = new Set<string>()

      let created = 0
      let updated = 0

      for (const candidate of candidates) {
        const dedupeKey = computeDedupeKey(projectId, candidate)
        candidateDedupeKeys.add(dedupeKey)
        const principles = this.principleMapper.suggestPrinciples(candidate)
        const prev = existingByDedupe.get(dedupeKey)

        if (prev) {
          // 已存在：更新严重度/置信度/证据/建议/签名，清 stale
          prev.severity = candidate.severity
          prev.confidence = candidate.confidence
          prev.evidence = candidate.evidence
          prev.suggestedPrinciples = principles
          prev.title = candidate.title
          prev.inputSignature = inputSignature
          prev.outputHash = outputHash
          prev.ruleVersion = ruleVersion
          prev.stale = false
          prev.staleReason = null
          if (prev.status === 'draft') {
            // 草稿可被覆盖更新
          }
          prev.useTransaction(trx)
          await prev.save()
          updated++
        } else {
          // 新建：物理矛盾或技术矛盾，按 type 写对应参数列
          const record = this.buildRecord(
            organizationId,
            projectId,
            dedupeKey,
            candidate,
            principles,
            inputSignature,
            outputHash,
            ruleVersion,
          )
          record.useTransaction(trx)
          await record.save()
          created++
        }
      }

      // 旧 draft 不在当前候选集 → 标记 superseded
      let superseded = 0
      for (const [dedupeKey, rec] of existingByDedupe) {
        if (candidateDedupeKeys.has(dedupeKey)) continue
        if (rec.status === 'draft') {
          rec.status = 'superseded' as ContradictionStatus
          rec.useTransaction(trx)
          await rec.save()
          superseded++
        } else if (rec.status === 'confirmed') {
          // 已确认但不再派生 → 标记 stale，保留供审计/报表
          rec.stale = true
          rec.staleReason = '当前项目事实变化后该矛盾不再被规则派生'
          rec.useTransaction(trx)
          await rec.save()
        }
      }

      // 审计：刷新（新建或状态变化时）
      if (created > 0 || superseded > 0 || updated > 0) {
        await this.audit.log({
          event: AuditEvent.CONTRADICTION_REFRESHED as any,
          userId,
          organizationId,
          projectId,
          entityType: 'project_contradiction',
          entityId: 0,
          requestId: requestId ?? null,
          client: trx,
          metadata: {
            ruleVersion,
            inputSignature,
            outputHash,
            created,
            updated,
            superseded,
            warningCount: warnings.length,
          },
          strict: true,
        })
      }

      return {
        created,
        updated,
        unchanged: 0,
        superseded,
        total: created + updated,
        ruleVersion,
        inputSignature,
        outputHash,
      }
    })
  }

  // ──────── 确认 ────────

  /** draft → confirmed，记录确认人/时间。 */
  async confirm(
    organizationId: number,
    projectId: number,
    contradictionId: number,
    userId: number,
    requestId?: string | null,
  ): Promise<ProjectContradiction> {
    const record = await this.findInScopeOrFail(organizationId, projectId, contradictionId)
    if (record.status === 'dismissed' || record.status === 'superseded') {
      throw new ValidationException('该矛盾已被忽略或取代，无法确认')
    }
    const prevStatus = record.status
    record.status = 'confirmed'
    record.confirmedBy = userId
    record.confirmedAt = DateTime.now()
    await record.save()

    await this.audit.log({
      event: AuditEvent.CONTRADICTION_CONFIRMED as any,
      userId,
      organizationId,
      projectId,
      entityType: 'project_contradiction',
      entityId: record.id,
      requestId: requestId ?? null,
      metadata: {
        dedupeKey: record.dedupeKey,
        type: record.type,
        severity: record.severity,
        ruleVersion: record.ruleVersion,
        prevStatus,
      },
    })
    return record
  }

  // ──────── 忽略 ────────

  /** 带理由忽略矛盾。 */
  async dismiss(
    organizationId: number,
    projectId: number,
    contradictionId: number,
    userId: number,
    dismissReason: string,
    requestId?: string | null,
  ): Promise<ProjectContradiction> {
    const record = await this.findInScopeOrFail(organizationId, projectId, contradictionId)
    if (record.status === 'superseded') {
      throw new ValidationException('该矛盾已被取代，无法忽略')
    }
    record.status = 'dismissed'
    record.dismissedBy = userId
    record.dismissedAt = DateTime.now()
    record.dismissReason = dismissReason
    await record.save()

    await this.audit.log({
      event: AuditEvent.CONTRADICTION_DISMISSED as any,
      userId,
      organizationId,
      projectId,
      entityType: 'project_contradiction',
      entityId: record.id,
      requestId: requestId ?? null,
      metadata: {
        dedupeKey: record.dedupeKey,
        type: record.type,
        severity: record.severity,
        ruleVersion: record.ruleVersion,
        dismissReason,
      },
    })
    return record
  }

  // ──────── 列表 / 详情 ────────

  async list(
    organizationId: number,
    projectId: number,
    opts: {
      page?: number
      perPage?: number
      type?: string | null
      status?: string | null
      severity?: string | null
    } = {},
  ): Promise<{
    data: ProjectContradiction[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const page = Math.max(1, opts.page ?? 1)
    const perPage = Math.min(100, Math.max(1, opts.perPage ?? 20))
    const query = ProjectContradiction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
    if (opts.type) query.where('type', opts.type)
    if (opts.status) query.where('status', opts.status)
    if (opts.severity) query.where('severity', opts.severity)
    // 稳定排序：严重度（critical→low）→ 创建时间倒序 → id
    query.orderByRaw(
      `CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC`,
    )
    query.orderBy('created_at', 'desc')
    query.orderBy('id', 'desc')

    const paginator = await query.paginate(page, perPage)
    const meta = paginator.getMeta()
    return {
      data: paginator.all(),
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
      },
    }
  }

  async get(
    organizationId: number,
    projectId: number,
    contradictionId: number,
  ): Promise<ProjectContradiction> {
    return this.findInScopeOrFail(organizationId, projectId, contradictionId)
  }

  // ──────── stale 复算 ────────

  /**
   * 复算 stale：重新收集当前输入比对 inputSignature，标记 stale。
   * 在事务外完成（避免 SQLite 单连接自锁）。
   */
  async computeStale(
    organizationId: number,
    projectId: number,
  ): Promise<{ snapshot: ContradictionInputSnapshot; isStale: boolean }> {
    const snapshot = await this.collector.collect(organizationId, projectId)
    const currentSignature = computeInputSignature(snapshot)
    const latest = await ProjectContradiction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereIn('status', ['draft', 'confirmed'])
      .orderBy('updated_at', 'desc')
      .first()
    if (!latest) {
      return { snapshot, isStale: false }
    }
    const isStale =
      latest.inputSignature !== currentSignature ||
      latest.ruleVersion !== CONTRADICTION_RULESET_VERSION
    if (latest.stale !== isStale) {
      latest.stale = isStale
      latest.staleReason = isStale ? '当前项目事实已变化，需刷新' : null
      await latest.save()
    }
    return { snapshot, isStale }
  }

  async saveAiExplanation(
    organizationId: number,
    projectId: number,
    contradictionId: number,
    explanation: ProjectContradiction['aiExplanation'],
  ): Promise<ProjectContradiction> {
    const record = await this.findInScopeOrFail(organizationId, projectId, contradictionId)
    record.aiExplanation = explanation
    await record.save()
    return record
  }

  // ──────── DTO 映射（权限脱敏由 Policy/Controller 控制；DTO 仅暴露低敏字段）────────

  toDTO(record: ProjectContradiction): ContradictionDTO {
    return {
      id: record.id,
      organizationId: record.organizationId,
      projectId: record.projectId,
      key: record.key,
      dedupeKey: record.dedupeKey,
      type: record.type,
      status: record.status,
      ruleId: record.ruleId,
      ruleVersion: record.ruleVersion,
      severity: record.severity,
      confidence: record.confidence,
      improvingParameterKey: record.improvingParameterKey,
      worseningParameterKey: record.worseningParameterKey,
      improvingDirection: record.improvingDirection,
      worseningDirection: record.worseningDirection,
      parameterKey: record.parameterKey,
      requirementA: record.requirementA,
      requirementB: record.requirementB,
      title: record.title,
      evidence: record.evidence,
      suggestedPrinciples: record.suggestedPrinciples,
      inputSignature: record.inputSignature,
      outputHash: record.outputHash,
      stale: record.stale,
      staleReason: record.staleReason,
      relatedChangeRequestId: record.relatedChangeRequestId,
      confirmedBy: record.confirmedBy,
      confirmedAt: record.confirmedAt?.toISO() ?? null,
      dismissedBy: record.dismissedBy,
      dismissedAt: record.dismissedAt?.toISO() ?? null,
      dismissReason: record.dismissReason,
      aiExplanation: record.aiExplanation,
      createdAt: record.createdAt.toISO() ?? '',
      updatedAt: record.updatedAt?.toISO() ?? null,
    }
  }

  // ──────── 内部 ────────

  /** 组织+项目双隔离查找；不存在抛 RESOURCE_NOT_FOUND（不泄露存在性）。 */
  private async findInScopeOrFail(
    organizationId: number,
    projectId: number,
    contradictionId: number,
  ): Promise<ProjectContradiction> {
    const record = await ProjectContradiction.query()
      .where('id', contradictionId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
    if (!record) {
      throw new ResourceNotFoundException('矛盾记录不存在')
    }
    return record
  }

  /** 按候选构建一条新记录（technical/physical 分别填参数列）。 */
  private buildRecord(
    organizationId: number,
    projectId: number,
    dedupeKey: string,
    candidate: CandidateContradiction,
    principles: SuggestedPrinciple[],
    inputSignature: string,
    outputHash: string | null,
    ruleVersion: string,
  ): ProjectContradiction {
    const record = new ProjectContradiction()
    record.organizationId = organizationId
    record.projectId = projectId
    record.key = `pc:${projectId}:${dedupeKey}`
    record.dedupeKey = dedupeKey
    record.type = candidate.type
    record.ruleId = candidate.ruleId
    record.ruleVersion = ruleVersion
    record.severity = candidate.severity
    record.confidence = candidate.confidence
    record.title = candidate.title
    record.evidence = candidate.evidence
    record.suggestedPrinciples = principles
    record.inputSignature = inputSignature
    record.outputHash = outputHash
    record.status = 'draft'
    record.stale = false
    record.staleReason = null
    record.relatedChangeRequestId = null
    record.confirmedBy = null
    record.confirmedAt = null
    record.dismissedBy = null
    record.dismissedAt = null
    record.dismissReason = null
    record.aiExplanation = null

    if (candidate.type === 'technical') {
      record.improvingParameterKey = candidate.improvingParameterKey
      record.worseningParameterKey = candidate.worseningParameterKey
      record.improvingDirection = candidate.improvingDirection
      record.worseningDirection = candidate.worseningDirection
      record.parameterKey = null
      record.requirementA = null
      record.requirementB = null
    } else {
      record.improvingParameterKey = null
      record.worseningParameterKey = null
      record.improvingDirection = null
      record.worseningDirection = null
      record.parameterKey = candidate.parameterKey
      record.requirementA = candidate.requirementA
      record.requirementB = candidate.requirementB
    }
    return record
  }

  /** 按当前签名复算并落库 stale 标记（事务外读 + 逐条写）。 */
  private async applyStaleFlags(
    organizationId: number,
    projectId: number,
    currentSignature: string,
  ): Promise<void> {
    const records = await ProjectContradiction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereIn('status', ['draft', 'confirmed'])
    for (const r of records) {
      const shouldStale =
        r.inputSignature !== currentSignature || r.ruleVersion !== CONTRADICTION_RULESET_VERSION
      if (shouldStale !== r.stale) {
        r.stale = shouldStale
        r.staleReason = shouldStale ? '当前项目事实已变化，需刷新' : null
        await r.save()
      }
    }
  }
}

// 严重度排序辅助（保留引用以稳定 severityRank 语义）
export { severityRank }
