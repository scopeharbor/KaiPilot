/**
 * v2-ai-draft-layer-preview-diff-apply —— Draft Layer API client（task 10.1）。
 *
 * TanStack Query keys、create / preview / diff / decision / dry-run / apply / discard endpoints。
 * 所有请求使用统一 apiFetch hook，自动携带认证与组织上下文。
 */
import { apiFetch } from '@/lib/api-client'
import type {
  DraftLayerSession,
  DraftLayerDetailResponse,
  DraftLayerPreviewResponse,
  DraftLayerDiffResponse,
  DraftLayerDryRunResponse,
  DraftLayerApplyResponse,
  DraftLayerDecision,
  DraftLayerBulkDecision,
} from '@aiproj/types'

export const aiDraftLayerApi = {
  /** 从 Compiler Run 创建 Draft Session */
  create: (compilerRunId: number) =>
    apiFetch<{ session: DraftLayerSession }>('/ai/draft-layer/sessions', {
      method: 'POST',
      body: JSON.stringify({ compilerRunId }),
    }),

  /** 获取 session 详情（含 changes、preview、diff、applyResult） */
  get: (sessionId: number) =>
    apiFetch<DraftLayerDetailResponse>(`/ai/draft-layer/sessions/${sessionId}`),

  /** 生成 Preview */
  preview: (sessionId: number) =>
    apiFetch<DraftLayerPreviewResponse>(`/ai/draft-layer/sessions/${sessionId}/preview`, {
      method: 'POST',
    }),

  /** 获取 Diff */
  diff: (sessionId: number) =>
    apiFetch<DraftLayerDiffResponse>(`/ai/draft-layer/sessions/${sessionId}/diff`),

  /** 单项决策 */
  decide: (
    sessionId: number,
    decision: {
      changeId: number
      reviewStatus: string
      userModifiedValue?: unknown
      userNote?: string
    },
  ) =>
    apiFetch<DraftLayerDecision>(`/ai/draft-layer/sessions/${sessionId}/decisions`, {
      method: 'POST',
      body: JSON.stringify(decision),
    }),

  /** 批量决策 */
  bulkDecide: (sessionId: number, filter: DraftLayerBulkDecision) =>
    apiFetch<{ affected: number; selectionHash: string }>(
      `/ai/draft-layer/sessions/${sessionId}/bulk-decisions`,
      {
        method: 'POST',
        body: JSON.stringify({ filter }),
      },
    ),

  /** Dry-run */
  dryRun: (sessionId: number, force?: boolean) =>
    apiFetch<DraftLayerDryRunResponse>(`/ai/draft-layer/sessions/${sessionId}/dry-run`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    }),

  /** Apply */
  apply: (sessionId: number, idempotencyKey?: string) =>
    apiFetch<DraftLayerApplyResponse>(`/ai/draft-layer/sessions/${sessionId}/apply`, {
      method: 'POST',
      body: JSON.stringify({ idempotencyKey }),
    }),

  /** 放弃草案 */
  discard: (sessionId: number) =>
    apiFetch<{ session: DraftLayerSession }>(`/ai/draft-layer/sessions/${sessionId}/discard`, {
      method: 'POST',
    }),
}

/** TanStack Query keys */
export const aiDraftLayerKeys = {
  all: ['ai-draft-layer'] as const,
  detail: (sessionId: number) => [...aiDraftLayerKeys.all, 'detail', sessionId] as const,
  preview: (sessionId: number) => [...aiDraftLayerKeys.all, 'preview', sessionId] as const,
  diff: (sessionId: number) => [...aiDraftLayerKeys.all, 'diff', sessionId] as const,
  decisions: (sessionId: number) => [...aiDraftLayerKeys.all, 'decisions', sessionId] as const,
  dryRun: (sessionId: number) => [...aiDraftLayerKeys.all, 'dry-run', sessionId] as const,
  apply: (sessionId: number) => [...aiDraftLayerKeys.all, 'apply', sessionId] as const,
}
