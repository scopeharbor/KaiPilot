/**
 * 个人工作日历（日历第 3 批）：每个人自己的休假与工作日，跨项目生效。
 *
 * - leaves：休假 / 请假区间（含首尾两天），可带一句说明；
 * - workdays：个人工作日（0=周日 … 6=周六）；null 表示跟随项目工作日历。
 *
 * 排期（日历快速新建的负责人建议与冲突提醒）会避开这些日子；「我的日历」会把它们标出来。
 */

export interface PersonalLeave {
  /** 稳定 id（编辑 / 删除用）。 */
  id: string
  startDate: string
  endDate: string
  note: string | null
}

export interface PersonalWorkingCalendar {
  /** 个人工作日（0=周日 … 6=周六）；null = 跟随项目。 */
  workdays: number[] | null
  leaves: PersonalLeave[]
}

export const EMPTY_PERSONAL_CALENDAR: PersonalWorkingCalendar = { workdays: null, leaves: [] }

/** 最多保存的休假条数（防止偏好字段无限膨胀）。 */
export const MAX_PERSONAL_LEAVES = 200

const ISO = /^\d{4}-\d{2}-\d{2}$/

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const probe = new Date(Date.UTC(y!, m! - 1, d!))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m! - 1 && probe.getUTCDate() === d
}

/** 清洗个人工作日历：非法条目丢掉，起止颠倒自动对调，按开始日排序。 */
export function normalizePersonalCalendar(raw: unknown): PersonalWorkingCalendar {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const workdays = Array.isArray(record.workdays)
    ? [
        ...new Set(
          record.workdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6),
        ),
      ].sort()
    : null
  const leaves: PersonalLeave[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(record.leaves) ? record.leaves : []) {
    if (!item || typeof item !== 'object') continue
    const leave = item as Record<string, unknown>
    if (!isIsoDate(leave.startDate) || !isIsoDate(leave.endDate)) continue
    const [startDate, endDate] =
      leave.startDate <= leave.endDate
        ? [leave.startDate, leave.endDate]
        : [leave.endDate, leave.startDate]
    let id = typeof leave.id === 'string' && leave.id.trim() ? leave.id.trim().slice(0, 40) : ''
    if (!id || seen.has(id)) id = `${startDate}_${endDate}_${leaves.length}`
    seen.add(id)
    const note =
      typeof leave.note === 'string' && leave.note.trim() ? leave.note.trim().slice(0, 100) : null
    leaves.push({ id, startDate, endDate, note })
  }
  leaves.sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate),
  )
  return {
    workdays: workdays && workdays.length > 0 ? workdays : null,
    leaves: leaves.slice(0, MAX_PERSONAL_LEAVES),
  }
}

/** 某天落在哪条休假里（没有返回 null）。 */
export function personalLeaveOn(
  calendar: PersonalWorkingCalendar,
  dateISO: string,
): PersonalLeave | null {
  return (
    calendar.leaves.find((leave) => leave.startDate <= dateISO && leave.endDate >= dateISO) ?? null
  )
}

/** 某天这个人不上班：在休假里，或不是他的个人工作日。 */
export function isPersonallyOff(calendar: PersonalWorkingCalendar, dateISO: string): boolean {
  if (personalLeaveOn(calendar, dateISO)) return true
  if (!calendar.workdays) return false
  const [y, m, d] = dateISO.split('-').map(Number)
  const weekday = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()
  return !calendar.workdays.includes(weekday)
}

/** 区间 [from, to] 里这个人不上班的日子（含首尾，最多扫 366 天）。 */
export function personalOffDays(
  calendar: PersonalWorkingCalendar,
  from: string,
  to: string,
): string[] {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return []
  if (!calendar.workdays && calendar.leaves.length === 0) return []
  const days: string[] = []
  const [y, m, d] = from.split('-').map(Number)
  let ms = Date.UTC(y!, m! - 1, d!)
  for (let i = 0; i < 366; i++) {
    const iso = new Date(ms).toISOString().slice(0, 10)
    if (iso > to) break
    if (isPersonallyOff(calendar, iso)) days.push(iso)
    ms += 86_400_000
  }
  return days
}
