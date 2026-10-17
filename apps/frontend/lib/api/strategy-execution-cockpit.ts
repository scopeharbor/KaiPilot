import { apiFetchEnvelope } from '@/lib/api-client'
import type { CockpitQuery, CockpitSummary } from '@aiproj/types'

/**
 * 战略执行驾驶舱 API client（v3-strategy-execution-cockpit §5.1）。
 *
 * 只读：仅 GET，无 mutation、无 confirm/apply handle。组织 ID 显式带在路径上，
 * 与后端 GET /api/v1/organizations/:organizationId/strategy-execution-cockpit 契约一致。
 */

// ─── Query Keys ────────────────────────────────────────────────────────────────

export const strategyExecutionCockpitKeys = {
  all: ['organizations', 'strategy-execution-cockpit'] as const,
  summary: (organizationId: number | null, query?: CockpitQuery) =>
    [...strategyExecutionCockpitKeys.all, organizationId ?? 'none', query ?? {}] as const,
}

// ─── URL filter 序列化 / 解析（§5.2）───────────────────────────────────────────

export function serializeCockpitUrlFilters(query?: CockpitQuery): string {
  if (!query) return ''
  const sp = new URLSearchParams()
  if (query.cycleId) sp.set('cycleId', String(query.cycleId))
  if (query.scope) {
    const scopes = Array.isArray(query.scope) ? query.scope : [query.scope]
    if (scopes.length) sp.set('scope', scopes.join(','))
  }
  if (query.ownerId) sp.set('ownerId', String(query.ownerId))
  if (query.status) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status]
    if (statuses.length) sp.set('status', statuses.join(','))
  }
  if (query.theme) {
    const themes = Array.isArray(query.theme) ? query.theme : [query.theme]
    if (themes.length) sp.set('theme', themes.join(','))
  }
  if (query.include) {
    const includes = Array.isArray(query.include) ? query.include : [query.include]
    if (includes.length) sp.set('include', includes.join(','))
  }
  if (query.freshnessWindowMinutes)
    sp.set('freshnessWindowMinutes', String(query.freshnessWindowMinutes))
  if (query.attentionLimit) sp.set('attentionLimit', String(query.attentionLimit))
  if (query.sort) sp.set('sort', query.sort)
  if (query.order) sp.set('order', query.order)
  const qs = sp.toString()
  return qs ? '?' + qs : ''
}

export function parseCockpitUrlFilters(
  params: Record<string, string | string[] | undefined>,
): CockpitQuery {
  const query: CockpitQuery = {}
  const one = (key: string): string | undefined => {
    const value = params[key]
    return Array.isArray(value) ? value[0] : value
  }
  const list = (key: string): string[] | undefined => {
    const value = params[key]
    if (!value) return undefined
    return Array.isArray(value)
      ? value
      : value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
  }
  const cycleId = Number(one('cycleId'))
  if (Number.isFinite(cycleId) && cycleId > 0) query.cycleId = cycleId
  const scope = list('scope') as CockpitQuery['scope']
  if (scope) query.scope = scope
  const ownerId = Number(one('ownerId'))
  if (Number.isFinite(ownerId) && ownerId > 0) query.ownerId = ownerId
  const status = list('status') as CockpitQuery['status']
  if (status) query.status = status
  const theme = list('theme') as CockpitQuery['theme']
  if (theme) query.theme = theme
  const include = list('include') as CockpitQuery['include']
  if (include) query.include = include
  const freshnessWindowMinutes = Number(one('freshnessWindowMinutes'))
  if (Number.isFinite(freshnessWindowMinutes) && freshnessWindowMinutes > 0)
    query.freshnessWindowMinutes = freshnessWindowMinutes
  const attentionLimit = Number(one('attentionLimit'))
  if (Number.isFinite(attentionLimit) && attentionLimit > 0) query.attentionLimit = attentionLimit
  const sort = one('sort') as CockpitQuery['sort']
  if (sort) query.sort = sort
  const order = one('order') as CockpitQuery['order']
  if (order === 'asc' || order === 'desc') query.order = order
  return query
}

// ─── API ───────────────────────────────────────────────────────────────────────

/** 读取战略执行驾驶舱摘要。 */
export async function fetchStrategyExecutionCockpit(
  organizationId: number,
  query?: CockpitQuery,
): Promise<CockpitSummary> {
  const result = await apiFetchEnvelope<{ data: CockpitSummary }>(
    '/organizations/' +
      organizationId +
      '/strategy-execution-cockpit' +
      serializeCockpitUrlFilters(query),
  )
  return result.data
}
