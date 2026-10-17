import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  TrizDecisionLogListResponse,
  TrizDecisionLogDetailResponse,
  TrizDecisionLogCreateRequest,
  TrizDecisionLogCreateResponse,
  TrizDecisionLogSupersedeRequest,
  TrizDecisionSubjectLookupRequest,
  TrizDecisionSubjectLookupResponse,
  TrizDecisionAiDraftRequest,
  TrizDecisionAiDraftResponse,
} from '@aiproj/types'

/**
 * v2-triz-decision-log-traceability —— TRIZ 决策日志前端 API 客户端。
 *
 * 所有创建/废止操作均需用户确认，AI 仅为辅助草稿生成，不自动落库。
 */

// ---------------------------------------------------------------------------
// Query key 工厂
// ---------------------------------------------------------------------------

export const trizDecisionLogKeys = {
  all: ['triz-decision-log'] as const,
  list: (projectId: number, page?: number, perPage?: number) =>
    [...trizDecisionLogKeys.all, 'list', projectId, page ?? 1, perPage ?? 20] as const,
  detail: (projectId: number, decisionLogId: number) =>
    [...trizDecisionLogKeys.all, 'detail', projectId, decisionLogId] as const,
  subjectLookup: (projectId: number, kind: string, id: string) =>
    [...trizDecisionLogKeys.all, 'subject', projectId, kind, id] as const,
}

// ---------------------------------------------------------------------------
// API 路径
// ---------------------------------------------------------------------------

const decisionLogPath = (projectId: number) => `/projects/${projectId}/triz-decision-logs`

// ---------------------------------------------------------------------------
// API 方法
// ---------------------------------------------------------------------------

export const trizDecisionLogApi = {
  /** 获取决策日志列表（分页）。 */
  list: (projectId: number, page = 1, perPage = 20) => {
    const query = new URLSearchParams()
    query.set('page', String(page))
    query.set('perPage', String(perPage))
    return apiFetchEnvelope<TrizDecisionLogListResponse>(
      `${decisionLogPath(projectId)}?${query.toString()}`,
    ).then((res) => res.data)
  },

  /** 获取决策日志详情。 */
  detail: (projectId: number, decisionLogId: number) =>
    apiFetchEnvelope<TrizDecisionLogDetailResponse>(
      `${decisionLogPath(projectId)}/${decisionLogId}`,
    ).then((res) => res.data),

  /** 创建决策日志。 */
  create: (projectId: number, payload: TrizDecisionLogCreateRequest) =>
    apiFetchEnvelope<TrizDecisionLogCreateResponse>(decisionLogPath(projectId), {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    }).then((res) => res.data),

  /** 废止旧决策（追加式修订）。 */
  supersede: (projectId: number, decisionLogId: number, payload: TrizDecisionLogSupersedeRequest) =>
    apiFetchEnvelope<TrizDecisionLogCreateResponse>(
      `${decisionLogPath(projectId)}/${decisionLogId}/supersede`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      },
    ).then((res) => res.data),

  /** 主题查询 —— 按 subject ref 查询相关决策日志。 */
  subjectLookup: (projectId: number, payload: TrizDecisionSubjectLookupRequest) =>
    apiFetchEnvelope<TrizDecisionSubjectLookupResponse>(
      `${decisionLogPath(projectId)}/subject-lookup`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      },
    ).then((res) => res.data),

  /** AI 辅助理由草稿生成（建议型，不落库）。 */
  draftReason: (projectId: number, payload: TrizDecisionAiDraftRequest) =>
    apiFetchEnvelope<TrizDecisionAiDraftResponse>(`${decisionLogPath(projectId)}/draft-reason`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    }).then((res) => res.data),
}
