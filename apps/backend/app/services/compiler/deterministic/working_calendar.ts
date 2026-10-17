/**
 * Deterministic Engine —— 工作日历工具。
 *
 * 提供工作日判断、next working day、duration 到日期区间转换。
 *
 * @aiproj/backend
 */

import { DateTime } from 'luxon'
import type { WorkingCalendar } from '@aiproj/compiler-spec'

export const DEFAULT_CALENDAR: WorkingCalendar = {
  calendarId: 'default',
  workingDays: [1, 2, 3, 4, 5],
  excludedDates: [],
}

/**
 * 判断某日期是否为工作日（包含日历排除日期）。
 */
export function isWorkingDay(date: DateTime, calendar: WorkingCalendar): boolean {
  const dow = date.weekday % 7 // 0=Sun, 1=Mon, ..., 6=Sat
  if (!calendar.workingDays.includes(dow)) return false
  const dateStr = date.toISODate()
  if (dateStr && calendar.excludedDates.includes(dateStr)) return false
  return true
}

/**
 * 找到从 startDate（含）开始的第一个有效工作日。
 */
export function nextWorkingDay(startDate: DateTime, calendar: WorkingCalendar): DateTime {
  let cursor = startDate
  let safety = 0
  while (!isWorkingDay(cursor, calendar)) {
    cursor = cursor.plus({ days: 1 })
    safety++
    if (safety > 730) break // 2 年安全阀
  }
  return cursor
}

/**
 * 从 startDate 开始，计算 duration 个工作日后的结束日期。
 * 返回 [开始日期的有效工作日, 结束日期]。
 */
export function durationToDateRange(
  startDate: DateTime,
  durationDays: number,
  calendar: WorkingCalendar,
): { start: DateTime; end: DateTime } {
  const start = nextWorkingDay(startDate, calendar)

  if (durationDays <= 0) {
    return { start, end: start }
  }

  let cursor = start
  let remaining = durationDays
  let safety = 0

  while (remaining > 1) {
    cursor = cursor.plus({ days: 1 })
    if (isWorkingDay(cursor, calendar)) {
      remaining--
    }
    safety++
    if (safety > 730) break
  }

  return { start, end: cursor }
}

/**
 * 计算两个日期之间的工作日数量。
 */
export function countWorkingDaysBetween(
  start: DateTime,
  end: DateTime,
  calendar: WorkingCalendar,
): number {
  let count = 0
  let cursor = start
  let safety = 0
  while (cursor <= end) {
    if (isWorkingDay(cursor, calendar)) count++
    cursor = cursor.plus({ days: 1 })
    safety++
    if (safety > 730) break
  }
  return count
}

/**
 * 日期字符串转 DateTime。
 */
export function toDateTime(dateStr: string): DateTime {
  return DateTime.fromISO(dateStr, { zone: 'utc' })
}

/**
 * DateTime 转 ISO 日期字符串。
 */
export function toDateStr(dt: DateTime): string {
  return dt.toISODate() ?? ''
}
