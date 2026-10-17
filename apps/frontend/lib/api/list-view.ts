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
  return query.size ? `?${query.toString()}` : ''
}

export const taskListViewApi = {
  list: (projectId: number, filters: TaskListViewFilters = {}) =>
    apiFetchEnvelope<PaginatedTasks>(
      `/projects/${projectId}/list${buildTaskListViewQuery(filters)}`,
    ),
}
