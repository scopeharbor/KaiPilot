// OKR Dashboard API client（v3-okr-dashboard §5.1）。
//
// 只读 API：仅覆盖 `GET /api/v1/organizations/:organizationId/okrs/dashboard`。
// 与后端 controller 契约保持一致，返回 `{ data: OkrDashboardSummary }` 信封。
// 组织 ID 显式带在路径中；query 参数走白名单，与后端 validator 对齐。

import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  OkrDashboardQuery,
  OkrDashboardSummary,
  OkrDashboardSummaryResponse,
} from '@aiproj/types'

// ─── Query Keys（分层，与 use-okr.ts 里 okrKeys 一致的风格） ────────────────────

export const okrDashboardKeys = {
  all: (organizationId: number | null) => ['okr-dashboard', organizationId ?? 'none'] as const,
  summary: (organizationId: number | null, query?: OkrDashboardQuery) =>
    [...okrDashboardKeys.all(organizationId), 'summary', normalizeKey(query)] as const,
}

/**
 * 将 query 压平成稳定的 key 片段，避免同一语义不同顺序导致缓存重复。
 * 数组类字段先排序，undefined/null/空数组过滤，防止无谓的 refetch。
 */
function normalizeKey(query?: OkrDashboardQuery): Record<string, unknown> {
  if (!query) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      if (v.length === 0) continue
      out[k] = [...v].map(String).sort()
      continue
    }
    out[k] = v
  }
  return out
}

// ─── URL builder ──────────────────────────────────────────────────────────────

function buildQueryString(query?: OkrDashboardQuery): string {
  if (!query) return ''
  const sp = new URLSearchParams()
  if (query.cycleId != null) sp.set('cycleId', String(query.cycleId))
  if (query.ownerId != null) sp.set('ownerId', String(query.ownerId))
  if (query.attentionLimit != null) sp.set('attentionLimit', String(query.attentionLimit))
  if (query.attentionSort) sp.set('attentionSort', query.attentionSort)
  if (query.attentionOrder) sp.set('attentionOrder', query.attentionOrder)
  if (query.staleThresholdMinutes != null) {
    sp.set('staleThresholdMinutes', String(query.staleThresholdMinutes))
  }
  if (query.dateFrom) sp.set('dateFrom', query.dateFrom)
  if (query.dateTo) sp.set('dateTo', query.dateTo)
  if (query.search) sp.set('search', query.search)
  // 数组走重复 key，与后端 validator 的 array 白名单解析一致。
  const appendArray = (key: string, value: unknown) => {
    if (value == null) return
    const arr = Array.isArray(value) ? value : [value]
    for (const v of arr) {
      if (v == null || v === '') continue
      sp.append(key, String(v))
    }
  }
  appendArray('scope', query.scope)
  appendArray('status', query.status)
  appendArray('sections', query.sections)
  appendArray('include', query.include)
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

/**
 * 拉取 OKR Dashboard 摘要（只读）。
 *
 * 抛出的错误由 apiFetchEnvelope 统一 `ApiError` 化：
 *   - 401 → 触发一次静默 refresh
 *   - 403 → 组件层视作 forbidden
 *   - 422 → validation error
 * TanStack Query 层可用 queryRetry 决定是否重试。
 */
export async function fetchOkrDashboardSummary(
  organizationId: number,
  query?: OkrDashboardQuery,
): Promise<OkrDashboardSummary> {
  const envelope = await apiFetchEnvelope<OkrDashboardSummaryResponse>(
    `/organizations/${organizationId}/okrs/dashboard${buildQueryString(query)}`,
  )
  return envelope.data
}
