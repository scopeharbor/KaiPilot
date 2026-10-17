/**
 * v3-copilot-live-submission-channel —— Copilot 记忆 API 客户端（任务 7.8）。
 *
 * `v3-copilot-memory-user-and-project` 已归档并交付了后端八个端点
 * （`/api/v1/ai/memory` 组）与 `CopilotMemoryView` 组件，但**从未提供前端客户端**，
 * 组件因此生产引用为 0、一次都没被挂载。本模块补齐这条线。
 *
 * 复用既有 `apiFetch`（自动附 token、401 静默 refresh 后重放、统一解包 `data`）。
 */

import { apiFetch } from '@/lib/api-client'
import type { MemoryEntry } from '@/components/copilot/CopilotMemoryView'

const BASE = '/ai/memory'

export interface CopilotMemoryListParams {
  scope?: 'user' | 'project' | 'organization'
  projectId?: number
}

export const copilotMemoryApi = {
  /** GET /api/v1/ai/memory —— 列出当前 actor 可见的记忆条目。 */
  list: (params: CopilotMemoryListParams = {}) => {
    const qs = new URLSearchParams()
    if (params.scope) qs.set('scope', params.scope)
    if (params.projectId !== undefined) qs.set('projectId', String(params.projectId))
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return apiFetch<readonly MemoryEntry[]>(`${BASE}${suffix}`)
  },

  /** POST /api/v1/ai/memory/:id/confirm —— 确认候选记忆。 */
  confirm: (entryId: string) =>
    apiFetch<MemoryEntry>(`${BASE}/${encodeURIComponent(entryId)}/confirm`, { method: 'POST' }),

  /** POST /api/v1/ai/memory/:id/ignore —— 忽略候选记忆。 */
  ignore: (entryId: string) =>
    apiFetch<MemoryEntry>(`${BASE}/${encodeURIComponent(entryId)}/ignore`, { method: 'POST' }),

  /** POST /api/v1/ai/memory/:id/invalidate —— 标记记忆失效。 */
  invalidate: (entryId: string) =>
    apiFetch<MemoryEntry>(`${BASE}/${encodeURIComponent(entryId)}/invalidate`, { method: 'POST' }),

  /** DELETE /api/v1/ai/memory/:id —— 删除记忆（可清除要求）。 */
  remove: (entryId: string) =>
    apiFetch<void>(`${BASE}/${encodeURIComponent(entryId)}`, { method: 'DELETE' }),
}

/** 分层 query keys。 */
export const copilotMemoryKeys = {
  all: ['copilot-memory'] as const,
  list: (params: CopilotMemoryListParams) => [...copilotMemoryKeys.all, 'list', params] as const,
}
