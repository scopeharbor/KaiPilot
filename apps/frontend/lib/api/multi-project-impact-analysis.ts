import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  MultiProjectImpactScope,
  MultiProjectImpactPlanResponse,
  MultiProjectImpactRunRequest,
  MultiProjectImpactRunResponse,
  MultiProjectImpactListQuery,
  MultiProjectImpactListResponse,
  MultiProjectImpactDetailResponse,
  MultiProjectImpactRefreshRequest,
  MultiProjectImpactRefreshResponse,
  MultiProjectImpactWhatIfRequest,
  MultiProjectImpactWhatIfResponse,
  MultiProjectImpactExportRequest,
  MultiProjectImpactExportResponse,
  MultiProjectImpactFollowUpRequest,
  MultiProjectImpactFollowUpResponse,
  MultiProjectImpactAiExplanationRequest,
  MultiProjectImpactAiExplanationResponse,
  MultiProjectImpactDrillDownRequest,
  MultiProjectImpactDrillDownResponse,
} from '@aiproj/types'

// ─── API 路径 ──────────────────────────────────────────────────────

function basePath(organizationId: number | string): string {
  return `/organizations/${organizationId}/multi-project-impact-analyses`
}

// ─── Query Keys ────────────────────────────────────────────────────

export const multiProjectImpactKeys = {
  all: (organizationId: number | string) =>
    ['organizations', String(organizationId), 'multi-project-impact-analyses'] as const,
  list: (organizationId: number | string, query?: MultiProjectImpactListQuery) =>
    [...multiProjectImpactKeys.all(organizationId), 'list', query ?? {}] as const,
  detail: (organizationId: number | string, snapshotId: number) =>
    [...multiProjectImpactKeys.all(organizationId), 'detail', snapshotId] as const,
}

// ─── API 函数 ──────────────────────────────────────────────────────

/** Plan 分析计划 */
export async function planMultiProjectImpactAnalysis(
  organizationId: number,
  scope: MultiProjectImpactScope,
): Promise<MultiProjectImpactPlanResponse> {
  return apiFetchEnvelope<MultiProjectImpactPlanResponse>(`${basePath(organizationId)}/plan`, {
    method: 'POST',
    body: JSON.stringify({ scope }),
  })
}

/** Run 运行分析 */
export async function runMultiProjectImpactAnalysis(
  organizationId: number,
  runRequest: MultiProjectImpactRunRequest,
): Promise<MultiProjectImpactRunResponse> {
  return apiFetchEnvelope<MultiProjectImpactRunResponse>(`${basePath(organizationId)}/run`, {
    method: 'POST',
    body: JSON.stringify(runRequest),
  })
}

/** List 列出快照 */
export async function listMultiProjectImpactSnapshots(
  organizationId: number,
  query?: MultiProjectImpactListQuery,
): Promise<MultiProjectImpactListResponse> {
  const params = new URLSearchParams()
  if (query?.projectIds && query.projectIds.length > 0) {
    query.projectIds.forEach((id) => params.append('projectIds', String(id)))
  }
  if (query?.sourceType) params.set('sourceType', query.sourceType)
  if (query?.severity) params.set('severity', query.severity)
  if (query?.isStale !== undefined) params.set('isStale', String(query.isStale))
  if (query?.status) params.set('status', query.status)
  if (query?.sort) params.set('sort', query.sort)
  if (query?.page) params.set('page', String(query.page))
  if (query?.perPage) params.set('perPage', String(query.perPage))

  const qs = params.toString()
  return apiFetchEnvelope<MultiProjectImpactListResponse>(
    `${basePath(organizationId)}${qs ? `?${qs}` : ''}`,
  )
}

/** Read 读取快照详情 */
export async function readMultiProjectImpactSnapshot(
  organizationId: number,
  snapshotId: number,
): Promise<MultiProjectImpactDetailResponse> {
  return apiFetchEnvelope<MultiProjectImpactDetailResponse>(
    `${basePath(organizationId)}/${snapshotId}`,
  )
}

/** Refresh 刷新快照 */
export async function refreshMultiProjectImpactSnapshot(
  organizationId: number,
  refreshRequest: MultiProjectImpactRefreshRequest,
): Promise<MultiProjectImpactRefreshResponse> {
  return apiFetchEnvelope<MultiProjectImpactRefreshResponse>(
    `${basePath(organizationId)}/${refreshRequest.snapshotId}/refresh`,
    { method: 'POST' },
  )
}

/** What-if 场景对比 */
export async function compareWhatIfMultiProjectImpact(
  organizationId: number,
  whatIfRequest: MultiProjectImpactWhatIfRequest,
): Promise<MultiProjectImpactWhatIfResponse> {
  return apiFetchEnvelope<MultiProjectImpactWhatIfResponse>(`${basePath(organizationId)}/what-if`, {
    method: 'POST',
    body: JSON.stringify(whatIfRequest),
  })
}

/** Export 导出 */
export async function exportMultiProjectImpactAnalysis(
  organizationId: number,
  exportRequest: MultiProjectImpactExportRequest,
): Promise<MultiProjectImpactExportResponse> {
  return apiFetchEnvelope<MultiProjectImpactExportResponse>(`${basePath(organizationId)}/export`, {
    method: 'POST',
    body: JSON.stringify(exportRequest),
  })
}

/** Follow-up Draft 后续动作草案 */
export async function buildMultiProjectImpactFollowUpDraft(
  organizationId: number,
  followUpRequest: MultiProjectImpactFollowUpRequest,
): Promise<MultiProjectImpactFollowUpResponse> {
  return apiFetchEnvelope<MultiProjectImpactFollowUpResponse>(
    `${basePath(organizationId)}/follow-up`,
    { method: 'POST', body: JSON.stringify(followUpRequest) },
  )
}

/** AI Explanation AI 解释 */
export async function requestMultiProjectImpactAiExplanation(
  organizationId: number,
  aiRequest: MultiProjectImpactAiExplanationRequest,
): Promise<MultiProjectImpactAiExplanationResponse> {
  return apiFetchEnvelope<MultiProjectImpactAiExplanationResponse>(
    `${basePath(organizationId)}/ai-explanation`,
    { method: 'POST', body: JSON.stringify(aiRequest) },
  )
}

/** Drill-down 安全下钻 */
export async function drillDownMultiProjectImpact(
  organizationId: number,
  drillDownRequest: MultiProjectImpactDrillDownRequest,
): Promise<MultiProjectImpactDrillDownResponse> {
  return apiFetchEnvelope<MultiProjectImpactDrillDownResponse>(
    `${basePath(organizationId)}/drill-down`,
    { method: 'POST', body: JSON.stringify(drillDownRequest) },
  )
}
