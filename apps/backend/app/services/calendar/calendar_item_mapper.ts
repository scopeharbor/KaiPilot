import { DateTime } from 'luxon'
import type {
  CalendarItem,
  CalendarItemDateRange,
  CalendarWorkingCalendarContext,
} from '#types/calendar_item'
import type Task from '#models/task'
import type { MilestoneView } from '#services/milestone_service'
import { createWorkingCalendar, type WorkingCalendar } from '#services/gantt_working_calendar'

/**
 * 从任务派生 CalendarItem。
 */
export function taskToCalendarItem(task: Task, today: string): CalendarItem {
  const startDate = task.startDate?.toISODate() ?? null
  const endDate = task.endDate?.toISODate() ?? null
  const dateRange = buildDateRange(startDate, endDate)
  const isOverdue =
    task.status !== 'completed' &&
    task.status !== 'cancelled' &&
    endDate !== null &&
    endDate < today

  return {
    id: `task-${task.id}`,
    kind: 'task',
    sourceId: Number(task.id),
    projectId: Number(task.projectId),
    name: task.name,
    status: task.status,
    priority: task.priority,
    assignee: task.assignee
      ? {
          id: Number(task.assignee.id),
          fullName: task.assignee.fullName,
          email: task.assignee.email,
        }
      : null,
    dateRange,
    isMultiDay: dateRange.isSpan && startDate !== endDate,
    isOverdue,
    detailUrl: `/projects/${Number(task.projectId)}/tasks/${Number(task.id)}`,
  }
}

/**
 * 从里程碑视图派生 CalendarItem。
 */
export function milestoneToCalendarItem(milestone: MilestoneView, today: string): CalendarItem {
  const m = milestone.milestone
  const plannedDate = m.plannedDate?.toISODate() ?? null
  const dateRange = buildDateRange(null, plannedDate)
  const isOverdue = m.status !== 'achieved' && plannedDate !== null && plannedDate < today

  return {
    id: `milestone-${m.id}`,
    kind: 'milestone',
    sourceId: Number(m.id),
    projectId: Number(m.projectId),
    name: m.name,
    status: m.status,
    displayStatus: milestone.displayStatus,
    assignee: null,
    dateRange,
    isMultiDay: false,
    isOverdue,
    detailUrl: `/projects/${Number(m.projectId)}/milestones/${Number(m.id)}`,
  }
}

/**
 * 构建 CalendarItemDateRange。
 */
export function buildDateRange(start: string | null, end: string | null): CalendarItemDateRange {
  const hasStart = start !== null
  const hasEnd = end !== null
  const isSpan = hasStart && hasEnd && start !== end

  return {
    start,
    end,
    isSpan,
    missingStart: hasEnd && !hasStart,
    missingEnd: hasStart && !hasEnd,
  }
}

/**
 * 构建工作日历上下文。
 * 只读提示上下文，不影响正式任务日期。
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** 项目设置里的封网窗口（AI 草案导入时写入）；形态不合法的条目直接忽略。 */
function readFreezeWindows(
  settings?: Record<string, unknown> | null,
): Array<{ start: string; end: string; label: string }> {
  const raw = settings?.changeFreezeWindows
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (item): item is { start: string; end: string; label?: unknown } =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { start?: unknown }).start === 'string' &&
        typeof (item as { end?: unknown }).end === 'string' &&
        ISO_DATE.test((item as { start: string }).start) &&
        ISO_DATE.test((item as { end: string }).end),
    )
    .map((item) => ({
      start: item.start,
      end: item.end,
      label: typeof item.label === 'string' && item.label ? item.label : '封网',
    }))
    .slice(0, 50)
}

export function buildWorkingCalendarContext(
  settings?: Record<string, unknown> | null,
): CalendarWorkingCalendarContext {
  let workingCalendar: WorkingCalendar
  try {
    workingCalendar = createWorkingCalendar(settings as Record<string, unknown> | null | undefined)
  } catch {
    // 工作日历配置异常时降级为常规 5 天工作周
    workingCalendar = createWorkingCalendar()
  }

  const workdayArray = Array.from(workingCalendar.workdays)
  const holidayArray = Array.from(workingCalendar.holidays)
  const extraWorkdayArray = Array.from(workingCalendar.extraWorkdays)

  return {
    workdays: workdayArray,
    holidays: holidayArray,
    extraWorkdays: extraWorkdayArray,
    changeFreezeWindows: readFreezeWindows(settings),
    isNonWorkingDay: (date: string) => {
      const ts = DateTime.fromISO(date).toMillis()
      return !isWorkingDayWithCalendar(workingCalendar, ts)
    },
    isHoliday: (date: string) => holidayArray.includes(date),
    isExtraWorkday: (date: string) => extraWorkdayArray.includes(date),
  }
}

function isWorkingDayWithCalendar(calendar: WorkingCalendar, timestamp: number): boolean {
  const date = new Date(timestamp)
  const isoDate = date.toISOString().slice(0, 10)
  if (calendar.holidays.has(isoDate)) return false
  if (calendar.extraWorkdays.has(isoDate)) return true
  return calendar.workdays.has(date.getUTCDay())
}

/**
 * 计算日期窗口是否超过 Calendar 允许的最大范围（18 个月）。
 */
export function isWindowTooLarge(dateFrom: string, dateTo: string, maxMonths = 18): boolean {
  const from = DateTime.fromISO(dateFrom)
  const to = DateTime.fromISO(dateTo)
  return to.diff(from, 'months').months > maxMonths
}

/**
 * 稳定排序：date ASC → kind（task 先于 milestone） → id ASC。
 */
export function sortCalendarItems(items: CalendarItem[]): CalendarItem[] {
  return items.sort((a, b) => {
    const aDate = a.dateRange.start ?? a.dateRange.end ?? '9999-12-31'
    const bDate = b.dateRange.start ?? b.dateRange.end ?? '9999-12-31'
    if (aDate !== bDate) return aDate < bDate ? -1 : 1
    // kind: task 先于 milestone
    if (a.kind !== b.kind) return a.kind === 'task' ? -1 : 1
    // id: 数字部分排序
    const aId = a.sourceId
    const bId = b.sourceId
    return aId - bId
  })
}
