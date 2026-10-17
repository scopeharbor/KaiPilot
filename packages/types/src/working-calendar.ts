export const WORKING_CALENDAR_SETTINGS_VERSION = 1 as const

export interface WorkingCalendarSettings {
  version: typeof WORKING_CALENDAR_SETTINGS_VERSION
  workdays: number[]
  holidays: string[]
  extraWorkdays: string[]
}

export interface WorkingCalendarSettingsInput {
  version?: number
  workdays?: unknown
  holidays?: unknown
  extraWorkdays?: unknown
}

export const DEFAULT_WORKING_CALENDAR_SETTINGS: WorkingCalendarSettings = {
  version: WORKING_CALENDAR_SETTINGS_VERSION,
  workdays: [1, 2, 3, 4, 5],
  holidays: [],
  extraWorkdays: [],
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export class WorkingCalendarSettingsError extends Error {}

export function isIsoDateOnly(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  return new Date(timestamp).toISOString().slice(0, 10) === value
}

export function normalizeWorkingCalendarSettings(
  input?: WorkingCalendarSettingsInput | null,
): WorkingCalendarSettings {
  const workdays = normalizeWorkdays(input?.workdays ?? DEFAULT_WORKING_CALENDAR_SETTINGS.workdays)
  const holidays = normalizeDateList(input?.holidays ?? [])
  const extraWorkdays = normalizeDateList(input?.extraWorkdays ?? [])

  return {
    version: WORKING_CALENDAR_SETTINGS_VERSION,
    workdays,
    holidays,
    extraWorkdays,
  }
}

export function findDuplicateDate(values: unknown): string | null {
  if (!Array.isArray(values)) return null
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    if (seen.has(value)) return value
    seen.add(value)
  }
  return null
}

function normalizeWorkdays(values: unknown): number[] {
  if (!Array.isArray(values)) {
    throw new WorkingCalendarSettingsError('workdays 必须是数组')
  }
  const result = new Set<number>()
  for (const value of values) {
    if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 6) {
      throw new WorkingCalendarSettingsError('workdays 必须是 0 到 6 的整数数组')
    }
    result.add(Number(value))
  }
  if (result.size === 0) {
    throw new WorkingCalendarSettingsError('项目至少需要一个工作日')
  }
  return [...result].sort((a, b) => a - b)
}

function normalizeDateList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    throw new WorkingCalendarSettingsError('日期字段必须是 ISO 日期数组')
  }
  const result = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string' || !isIsoDateOnly(value)) {
      throw new WorkingCalendarSettingsError(`无效日期：${String(value)}`)
    }
    result.add(value)
  }
  return [...result].sort()
}
