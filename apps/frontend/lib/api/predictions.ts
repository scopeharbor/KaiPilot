import { apiFetchEnvelope } from '@/lib/api-client'

// ---------------------------------------------------------------------------
// 类型 — 通过 @aiproj/types 共享包导入
// ---------------------------------------------------------------------------

import type {
  PredictionSnapshot,
  PredictionSnapshotListItem,
  PredictionSignal,
  PredictionAiExplanation,
  PredictionDataWarning,
  DashboardPredictionSummary,
  PredictionSnapshotStatus,
  PredictionWindow,
  CreatePredictionRequest,
  CreatePredictionResponse,
  ListPredictionsQuery,
  ListPredictionsResponse,
  GetPredictionResponse,
  ConfirmPredictionRequest,
  ConfirmPredictionResponse,
  DismissPredictionRequest,
  DismissPredictionResponse,
  GenerateAiExplanationRequest,
  GenerateAiExplanationResponse,
  ApproveAiExplanationRequest,
  ApproveAiExplanationResponse,
  RejectAiExplanationRequest,
  RejectAiExplanationResponse,
} from '@aiproj/types'

export type {
  PredictionSnapshot,
  PredictionSnapshotListItem,
  PredictionSignal,
  PredictionAiExplanation,
  PredictionDataWarning,
  DashboardPredictionSummary,
  PredictionSnapshotStatus,
  PredictionWindow,
  CreatePredictionRequest,
  CreatePredictionResponse,
  ListPredictionsQuery,
  ListPredictionsResponse,
  GetPredictionResponse,
  ConfirmPredictionRequest,
  ConfirmPredictionResponse,
  DismissPredictionRequest,
  DismissPredictionResponse,
  GenerateAiExplanationRequest,
  GenerateAiExplanationResponse,
  ApproveAiExplanationRequest,
  ApproveAiExplanationResponse,
  RejectAiExplanationRequest,
  RejectAiExplanationResponse,
}

export type {
  PredictionSeverity,
  PredictionSignalType,
  PredictionConfidenceBand,
  AiExplanationStatus,
  EvidenceVisibility,
  PredictionConfirmation,
} from '@aiproj/types'

export {
  PREDICTION_WINDOWS,
  PREDICTION_SNAPSHOT_STATUSES,
  PREDICTION_SIGNAL_TYPES,
  PREDICTION_SIGNAL_TYPE_LABELS,
  PREDICTION_SEVERITIES,
  PREDICTION_SEVERITY_ORDER,
  PREDICTION_CONFIDENCE_BANDS,
  AI_EXPLANATION_STATUSES,
  AI_EXPLANATION_FAILURE_CODES,
  EVIDENCE_VISIBILITY,
  predictionSeverityScore,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// API 函数
// ---------------------------------------------------------------------------

/** 创建预测快照（触发 AI 预测生成）。 */
export async function createPrediction(
  projectId: number,
  data: CreatePredictionRequest,
): Promise<CreatePredictionResponse> {
  return apiFetchEnvelope(`/projects/${projectId}/predictions`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/** 列出预测历史。 */
export async function listPredictions(
  projectId: number,
  query?: ListPredictionsQuery,
): Promise<ListPredictionsResponse> {
  const params = new URLSearchParams()
  if (query?.status) params.set('status', query.status)
  if (query?.window) params.set('window', String(query.window))
  if (query?.page) params.set('page', String(query.page))
  if (query?.perPage) params.set('perPage', String(query.perPage))
  if (query?.sort) params.set('sort', query.sort)
  const qs = params.size ? `?${params.toString()}` : ''
  return apiFetchEnvelope(`/projects/${projectId}/predictions${qs}`)
}

/** 获取最新的预测快照。 */
export async function getLatestPrediction(projectId: number): Promise<GetPredictionResponse> {
  return apiFetchEnvelope(`/projects/${projectId}/predictions/latest`)
}

/** 获取指定预测快照。 */
export async function getPrediction(projectId: number, id: number): Promise<GetPredictionResponse> {
  return apiFetchEnvelope(`/projects/${projectId}/predictions/${id}`)
}

/** 确认预测快照。 */
export async function confirmPrediction(
  projectId: number,
  id: number,
  data?: ConfirmPredictionRequest,
): Promise<ConfirmPredictionResponse> {
  return apiFetchEnvelope(`/projects/${projectId}/predictions/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify(data ?? {}),
  })
}

/** 忽略预测快照。 */
export async function dismissPrediction(
  projectId: number,
  id: number,
  data: DismissPredictionRequest,
): Promise<DismissPredictionResponse> {
  return apiFetchEnvelope(`/projects/${projectId}/predictions/${id}/dismiss`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/** 生成 AI 解释。 */
export async function generateAiExplanation(
  projectId: number,
  id: number,
  data?: GenerateAiExplanationRequest,
): Promise<GenerateAiExplanationResponse> {
  return apiFetchEnvelope(`/projects/${projectId}/predictions/${id}/ai-explanation`, {
    method: 'POST',
    body: JSON.stringify(data ?? {}),
  })
}

/** 批准 AI 解释。 */
export async function approveAiExplanation(
  projectId: number,
  id: number,
  data?: ApproveAiExplanationRequest,
): Promise<ApproveAiExplanationResponse> {
  return apiFetchEnvelope(`/projects/${projectId}/predictions/${id}/ai-explanation/approve`, {
    method: 'POST',
    body: JSON.stringify(data ?? {}),
  })
}

/** 驳回 AI 解释。 */
export async function rejectAiExplanation(
  projectId: number,
  id: number,
  data: RejectAiExplanationRequest,
): Promise<RejectAiExplanationResponse> {
  return apiFetchEnvelope(`/projects/${projectId}/predictions/${id}/ai-explanation/reject`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/** 获取 Dashboard 预测摘要。 */
export async function getDashboardPredictionSummary(
  projectId: number,
): Promise<{ data: DashboardPredictionSummary }> {
  return apiFetchEnvelope(`/projects/${projectId}/predictions/dashboard-summary`)
}
