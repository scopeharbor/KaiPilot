import { apiFetchEnvelope } from '@/lib/api-client'
import type { HealthDiagnosis, HealthDiagnosisListItem, HealthAiDraft } from '@aiproj/types'

// ---------------------------------------------------------------------------
// API 路径
// ---------------------------------------------------------------------------

const healthDiagnosisPath = (projectId: number) => `/projects/${projectId}/health-diagnoses`

// ---------------------------------------------------------------------------
// 前端类型（从共享类型重导出）
// ---------------------------------------------------------------------------

export type {
  HealthDiagnosis,
  HealthDiagnosisListItem,
  HealthAiDraft,
  HealthDataWarning,
  HealthDimension,
  HealthSeverity,
  HealthRuleId,
  HealthDiagnosisStatus,
  HealthDiagnosisSummary,
  HealthDimensionScore,
  HealthEvidenceItem,
  HealthSuggestedAction,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// API 函数
// ---------------------------------------------------------------------------

/** 获取最新健康诊断 */
export async function getLatestDiagnosis(projectId: number): Promise<HealthDiagnosis | null> {
  const result = await apiFetchEnvelope<{ data: HealthDiagnosis | null }>(
    `${healthDiagnosisPath(projectId)}/latest`,
  )
  return result.data
}

/** 获取诊断列表 */
export async function listDiagnoses(
  projectId: number,
  params?: { status?: string; page?: number; perPage?: number; sort?: string },
): Promise<{
  data: HealthDiagnosisListItem[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}> {
  const searchParams = new URLSearchParams()
  if (params?.status) searchParams.set('status', params.status)
  if (params?.page) searchParams.set('page', String(params.page))
  if (params?.perPage) searchParams.set('perPage', String(params.perPage))
  if (params?.sort) searchParams.set('sort', params.sort)

  const qs = searchParams.toString()
  return apiFetchEnvelope(`${healthDiagnosisPath(projectId)}${qs ? `?${qs}` : ''}`)
}

/** 获取诊断详情 */
export async function getDiagnosis(
  projectId: number,
  diagnosisId: number,
): Promise<HealthDiagnosis | null> {
  const result = await apiFetchEnvelope<{ data: HealthDiagnosis | null }>(
    `${healthDiagnosisPath(projectId)}/${diagnosisId}`,
  )
  return result.data
}

/** 生成新诊断 */
export async function createDiagnosis(
  projectId: number,
  enableAiDraft?: boolean,
): Promise<HealthDiagnosis> {
  const result = await apiFetchEnvelope<{ data: HealthDiagnosis }>(healthDiagnosisPath(projectId), {
    method: 'POST',
    body: JSON.stringify({ enableAiDraft }),
    headers: { 'Content-Type': 'application/json' },
  })
  return result.data
}

/** 刷新诊断 */
export async function refreshDiagnosis(projectId: number): Promise<HealthDiagnosis> {
  const result = await apiFetchEnvelope<{ data: HealthDiagnosis }>(
    `${healthDiagnosisPath(projectId)}/refresh`,
    { method: 'POST' },
  )
  return result.data
}

/** 生成 AI 诊断草稿 */
export async function generateAiDraft(
  projectId: number,
  diagnosisId: number,
): Promise<HealthAiDraft | null> {
  const result = await apiFetchEnvelope<{ data: HealthAiDraft | null }>(
    `${healthDiagnosisPath(projectId)}/${diagnosisId}/ai-draft`,
    { method: 'POST' },
  )
  return result.data
}

/** 确认诊断 */
export async function confirmDiagnosis(
  projectId: number,
  diagnosisId: number,
  notes?: string,
): Promise<HealthDiagnosis> {
  const result = await apiFetchEnvelope<{ data: HealthDiagnosis }>(
    `${healthDiagnosisPath(projectId)}/${diagnosisId}/confirm`,
    {
      method: 'POST',
      body: JSON.stringify({ notes }),
      headers: { 'Content-Type': 'application/json' },
    },
  )
  return result.data
}

/** 驳回诊断 */
export async function rejectDiagnosis(
  projectId: number,
  diagnosisId: number,
  reason: string,
): Promise<HealthDiagnosis> {
  const result = await apiFetchEnvelope<{ data: HealthDiagnosis }>(
    `${healthDiagnosisPath(projectId)}/${diagnosisId}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
      headers: { 'Content-Type': 'application/json' },
    },
  )
  return result.data
}

/** 确认过期诊断继续使用 */
export async function confirmStaleDiagnosis(
  projectId: number,
  diagnosisId: number,
  reason?: string,
): Promise<HealthDiagnosis> {
  const result = await apiFetchEnvelope<{ data: HealthDiagnosis }>(
    `${healthDiagnosisPath(projectId)}/${diagnosisId}/confirm-stale`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
      headers: { 'Content-Type': 'application/json' },
    },
  )
  return result.data
}
