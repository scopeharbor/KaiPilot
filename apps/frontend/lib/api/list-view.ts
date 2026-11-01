import { apiFetchEnvelope } from '@/lib/api-client'
import type { PaginatedTasks, TaskPriority, TaskStatus } from '@/lib/api/tasks'

export const LIST_SORT_FIELDS = [
  'name',
  'priority',
  'status',
  'assignee',
  'progressPercent',
  'endDate',
  'estimatedHours',
  'actualHours',
  'createdAt',
  'updatedAt',
] as const

export type ListSortField = (typeof LIST_SORT_FIELDS)[number]
export type ListSortTerm = `${'+' | '-'}${ListSortField}`

/** OpenProject 式分组字段（v3-classic-ui-openproject-table）；服务端以此为首要排序并返回每组汇总。 */
export const LIST_GROUP_FIELDS = ['status', 'priority', 'assignee'] as const
export type ListGroupField = (typeof LIST_GROUP_FIELDS)[number]

/** 整份筛选结果中某一组的汇总；`key` 为状态 / 优先级值或负责人用户 id（未分配为 null）。 */
export interface TaskListGroupSummary {
  key: string | number | null
  count: number
  estimatedHours: number
  actualHours: number
}

/** 整份筛选结果的合计。 */
export interface TaskListSums {
  count: number
  estimatedHours: number
  actualHours: number
  progressPercent: number
}

export interface TaskListViewPage {
  data: PaginatedTasks['data']
  meta: PaginatedTasks['meta'] & { groups?: TaskListGroupSummary[]; sums?: TaskListSums }
}

export interface TaskListViewFilters {
  search?: string
  statuses?: TaskStatus[]
  priorities?: TaskPriority[]
  assigneeIds?: number[]
  dateFrom?: string
  dateTo?: string
  sort?: ListSortTerm[]
  page?: number
  perPage?: number
  groupBy?: ListGroupField
  sums?: boolean
}

export function buildTaskListViewQuery(filters: TaskListViewFilters) {
  const query = new URLSearchParams()
  if (filters.search) query.set('search', filters.search)
  if (filters.statuses?.length) query.set('status', filters.statuses.join(','))
  if (filters.priorities?.length) query.set('priority', filters.priorities.join(','))
  if (filters.assigneeIds?.length) query.set('assigneeId', filters.assigneeIds.join(','))
  if (filters.dateFrom) query.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) query.set('dateTo', filters.dateTo)
  if (filters.sort?.length) query.set('sort', filters.sort.join(','))
  if (filters.page && filters.page !== 1) query.set('page', String(filters.page))
  if (filters.perPage && filters.perPage !== 50) query.set('perPage', String(filters.perPage))
  if (filters.groupBy) query.set('groupBy', filters.groupBy)
  if (filters.sums) query.set('sums', '1')
  return query.size ? `?${query.toString()}` : ''
}

export const taskListViewApi = {
  list: (projectId: number, filters: TaskListViewFilters = {}) =>
    apiFetchEnvelope<TaskListViewPage>(
      `/projects/${projectId}/list${buildTaskListViewQuery(filters)}`,
    ),
}
