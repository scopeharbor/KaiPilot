'use client'

/**
 * v3-copilot-authoritative-page-context —— 前端页面语境 adapter（任务 1.2）。
 *
 * 从 pathname/params/searchParams 派生结构化 `PageContextDescriptor`：
 * - 只发送结构化可见状态（路由/项目/视图/筛选/排序/时间窗/选中实体/修订号）；
 * - **从不读取 DOM**：不读取 document、refs、innerHTML、整页 HTML；
 * - 只发送每路由 allowlist 内的 filter/sort 键（后端以同一张表二次校验）；
 * - routeRevision 为确定性稳定指纹（同页面同 revision，页面状态变化即变化）。
 *
 * 纯函数（除 URLSearchParams 读取外无副作用），组件测试可直接构造输入。
 */

import type { CopilotPageContextDescriptorV1 } from '@aiproj/types'
import {
  COPILOT_PAGE_CONTEXT_ROUTE_FILTER_ALLOWLIST,
  COPILOT_PAGE_CONTEXT_ROUTE_SORT_ALLOWLIST,
  deriveCopilotPageRouteRevision,
  type CopilotPageContextFilter,
  type CopilotPageContextRouteId,
  type CopilotPageContextSort,
  type CopilotPageEntityRef,
} from '@aiproj/types'

export interface PageContextDerivationInput {
  readonly pathname: string
  readonly params: Readonly<Record<string, string | string[]>>
  readonly searchParams: URLSearchParams
}

/** 各视图路由段 → routeId。 */
const VIEW_SEGMENT_TO_ROUTE_ID: Readonly<Record<string, CopilotPageContextRouteId>> = {
  kanban: 'project-kanban',
  list: 'project-list',
  calendar: 'project-calendar',
  timeline: 'project-timeline',
  gantt: 'project-gantt',
  wbs: 'project-wbs',
}

/** 路由 → 视图中文名（披露 chips 用；design §G「页面：看板」）。 */
export const PAGE_CONTEXT_ROUTE_LABELS: Readonly<Record<CopilotPageContextRouteId, string>> = {
  'project-kanban': '看板',
  'project-list': '任务列表',
  'project-calendar': '日历',
  'project-timeline': '时间线',
  'project-gantt': '甘特图',
  'project-wbs': 'WBS',
  'project-overview': '项目概览',
  global: '全局',
}

/** URL 参数名 → canonical filter key（只映射结构化可见状态）。 */
const QUERY_FILTER_PARAM_MAP: Readonly<Record<string, string>> = {
  search: 'keyword',
  status: 'status',
  assigneeId: 'assignee',
  priority: 'priority',
  label: 'label',
  milestone: 'milestone',
  criticalPath: 'criticalPath',
  parent: 'parent',
  level: 'level',
  selection: 'selection',
}

/** URL 参数名 → 选中实体 kind（仅单选 ID 形态，避免发送不可见字段）。 */
const ENTITY_SELECTION_PARAM_MAP: Readonly<Record<string, CopilotPageEntityRef['kind']>> = {
  task: 'task',
  risk: 'risk',
  milestone: 'milestone',
  resource: 'resource',
}

/** 解析项目路由（/projects/:id/...）。返回项目 ID 或 null。 */
export function extractProjectIdFromPathname(pathname: string): number | null {
  const match = /^\/projects\/(\d+)(?:\/|$)/.exec(pathname)
  if (!match) return null
  const id = Number(match[1])
  return Number.isInteger(id) && id > 0 ? id : null
}

/** 解析路由 ID（优先级：六视图 > 任务列表 > 项目概览 > 全局）。 */
export function deriveRouteId(pathname: string): CopilotPageContextRouteId {
  const projectMatch = /^\/projects\/\d+\/(?:\(views\)\/)?([a-z-]+)/.exec(pathname)
  if (projectMatch) {
    const segment = projectMatch[1]
    const viewRoute = VIEW_SEGMENT_TO_ROUTE_ID[segment as keyof typeof VIEW_SEGMENT_TO_ROUTE_ID]
    if (viewRoute !== undefined) return viewRoute
    if (segment === 'tasks') return 'project-list'
  }
  if (/^\/projects\/\d+$/.test(pathname)) return 'project-overview'
  return 'global'
}

/** 从 URL 派生 filter 清单（只含 allowlist 内键，按声明序）。 */
export function deriveFilters(
  routeId: CopilotPageContextRouteId,
  searchParams: URLSearchParams,
): CopilotPageContextFilter[] {
  const allowed = COPILOT_PAGE_CONTEXT_ROUTE_FILTER_ALLOWLIST[routeId]
  const filters: CopilotPageContextFilter[] = []
  for (const [paramName, key] of Object.entries(QUERY_FILTER_PARAM_MAP)) {
    if (!allowed.includes(key)) continue
    const raw = searchParams.get(paramName)
    if (raw === null || raw.trim().length === 0) continue
    filters.push({ key, op: 'eq', value: raw.trim().slice(0, 128) })
  }
  return filters
}

/** 从 ?sort=-dueDate,priority 派生排序（只含 allowlist 内字段）。 */
export function deriveSort(
  routeId: CopilotPageContextRouteId,
  searchParams: URLSearchParams,
): CopilotPageContextSort[] {
  const allowed = COPILOT_PAGE_CONTEXT_ROUTE_SORT_ALLOWLIST[routeId]
  const raw = searchParams.get('sort')
  if (!raw) return []
  const sort: CopilotPageContextSort[] = []
  for (const term of raw.split(',')) {
    const trimmed = term.trim()
    if (!trimmed) continue
    const direction = trimmed.startsWith('-') ? 'desc' : 'asc'
    const field = direction === 'desc' ? trimmed.slice(1) : trimmed.replace(/^\+/, '')
    if (!allowed.includes(field)) continue
    sort.push({ field, direction })
    if (sort.length >= 4) break
  }
  return sort
}

/** 从 ?task=42 / ?risk=1 派生选中实体引用（只接受正整数 ID）。 */
export function deriveSelectedEntityRefs(searchParams: URLSearchParams): CopilotPageEntityRef[] {
  const refs: CopilotPageEntityRef[] = []
  for (const [paramName, kind] of Object.entries(ENTITY_SELECTION_PARAM_MAP)) {
    const raw = searchParams.get(paramName)
    if (raw === null) continue
    const id = Number(raw)
    if (!Number.isInteger(id) || id <= 0) continue
    refs.push({ kind, id })
  }
  return refs
}

/**
 * 派生确定性 routeRevision（指纹语义由共享契约 `deriveCopilotPageRouteRevision`
 * 定义）：同页面（pathname + 可见状态）同指纹；任意可见状态变化 → 指纹变化。
 * 只包含结构化可见状态，不含 DOM。
 */
export function deriveRouteRevision(
  pathname: string,
  filters: readonly CopilotPageContextFilter[],
  sort: readonly CopilotPageContextSort[],
  timeRange: { from?: string; to?: string } | undefined,
  selection: readonly CopilotPageEntityRef[],
): string {
  return deriveCopilotPageRouteRevision({ pathname, filters, sort, timeRange, selection })
}

/**
 * 派生页面语境描述符（V1）。
 *
 * 返回 null 表示当前路由不产生项目语境（global；仍返回 descriptor 但 routeId
 * 为 'global' 且无 projectId——见设计 §C 的 routeId 枚举）。
 * 本函数不读取 DOM，也不会序列化任何页面内容。
 */
export function derivePageContextDescriptor(
  input: PageContextDerivationInput,
): CopilotPageContextDescriptorV1 {
  const pathname = input.pathname ?? '/'
  const routeId = deriveRouteId(pathname)
  const projectId = extractProjectIdFromPathname(pathname)
  const filters = deriveFilters(routeId, input.searchParams)
  const sort = deriveSort(routeId, input.searchParams)

  const from = input.searchParams.get('from')
  const to = input.searchParams.get('to')
  const timeRange =
    from !== null || to !== null
      ? {
          ...(from !== null ? { from } : {}),
          ...(to !== null ? { to } : {}),
        }
      : undefined

  const selection = deriveSelectedEntityRefs(input.searchParams)
  // 旧版任务详情页（/projects/:id/tasks/:taskId）：路径里的任务即当前查看的任务
  const taskPathMatch = /^\/projects\/\d+\/tasks\/(\d+)(?:\/|$)/.exec(pathname)
  if (taskPathMatch && !selection.some((ref) => ref.kind === 'task')) {
    selection.push({ kind: 'task', id: Number(taskPathMatch[1]) })
  }
  // 视图 ID 由路由派生：六视图取段名，列表/概览取规范名（不读 DOM、不依赖 params）。
  const viewId =
    routeId !== 'global' && routeId !== 'project-overview'
      ? routeId.slice('project-'.length)
      : undefined

  return {
    version: 1,
    routeId,
    pathname,
    ...(projectId !== null ? { projectId } : {}),
    ...(viewId !== undefined ? { viewId } : {}),
    ...(filters.length > 0 ? { filters } : {}),
    ...(sort.length > 0 ? { sort } : {}),
    ...(timeRange !== undefined ? { timeRange } : {}),
    ...(selection.length > 0 ? { selectedEntityRefs: selection } : {}),
    routeRevision: deriveRouteRevision(pathname, filters, sort, timeRange, selection),
  }
}
