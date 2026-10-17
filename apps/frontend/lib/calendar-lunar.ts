import { SolarDay } from 'tyme4ts'

/**
 * 日历格子的农历与法定节假日信息（纯展示，不影响任务日期）。
 *
 * 法定节假日与调休来自 tyme4ts 内置的国务院放假安排（每年 11 月公布次年安排后随库更新）；
 * 未收录的年份不显示「休 / 班」，只显示农历、节气与传统节日。
 */
export interface LunarDayInfo {
  /** 格子里的短标签：节日 > 节气 > 农历日（初一显示月份）。 */
  label: string
  /** 完整农历描述，用于 title / aria。 */
  lunarText: string
  jieQi: string | null
  festival: string | null
  /** 法定放假（休）或调休上班（班）；无安排时为 null。 */
  statutory: { name: string; work: boolean } | null
}

const cache = new Map<string, LunarDayInfo>()

/** 常见公历节日（只取对项目排期有意义的）。 */
const SOLAR_FESTIVALS = new Set([
  '元旦节',
  '劳动节',
  '国庆节',
  '元旦',
  '妇女节',
  '儿童节',
  '建军节',
  '教师节',
])

export function lunarDayInfo(dateISO: string): LunarDayInfo {
  const hit = cache.get(dateISO)
  if (hit) return hit
  const [year = 1970, month = 1, day = 1] = dateISO.split('-').map(Number)
  const solar = SolarDay.fromYmd(year, month, day)
  const lunar = solar.getLunarDay()
  const monthName = lunar.getLunarMonth().getName()
  const dayName = lunar.getName()
  const lunarFestival = lunar.getFestival()?.getName() ?? null
  const solarFestivalName = solar.getFestival()?.getName() ?? null
  const solarFestival =
    solarFestivalName && SOLAR_FESTIVALS.has(solarFestivalName) ? solarFestivalName : null
  const festival = lunarFestival ?? solarFestival
  const termDay = solar.getTermDay()
  const jieQi = termDay.getDayIndex() === 0 ? termDay.getSolarTerm().getName() : null
  const holiday = solar.getLegalHoliday()
  const info: LunarDayInfo = {
    label: festival ?? jieQi ?? (lunar.getDay() === 1 ? monthName : dayName),
    lunarText: `农历${monthName}${dayName}${jieQi ? ` · ${jieQi}` : ''}${festival ? ` · ${festival}` : ''}`,
    jieQi,
    festival,
    statutory: holiday ? { name: holiday.getName(), work: holiday.isWork() } : null,
  }
  if (cache.size > 2000) cache.clear()
  cache.set(dateISO, info)
  return info
}

export interface FreezeWindow {
  start: string
  end: string
  label: string
}

/** 该日期所在的封网窗口（ISO 字符串可直接比较）。 */
export function freezeWindowOn(
  windows: readonly FreezeWindow[] | undefined,
  dateISO: string,
): FreezeWindow | null {
  return windows?.find((window) => window.start <= dateISO && dateISO <= window.end) ?? null
}
