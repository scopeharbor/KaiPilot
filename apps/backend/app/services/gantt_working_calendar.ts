import {
  DEFAULT_WORKING_CALENDAR_SETTINGS,
  normalizeWorkingCalendarSettings,
  type WorkingCalendarSettings,
} from '@aiproj/types'

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000
const MAX_SCAN_DAYS = 3660

export interface WorkingCalendar {
  workdays: ReadonlySet<number>
  holidays: ReadonlySet<string>
  extraWorkdays: ReadonlySet<string>
  settings: WorkingCalendarSettings
}

export class WorkingCalendarError extends Error {}

export function parseIsoDate(value: string): number {
  const match = ISO_DATE.exec(value)
  if (!match) throw new WorkingCalendarError(`无效日期：${value}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  if (formatIsoDate(timestamp) !== value) throw new WorkingCalendarError(`无效日期：${value}`)
  return timestamp
}

export function formatIsoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

export function createWorkingCalendar(
  settings?: Partial<WorkingCalendarSettings> | null,
): WorkingCalendar {
  let normalized: WorkingCalendarSettings
  try {
    const rawSettings =
      settings &&
      'workingCalendar' in settings &&
      settings.workingCalendar &&
      typeof settings.workingCalendar === 'object'
        ? (settings.workingCalendar as Partial<WorkingCalendarSettings>)
        : settings
    normalized = normalizeWorkingCalendarSettings(rawSettings ?? DEFAULT_WORKING_CALENDAR_SETTINGS)
  } catch (error) {
    throw new WorkingCalendarError((error as Error).message)
  }
  const conflict = normalized.holidays.find((date) => normalized.extraWorkdays.includes(date))
  if (conflict) {
    throw new WorkingCalendarError(`同一日期不能同时作为节假日和调休日：${conflict}`)
  }
  return {
    workdays: new Set(normalized.workdays),
    holidays: new Set(normalized.holidays),
    extraWorkdays: new Set(normalized.extraWorkdays),
    settings: normalized,
  }
}

export function isWorkingDay(calendar: WorkingCalendar, timestamp: number): boolean {
  const date = new Date(timestamp)
  const isoDate = formatIsoDate(timestamp)
  if (calendar.holidays.has(isoDate)) return false
  if (calendar.extraWorkdays.has(isoDate)) return true
  return calendar.workdays.has(date.getUTCDay())
}

export function snapToWorkingDay(
  calendar: WorkingCalendar,
  timestamp: number,
  direction: 1 | -1 = 1,
): number {
  let current = timestamp
  for (let scanned = 0; scanned <= MAX_SCAN_DAYS; scanned++) {
    if (isWorkingDay(calendar, current)) return current
    current += direction * DAY_MS
  }
  throw new WorkingCalendarError('无法在安全范围内找到工作日')
}

/**
 * 工作日位移：0 保留当前有效工作日；正数向后、负数向前。
 * 锚点若为非工作日，先按位移方向吸附。
 */
export function shiftWorkingDays(
  calendar: WorkingCalendar,
  timestamp: number,
  offset: number,
): number {
  if (!Number.isInteger(offset)) throw new WorkingCalendarError('工作日偏移必须是整数')
  const direction: 1 | -1 = offset < 0 ? -1 : 1
  let current = snapToWorkingDay(calendar, timestamp, direction)
  let remaining = Math.abs(offset)
  while (remaining > 0) {
    current += direction * DAY_MS
    if (isWorkingDay(calendar, current)) remaining--
  }
  return current
}

export function workingDayDuration(
  calendar: WorkingCalendar,
  startTimestamp: number,
  endTimestamp: number,
): number {
  if (endTimestamp < startTimestamp) throw new WorkingCalendarError('结束日期不能早于开始日期')
  let count = 0
  for (let current = startTimestamp; current <= endTimestamp; current += DAY_MS) {
    if (isWorkingDay(calendar, current)) count++
  }
  return Math.max(1, count)
}

export function endFromStart(
  calendar: WorkingCalendar,
  startTimestamp: number,
  durationDays: number,
): number {
  if (!Number.isInteger(durationDays) || durationDays < 1) {
    throw new WorkingCalendarError('任务工期必须是正整数工作日')
  }
  const start = snapToWorkingDay(calendar, startTimestamp, 1)
  return shiftWorkingDays(calendar, start, durationDays - 1)
}

export function startFromEnd(
  calendar: WorkingCalendar,
  endTimestamp: number,
  durationDays: number,
): number {
  if (!Number.isInteger(durationDays) || durationDays < 1) {
    throw new WorkingCalendarError('任务工期必须是正整数工作日')
  }
  const end = snapToWorkingDay(calendar, endTimestamp, -1)
  return shiftWorkingDays(calendar, end, -(durationDays - 1))
}
