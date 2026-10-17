import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  PmoRecommendationListQuery,
  PmoRecommendationListResponse,
  PmoRecommendationSummary,
  PmoRecommendationSummaryQuery,
  PmoRecommendationDetailResponse,
  PmoReviewActionRequest,
  PmoReviewActionResponse,
  PmoAiRationaleRequest,
  PmoRecommendationCandidate,
  PmoRecommendationRecord,
  PmoRecommendationWarning,
  RecommendationAiMetadata,
} from '@aiproj/types'

// ─── API 路径 ──────────────────────────────────────────────────────────────────

const BASE = '/pmo/ai-priority-recommendations'

// ─── Query Keys ────────────────────────────────────────────────────────────────

export const pmoAiPriorityRecommendationsKeys = {
  all: ['pmo', 'ai-priority-recommendations'] as const,
  list: (query?: PmoRecommendationListQuery) =>
    [...pmoAiPriorityRecommendationsKeys.all, 'list', query ?? {}] as const,
  summary: (query?: PmoRecommendationSummaryQuery) =>
    [...pmoAiPriorityRecommendationsKeys.all, 'summary', query ?? {}] as const,
  detail: (id: number) => [...pmoAiPriorityRecommendationsKeys.all, 'detail', id] as const,
}

// ─── API 函数 ──────────────────────────────────────────────────────────────────

/** 获取 PMO AI 推荐队列列表。 */
export async function fetchPmoRecommendationList(
  query?: PmoRecommendationListQuery,
): Promise<PmoRecommendationListResponse> {
  const sp = new URLSearchParams()
  if (query?.page) sp.set('page', String(query.page))
  if (query?.perPage) sp.set('perPage', String(query.perPage))
  if (query?.sort) sp.set('sort', query.sort)
  if (query?.order) sp.set('order', query.order)
  if (query?.status) sp.set('status', query.status)
  if (query?.severity) sp.set('severity', query.severity)
  if (query?.sourceType) sp.set('sourceType', query.sourceType)
  if (query?.aiStatus) sp.set('aiStatus', query.aiStatus)
  if (query?.stale !== undefined) sp.set('stale', String(query.stale))
  if (query?.projectId) sp.set('projectId', String(query.projectId))
  if (query?.q) sp.set('q', query.q)
  const qs = sp.toString()
  return apiFetchEnvelope<PmoRecommendationListResponse>(`${BASE}${qs ? `?${qs}` : ''}`)
}

/** 获取 PMO AI 推荐摘要。 */
export async function fetchPmoRecommendationSummary(
  query?: PmoRecommendationSummaryQuery,
): Promise<PmoRecommendationSummary> {
  const sp = new URLSearchParams()
  if (query?.includeWarnings) sp.set('includeWarnings', String(query.includeWarnings))
  if (query?.includeTop !== undefined) sp.set('includeTop', String(query.includeTop))
  const qs = sp.toString()
  const result = await apiFetchEnvelope<{ data: PmoRecommendationSummary }>(
    `${BASE}/summary${qs ? `?${qs}` : ''}`,
  )
  return result.data
}

/** 获取 PMO AI 推荐详情。 */
export async function fetchPmoRecommendationDetail(
  id: number,
): Promise<PmoRecommendationDetailResponse> {
  return apiFetchEnvelope<PmoRecommendationDetailResponse>(`${BASE}/${id}`)
}

/** 刷新 PMO AI 推荐候选。 */
export async function refreshPmoRecommendations(): Promise<{
  data: PmoRecommendationCandidate[]
  warnings: PmoRecommendationWarning[]
  created: number
  merged: number
}> {
  return apiFetchEnvelope(`${BASE}/refresh`, { method: 'POST' })
}

/**
 * AI 理由生成响应（镜像 PmoAiPriorityRecommendationsController.aiRationale 实返
 * `{ data: { aiMetadata, record } }`——aiMetadata 为本次生成的底层 AI 元数据，
 * record 为生成后落库的推荐记录（含更新后的 aiStatus/aiMetadata）；类型包中
 * 泛化的 PmoAiRationaleResponse（{ data: PmoAiRationaleMetadata }）与控制器实返
 * 不符，此处以实返为准内联声明）。
 */
export interface GeneratePmoAiRationaleResult {
  data: {
    aiMetadata: RecommendationAiMetadata
    record: PmoRecommendationRecord
  }
}

/** 生成/重新生成 AI 理由。 */
export async function generatePmoAiRationale(
  id: number,
  body: PmoAiRationaleRequest,
): Promise<GeneratePmoAiRationaleResult> {
  return apiFetchEnvelope<GeneratePmoAiRationaleResult>(`${BASE}/${id}/ai-rationale`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 审查动作（accept / dismiss / snooze / convert）。 */
export async function updatePmoRecommendationStatus(
  id: number,
  body: PmoReviewActionRequest,
): Promise<PmoReviewActionResponse> {
  return apiFetchEnvelope<PmoReviewActionResponse>(`${BASE}/${id}/status`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}
