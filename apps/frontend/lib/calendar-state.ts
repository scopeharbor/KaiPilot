import type { CalendarFilters, CalendarView, CalendarMode } from '@/lib/api/calendar'
import type { TaskPriority, TaskStatus } from '@/lib/api/tasks'
import { DateTime } from 'luxon'

const VIEWS = new Set<CalendarView>(['month', 'week', 'day'])
const MODES = new Set<CalendarMode>(['deadline', 'schedule'])
const ITEM_TYPES = new Set<'task' | 'milestone'>(['task', 'milestone'])
const STATUSES = new Set<TaskStatus>([
  'not_started',
  'in_progress',
  'completed',
  'blocked',
  'on_hold',
  'cancelled',
])
const PRIORITIES = new Set<TaskPriority>(['lowest', 'low', 'medium', 'high', 'highest'])
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface SearchParamsReader {
  get(name: string): string | null
}

function list<T extends string>(value: string | null, allowed: Set<T>): string | undefined {
  const values = value?.split(',').filter((item) => allowed.has(item as T))
  return values?.length ? [...new Set(values)].join(',') : undefined
}

function positiveInteger(value: string | null, fallback: number, maximum = 100000) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function shiftCalendarAnchor(
  anchorDate: string,
  view: CalendarView,
  direction: -1 | 1,
): string {
  const anchor = DateTime.fromISO(anchorDate)
  const delta =
    view === 'month'
      ? { months: direction }
      : view === 'week'
        ? { weeks: direction }
        : { days: direction }
  return anchor.plus(delta).toISODate()!
}

export function parseCalendarState(params: SearchParamsReader): CalendarFilters {
  const viewParam = params.get('view')
  const view: CalendarView = VIEWS.has(viewParam as CalendarView)
    ? (viewParam as CalendarView)
    : 'month'
  const anchorParam = params.get('anchorDate')
  const anchorDate = DATE_PATTERN.test(anchorParam ?? '') ? anchorParam! : todayISO()
  const modeParam = params.get('mode')
  const mode: CalendarMode | undefined = MODES.has(modeParam as CalendarMode)
    ? (modeParam as CalendarMode)
    : undefined

  return {
    view,
    anchorDate,
    mode,
    search: params.get('search')?.trim() || undefined,
    status: list(params.get('status'), STATUSES),
    priority: list(params.get('priority'), PRIORITIES),
    assigneeId: params.get('assigneeId') || undefined,
    itemTypes: list(params.get('itemTypes'), ITEM_TYPES),
    page: positiveInteger(params.get('page'), 1),
    perPage: positiveInteger(params.get('perPage'), 200, 200),
  }
}

export function serializeCalendarState(filters: CalendarFilters) {
  const query = new URLSearchParams()
  if (filters.view !== 'month') query.set('view', filters.view)
  const today = todayISO()
  if (filters.anchorDate !== today) query.set('anchorDate', filters.anchorDate)
  if (filters.mode) query.set('mode', filters.mode)
  if (filters.search) query.set('search', filters.search)
  if (filters.status) query.set('status', filters.status)
  if (filters.priority) query.set('priority', filters.priority)
  if (filters.assigneeId) query.set('assigneeId', filters.assigneeId)
  if (filters.itemTypes) query.set('itemTypes', filters.itemTypes)
  if (filters.page && filters.page !== 1) query.set('page', String(filters.page))
  return query.toString()
}

/**
 * 将 CalendarItem 裁剪到指定视图窗口。
 * 用于 schedule 模式的月/周/日视图。
 */
export function sliceCalendarItemsToWindow(
  items: import('@/lib/calendar-types').CalendarItem[],
  windowStart: string,
  windowEnd: string,
): import('@/lib/calendar-types').CalendarItem[] {
  return items.filter((item) => {
    const range = item.dateRange
    if (range.start && range.end) {
      return range.start <= windowEnd && range.end >= windowStart
    }
    if (range.end) {
      return range.end >= windowStart && range.end <= windowEnd
    }
    if (range.start) {
      return range.start >= windowStart && range.start <= windowEnd
    }
    return false
  })
}
