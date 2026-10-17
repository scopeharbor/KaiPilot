/**
 * v3-copilot-suggestion-inbox — 前端 API 客户端
 *
 * 收件箱查询、状态变更、刷新聚合。
 *
 * 统一走 `apiFetch`：此前用裸 `fetch` 请求前端同源的相对路径，既不带 Bearer 令牌，
 * 也没指向后端地址，浏览器里四个接口全部失败，收件箱实际不可用。
 */

import { apiFetch } from '@/lib/api-client'
import type {
  InboxEntryState,
  InboxAction,
  InboxSourceKind,
  InboxSeverity,
  InboxAggregateResult,
  InboxMissingSource,
} from '@aiproj/types'

const BASE = '/copilot-suggestion-inbox'

/**
 * 查询收件箱条目。
 */
export async function queryInbox(params: {
  projectId?: number
  sourceKind?: InboxSourceKind
  state?: InboxEntryState
  severity?: InboxSeverity
  since?: string
  until?: string
  page?: number
  perPage?: number
}): Promise<InboxAggregateResult> {
  const qs = new URLSearchParams()
  if (params.projectId) qs.set('projectId', String(params.projectId))
  if (params.sourceKind) qs.set('sourceKind', params.sourceKind)
  if (params.state) qs.set('state', params.state)
  if (params.severity) qs.set('severity', params.severity)
  if (params.since) qs.set('since', params.since)
  if (params.until) qs.set('until', params.until)
  if (params.page) qs.set('page', String(params.page))
  if (params.perPage) qs.set('perPage', String(params.perPage))

  const suffix = qs.size ? `?${qs.toString()}` : ''
  return apiFetch<InboxAggregateResult>(`${BASE}${suffix}`)
}

/**
 * 获取未读计数。
 */
export async function getUnreadCount(projectId?: number): Promise<number> {
  const qs = projectId ? `?projectId=${projectId}` : ''
  const data = await apiFetch<{ unreadCount: number }>(`${BASE}/unread-count${qs}`)
  return data.unreadCount
}

/**
 * 执行状态变更动作。
 */
export async function performAction(
  entryId: string,
  action: InboxAction,
): Promise<{
  entryId: string
  previousState: InboxEntryState
  newState: InboxEntryState
  previewSessionId?: string
}> {
  return apiFetch(`${BASE}/${encodeURIComponent(entryId)}/action`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  })
}

/**
 * 刷新聚合（触发过期检查）。
 */
export async function refreshInbox(projectId: number): Promise<{
  aggregated: number
  created: number
  updated: number
  skippedTerminal: number
  missingSources: InboxMissingSource[]
  expired: number
}> {
  return apiFetch(`${BASE}/refresh`, {
    method: 'POST',
    body: JSON.stringify({ projectId }),
  })
}
