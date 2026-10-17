import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  TrizDecisionCenterSummaryResponse,
  TrizDecisionCenterListResponse,
  TrizDecisionCenterDetailResponse,
  TrizDecisionCenterReadinessResponse,
  TrizDecisionCenterAiDraftResponse,
  TrizDecisionCenterAiDraftRequest,
} from '@aiproj/types'

/**
 * v3-triz-decision-center —— TRIZ 决策中心前端 API 客户端（tasks 6.1）。
 *
 * 所有读取均无副作用，写入复用既有决策日志 API。
 */

// ---------------------------------------------------------------------------
// Query key 工厂
// ---------------------------------------------------------------------------

export const trizDecisionCenterKeys = {
  all: ['triz-decision-center'] as const,
  summary: (projectId: number) => [...trizDecisionCenterKeys.all, 'summary', projectId] as const,
  items: (projectId: number, filters?: Record<string, unknown>) =>
    [...trizDecisionCenterKeys.all, 'items', projectId, filters ?? {}] as const,
  detail: (projectId: number, itemId: string) =>
    [...trizDecisionCenterKeys.all, 'detail', projectId, itemId] as const,
  readiness: (projectId: number) =>
    [...trizDecisionCenterKeys.all, 'readiness', projectId] as const,
}

// ---------------------------------------------------------------------------
// API 路径
// ---------------------------------------------------------------------------

const decisionCenterPath = (projectId: number) => `/projects/${projectId}/triz-decision-center`

// ---------------------------------------------------------------------------
// API 方法
// ---------------------------------------------------------------------------

export const trizDecisionCenterApi = {
  /** 获取决策中心摘要。 */
  summary: (projectId: number) =>
    apiFetchEnvelope<TrizDecisionCenterSummaryResponse>(
      `${decisionCenterPath(projectId)}/summary`,
    ).then((res) => res.data),

  /** 获取决策中心队列列表。 */
  items: (projectId: number, filters?: Record<string, unknown>) => {
    const query = new URLSearchParams()
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value != null && value !== '') {
          query.set(key, String(value))
        }
      }
    }
    return apiFetchEnvelope<TrizDecisionCenterListResponse>(
      `${decisionCenterPath(projectId)}/items?${query.toString()}`,
    ).then((res) => res.data)
  },

  /** 获取决策中心项详情。 */
  detail: (projectId: number, itemId: string) =>
    apiFetchEnvelope<TrizDecisionCenterDetailResponse>(
      `${decisionCenterPath(projectId)}/items/${encodeURIComponent(itemId)}`,
    ).then((res) => res.data),

  /** 获取 Draft readiness。 */
  readiness: (projectId: number) =>
    apiFetchEnvelope<TrizDecisionCenterReadinessResponse>(
      `${decisionCenterPath(projectId)}/readiness`,
    ).then((res) => res.data),

  /** AI 理由草稿（建议型，不落库）。复用 AI draft reason 入口。 */
  draftReason: (projectId: number, payload: TrizDecisionCenterAiDraftRequest) =>
    apiFetchEnvelope<TrizDecisionCenterAiDraftResponse>(
      `/projects/${projectId}/triz-decision-logs/draft-reason`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      },
    ).then((res) => res.data),
}
