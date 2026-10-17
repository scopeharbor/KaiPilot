import { DateTime } from 'luxon'

/**
 * 前端工作日历上下文（只读展示用）。
 * 后端以数组形式序列化（函数无法过网络），前端据此推导每日语义。
 */
export interface WorkingCalendarInfo {
  /** 常规工作日，0=周日 … 6=周六 */
  workdays: number[]
  /** 节假日 ISO date */
  holidays: string[]
  /** 调休日（原本非工作日，但被设为工作日）ISO date */
  extraWorkdays: string[]
}

export interface DayWorkingStatus {
  isHoliday: boolean
  isExtraWorkday: boolean
  /** 非工作日：节假日或不在工作日集合且非调休日的周末 */
  isNonWorking: boolean
}

/** Luxon weekday(1=Mon..7=Sun) → JS getUTCDay(0=Sun..6=Sat)。 */
function jsDayOfWeek(dateISO: string): number {
  return DateTime.fromISO(dateISO).weekday % 7
}

/**
 * 计算某一天在工作日历下的语义。工作日历只影响提示，不改写任何任务日期。
 */
export function dayWorkingStatus(
  wc: WorkingCalendarInfo | undefined,
  dateISO: string,
): DayWorkingStatus {
  if (!wc) {
    // 无上下文时按常规 5 天工作周（周末为非工作日）
    const dow = jsDayOfWeek(dateISO)
    return { isHoliday: false, isExtraWorkday: false, isNonWorking: dow === 0 || dow === 6 }
  }
  const isHoliday = wc.holidays.includes(dateISO)
  const isExtraWorkday = wc.extraWorkdays.includes(dateISO)
  const workdays = wc.workdays.length ? wc.workdays : [1, 2, 3, 4, 5]
  let isNonWorking: boolean
  if (isHoliday) isNonWorking = true
  else if (isExtraWorkday) isNonWorking = false
  else isNonWorking = !workdays.includes(jsDayOfWeek(dateISO))
  return { isHoliday, isExtraWorkday, isNonWorking }
}
