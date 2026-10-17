/**
 * PmoAiPriorityRecommendationService —— PMO AI 优先级推荐核心服务。
 *
 * v3-pmo-ai-priority-recommendations §4: 候选刷新、列表、摘要、详情、
 * 审查生命周期、AI 理由生成、低敏审计。红线：不修改正式项目事实。
 */
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import PmoAiPriorityRecommendation from '#models/pmo_ai_priority_recommendation'
import Project from '#models/project'
import {
  PriorityScoringAdapter,
  PmoDashboardAdapter,
  PmoTrafficLightAdapter,
  ProjectRecommendationAdapter,
} from './index.js'
import type {
  PmoSourceAdapter,
  PmoAdapterContext,
  PmoAdapterCollectResult,
} from './adapter_types.js'
import type User from '#models/user'
import type {
  PmoRecommendationRecord,
  PmoRecommendationQueueItem,
  PmoRecommendationSummary,
  PmoRecommendationDetail,
  PmoRecommendationCandidate,
  PmoRecommendationWarning,
  PmoSourceSignal,
  PmoRecommendationListQuery,
  PmoReviewAction,
  PmoConversionIntent,
  RecommendationAiMetadata,
} from '@aiproj/types'
import { inject } from '@adonisjs/core'
import AuditService, { AuditEvent } from '#services/audit_service'
import type { AIGateway } from '#services/ai_m0/gateway'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const MAX_PER_PAGE = 100
const DEFAULT_PER_PAGE = 20
const MAX_TOP_RECOMMENDATIONS = 10

// ---------------------------------------------------------------------------
// 查询参数类型
// ---------------------------------------------------------------------------

export interface PmoRefreshParams {
  organizationId: number
  userId: number
  actor: User
  sources?: string[]
  hasRiskView: boolean
  hasResourceView: boolean
  hasPredictionView: boolean
  hasHealthView: boolean
  priorityScoringAvailable: boolean
  trafficLightAvailable: boolean
}

export interface PmoAIGenerateParams {
  recommendationId: number
  organizationId: number
  userId: number
  idempotencyKey?: string
}

export interface PmoReviewParams {
  recommendationId: number
  organizationId: number
  userId: number
  action: PmoReviewAction
  reason?: string
  snoozeUntil?: string
  convertTarget?: string
  convertParams?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@inject()
export default class PmoAiPriorityRecommendationService {
  private adapters: PmoSourceAdapter[]

  constructor(private audit: AuditService) {
    this.adapters = [
      new PriorityScoringAdapter(),
      new PmoDashboardAdapter(),
      new PmoTrafficLightAdapter(),
      new ProjectRecommendationAdapter(),
    ]
  }

  private buildContext(params: PmoRefreshParams): PmoAdapterContext {
    return {
      organizationId: params.organizationId,
      actor: params.actor,
      hasRiskView: params.hasRiskView,
      hasResourceView: params.hasResourceView,
      hasPredictionView: params.hasPredictionView,
      hasHealthView: params.hasHealthView,
      priorityScoringAvailable: params.priorityScoringAvailable,
      trafficLightAvailable: params.trafficLightAvailable,
    }
  }

  // -----------------------------------------------------------------------
  // 4.1 refresh — 刷新 PMO 推荐候选
  // -----------------------------------------------------------------------

  async refreshCandidates(params: PmoRefreshParams): Promise<{
    data: PmoRecommendationRecord[]
    warnings: PmoRecommendationWarning[]
    created: number
    merged: number
  }> {
    const ctx = this.buildContext(params)
    const sourceFilter = params.sources?.length ? new Set(params.sources) : null

    // 并行收集所有 adapters
    const results: PmoAdapterCollectResult[] = []
    for (const adapter of this.adapters) {
      if (sourceFilter && !sourceFilter.has(adapter.sourceType)) continue
      const result = await adapter.collect(ctx)
      results.push(result)
    }

    // 聚合候选
    const allCandidates = results.flatMap((r) => r.candidates)
    const allSignals = results.flatMap((r) => r.signals)
    const allWarnings = results.flatMap((r) => r.warnings)
    const sourcesAvailable = results.filter((r) => r.available).length

    // 去重（按 dedupeKey + 组织）
    const deduped = this.dedupeCandidates(allCandidates, params.organizationId)

    // 持久化
    const { created, merged } = await this.persistCandidates(
      deduped,
      allSignals,
      params.organizationId,
      params.userId,
    )

    // Audit
    await this.audit.log({
      event: AuditEvent.PMO_AI_RECOMMENDATION_REFRESHED,
      organizationId: params.organizationId,
      userId: params.userId,
      metadata: {
        created,
        merged,
        candidates: deduped.length,
        sourcesAvailable,
        sourcesTotal: results.length,
      },
    })

    return {
      data: await this.loadForOrganization(params.organizationId, {
        perPage: MAX_PER_PAGE,
        page: 1,
      }),
      warnings: allWarnings,
      created,
      merged,
    }
  }

  // -----------------------------------------------------------------------
  // 4.1 list — 队列列表
  // -----------------------------------------------------------------------

  async list(
    organizationId: number,
    query: PmoRecommendationListQuery,
  ): Promise<{
    data: PmoRecommendationQueueItem[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
    summary: PmoRecommendationSummary
  }> {
    const page = query.page ?? 1
    const perPage = Math.min(query.perPage ?? DEFAULT_PER_PAGE, MAX_PER_PAGE)

    let dbQuery = PmoAiPriorityRecommendation.scopeByOrg(
      PmoAiPriorityRecommendation.query().orderBy('created_at', 'desc'),
      organizationId,
    )

    if (query.status) dbQuery = dbQuery.where('status', query.status)
    if (query.severity) dbQuery = dbQuery.where('severity', query.severity)
    if (query.sourceType) dbQuery = dbQuery.where('source_type', query.sourceType)
    if (query.aiStatus) dbQuery = dbQuery.where('ai_status', query.aiStatus)
    if (query.stale !== undefined) dbQuery = dbQuery.where('stale', query.stale)
    if (query.projectId) dbQuery = dbQuery.where('project_id', query.projectId)

    const totalRows = await dbQuery.clone().clearOrder().count('* as total')
    const total = totalRows[0].$extras.total as number
    const totalPages = Math.ceil(total / perPage)

    const records = (await dbQuery
      .offset((page - 1) * perPage)
      .limit(perPage)) as PmoAiPriorityRecommendation[]

    // 批量获取项目名称
    const projectIds = records.map((r) => r.projectId)
    const projects = await Project.query().whereIn('id', projectIds).select('id', 'name')

    const projectNameMap = new Map(projects.map((p) => [p.id, p.name ?? `项目${p.id}`]))

    const items: PmoRecommendationQueueItem[] = records.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      projectName: projectNameMap.get(r.projectId) ?? `项目${r.projectId}`,
      sourceType: r.sourceType,
      title: r.title,
      summary: r.summary,
      severity: r.severity,
      priorityContext: r.priorityContext,
      status: r.status,
      aiStatus: r.aiStatus,
      sourceSignalCount: r.sourceSignals?.length ?? 0,
      warningCount: r.warnings?.length ?? 0,
      stale: r.stale,
      expiresAt: r.expiresAt?.toISO?.() ?? null,
      createdAt: r.createdAt?.toISO?.() ?? new Date().toISOString(),
      handledBy: r.handledBy,
      handledAt: r.handledAt?.toISO?.() ?? null,
    }))

    const summary = await this.buildSummary(organizationId)

    return {
      data: items,
      meta: { total, page, perPage, totalPages },
      summary,
    }
  }

  // -----------------------------------------------------------------------
  // 4.1 summary — 聚合摘要
  // -----------------------------------------------------------------------

  async getSummary(organizationId: number): Promise<PmoRecommendationSummary> {
    return this.buildSummary(organizationId)
  }

  // -----------------------------------------------------------------------
  // 4.1 detail — 详情
  // -----------------------------------------------------------------------

  async getById(organizationId: number, id: number): Promise<PmoRecommendationDetail | null> {
    const record = await PmoAiPriorityRecommendation.scopeByOrg(
      PmoAiPriorityRecommendation.query(),
      organizationId,
    )
      .where('id', id)
      .first()

    if (!record) return null

    return {
      record: this.toRecord(record),
      sourceWarnings: record.warnings ?? [],
      conversionIntents: [], // 后续可扩展
    }
  }

  // -----------------------------------------------------------------------
  // 4.2 review actions — 审查生命周期
  // -----------------------------------------------------------------------

  async reviewAction(params: PmoReviewParams): Promise<{
    record: PmoRecommendationRecord
    conversionIntent?: PmoConversionIntent | null
  }> {
    const rec = await PmoAiPriorityRecommendation.scopeByOrg(
      PmoAiPriorityRecommendation.query(),
      params.organizationId,
    )
      .where('id', params.recommendationId)
      .first()

    if (!rec) throw new Error('RESOURCE_NOT_FOUND')

    switch (params.action) {
      case 'accept':
        rec.status = 'accepted'
        break
      case 'dismiss':
        rec.status = 'dismissed'
        break
      case 'snooze':
        rec.status = 'snoozed'
        rec.snoozedUntil = params.snoozeUntil
          ? DateTime.fromISO(params.snoozeUntil)
          : DateTime.now().plus({ hours: 24 })
        break
      case 'convert': {
        rec.status = 'converted'
        const intent: PmoConversionIntent = {
          id: Date.now(), // 简化：真实实现应为序列生成
          recommendationId: rec.id,
          target: (params.convertTarget ?? 'project_priority_review') as any,
          params: params.convertParams ?? {},
          status: 'pending',
          createdBy: params.userId,
          createdAt: new Date().toISOString(),
          completedAt: null,
        }
        // 注意：convert 只创建 pending intent，不修改正式项目事实
        rec.status = 'converted'
        rec.handledBy = params.userId
        rec.handledAt = DateTime.now()
        rec.reviewReason = params.reason ?? null
        await rec.save()

        await this.audit.log({
          event: AuditEvent.PMO_AI_RECOMMENDATION_CONVERTED,
          organizationId: params.organizationId,
          userId: params.userId,
          projectId: rec.projectId,
          entityType: 'pmo_ai_priority_recommendation',
          entityId: rec.id,
          metadata: { target: intent.target },
        })

        return { record: this.toRecord(rec), conversionIntent: intent }
      }
      default:
        // generate_ai_rationale / regenerate_ai_rationale → 在 AI 方法中处理
        break
    }

    rec.handledBy = params.userId
    rec.handledAt = DateTime.now()
    rec.reviewReason = params.reason ?? null
    await rec.save()

    await this.audit.log({
      event: AuditEvent.PMO_AI_RECOMMENDATION_REVIEWED,
      organizationId: params.organizationId,
      userId: params.userId,
      projectId: rec.projectId,
      entityType: 'pmo_ai_priority_recommendation',
      entityId: rec.id,
      metadata: {
        reviewAction: params.action,
        reason: params.reason ?? null,
      },
    })

    return { record: this.toRecord(rec) }
  }

  // -----------------------------------------------------------------------
  // 4.3 AI rationale — 基于 AIGateway 的可选 AI 理由生成
  // -----------------------------------------------------------------------

  async generateAiRationale(
    gateway: AIGateway,
    params: PmoAIGenerateParams,
  ): Promise<{
    aiMetadata: RecommendationAiMetadata
    record: PmoRecommendationRecord
  }> {
    const rec = await PmoAiPriorityRecommendation.scopeByOrg(
      PmoAiPriorityRecommendation.query(),
      params.organizationId,
    )
      .where('id', params.recommendationId)
      .first()

    if (!rec) throw new Error('RESOURCE_NOT_FOUND')

    const startedAt = performance.now()

    // 构建低敏 prompt 上下文（不包含受限证据）
    const promptContext = {
      title: rec.title,
      summary: rec.summary,
      sourceType: rec.sourceType,
      severity: rec.severity,
      projectId: rec.projectId,
      priorityLevel: rec.priorityContext?.priorityLevel ?? 'unavailable',
      topDimensions: (rec.priorityContext?.topDimensionContributors ?? []).slice(0, 3),
    }

    const systemPrompt = `你是一个项目管理 PMO 专家。根据以下低敏推荐上下文，用简体中文生成：
1. 一段简短的推荐理由（不超过 500 字）
2. 2-3 个追问问题
3. 1-2 条建议行动文案草案

注意：这些生成内容仅作为人工审查参考，不是正式项目决策。不要虚构数据。`

    const userPrompt = JSON.stringify(promptContext)

    let result
    try {
      result = await gateway.generate({
        sentence: userPrompt,
        promptSet: { systemPrompt, userPrompt },
        strategy: 'P' as any,
        temperature: 0.3,
      })
    } catch (err) {
      logger.error({ err }, 'PMO AI rationale generation failed')

      const failedMetadata: RecommendationAiMetadata = {
        provider: gateway.provider,
        model: gateway.model,
        inputTokens: null,
        outputTokens: null,
        totalCost: null,
        currency: 'CNY',
        latencyMs: performance.now() - startedAt,
        inputSignature: params.idempotencyKey ?? null,
        outputHash: null,
        status: 'failed',
        failureCode: 'AI_GENERATION_FAILED',
        failureMessage: err instanceof Error ? err.message : String(err),
        narrative: null,
        focusPoints: [],
        suggestedActions: [],
        assumptions: [],
        confidence: 0,
        approvedBy: null,
        approvedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectReason: null,
        generatedAt: new Date().toISOString(),
      }

      rec.aiStatus = 'failed'
      rec.aiMetadata = failedMetadata
      await rec.save()

      // Audit (低敏)
      await this.audit.log({
        event: AuditEvent.PMO_AI_RATIONALE_FAILED,
        severity: 'warning',
        organizationId: params.organizationId,
        userId: params.userId,
        projectId: rec.projectId,
        entityType: 'pmo_ai_priority_recommendation',
        entityId: rec.id,
        metadata: { provider: gateway.provider },
      })

      return { aiMetadata: failedMetadata, record: this.toRecord(rec) }
    }

    // 解析 AI 输出
    const outputHash = this.hashString(result.rawText)

    const aiMetadata: RecommendationAiMetadata = {
      provider: gateway.provider,
      model: gateway.model,
      inputTokens: null,
      outputTokens: result.outputTokens,
      totalCost: null,
      currency: 'CNY',
      latencyMs: result.totalMs,
      inputSignature: params.idempotencyKey ?? null,
      outputHash,
      status: 'pending',
      failureCode: null,
      failureMessage: null,
      narrative: result.rawText.slice(0, 2000), // 截断到限制
      focusPoints: [],
      suggestedActions: [],
      assumptions: [],
      confidence: result.usingRealAdapter ? 0.7 : 0.3, // mock adapter 降低置信度
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectReason: null,
      generatedAt: new Date().toISOString(),
    }

    rec.aiStatus = 'available'
    rec.aiMetadata = aiMetadata
    await rec.save()

    // Audit (低敏——不包含 prompt 和输出全文)
    await this.audit.log({
      event: AuditEvent.PMO_AI_RATIONALE_GENERATED,
      organizationId: params.organizationId,
      userId: params.userId,
      projectId: rec.projectId,
      entityType: 'pmo_ai_priority_recommendation',
      entityId: rec.id,
      metadata: {
        provider: gateway.provider,
        model: gateway.model,
        outputHash,
        latencyMs: Math.round(result.totalMs),
        outputTokens: result.outputTokens,
        usingRealAdapter: result.usingRealAdapter,
      },
    })

    return { aiMetadata, record: this.toRecord(rec) }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** 去重合并候选。 */
  private dedupeCandidates(
    candidates: PmoRecommendationCandidate[],
    _organizationId: number,
  ): PmoRecommendationCandidate[] {
    const seen = new Map<string, PmoRecommendationCandidate>()
    for (const c of candidates) {
      const existing = seen.get(c.dedupeKey)
      if (!existing) {
        seen.set(c.dedupeKey, c)
      } else {
        // 保留严重度更高的
        const severityOrder = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }
        const newSev = severityOrder[c.severity] ?? 0
        const oldSev = severityOrder[existing.severity] ?? 0
        if (newSev > oldSev) {
          seen.set(c.dedupeKey, {
            ...c,
            warnings: [
              ...c.warnings,
              {
                code: 'CANDIDATE_DUPLICATE' as any,
                message: '已与更早候选合并',
                blocking: false,
              },
            ],
          })
        }
      }
    }
    return [...seen.values()]
  }

  /** 持久化候选到数据库。 */
  private async persistCandidates(
    candidates: PmoRecommendationCandidate[],
    _allSignals: PmoSourceSignal[],
    organizationId: number,
    userId: number,
  ): Promise<{ created: number; merged: number }> {
    let created = 0
    let merged = 0

    for (const c of candidates) {
      // 检查是否存在相同 dedupeKey 的记录
      const existing = await PmoAiPriorityRecommendation.scopeByOrg(
        PmoAiPriorityRecommendation.query(),
        organizationId,
      )
        .where('dedupe_key', c.dedupeKey)
        .first()

      if (existing) {
        // Merge: 更新严重度、信号、警告（不覆盖已有 AI 数据）
        if (this.severityOrder(c.severity) > this.severityOrder(existing.severity)) {
          existing.severity = c.severity
        }
        existing.sourceSignals = [...c.sourceSignals]
        existing.warnings = [...(existing.warnings ?? []), ...c.warnings]
        existing.priorityContext = c.priorityContext
        existing.stale = false
        existing.staleReason = null
        await existing.save()
        merged++
      } else {
        // Create
        await PmoAiPriorityRecommendation.create({
          organizationId,
          projectId: c.projectId,
          sourceType: c.candidateType,
          sourceId: c.dedupeKey,
          title: c.title,
          summary: c.summary,
          suggestedAction: c.suggestedAction,
          actionType: c.actionType,
          severity: c.severity,
          priorityContext: c.priorityContext,
          sourceSignals: c.sourceSignals,
          evidenceRefs: c.evidenceRefs,
          status: 'new',
          warnings: c.warnings,
          aiMetadata: null,
          aiStatus: 'none',
          dedupeKey: c.dedupeKey,
          inputSignature: c.inputSignature,
          candidateVersion: c.candidateVersion,
          expiresAt: c.expiresAt ? DateTime.fromISO(c.expiresAt) : null,
          stale: false,
          staleReason: null,
          createdBy: userId,
        })
        created++
      }
    }

    return { created, merged }
  }

  /** 构建摘要。 */
  private async buildSummary(organizationId: number): Promise<PmoRecommendationSummary> {
    const statsQuery = PmoAiPriorityRecommendation.scopeByOrg(
      PmoAiPriorityRecommendation.query(),
      organizationId,
    )

    const all = await statsQuery.clone()

    const statusCounts = await statsQuery
      .clone()
      .select('status')
      .groupBy('status')
      .count('* as cnt')

    const severityCounts = await PmoAiPriorityRecommendation.scopeByOrg(
      PmoAiPriorityRecommendation.query(),
      organizationId,
    )
      .select('severity')
      .groupBy('severity')
      .count('* as cnt')

    // Status
    const m = new Map<string, number>(
      statusCounts.map((s: any) => [String(s.status), Number(s.$extras.cnt)]),
    )
    const totalCount = all.length
    const newCount = m.get('new') ?? 0
    const reviewingCount = m.get('reviewing') ?? 0
    const acceptedCount = m.get('accepted') ?? 0
    const dismissedCount = m.get('dismissed') ?? 0
    const convertedCount = m.get('converted') ?? 0
    const staleCount = all.filter((r: any) => r.stale).length
    const aiAvailableCount = all.filter((r: any) => r.aiStatus === 'available').length

    // Severity
    const sevMap = new Map<string, number>(
      severityCounts.map((s: any) => [String(s.severity), Number(s.$extras.cnt)]),
    )
    const criticalCount = sevMap.get('critical') ?? 0
    const highCount = sevMap.get('high') ?? 0

    let maxSeverity: any = null
    if (criticalCount > 0) maxSeverity = 'critical'
    else if (highCount > 0) maxSeverity = 'high'
    else if ((sevMap.get('medium') ?? 0) > 0) maxSeverity = 'medium'
    else if ((sevMap.get('low') ?? 0) > 0) maxSeverity = 'low'
    else if (totalCount > 0) maxSeverity = 'info'

    // Top recommendations
    const topRecs = (await PmoAiPriorityRecommendation.scopeByOrg(
      PmoAiPriorityRecommendation.query()
        .whereIn('status', ['new', 'reviewing'])
        .orderBy('created_at', 'desc')
        .limit(MAX_TOP_RECOMMENDATIONS),
      organizationId,
    )) as PmoAiPriorityRecommendation[]

    const projectIds = topRecs.map((r) => r.projectId)
    const projects = await Project.query().whereIn('id', projectIds).select('id', 'name')
    const nameMap = new Map(projects.map((p) => [p.id, p.name ?? `项目${p.id}`]))

    const topRecommendations: PmoRecommendationQueueItem[] = topRecs.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      projectName: nameMap.get(r.projectId) ?? `项目${r.projectId}`,
      sourceType: r.sourceType,
      title: r.title,
      summary: r.summary,
      severity: r.severity,
      priorityContext: r.priorityContext,
      status: r.status,
      aiStatus: r.aiStatus,
      sourceSignalCount: r.sourceSignals?.length ?? 0,
      warningCount: r.warnings?.length ?? 0,
      stale: r.stale,
      expiresAt: r.expiresAt?.toISO?.() ?? null,
      createdAt: r.createdAt?.toISO?.() ?? new Date().toISOString(),
      handledBy: r.handledBy,
      handledAt: r.handledAt?.toISO?.() ?? null,
    }))

    return {
      totalCount,
      newCount,
      reviewingCount,
      acceptedCount,
      dismissedCount,
      convertedCount,
      criticalCount,
      highCount,
      staleCount,
      aiAvailableCount,
      maxSeverity,
      scoringAvailable: true, // 通过 adapter 控制
      scoringStale: false,
      topRecommendations,
      warnings: [],
      generatedAt: new Date().toISOString(),
    }
  }

  /** 加载组织推荐记录。 */
  private async loadForOrganization(
    organizationId: number,
    _query: { perPage: number; page: number },
  ): Promise<PmoRecommendationRecord[]> {
    const recs = (await PmoAiPriorityRecommendation.scopeByOrg(
      PmoAiPriorityRecommendation.query().orderBy('created_at', 'desc').limit(MAX_PER_PAGE),
      organizationId,
    )) as PmoAiPriorityRecommendation[]

    return recs.map((r) => this.toRecord(r))
  }

  /** 内部模型 → DTO 转换。 */
  private toRecord(r: PmoAiPriorityRecommendation): PmoRecommendationRecord {
    return {
      id: r.id,
      organizationId: r.organizationId,
      projectId: r.projectId,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      title: r.title,
      summary: r.summary,
      suggestedAction: r.suggestedAction ?? '',
      actionType: r.actionType,
      severity: r.severity,
      priorityContext: r.priorityContext,
      sourceSignals: r.sourceSignals,
      evidenceRefs: r.evidenceRefs ?? [],
      status: r.status,
      dedupeKey: r.dedupeKey,
      inputSignature: r.inputSignature,
      candidateVersion: r.candidateVersion,
      warnings: r.warnings ?? [],
      aiMetadata: r.aiMetadata,
      aiStatus: r.aiStatus,
      expiresAt: r.expiresAt?.toISO?.() ?? null,
      stale: r.stale,
      staleReason: r.staleReason,
      createdBy: r.createdBy,
      handledBy: r.handledBy,
      handledAt: r.handledAt?.toISO?.() ?? null,
      snoozedUntil: r.snoozedUntil?.toISO?.() ?? null,
      reviewReason: r.reviewReason,
      createdAt: r.createdAt?.toISO?.() ?? new Date().toISOString(),
      updatedAt: r.updatedAt?.toISO?.() ?? new Date().toISOString(),
    }
  }

  /** 严重度排序值。 */
  private severityOrder(s: string): number {
    const map: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }
    return map[s] ?? 0
  }

  /** 简单哈希。 */
  private hashString(input: string): string {
    let hash = 0
    for (let i = 0; i < input.length; i++) {
      hash = (hash << 5) - hash + input.charCodeAt(i)
      hash |= 0
    }
    return `h_${Math.abs(hash).toString(36)}`
  }
}
