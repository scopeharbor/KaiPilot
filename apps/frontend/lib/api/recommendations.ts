import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  RecommendationListItem,
  RecommendationRecord,
  RecommendationSummary,
  RecommendationAiMetadata,
  RecommendationWarning,
  RecommendationStatus,
  RecommendationSource,
  RecommendationSeverity,
  RecommendationConfidence,
  RecommendationActionType,
  RecommendationVisibility,
  RecommendationTargetRef,
  RecommendationEvidenceRef,
  RecommendationCandidate,
  RecommendationAction,
  DashboardRecommendationSummary,
  NotificationRecommendationPayload,
  ActivityRecommendationEvent,
  ListRecommendationsQuery,
  ListRecommendationsResponse,
  GetRecommendationResponse,
  RefreshRecommendationsRequest,
  RefreshRecommendationsResponse,
  UpdateRecommendationStatusRequest,
  UpdateRecommendationStatusResponse,
  GenerateAiExplanationRequest,
  GenerateAiExplanationResponse,
  ApproveAiExplanationRequest,
  ApproveAiExplanationResponse,
  RejectAiExplanationRequest,
  RejectAiExplanationResponse,
  ConvertRecommendationRequest,
  ConvertRecommendationResponse,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// API 路径
// ---------------------------------------------------------------------------

const recommendationsPath = (projectId: number) => `/projects/${projectId}/recommendations`

// ---------------------------------------------------------------------------
// 前端类型（从共享类型重导出）
// ---------------------------------------------------------------------------

export type {
  RecommendationListItem,
  RecommendationRecord,
  RecommendationSummary,
  RecommendationAiMetadata,
  RecommendationWarning,
  RecommendationStatus,
  RecommendationSource,
  RecommendationSeverity,
  RecommendationConfidence,
  RecommendationActionType,
  RecommendationVisibility,
  RecommendationTargetRef,
  RecommendationEvidenceRef,
  RecommendationCandidate,
  RecommendationAction,
  DashboardRecommendationSummary,
  NotificationRecommendationPayload,
  ActivityRecommendationEvent,
  ListRecommendationsQuery,
  ListRecommendationsResponse,
  GetRecommendationResponse,
  RefreshRecommendationsRequest,
  RefreshRecommendationsResponse,
  UpdateRecommendationStatusRequest,
  UpdateRecommendationStatusResponse,
  GenerateAiExplanationRequest,
  GenerateAiExplanationResponse,
  ApproveAiExplanationRequest,
  ApproveAiExplanationResponse,
  RejectAiExplanationRequest,
  RejectAiExplanationResponse,
  ConvertRecommendationRequest,
  ConvertRecommendationResponse,
}

// ---------------------------------------------------------------------------
// API 常量重导出
// ---------------------------------------------------------------------------

export {
  RECOMMENDATION_SOURCES,
  RECOMMENDATION_STATUSES,
  RECOMMENDATION_TRANSITIONS,
  RECOMMENDATION_SEVERITIES,
  RECOMMENDATION_SEVERITY_ORDER,
  RECOMMENDATION_SEVERITY_LABELS,
  RECOMMENDATION_CONFIDENCES,
  RECOMMENDATION_VISIBILITY,
  RECOMMENDATION_ACTION_TYPES,
  recommendationSeverityScore,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// API 函数
// ---------------------------------------------------------------------------

/** 获取项目推荐列表 */
export async function listRecommendations(
  projectId: number,
  params?: ListRecommendationsQuery,
): Promise<ListRecommendationsResponse> {
  const searchParams = new URLSearchParams()
  if (params?.status) searchParams.set('status', params.status)
  if (params?.sourceType) searchParams.set('sourceType', params.sourceType)
  if (params?.severity) searchParams.set('severity', params.severity)
  if (params?.targetType) searchParams.set('targetType', params.targetType)
  if (params?.relatedToMe !== undefined) searchParams.set('relatedToMe', String(params.relatedToMe))
  if (params?.stale !== undefined) searchParams.set('stale', String(params.stale))
  if (params?.q) searchParams.set('q', params.q)
  if (params?.page) searchParams.set('page', String(params.page))
  if (params?.perPage) searchParams.set('perPage', String(params.perPage))
  if (params?.sort) searchParams.set('sort', params.sort)

  const qs = searchParams.toString()
  return apiFetchEnvelope<ListRecommendationsResponse>(
    `${recommendationsPath(projectId)}${qs ? `?${qs}` : ''}`,
  )
}

/** 获取推荐摘要 */
export async function getRecommendationSummary(projectId: number): Promise<RecommendationSummary> {
  return apiFetchEnvelope<RecommendationSummary>(`${recommendationsPath(projectId)}/summary`)
}

/** 获取推荐详情 */
export async function getRecommendationDetail(
  projectId: number,
  recId: number,
): Promise<RecommendationRecord> {
  const result = await apiFetchEnvelope<GetRecommendationResponse>(
    `${recommendationsPath(projectId)}/${recId}`,
  )
  return result.data
}

/** 刷新推荐候选 */
export async function refreshRecommendations(
  projectId: number,
  sources?: RecommendationSource[],
): Promise<RefreshRecommendationsResponse> {
  const body: RefreshRecommendationsRequest = sources ? { sources } : {}
  return apiFetchEnvelope<RefreshRecommendationsResponse>(
    `${recommendationsPath(projectId)}/refresh`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

/** 更新推荐状态 */
export async function updateRecommendationStatus(
  projectId: number,
  recId: number,
  status: RecommendationStatus,
  reason?: string,
): Promise<RecommendationRecord> {
  const body: UpdateRecommendationStatusRequest = { status, reason }
  const result = await apiFetchEnvelope<UpdateRecommendationStatusResponse>(
    `${recommendationsPath(projectId)}/${recId}/status`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    },
  )
  return result.data
}

/** 生成 AI 解释 */
export async function generateAiExplanation(
  projectId: number,
  recId: number,
  idempotencyKey?: string,
): Promise<RecommendationAiMetadata> {
  const body: GenerateAiExplanationRequest = idempotencyKey ? { idempotencyKey } : {}
  const result = await apiFetchEnvelope<{ data: RecommendationAiMetadata }>(
    `${recommendationsPath(projectId)}/${recId}/ai-explanation`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    },
  )
  return result.data
}

/** 批准 AI 解释 */
export async function approveAiExplanation(
  projectId: number,
  recId: number,
  notes?: string,
): Promise<RecommendationRecord> {
  const body: ApproveAiExplanationRequest = notes ? { notes } : {}
  const result = await apiFetchEnvelope<{ data: RecommendationRecord }>(
    `${recommendationsPath(projectId)}/${recId}/ai-explanation/approve`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    },
  )
  return result.data
}

/** 驳回 AI 解释 */
export async function rejectAiExplanation(
  projectId: number,
  recId: number,
  reason: string,
): Promise<RecommendationRecord> {
  const body: RejectAiExplanationRequest = { reason }
  const result = await apiFetchEnvelope<{ data: RecommendationRecord }>(
    `${recommendationsPath(projectId)}/${recId}/ai-explanation/reject`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    },
  )
  return result.data
}

/** 转换推荐 */
export async function convertRecommendation(
  projectId: number,
  recId: number,
  convertTo: string,
  params?: Record<string, unknown>,
): Promise<ConvertRecommendationResponse['data']> {
  const body: ConvertRecommendationRequest = { convertTo, params }
  const result = await apiFetchEnvelope<ConvertRecommendationResponse>(
    `${recommendationsPath(projectId)}/${recId}/convert`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    },
  )
  return result.data
}
