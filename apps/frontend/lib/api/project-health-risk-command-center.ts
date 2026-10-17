import { apiFetchEnvelope } from '@/lib/api-client'
import type { CommandCenterQuery, CommandCenterResponse } from '@aiproj/types'

/**
 * 项目健康风险指挥中心 API client（v3-project-health-risk-command-center §5.1）。
 *
 * 只读：仅 GET，无 mutation、无 confirm/apply handle。
 * 与后端 GET /api/v1/projects/:id/health-risk-command-center 契约一致；
 * 有效组织经会话租户上下文解析，不作为路径参数，但必须参与 query key 以隔离缓存。
 */

// ─── Query Keys ────────────────────────────────────────────────────────────────

export const commandCenterKeys = {
  all: ['projects', 'health-risk-command-center'] as const,
  /** key 绑定：有效组织 + 项目 + 规范化 query + contract version。切换组织/项目不复用缓存。 */
  summary: (organizationId: number | null, projectId: number | null, query?: CommandCenterQuery) =>
    [
      ...commandCenterKeys.all,
      organizationId ?? 'none',
      projectId ?? 'none',
      query ?? {},
      'v1',
    ] as const,
}

// ─── Query 序列化（白名单键，闭集值）────────────────────────────────────────────

export function serializeCommandCenterQuery(query?: CommandCenterQuery): string {
  if (!query) return ''
  const sp = new URLSearchParams()
  if (query.attentionLimit !== undefined && query.attentionLimit !== '') {
    sp.set('attentionLimit', String(query.attentionLimit))
  }
  if (query.include !== undefined && query.include !== '') {
    const includes = Array.isArray(query.include) ? query.include : [query.include]
    if (includes.length) sp.set('include', includes.join(','))
  }
  if (query.freshnessWindowDays !== undefined && query.freshnessWindowDays !== '') {
    sp.set('freshnessWindowDays', String(query.freshnessWindowDays))
  }
  const qs = sp.toString()
  return qs ? '?' + qs : ''
}

// ─── API ───────────────────────────────────────────────────────────────────────

/** 错误分类（5.2）：非泄露契约下前端可区分的三类。 */
export type CommandCenterErrorKind =
  'unauthenticated' | 'not-found-or-forbidden' | 'validation' | 'server' | 'network'

export function classifyCommandCenterError(error: unknown): CommandCenterErrorKind {
  const status = (error as { status?: number } | undefined)?.status
  if (status === undefined) return 'network'
  if (status === 401) return 'unauthenticated'
  if (status === 403 || status === 404) return 'not-found-or-forbidden'
  if (status === 422) return 'validation'
  return 'server'
}

/** 读取项目健康风险指挥中心投影。 */
export async function fetchProjectHealthRiskCommandCenter(
  projectId: number,
  query?: CommandCenterQuery,
): Promise<CommandCenterResponse> {
  const result = await apiFetchEnvelope<{
    data: CommandCenterResponse['data']
    meta: CommandCenterResponse['meta']
  }>('/projects/' + projectId + '/health-risk-command-center' + serializeCommandCenterQuery(query))
  // 后端返回 { data: { project, headline, sources, attention }, meta: {...} }；
  // 页面消费时把 meta 合并进统一形态。
  return {
    data: result.data,
    meta: result.meta,
  }
}
