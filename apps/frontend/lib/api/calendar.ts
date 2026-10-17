import { apiFetchEnvelope } from '@/lib/api-client'
import type { Task } from './tasks'
import type { CalendarFullResponse } from '@/lib/calendar-types'

export type CalendarView = 'month' | 'week' | 'day'
export type CalendarMode = 'deadline' | 'schedule'

export interface CalendarFilters {
  view: CalendarView
  anchorDate: string
  dateFrom?: string
  dateTo?: string
  mode?: CalendarMode
  search?: string
  status?: string
  priority?: string
  assigneeId?: string
  itemTypes?: string
  page?: number
  perPage?: number
}

export interface PaginatedCalendarTasks {
  data: Task[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

function buildQuery(filters: CalendarFilters): string {
  const params = new URLSearchParams()
  params.set('view', filters.view)
  params.set('anchorDate', filters.anchorDate)
  if (filters.mode) params.set('mode', filters.mode)
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  if (filters.search) params.set('search', filters.search)
  if (filters.status) params.set('status', filters.status)
  if (filters.priority) params.set('priority', filters.priority)
  if (filters.assigneeId) params.set('assigneeId', filters.assigneeId)
  if (filters.itemTypes) params.set('itemTypes', filters.itemTypes)
  if (filters.page) params.set('page', String(filters.page))
  if (filters.perPage) params.set('perPage', String(filters.perPage))
  return params.toString()
}

export const calendarApi = {
  /** 截止日模式（V1 兼容）：返回按 end_date 落点的任务列表。 */
  list: (projectId: number, filters: CalendarFilters) =>
    apiFetchEnvelope<PaginatedCalendarTasks>(
      `/projects/${projectId}/calendar?${buildQuery(filters)}`,
    ),
  /** 完整排程模式（V2）：返回任务区间 + 里程碑派生日历项 + 工作日历上下文。 */
  listSchedule: (projectId: number, filters: CalendarFilters) =>
    apiFetchEnvelope<CalendarFullResponse>(
      `/projects/${projectId}/calendar?${buildQuery({ ...filters, mode: 'schedule' })}`,
    ),
}

export const calendarKeys = {
  all: ['calendar'] as const,
  lists: (projectId: number) => [...calendarKeys.all, 'list', projectId] as const,
  list: (projectId: number, filters: CalendarFilters) =>
    [...calendarKeys.lists(projectId), filters] as const,
}
