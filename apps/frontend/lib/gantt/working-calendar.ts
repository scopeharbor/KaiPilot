// TODO-DEBT: sec13-T021-shared-scheduling-package - keep this browser-side
// mirror aligned with apps/backend/app/services/gantt_working_calendar.ts until
// V2 extracts a shared gantt scheduling package.
import {
  DEFAULT_WORKING_CALENDAR_SETTINGS,
  normalizeWorkingCalendarSettings,
  type WorkingCalendarSettings,
  type WorkingCalendarSettingsInput,
} from '@aiproj/types'

export type { WorkingCalendarSettings, WorkingCalendarSettingsInput } from '@aiproj/types'

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000
const MAX_SCAN_DAYS = 3660

type WorkingCalendarRuntimeInput = WorkingCalendarSettingsInput & {
  workingCalendar?: WorkingCalendarSettingsInput | null
}

export interface WorkingCalendar {
  workdays: ReadonlySet<number>
  holidays: ReadonlySet<string>
  extraWorkdays: ReadonlySet<string>
  settings: WorkingCalendarSettings
  workingDayCache: Map<number, boolean>
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
  settings?: WorkingCalendarRuntimeInput | null,
): WorkingCalendar {
  let normalized: WorkingCalendarSettings
  try {
    const rawSettings =
      settings &&
      'workingCalendar' in settings &&
      settings.workingCalendar &&
      typeof settings.workingCalendar === 'object'
        ? settings.workingCalendar
        : settings
    normalized = normalizeWorkingCalendarSettings(rawSettings ?? DEFAULT_WORKING_CALENDAR_SETTINGS)
  } catch (error) {
    throw new WorkingCalendarError((error as Error).message)
  }
  const conflict = normalized.holidays.find((date) => normalized.extraWorkdays.includes(date))
  if (conflict) {
    throw new WorkingCalendarError(`Date cannot be both holiday and extra workday: ${conflict}`)
  }
  return {
    workdays: new Set(normalized.workdays),
    holidays: new Set(normalized.holidays),
    extraWorkdays: new Set(normalized.extraWorkdays),
    settings: normalized,
    workingDayCache: new Map(),
  }
}

export function isWorkingDay(calendar: WorkingCalendar, timestamp: number): boolean {
  const dayIndex = Math.floor(timestamp / DAY_MS)
  const cached = calendar.workingDayCache.get(dayIndex)
  if (cached !== undefined) return cached

  const dow = (dayIndex + 4) % 7
  let result = calendar.workdays.has(dow)
  if (calendar.holidays.size > 0 || calendar.extraWorkdays.size > 0) {
    const isoDate = formatIsoDate(timestamp)
    if (calendar.holidays.has(isoDate)) result = false
    if (calendar.extraWorkdays.has(isoDate)) result = true
  }
  calendar.workingDayCache.set(dayIndex, result)
  return result
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
  throw new WorkingCalendarError('Unable to find a working day in scan range')
}

export function shiftWorkingDays(
  calendar: WorkingCalendar,
  timestamp: number,
  offset: number,
): number {
  if (!Number.isInteger(offset))
    throw new WorkingCalendarError('Working day offset must be integer')
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
  if (endTimestamp < startTimestamp) throw new WorkingCalendarError('End date precedes start date')
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
    throw new WorkingCalendarError('Duration must be a positive integer')
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
    throw new WorkingCalendarError('Duration must be a positive integer')
  }
  const end = snapToWorkingDay(calendar, endTimestamp, -1)
  return shiftWorkingDays(calendar, end, -(durationDays - 1))
}

export function snapIsoToWorkingDay(
  date: string,
  settings?: WorkingCalendarSettingsInput | null,
  direction: 1 | -1 = 1,
): string {
  return formatIsoDate(
    snapToWorkingDay(createWorkingCalendar(settings), parseIsoDate(date), direction),
  )
}

export function shiftIsoByWorkingDays(
  date: string,
  offset: number,
  settings?: WorkingCalendarSettingsInput | null,
): string {
  return formatIsoDate(
    shiftWorkingDays(createWorkingCalendar(settings), parseIsoDate(date), offset),
  )
}
