/**
 * 草案排期用的中国工作日历：法定节假日 + 调休 + 客户生产变更冻结（封网）窗口。
 *
 * 背景：原排期只排除周末。行业项目跨元旦、春节、国庆是常态，银行还有年终决算封网，
 * 按「只排除周末」排出的计划系统性偏乐观，投产类任务还可能落在封网期。
 *
 * 数据来源：tyme4ts 的 LegalHoliday（随国务院每年 11 月公布的次年放假安排更新）。
 * 尚未公布的年份按农历推算主要假日（元旦、春节、清明、劳动节、端午、中秋、国庆），
 * 标记为估算，由排期说明与风险提示告知用户「以国务院公布为准」。
 */

import { LunarDay, SolarDay, SolarTerm } from 'tyme4ts'
import type { WorkingCalendarSettings } from '@aiproj/types'
import { DEFAULT_WORKING_CALENDAR_SETTINGS } from '@aiproj/types'
import { createWorkingCalendar, type WorkingCalendar } from '#services/gantt_working_calendar'

const DAY_MS = 86_400_000

export interface CalendarDayEntry {
  date: string
  name: string
  /** true = 调休上班（周末补班）；false = 放假。 */
  work: boolean
  estimated: boolean
}

export interface ChangeFreezeWindow {
  start: string
  end: string
  label: string
}

export interface DraftCalendar {
  calendar: WorkingCalendar
  settings: WorkingCalendarSettings
  entries: CalendarDayEntry[]
  officialYears: number[]
  estimatedYears: number[]
  freezeWindows: ChangeFreezeWindow[]
}

function iso(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

function parseIso(value: string): number {
  return Date.parse(`${value}T00:00:00Z`)
}

function solarIso(solar: SolarDay): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${solar.getYear()}-${pad(solar.getMonth())}-${pad(solar.getDay())}`
}

function span(start: string, days: number, name: string): CalendarDayEntry[] {
  const first = parseIso(start)
  return Array.from({ length: days }, (_, offset) => ({
    date: iso(first + offset * DAY_MS),
    name,
    work: false,
    estimated: true,
  }))
}

/** 未公布年份：按农历 / 节气推算主要假日（不推算调休，调休以国务院公布为准）。 */
function estimatedHolidays(year: number): CalendarDayEntry[] {
  const lunarDay = (month: number, day: number) =>
    solarIso(LunarDay.fromYmd(year, month, day).getSolarDay())
  const newYearEve = iso(parseIso(lunarDay(1, 1)) - DAY_MS)
  const qingming = SolarTerm.fromName(year, '清明').getJulianDay().getSolarDay()
  return [
    ...span(`${year}-01-01`, 1, '元旦'),
    // 2025 年起春节法定假日含除夕共 4 天，连同调休通常放 8–9 天；未公布前按除夕至初七估算。
    ...span(newYearEve, 8, '春节'),
    ...span(solarIso(qingming), 1, '清明节'),
    ...span(`${year}-05-01`, 5, '劳动节'),
    ...span(lunarDay(5, 5), 1, '端午节'),
    ...span(lunarDay(8, 15), 1, '中秋节'),
    ...span(`${year}-10-01`, 7, '国庆节'),
  ]
}

function officialHolidays(year: number): CalendarDayEntry[] {
  const entries: CalendarDayEntry[] = []
  for (let day = SolarDay.fromYmd(year, 1, 1); day.getYear() === year; day = day.next(1)) {
    const holiday = day.getLegalHoliday()
    if (!holiday) continue
    entries.push({
      date: solarIso(day),
      name: holiday.getName(),
      work: holiday.isWork(),
      estimated: false,
    })
  }
  return entries
}

// ---------------------------------------------------------------------------
// 封网 / 变更冻结窗口
// ---------------------------------------------------------------------------

const FREEZE_SENTENCE =
  /[^。；;！!\n]*(?:冻结|封网|封板|禁止(?:生产)?变更|变更窗口关闭)[^。；;！!\n]*/gu
const MONTH_PHRASE = /(\d{1,2})\s*月\s*(上旬|中旬|下旬|初|底|末|中)?/gu
const HOLIDAY_PHRASE = /(春节|国庆|元旦|五一|劳动节|清明|端午|中秋)(?:期间|前后|假期)?/gu

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function monthPhraseRange(
  year: number,
  month: number,
  part: string | undefined,
): { start: number; end: number } {
  const last = lastDayOfMonth(year, month)
  const [from, to] =
    part === '上旬' || part === '初'
      ? [1, 10]
      : part === '中旬' || part === '中'
        ? [11, 20]
        : part === '下旬'
          ? [21, last]
          : part === '底' || part === '末'
            ? [Math.max(1, last - 9), last]
            : [1, last]
  return { start: Date.UTC(year, month - 1, from), end: Date.UTC(year, month - 1, to) }
}

/** 月份相对项目窗口定年：取项目开始当年或次年中，落入项目窗口（或最接近）的那一年。 */
function yearFor(month: number, afterTime: number, projectStart: number): number {
  const startYear = new Date(projectStart).getUTCFullYear()
  for (const year of [startYear, startYear + 1, startYear + 2]) {
    if (Date.UTC(year, month - 1, lastDayOfMonth(year, month)) >= afterTime) return year
  }
  return startYear
}

const HOLIDAY_ALIAS: Record<string, string> = {
  五一: '劳动节',
  国庆: '国庆节',
  清明: '清明节',
  端午: '端午节',
  中秋: '中秋节',
}

/**
 * 从原始描述解析封网窗口，如「年底结算高峰（12 月中旬至 1 月上旬）与春节期间冻结生产变更」。
 * 只识别含「冻结 / 封网 / 禁止变更」的句子；节假日窗口取日历里该节日的放假区间（含前后各 2 天缓冲）。
 */
export function parseChangeFreezeWindows(
  rawInput: string,
  projectStartIso: string,
  projectEndIso: string,
  entries: CalendarDayEntry[],
): ChangeFreezeWindow[] {
  const projectStart = parseIso(projectStartIso)
  const projectEnd = parseIso(projectEndIso)
  if (!Number.isFinite(projectStart) || !Number.isFinite(projectEnd)) return []
  const windows: ChangeFreezeWindow[] = []
  for (const sentence of rawInput.normalize('NFKC').match(FREEZE_SENTENCE) ?? []) {
    // 「12 月中旬至 1 月上旬」：成对月份短语构成区间。
    const rangePattern =
      /(\d{1,2})\s*月\s*(上旬|中旬|下旬|初|底|末|中)?\s*(?:至|到|~|－|-|—)\s*(?:次年\s*)?(\d{1,2})\s*月\s*(上旬|中旬|下旬|初|底|末|中)?/gu
    let consumed = sentence
    for (const match of sentence.matchAll(rangePattern)) {
      const fromMonth = Number(match[1])
      const toMonth = Number(match[3])
      const fromYear = yearFor(fromMonth, projectStart, projectStart)
      const start = monthPhraseRange(fromYear, fromMonth, match[2]).start
      const toYear = toMonth < fromMonth ? fromYear + 1 : fromYear
      const end = monthPhraseRange(toYear, toMonth, match[4]).end
      windows.push({
        start: iso(start),
        end: iso(end),
        label: `封网：${match[0].replace(/\s+/g, '')}`,
      })
      consumed = consumed.replace(match[0], '')
    }
    for (const match of consumed.matchAll(MONTH_PHRASE)) {
      const month = Number(match[1])
      const range = monthPhraseRange(yearFor(month, projectStart, projectStart), month, match[2])
      windows.push({
        start: iso(range.start),
        end: iso(range.end),
        label: `封网：${match[0].replace(/\s+/g, '')}`,
      })
    }
    for (const match of consumed.matchAll(HOLIDAY_PHRASE)) {
      const name = HOLIDAY_ALIAS[match[1]] ?? match[1]
      const days = entries
        .filter((entry) => !entry.work && entry.name === name)
        .map((entry) => parseIso(entry.date))
        .filter((time) => time >= projectStart - 30 * DAY_MS && time <= projectEnd + 30 * DAY_MS)
        .sort((a, b) => a - b)
      if (days.length === 0) continue
      // 同名节日可能跨年出现两次：按间隔拆段。
      let segmentStart = days[0]
      let previous = days[0]
      const flush = () =>
        windows.push({
          start: iso(segmentStart - 2 * DAY_MS),
          end: iso(previous + 2 * DAY_MS),
          label: `封网：${name}期间`,
        })
      for (const time of days.slice(1)) {
        if (time - previous > 3 * DAY_MS) {
          flush()
          segmentStart = time
        }
        previous = time
      }
      flush()
    }
  }
  return windows
    .filter(
      (window) => parseIso(window.end) >= projectStart && parseIso(window.start) <= projectEnd,
    )
    .sort((a, b) => a.start.localeCompare(b.start))
}

/** 投产类任务（真正改动生产环境）：演练、方案、评审、文档类不算。 */
const PRODUCTION_CHANGE =
  /上线|投产|切换|切流|灰度|割接|生产部署|生产发布|发布到生产|正式发布|cutover|go-?live/iu
const NOT_PRODUCTION_CHANGE =
  /演练|方案|预案|评审|设计|编写|文档|培训|计划|准备|复盘|总结|手册|测试/u

export function isProductionChangeTask(name: string): boolean {
  return PRODUCTION_CHANGE.test(name) && !NOT_PRODUCTION_CHANGE.test(name)
}

/** 构建项目窗口（前后各留 1 年余量）的工作日历与封网窗口。 */
export function buildDraftCalendar(args: {
  startDate: string | null
  endDate: string | null
  rawInput?: string
}): DraftCalendar {
  const startYear = args.startDate
    ? Number(args.startDate.slice(0, 4))
    : new Date().getUTCFullYear()
  const endYear = args.endDate ? Number(args.endDate.slice(0, 4)) : startYear + 1
  const officialYears: number[] = []
  const estimatedYears: number[] = []
  const entries: CalendarDayEntry[] = []
  for (let year = startYear; year <= Math.max(endYear, startYear) + 1; year++) {
    const official = officialHolidays(year)
    if (official.length > 0) {
      officialYears.push(year)
      entries.push(...official)
    } else {
      estimatedYears.push(year)
      entries.push(...estimatedHolidays(year))
    }
  }
  const holidays = [
    ...new Set(entries.filter((entry) => !entry.work).map((entry) => entry.date)),
  ].sort()
  const extraWorkdays = [
    ...new Set(entries.filter((entry) => entry.work).map((entry) => entry.date)),
  ].sort()
  const settings: WorkingCalendarSettings = {
    ...DEFAULT_WORKING_CALENDAR_SETTINGS,
    holidays,
    extraWorkdays: extraWorkdays.filter((date) => !holidays.includes(date)),
  }
  const freezeWindows =
    args.rawInput && args.startDate && args.endDate
      ? parseChangeFreezeWindows(args.rawInput, args.startDate, args.endDate, entries)
      : []
  return {
    calendar: createWorkingCalendar(settings),
    settings,
    entries,
    officialYears,
    estimatedYears,
    freezeWindows,
  }
}

/** 给模型看的日历摘要：放假区间、调休上班日、封网窗口（有界、低敏）。 */
export function calendarPromptFacts(draftCalendar: DraftCalendar, fromIso: string, toIso: string) {
  const from = parseIso(fromIso)
  const to = parseIso(toIso)
  const inWindow = draftCalendar.entries.filter((entry) => {
    const time = parseIso(entry.date)
    return time >= from && time <= to
  })
  const groups: Array<{ name: string; dates: string[]; work: boolean; estimated: boolean }> = []
  for (const entry of inWindow.sort((a, b) => a.date.localeCompare(b.date))) {
    const current = groups.at(-1)
    if (current && current.name === entry.name && current.work === entry.work)
      current.dates.push(entry.date)
    else
      groups.push({
        name: entry.name,
        dates: [entry.date],
        work: entry.work,
        estimated: entry.estimated,
      })
  }
  return {
    holidays: groups
      .filter((group) => !group.work)
      .map(
        (group) =>
          `${group.name}：${group.dates[0]}${group.dates.length > 1 ? `~${group.dates.at(-1)}` : ''} 放假${group.estimated ? '（估算，以国务院公布为准）' : ''}`,
      ),
    makeupWorkdays: groups
      .filter((group) => group.work)
      .flatMap((group) => group.dates.map((date) => `${date}（${group.name}调休上班）`)),
    changeFreezeWindows: draftCalendar.freezeWindows.map(
      (window) => `${window.label}：${window.start}~${window.end}`,
    ),
  }
}

export const WORK_CALENDAR_RULE =
  '【工作日历】workCalendar 给出项目期间的法定节假日、调休上班日与客户封网窗口：任务起止日期避开放假日（调休上班日可排）；' +
  '工期按工作日计，跨越长假的任务结束日相应顺延；投产、切换、灰度切流、生产发布等生产变更任务不得落在 changeFreezeWindows 内，' +
  '应安排在封网前完成或封网后进行，并预留投产前的演练与回滚准备。'
