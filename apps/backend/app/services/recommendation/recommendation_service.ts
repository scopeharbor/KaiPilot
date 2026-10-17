/**
 * RecommendationService —— AI 智能推荐核心服务。
 *
 * 刷新推荐候选列表、去重/合并、评分排序、状态流转、过期检测、转换入口。
 * 红线：不修改任何正式业务数据（任务、资源、风险等）
 *
 * v2-ai-smart-recommendations / design D1/D3
 */
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import AuditService, { AuditEvent } from '#services/audit_service'
import db from '@adonisjs/lucid/services/db'
import ProjectRecommendation from '#models/project_recommendation'
import ProjectRecommendationEvent from '#models/project_recommendation_event'
import Project from '#models/project'
import AdapterRegistry from './adapter_registry.js'
import { createDefaultAdapterRegistry } from './index.js'
import {
  computeDedupeKey,
  computeInputSignature,
  computeEvidenceHash,
  computePriority,
} from './scoring.js'
import { assertTransition } from './status_machine.js'
import type { CollectorParams } from './adapter_types.js'
import type {
  RecommendationSource,
  RecommendationStatus,
  RecommendationSeverity,
  RecommendationRecord,
  RecommendationListItem,
  RecommendationSummary,
  RecommendationCandidate,
  RecommendationEvidenceRef,
  RecommendationWarning,
  RecommendationAiMetadata,
} from '@aiproj/types'
import { inject } from '@adonisjs/core'

// ---------------------------------------------------------------------------
// 查询参数类型
// ---------------------------------------------------------------------------

export interface ListRecommendationsParams {
  projectId: number
  organizationId: number
  status?: RecommendationStatus
  sourceType?: RecommendationSource
  severity?: RecommendationSeverity
  stale?: boolean
  q?: string
  page: number
  perPage: number
  sort?: string
}

export interface RefreshParams {
  organizationId: number
  projectId: number
  userId: number
  sources?: RecommendationSource[]
  hasRiskView: boolean
  hasResourceView: boolean
  hasChangeImpactView: boolean
}

export interface SummaryParams {
  organizationId: number
  projectId: number
  userId: number
}

const MAX_PER_PAGE = 100
const DEFAULT_PER_PAGE = 20

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@inject()
export default class RecommendationService {
  private adapterRegistry: AdapterRegistry

  constructor(private audit: AuditService) {
    this.adapterRegistry = createDefaultAdapterRegistry()
  }

  // -----------------------------------------------------------------------
  // 4.1 refresh — 刷新推荐候选
  // -----------------------------------------------------------------------

  async refreshProjectRecommendations(params: RefreshParams): Promise<{
    data: RecommendationRecord[]
    warnings: RecommendationWarning[]
    created: number
    merged: number
  }> {
    const project = await Project.query()
      .where('id', params.projectId)
      .where('organization_id', params.organizationId)
      .first()
    if (!project) throw new Error('RESOURCE_NOT_FOUND')

    const collectorParams: CollectorParams = {
      organizationId: params.organizationId,
      projectId: params.projectId,
      userId: params.userId,
      hasRiskView: params.hasRiskView,
      hasResourceView: params.hasResourceView,
      hasChangeImpactView: params.hasChangeImpactView,
    }

    // 收集候选
    const sources = params.sources ?? this.adapterRegistry.getAvailableSources()
    const allCandidates: RecommendationCandidate[] = []
    const allWarnings: RecommendationWarning[] = []

    for (const source of sources) {
      const adapter = this.adapterRegistry.getAdapter(source)
      if (!adapter) {
        allWarnings.push({
          code: 'ADAPTER_NOT_REGISTERED',
          message: `来源 ${source} 尚未注册 adapter`,
          blocking: false,
          source,
        })
        continue
      }

      try {
        const { candidates, warnings } = await adapter.collect(collectorParams)
        allCandidates.push(...candidates)
        for (const w of warnings) {
          allWarnings.push({
            code: w.code,
            message: w.message,
            blocking: w.blocking ?? false,
            source: w.source,
          })
        }
      } catch (error: any) {
        logger.warn({ source, error: error.message }, '推荐 Adapter 收集失败')
        allWarnings.push({
          code: 'ADAPTER_COLLECT_FAILED',
          message: `来源 ${source} 收集推荐失败: ${error.message}`,
          blocking: false,
          source,
        })
      }
    }

    // 去重/合并
    let created = 0
    let merged = 0
    const savedRecords: RecommendationRecord[] = []

    for (const candidate of allCandidates) {
      const dedupeKey =
        candidate.dedupeKey ||
        computeDedupeKey(
          candidate.sourceType,
          candidate.sourceId,
          candidate.targetRef?.entityType,
          candidate.targetRef?.entityId,
        )
      const priority = computePriority(candidate)
      const inputSignature = computeInputSignature({
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        dedupeKey,
        severity: candidate.severity,
        priority,
        evidenceRefs: candidate.evidenceRefs,
      })
      const evidenceHash = computeEvidenceHash(candidate.evidenceRefs)

      // 检查是否有未过期的同 dedupeKey 记录
      const existing = await ProjectRecommendation.query()
        .where('organization_id', params.organizationId)
        .where('project_id', params.projectId)
        .where('dedupe_key', dedupeKey)
        .whereNot('status', 'expired')
        .first()

      if (existing) {
        // 合并 evidenceRefs
        const existingRefs = (existing.evidenceRefs || []) as RecommendationEvidenceRef[]
        const newRefs = (candidate.evidenceRefs || []).filter(
          (nr) => !existingRefs.some((er) => er.summaryHash === nr.summaryHash),
        )
        const mergedRefs = [...existingRefs, ...newRefs]

        existing.merge({
          evidenceRefs: mergedRefs,
          evidenceHash: computeEvidenceHash(mergedRefs),
          severity: candidate.severity,
          priority,
          summary: candidate.summary,
          title: candidate.title,
          recommendedAction: candidate.recommendedAction,
          stale: false,
          staleReason: null,
          expiresAt: candidate.expiresAt ? DateTime.fromISO(candidate.expiresAt) : null,
        })
        await existing.save()
        merged++
        savedRecords.push(await this.toRecord(existing))
      } else {
        // 创建新记录
        const rec = await ProjectRecommendation.create({
          organizationId: params.organizationId,
          projectId: params.projectId,
          sourceType: candidate.sourceType,
          sourceId: candidate.sourceId,
          targetRef: candidate.targetRef,
          title: candidate.title,
          summary: candidate.summary,
          recommendedAction: candidate.recommendedAction,
          actionType: candidate.actionType,
          severity: candidate.severity,
          priority,
          confidence: candidate.confidence,
          dedupeKey,
          inputSignature,
          evidenceHash,
          evidenceRefs: candidate.evidenceRefs || null,
          status: 'new',
          warnings: null,
          aiMetadata: null,
          expiresAt: candidate.expiresAt ? DateTime.fromISO(candidate.expiresAt) : null,
          stale: false,
          staleReason: null,
          createdBy: params.userId,
          handledBy: null,
          handledAt: null,
        })
        created++
        savedRecords.push(await this.toRecord(rec))

        // 写入事件
        await ProjectRecommendationEvent.create({
          recommendationId: rec.id,
          organizationId: params.organizationId,
          projectId: params.projectId,
          eventType: 'generated',
          fromStatus: null,
          toStatus: 'new',
          actorId: params.userId,
          metadata: { source: candidate.sourceType, dedupeKey },
          summary: `来自 ${candidate.sourceType} 的推荐已生成: ${candidate.title}`,
        })
      }
    }

    // 审计
    await this.audit.log({
      event: AuditEvent.AI_RECOMMENDATION_GENERATED,
      userId: params.userId,
      projectId: params.projectId,
      organizationId: params.organizationId,
      metadata: {
        created,
        merged,
        sourceCount: sources.length,
        totalCandidates: allCandidates.length,
      },
    })

    return { data: savedRecords, warnings: allWarnings, created, merged }
  }

  // -----------------------------------------------------------------------
  // list — 列表
  // -----------------------------------------------------------------------

  async list(params: ListRecommendationsParams): Promise<{
    data: RecommendationListItem[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
    summary: RecommendationSummary
  }> {
    const page = Math.max(1, params.page)
    const perPage = Math.min(params.perPage || DEFAULT_PER_PAGE, MAX_PER_PAGE)

    let query = ProjectRecommendation.query()
      .where('organization_id', params.organizationId)
      .where('project_id', params.projectId)

    if (params.status) {
      query = query.where('status', params.status)
    }
    if (params.sourceType) {
      query = query.where('source_type', params.sourceType)
    }
    if (params.severity) {
      query = query.where('severity', params.severity)
    }
    if (params.stale !== undefined) {
      query = query.where('stale', params.stale)
    }
    if (params.q) {
      query = query.where((qb) => {
        qb.where('title', 'like', `%${params.q}%`).orWhere('summary', 'like', `%${params.q}%`)
      })
    }

    // 排序
    const sortField = params.sort?.replace(/^[-+]/, '') || 'priority'
    const sortOrder = params.sort?.startsWith('-') ? 'desc' : 'asc'
    const allowedSortFields = ['priority', 'created_at', 'severity', 'status', 'updated_at']
    const safeField = allowedSortFields.includes(sortField) ? sortField : 'priority'

    query = query.orderBy(safeField, sortOrder)

    const [{ count: rawCount }] = await db
      .from('project_recommendations')
      .where('organization_id', params.organizationId)
      .where('project_id', params.projectId)
      .count('* as count')
    const totalCount = Number(rawCount ?? 0)
    const totalPages = Math.ceil(totalCount / perPage) || 1

    const rows = await query.offset((page - 1) * perPage).limit(perPage)

    const data: RecommendationListItem[] = rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      sourceType: r.sourceType,
      title: r.title,
      summary: r.summary,
      severity: r.severity,
      priority: r.priority,
      status: r.status,
      dedupeKey: r.dedupeKey,
      stale: r.stale,
      expiresAt: r.expiresAt?.toISO() ?? null,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISO()!,
      handledBy: r.handledBy,
      handledAt: r.handledAt?.toISO() ?? null,
    }))

    const summary = await this.getSummary(params.organizationId, params.projectId)

    return { data, meta: { total: totalCount, page, perPage, totalPages }, summary }
  }

  // -----------------------------------------------------------------------
  // getSummary — 摘要
  // -----------------------------------------------------------------------

  async getSummary(organizationId: number, projectId: number): Promise<RecommendationSummary> {
    try {
      const all = await ProjectRecommendation.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .select('id', 'title', 'severity', 'priority', 'status', 'created_at', 'stale')

      const newRecs = all.filter((r) => r.status === 'new' || r.status === 'reviewing')
      const criticalRecs = all.filter((r) => r.severity === 'critical')
      const highRecs = all.filter((r) => r.severity === 'high')
      const acceptedRecs = all.filter((r) => r.status === 'accepted')

      // Top 3 by priority, not stale
      const top = all
        .filter((r) => !r.stale && (r.status === 'new' || r.status === 'reviewing'))
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 3)
        .map((r) => ({
          id: r.id,
          projectId: r.projectId,
          sourceType: r.sourceType,
          title: r.title,
          summary: r.summary,
          severity: r.severity,
          priority: r.priority,
          status: r.status,
          dedupeKey: r.dedupeKey,
          stale: r.stale,
          expiresAt: r.expiresAt?.toISO() ?? null,
          createdBy: r.createdBy,
          createdAt: r.createdAt.toISO()!,
          handledBy: r.handledBy,
          handledAt: r.handledAt?.toISO() ?? null,
        }))

      return {
        totalCount: all.length,
        criticalCount: criticalRecs.length,
        highCount: highRecs.length,
        mediumCount: all.filter((r) => r.severity === 'medium').length,
        newCount: newRecs.length,
        acceptedCount: acceptedRecs.length,
        topRecommendations: top,
        maxSeverity: criticalRecs.length > 0 ? 'critical' : highRecs.length > 0 ? 'high' : null,
        updatedAt:
          all.length > 0
            ? all
                .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())[0]
                .createdAt.toISO()!
            : null,
        available: all.length > 0,
        warnings: [],
      }
    } catch {
      return {
        totalCount: 0,
        criticalCount: 0,
        highCount: 0,
        mediumCount: 0,
        newCount: 0,
        acceptedCount: 0,
        topRecommendations: [],
        maxSeverity: null,
        updatedAt: null,
        available: false,
        warnings: [{ code: 'SERVICE_ERROR', message: '获取推荐摘要失败', blocking: false }],
      }
    }
  }

  // -----------------------------------------------------------------------
  // getById — 详情
  // -----------------------------------------------------------------------

  async getById(
    id: number,
    organizationId: number,
    projectId: number,
  ): Promise<RecommendationRecord> {
    const rec = await ProjectRecommendation.query()
      .where('id', id)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
    if (!rec) throw new Error('RESOURCE_NOT_FOUND')

    return this.toRecord(rec)
  }

  // -----------------------------------------------------------------------
  // updateStatus — 状态流转
  // -----------------------------------------------------------------------

  async updateStatus(
    id: number,
    organizationId: number,
    projectId: number,
    userId: number,
    status: RecommendationStatus,
    reason?: string,
  ): Promise<RecommendationRecord> {
    const rec = await ProjectRecommendation.query()
      .where('id', id)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
    if (!rec) throw new Error('RESOURCE_NOT_FOUND')

    const fromStatus = rec.status as RecommendationStatus
    assertTransition(fromStatus, status)

    const fromStatusStr = rec.status
    rec.status = status
    if (['accepted', 'dismissed', 'snoozed', 'converted'].includes(status)) {
      rec.handledBy = userId
      rec.handledAt = DateTime.now()
    }
    await rec.save()

    // 事件
    await ProjectRecommendationEvent.create({
      recommendationId: rec.id,
      organizationId,
      projectId,
      eventType:
        status === 'accepted'
          ? 'accepted'
          : status === 'dismissed'
            ? 'dismissed'
            : status === 'snoozed'
              ? 'snoozed'
              : status === 'converted'
                ? 'converted'
                : 'status_changed',
      fromStatus: fromStatusStr,
      toStatus: status,
      actorId: userId,
      metadata: reason ? { reason } : {},
      summary: `推荐状态从 ${fromStatusStr} 变更为 ${status}`,
    })

    // 审计
    await this.audit.log({
      event: AuditEvent.AI_RECOMMENDATION_STATUS_CHANGED,
      userId,
      projectId,
      organizationId,
      metadata: { recommendationId: rec.id, fromStatus: fromStatusStr, toStatus: status, reason },
    })

    return this.toRecord(rec)
  }

  // -----------------------------------------------------------------------
  // generateAiExplanation — 生成 AI 解释
  // -----------------------------------------------------------------------

  async generateAiExplanation(
    id: number,
    organizationId: number,
    projectId: number,
    userId: number,
    _idempotencyKey?: string,
  ): Promise<{ data: RecommendationAiMetadata }> {
    const rec = await ProjectRecommendation.query()
      .where('id', id)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
    if (!rec) throw new Error('RESOURCE_NOT_FOUND')

    // Fake provider 解释（真实 AI 调用由集成层实现）
    const metadata: RecommendationAiMetadata = {
      provider: 'fake',
      model: 'recommendation-v1',
      inputTokens: 0,
      outputTokens: 50,
      totalCost: 0,
      currency: 'USD',
      latencyMs: 5,
      inputSignature: rec.inputSignature,
      outputHash: `out-${Date.now().toString(36)}`,
      status: 'pending',
      failureCode: null,
      failureMessage: null,
      narrative: `建议：${rec.title}。${rec.summary}`,
      focusPoints: ['根据来源数据分析', '建议尽快处理'],
      suggestedActions: [rec.recommendedAction || '审查该推荐'],
      assumptions: ['基于当前项目快照', '数据来源可靠'],
      confidence: 0.75,
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectReason: null,
      generatedAt: new Date().toISOString(),
    }

    // 更新记录的 aiMetadata
    rec.aiMetadata = metadata
    await rec.save()

    // 事件
    await ProjectRecommendationEvent.create({
      recommendationId: rec.id,
      organizationId,
      projectId,
      eventType: 'ai_explanation',
      fromStatus: rec.status,
      toStatus: rec.status,
      actorId: userId,
      metadata: { provider: 'fake' },
      summary: 'AI 解释已生成',
    })

    // 审计
    await this.audit.log({
      event: AuditEvent.AI_RECOMMENDATION_AI_EXPLANATION,
      userId,
      projectId,
      organizationId,
      metadata: { recommendationId: rec.id, provider: 'fake', status: 'pending' },
    })

    return { data: metadata }
  }

  // -----------------------------------------------------------------------
  // updateAiExplanation — 审批 AI 解释
  // -----------------------------------------------------------------------

  async updateAiExplanation(
    id: number,
    organizationId: number,
    projectId: number,
    update: {
      status: 'approved' | 'rejected'
      approvedBy?: number | null
      approvedAt?: string | null
      rejectedBy?: number | null
      rejectedAt?: string | null
      rejectReason?: string | null
      notes?: string | null
    },
  ): Promise<RecommendationRecord> {
    const rec = await ProjectRecommendation.query()
      .where('id', id)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
    if (!rec) throw new Error('RESOURCE_NOT_FOUND')

    const currentMetadata = rec.aiMetadata || {
      provider: null,
      model: null,
      inputTokens: null,
      outputTokens: null,
      totalCost: null,
      currency: 'USD',
      latencyMs: null,
      inputSignature: null,
      outputHash: null,
      status: 'pending',
      failureCode: null,
      failureMessage: null,
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
      generatedAt: null,
    }

    currentMetadata.status = update.status
    if (update.status === 'approved') {
      currentMetadata.approvedBy = update.approvedBy ?? null
      currentMetadata.approvedAt = update.approvedAt ?? null
    } else {
      currentMetadata.rejectedBy = update.rejectedBy ?? null
      currentMetadata.rejectedAt = update.rejectedAt ?? null
      currentMetadata.rejectReason = update.rejectReason ?? null
    }

    rec.aiMetadata = currentMetadata
    await rec.save()

    // 审计
    await this.audit.log({
      event: AuditEvent.AI_RECOMMENDATION_AI_EXPLANATION,
      userId: (update.approvedBy || update.rejectedBy) ?? 0,
      projectId,
      organizationId,
      metadata: { recommendationId: rec.id, status: update.status },
    })

    return this.toRecord(rec)
  }

  // -----------------------------------------------------------------------
  // convertRecommendation — 转换推荐
  // -----------------------------------------------------------------------

  async convertRecommendation(
    id: number,
    organizationId: number,
    projectId: number,
    userId: number,
    convertTo: string,
    _params?: Record<string, unknown>,
  ): Promise<{
    data: {
      conversionType: string
      targetId: number | null
      targetUrl: string | null
      draftSessionId: number | null
      recommendation: RecommendationRecord
    }
  }> {
    const rec = await ProjectRecommendation.query()
      .where('id', id)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
    if (!rec) throw new Error('RESOURCE_NOT_FOUND')

    // 更新状态为 converted
    const fromStatus = rec.status as RecommendationStatus
    assertTransition(fromStatus, 'converted')
    rec.status = 'converted'
    rec.handledBy = userId
    rec.handledAt = DateTime.now()
    await rec.save()

    // 事件
    await ProjectRecommendationEvent.create({
      recommendationId: rec.id,
      organizationId,
      projectId,
      eventType: 'converted',
      fromStatus,
      toStatus: 'converted',
      actorId: userId,
      metadata: { convertTo },
      summary: `推荐已转换为 ${convertTo}`,
    })

    // 审计
    await this.audit.log({
      event: AuditEvent.AI_RECOMMENDATION_CONVERTED,
      userId,
      projectId,
      organizationId,
      metadata: { recommendationId: rec.id, convertTo },
    })

    // 构建转换目标 URL
    let targetUrl: string | null = null
    let targetId: number | null = null
    if (convertTo === 'risk') {
      targetUrl = `/projects/${projectId}/risks`
    } else if (convertTo === 'change_request') {
      targetUrl = `/projects/${projectId}/change-requests`
    } else if (convertTo === 'draft_layer') {
      targetUrl = `/projects/${projectId}/ai-draft`
    }

    return {
      data: {
        conversionType: convertTo,
        targetId,
        targetUrl,
        draftSessionId: null,
        recommendation: await this.toRecord(rec),
      },
    }
  }

  // -----------------------------------------------------------------------
  // 内部辅助
  // -----------------------------------------------------------------------

  private async toRecord(rec: ProjectRecommendation): Promise<RecommendationRecord> {
    return {
      id: rec.id,
      organizationId: rec.organizationId,
      projectId: rec.projectId,
      sourceType: rec.sourceType,
      sourceId: rec.sourceId,
      targetRef: rec.targetRef,
      title: rec.title,
      summary: rec.summary,
      recommendedAction: rec.recommendedAction || '',
      actionType: rec.actionType,
      severity: rec.severity,
      priority: rec.priority,
      confidence: rec.confidence,
      status: rec.status,
      dedupeKey: rec.dedupeKey,
      inputSignature: rec.inputSignature,
      evidenceHash: rec.evidenceHash,
      evidenceRefs: rec.evidenceRefs || [],
      warnings: rec.warnings || [],
      aiMetadata: rec.aiMetadata,
      expiresAt: rec.expiresAt?.toISO() ?? null,
      stale: rec.stale,
      staleReason: rec.staleReason,
      createdBy: rec.createdBy,
      handledBy: rec.handledBy,
      handledAt: rec.handledAt?.toISO() ?? null,
      createdAt: rec.createdAt.toISO()!,
      updatedAt: rec.updatedAt.toISO()!,
    }
  }
}
