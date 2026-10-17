import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  TrizAnalysisListResponse,
  TrizAnalysisDetailResponse,
  TrizDraftHandoffRequest,
  TrizDraftHandoffResponse,
  TrizDashboardSummaryResponse,
} from '@aiproj/types'

/**
 * v2-triz-compiler-analysis-layer —— TRIZ Compiler 分析层前端 API 客户端。
 *
 * 所有解决路径均为建议型（advisory），不包含可执行的数据库 patch。
 * 前端不提供自动执行按钮。
 */

// ---------------------------------------------------------------------------
// Query key 工厂
// ---------------------------------------------------------------------------

export const trizCompilerAnalysisKeys = {
  all: ['triz-compiler-analysis'] as const,
  list: (runId: number) => [...trizCompilerAnalysisKeys.all, 'list', runId] as const,
  detail: (runId: number, artifactId: string) =>
    [...trizCompilerAnalysisKeys.all, 'detail', runId, artifactId] as const,
  dashboardSummary: (projectId: number) =>
    [...trizCompilerAnalysisKeys.all, 'dashboard', projectId] as const,
}

// ---------------------------------------------------------------------------
// API 路径
// ---------------------------------------------------------------------------

const analysisPath = (runId: number) => `/ai/compiler/runs/${runId}/triz-analysis`
const dashboardPath = (projectId: number) =>
  `/projects/${projectId}/dashboard/triz-compiler-summary`

// ---------------------------------------------------------------------------
// API 方法
// ---------------------------------------------------------------------------

export const trizCompilerAnalysisApi = {
  /** 获取 TRIZ Compiler 分析 artifact 列表。 */
  list: (runId: number) => apiFetchEnvelope<TrizAnalysisListResponse>(analysisPath(runId)),

  /** 获取指定 artifact 详情（含完整解决路径）。 */
  detail: (runId: number, artifactId: string) =>
    apiFetchEnvelope<TrizAnalysisDetailResponse>(`${analysisPath(runId)}/${artifactId}`).then(
      (res) => res.data,
    ),

  /** 提交 handoff —— 将 resolution path 转为 Draft Layer 草稿候选。 */
  handoff: (runId: number, artifactId: string, payload: TrizDraftHandoffRequest) =>
    apiFetchEnvelope<TrizDraftHandoffResponse>(`${analysisPath(runId)}/${artifactId}/handoff`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    }).then((res) => res.data),

  /** 获取 Dashboard 摘要。 */
  getDashboardSummary: (projectId: number) =>
    apiFetchEnvelope<TrizDashboardSummaryResponse>(dashboardPath(projectId)).then(
      (res) => res.data,
    ),
}
