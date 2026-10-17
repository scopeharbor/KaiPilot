/**
 * 多曆法日历引擎（tyme4ts）：主曆排月格，副曆按勾选顺序给每天加标注。
 *
 * - 主曆（公历 / 农历 / 藏历 / 回历）决定「一个月」是哪些天、月份标题与格子大数字；
 *   任务始终按公历日期落位，所以每个格子都带公历 ISO 日期。
 * - 副曆只产出短标注（格子里显示）与完整说明（title / aria）；没有内容的天返回 null（例如节气只在交节当天）。
 */
import {
  CALENDAR_SYSTEM_LABELS,
  type CalendarSystemId,
  type PrimaryCalendarSystem,
} from '@aiproj/types'
import { SolarDay } from 'tyme4ts'

export interface PrimaryMonthDay {
  /** 公历日期 YYYY-MM-DD（任务落位用）。 */
  dateISO: string
  /** 格子大数字（主曆的日）。 */
  dayLabel: string
}

export interface PrimaryMonth {
  system: PrimaryCalendarSystem
  /** 稳定键（切月 / 缓存）。 */
  key: string
  /** 月份标题，如「2026年10月」「农历丙午年八月」「1448年赖比尔·阿色尼月」。 */
  title: string
  days: PrimaryMonthDay[]
  /** 本月公历起止（查询任务用）。 */
  startISO: string
  endISO: string
}

export type CalendarAnnotationTone = 'normal' | 'festival' | 'term' | 'off' | 'work' | 'muted'

export interface CalendarAnnotation {
  system: CalendarSystemId
  /** 格子里的短标注。 */
  short: string
  /** 完整说明（title / 无障碍）。 */
  full: string
  tone: CalendarAnnotationTone
}

const pad = (value: number) => String(value).padStart(2, '0')

export function solarISO(day: SolarDay): string {
  return `${day.getYear()}-${pad(day.getMonth())}-${pad(day.getDay())}`
}

export function solarDayOf(dateISO: string): SolarDay {
  const [year = 1970, month = 1, day = 1] = dateISO.split('-').map(Number)
  return SolarDay.fromYmd(year, month, day)
}

interface MonthLike<D> {
  toString(): string
  getDays(): D[]
  next(n: number): MonthLike<D>
}

function fromMonth<D extends { getSolarDay(): SolarDay }>(
  system: PrimaryCalendarSystem,
  month: MonthLike<D>,
  label: (day: D) => string,
): PrimaryMonth {
  const days = month.getDays().map((day) => ({
    dateISO: solarISO(day.getSolarDay()),
    dayLabel: label(day),
  }))
  return {
    system,
    key: `${system}:${month.toString()}`,
    title: month.toString(),
    days,
    startISO: days[0]?.dateISO ?? '',
    endISO: days.at(-1)?.dateISO ?? '',
  }
}

function solarMonth(year: number, month: number): PrimaryMonth {
  const days: PrimaryMonthDay[] = []
  for (let day = SolarDay.fromYmd(year, month, 1); day.getMonth() === month; day = day.next(1)) {
    days.push({ dateISO: solarISO(day), dayLabel: String(day.getDay()) })
  }
  return {
    system: 'solar',
    key: `solar:${year}-${pad(month)}`,
    title: `${year}年${month}月`,
    days,
    startISO: days[0]!.dateISO,
    endISO: days.at(-1)!.dateISO,
  }
}

/** 包含某个公历日期的主曆月份，再按 delta 前后移动（delta=0 即当月）。 */
export function primaryMonthAt(
  system: PrimaryCalendarSystem,
  dateISO: string,
  delta = 0,
): PrimaryMonth {
  const solar = solarDayOf(dateISO)
  switch (system) {
    case 'lunar':
      return fromMonth('lunar', solar.getLunarDay().getLunarMonth().next(delta), (day) =>
        day.getName(),
      )
    case 'hijri':
      return fromMonth('hijri', solar.getHijriDay().getHijriMonth().next(delta), (day) =>
        String(day.getDay()),
      )
    case 'tibetan':
      return fromMonth('tibetan', solar.getRabByungDay().getRabByungMonth().next(delta), (day) =>
        day.getName(),
      )
    default: {
      const total = solar.getYear() * 12 + (solar.getMonth() - 1) + delta
      return solarMonth(Math.floor(total / 12), (total % 12) + 1)
    }
  }
}

/** 某个公历日期在主曆下的「日」（格子大数字，补齐格也要用主曆显示）。 */
export function primaryDayLabel(system: PrimaryCalendarSystem, dateISO: string): string {
  const solar = solarDayOf(dateISO)
  switch (system) {
    case 'lunar':
      return solar.getLunarDay().getName()
    case 'hijri':
      return String(solar.getHijriDay().getDay())
    case 'tibetan':
      return solar.getRabByungDay().getName()
    default:
      return String(solar.getDay())
  }
}

/** 主曆月份的公历跨度描述（非公历主曆时显示在标题旁）。 */
export function solarSpanLabel(month: PrimaryMonth): string {
  if (month.system === 'solar' || !month.startISO) return ''
  const [sy, sm, sd] = month.startISO.split('-').map(Number)
  const [ey, em, ed] = month.endISO.split('-').map(Number)
  return sy === ey
    ? `公历 ${sy}年${sm}月${sd}日 – ${em}月${ed}日`
    : `公历 ${sy}年${sm}月${sd}日 – ${ey}年${em}月${ed}日`
}

/** 星期一为 0 … 星期日为 6。 */
export function weekdayIndex(dateISO: string): number {
  return (solarDayOf(dateISO).getWeek().getIndex() + 6) % 7
}

const SOLAR_FESTIVALS = new Set([
  '元旦',
  '劳动节',
  '国庆节',
  '妇女节',
  '儿童节',
  '建军节',
  '教师节',
  '青年节',
  '植树节',
])

/** 某一天在某个曆法下的标注；该曆法这天没有可说的返回 null。 */
export function annotationFor(
  dateISO: string,
  system: CalendarSystemId,
): CalendarAnnotation | null {
  const solar = solarDayOf(dateISO)
  const make = (short: string, full: string, tone: CalendarAnnotationTone = 'normal') => ({
    system,
    short,
    full,
    tone,
  })
  switch (system) {
    case 'solar':
      return make(`${solar.getMonth()}/${solar.getDay()}`, solar.toString(), 'muted')
    case 'lunar': {
      const lunar = solar.getLunarDay()
      const month = lunar.getLunarMonth().getName()
      return make(lunar.getDay() === 1 ? month : lunar.getName(), lunar.toString())
    }
    case 'tibetan': {
      const day = solar.getRabByungDay()
      const month = day.getRabByungMonth()
      return make(
        `藏${day.getDay() === 1 ? month.getName() : day.getName()}`,
        `藏历 ${day.toString()}（${month.getAlias()}）`,
      )
    }
    case 'hijri': {
      const day = solar.getHijriDay()
      return make(
        day.getDay() === 1 ? `回${day.getHijriMonth().getName()}` : `回${day.getDay()}`,
        `回历 ${day.toString()}`,
      )
    }
    case 'ganzhi': {
      const name = solar.getSixtyCycleDay().getSixtyCycle().getName()
      return make(name, `干支 ${solar.getSixtyCycleDay().toString()}`, 'muted')
    }
    case 'jieqi': {
      const term = solar.getTermDay()
      if (term.getDayIndex() !== 0) return null
      const name = term.getSolarTerm().getName()
      return make(name, `节气：${name}`, 'term')
    }
    case 'phenology': {
      const day = solar.getPhenologyDay()
      if (day.getDayIndex() !== 0) return null
      const name = day.getPhenology().getName()
      return make(name, `物候：${name}`, 'muted')
    }
    case 'dogday': {
      const day = solar.getDogDay()
      if (!day || day.getDayIndex() !== 0) return null
      const name = day.getDog().getName()
      return make(`入${name}`, `三伏：入${name}`, 'term')
    }
    case 'nineday': {
      const day = solar.getNineDay()
      if (!day || day.getDayIndex() !== 0) return null
      const name = day.getNine().getName()
      return make(name, `数九：${name}`, 'term')
    }
    case 'plumrain': {
      const day = solar.getPlumRainDay()
      if (!day || day.getDayIndex() !== 0) return null
      const name = day.getPlumRain().getName()
      return make(name, `梅雨：${name}`, 'term')
    }
    case 'phase': {
      const day = solar.getPhaseDay()
      if (day.getDayIndex() !== 0) return null
      const name = day.getPhase().getName()
      if (!['新月', '上弦月', '满月', '下弦月'].includes(name)) return null
      return make(name, `月相：${name}`, 'muted')
    }
    case 'constellation': {
      const name = solar.getConstellation().getName()
      const previous = solar.next(-1).getConstellation().getName()
      if (name === previous) return null
      return make(`${name}座`, `星座：${name}座`, 'muted')
    }
    case 'festival': {
      const lunarName = solar.getLunarDay().getFestival()?.getName() ?? null
      const solarName = solar.getFestival()?.getName() ?? null
      const name = lunarName ?? (solarName && SOLAR_FESTIVALS.has(solarName) ? solarName : null)
      return name ? make(name, `节日：${name}`, 'festival') : null
    }
    case 'holiday': {
      const holiday = solar.getLegalHoliday()
      if (!holiday) return null
      const work = holiday.isWork()
      return make(
        work ? '班' : '休',
        `${holiday.getName()}${work ? '调休上班' : '放假'}`,
        work ? 'work' : 'off',
      )
    }
    default:
      return null
  }
}

/** 一天的全部副曆标注（按勾选顺序，跳过没有内容的）。 */
export function annotationsFor(
  dateISO: string,
  systems: readonly CalendarSystemId[],
): CalendarAnnotation[] {
  const result: CalendarAnnotation[] = []
  for (const system of systems) {
    const annotation = annotationFor(dateISO, system)
    if (annotation) result.push(annotation)
  }
  return result
}

export function calendarSystemLabel(system: CalendarSystemId): string {
  return CALENDAR_SYSTEM_LABELS[system]
}
