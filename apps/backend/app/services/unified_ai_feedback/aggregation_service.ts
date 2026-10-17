/**
 * v3-unified-ai-feedback-ledger §7 — 聚合服务。
 *
 * 按契约写死的口径计算采纳率：
 * - 分母排除 pending
 * - skipped 计入分母但单独可见
 * - modified 与 accepted 永远分开
 * - 任何复合采纳率必须同时给出分量
 * - 拒绝原因分布聚合
 * - 覆盖率同时返回
 * - 组织隔离全路径
 */

import type {
  FeedbackType,
  FeedbackCapabilitySurface,
  AdoptionRateResult,
  RejectionReasonDistribution,
  FeedbackDownstreamSummary,
} from '@aiproj/types'
import { REJECTION_REASONS, computeAdoptionRate } from '@aiproj/types'
import UnifiedAiFeedbackEvent from '#models/unified_ai_feedback_event'
import { combinedProjection } from './projection_service.js'

// ===========================================================================
// §7.1 聚合查询参数
// ===========================================================================

export interface AggregationQuery {
  organizationId: number
  capabilitySurface?: string
  windowStart?: string
  windowEnd?: string
}

// ===========================================================================
// §7.1–§7.5 采纳率聚合
// ===========================================================================

/**
 * 聚合采纳率。按契约写死的口径计算。
 *
 * 返回值必须包含 accepted/modified/rejected/skipped 分量（§7.2），
 * 不可能只返回复合值（§7.3 测试覆盖）。
 */
export async function aggregateAdoptionRate(
  query: AggregationQuery,
): Promise<AdoptionRateResult & { rejectionDistribution: RejectionReasonDistribution[] }> {
  const events = await combinedProjection(query.organizationId, { limit: 10000 })

  // 按能力面过滤（如果指定）
  let filtered = events
  if (query.capabilitySurface) {
    filtered = events.filter((e) => e.capabilitySurface === query.capabilitySurface)
  }

  // 按时间窗过滤（如果指定）
  if (query.windowStart) {
    filtered = filtered.filter((e) => e.occurredAt >= query.windowStart!)
  }
  if (query.windowEnd) {
    filtered = filtered.filter((e) => e.occurredAt <= query.windowEnd!)
  }

  // 按反馈类型计数
  const counts: Record<FeedbackType, number> = {
    accepted: 0,
    rejected: 0,
    modified: 0,
    skipped: 0,
    pending: 0,
  }

  for (const event of filtered) {
    counts[event.feedbackType]++
  }

  // 计算采纳率（口径写死在契约层）
  const adoptionRate = computeAdoptionRate(
    counts.accepted,
    counts.modified,
    counts.rejected,
    counts.skipped,
    counts.pending,
  )

  // 拒绝原因分布
  const rejectionReasonCounts: Record<string, number> = {}
  for (const event of filtered) {
    if (event.feedbackType === 'rejected' && event.rejectionReason) {
      rejectionReasonCounts[event.rejectionReason] =
        (rejectionReasonCounts[event.rejectionReason] || 0) + 1
    }
  }

  const totalRejected = counts.rejected
  const rejectionDistribution: RejectionReasonDistribution[] = REJECTION_REASONS.map((reason) => ({
    reason,
    count: rejectionReasonCounts[reason] || 0,
    proportion: totalRejected > 0 ? (rejectionReasonCounts[reason] || 0) / totalRejected : 0,
  }))

  return {
    ...adoptionRate,
    rejectionDistribution,
  }
}

// ===========================================================================
// §7.9 下游读接口
// ===========================================================================

/**
 * 下游读接口：评测的采纳维度、排序的反哺输入。
 * 只暴露 references、fingerprints、enumerated values 和 counts。
 * 不暴露存储内容。
 */
export async function downstreamSummary(query: {
  organizationId: number
  capabilitySurface?: string
}): Promise<FeedbackDownstreamSummary> {
  const events = await combinedProjection(query.organizationId, { limit: 10000 })

  let filtered = events
  if (query.capabilitySurface) {
    filtered = events.filter((e) => e.capabilitySurface === query.capabilitySurface)
  }

  // 类型计数
  const typeCounts = {
    accepted: 0,
    modified: 0,
    rejected: 0,
    skipped: 0,
    pending: 0,
  }
  for (const event of filtered) {
    typeCounts[event.feedbackType]++
  }

  const adoptionRate = computeAdoptionRate(
    typeCounts.accepted,
    typeCounts.modified,
    typeCounts.rejected,
    typeCounts.skipped,
    typeCounts.pending,
  )

  // 拒绝原因分布
  const rejectionReasonCounts: Record<string, number> = {}
  for (const event of filtered) {
    if (event.feedbackType === 'rejected' && event.rejectionReason) {
      rejectionReasonCounts[event.rejectionReason] =
        (rejectionReasonCounts[event.rejectionReason] || 0) + 1
    }
  }
  const totalRejected = typeCounts.rejected
  const rejectionDistribution: RejectionReasonDistribution[] = REJECTION_REASONS.map((reason) => ({
    reason,
    count: rejectionReasonCounts[reason] || 0,
    proportion: totalRejected > 0 ? (rejectionReasonCounts[reason] || 0) / totalRejected : 0,
  }))

  // 按能力面切分
  const surfaceGroups = new Map<string, typeof filtered>()
  for (const event of filtered) {
    const existing = surfaceGroups.get(event.capabilitySurface) || []
    existing.push(event)
    surfaceGroups.set(event.capabilitySurface, existing)
  }

  const bySurface = [...surfaceGroups.entries()].map(([surface, surfaceEvents]) => {
    const sc = { accepted: 0, modified: 0, rejected: 0, skipped: 0, pending: 0 }
    for (const e of surfaceEvents) sc[e.feedbackType]++
    return {
      surface: surface as FeedbackCapabilitySurface,
      rate: computeAdoptionRate(sc.accepted, sc.modified, sc.rejected, sc.skipped, sc.pending),
    }
  })

  return {
    typeCounts,
    adoptionRate,
    rejectionDistribution,
    bySurface,
  }
}

// ===========================================================================
// §7.10 事件列表（分页）
// ===========================================================================

export interface ListEventsQuery {
  organizationId: number
  page: number
  perPage: number
  feedbackType?: FeedbackType
  capabilitySurface?: string
}

export async function listEvents(query: ListEventsQuery) {
  let dbQuery = UnifiedAiFeedbackEvent.query()
    .where('organization_id', query.organizationId)
    .orderBy('created_at', 'desc')

  if (query.feedbackType) {
    dbQuery = dbQuery.where('feedback_type', query.feedbackType)
  }
  if (query.capabilitySurface) {
    dbQuery = dbQuery.where('capability_surface', query.capabilitySurface)
  }

  const result = await dbQuery.paginate(query.page, query.perPage)

  return {
    data: result.all(),
    meta: {
      total: result.total,
      page: result.currentPage,
      perPage: result.perPage,
      totalPages: result.lastPage,
    },
  }
}
