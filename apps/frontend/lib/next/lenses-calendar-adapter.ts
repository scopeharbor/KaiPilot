import type { CalendarItem } from '@/lib/calendar-types'

/**
 * 日历时间切面镜头纯函数适配层（v3-ui-next-remaining-lenses W3 tasks 3.1 / spec「日历时间切面镜头」）。
 *
 * 与 UI 完全解耦的确定性日历网格计算：
 * 1. `computeMonthGrid`：以周一为一周起始，推导 4~6 × 7 自然月矩阵（含首尾补齐周）；
 * 2. 任务/里程碑跨日落位：将解析跨度 `[startDate, endDate]` 内的每项平铺至其覆盖的
 *    每个自然日单元格，并标记跨日边界形态（isStart / isEnd / isMiddle）；
 * 3. 溢出折叠：单日排程超过 `MAX_VISIBLE_ITEMS_PER_CELL` 的部分计数为「+N 项」。
 *
 * 全部日期计算基于 UTC 零点字符串（YYYY-MM-DD）算术，规避 DST 与时区抖动。
 */

/** 单日单元格内最多直接展示的排程微卡数，超出折叠为「+N 项」胶囊。 */
export const MAX_VISIBLE_ITEMS_PER_CELL = 3

const DAY_MS = 86_400_000
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** 某个日历项在具体某一天的落位语义（含跨日边界形态）。 */
export interface CalendarDayPlacement {
  item: CalendarItem
  /** 该天是解析跨度的起点（单日项恒为 true）。 */
  isStart: boolean
  /** 该天是解析跨度的终点（单日项恒为 true）。 */
  isEnd: boolean
  /** 该天处于多日跨度中段（严格晚于起点、早于终点）。 */
  isMiddle: boolean
}

/** 月历矩阵中单个自然日单元格的只读视图模型。 */
export interface CalendarDayCellData {
  /** ISO 日期键 'YYYY-MM-DD'。 */
  dateString: string
  /** 当月天数数字（1~31）。 */
  dayNumber: number
  /** 格子大数字：主曆的日（公历即 dayNumber；农历「初一」、回历「18」…）。 */
  dayLabel: string
  /** 是否属于 anchorDate 所在自然月（补齐周为 false）。 */
  isCurrentMonth: boolean
  /** 是否匹配 todayStr。 */
  isToday: boolean
  /** 周六 / 周日。 */
  isWeekend: boolean
  /** 当日全部排程项（与 placements 同序同步，等价 `placements.map((p) => p.item)`）。 */
  items: CalendarItem[]
  /** 当日逐项落位（多日条带项恒排在单日项之前，保障跨日条带行位连续）。 */
  placements: CalendarDayPlacement[]
  /** 溢出折叠计数：`max(0, 当日项数 - MAX_VISIBLE_ITEMS_PER_CELL)`。 */
  overflowCount: number
}

/** `computeMonthGrid` 返回的完整月矩阵。 */
export interface MonthGrid {
  /** 4~6 行 × 7 列（周一至周日）单元格矩阵。 */
  weeks: CalendarDayCellData[][]
  /** 如 '2026 年 9 月'。 */
  monthTitle: string
}

function parseParts(value: string): { year: number; month: number; day: number } {
  const match = DATE_PATTERN.exec(value)
  if (!match) {
    throw new Error(`非法日期格式（需 YYYY-MM-DD）：${value}`)
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`非法日历日期：${value}`)
  }
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`非法日历日期：${value}`)
  }
  return { year, month, day }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function toKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

/** Date 实例 → 本地 YYYY-MM-DD（组件缺省「今天」用）。 */
export function toDateString(date: Date): string {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  return toKey(year, month, day)
}

/** YYYY-MM-DD → UTC 零点毫秒。 */
function toUtcMs(value: string): number {
  const { year, month, day } = parseParts(value)
  return Date.UTC(year, month - 1, day)
}

/** 周一为 1、周日为 7 的 ISO 星期序（周一至周日 7 列对齐基准）。 */
export function isoWeekday(value: string): number {
  const dayOfWeek = new Date(toUtcMs(value)).getUTCDay()
  return dayOfWeek === 0 ? 7 : dayOfWeek
}

/**
 * 月份平移：将 anchorDate 归一到所在自然月 1 号，再平移 delta 个月
 * （支持跨年，如 2026-12-10 +1 → '2027-01-01'）。
 */
export function shiftAnchorMonth(anchorDate: string, delta: number): string {
  const { year, month } = parseParts(anchorDate)
  const target = new Date(Date.UTC(year, month - 1 + delta, 1))
  return toKey(target.getUTCFullYear(), target.getUTCMonth() + 1, 1)
}

/** 主曆月份（非公历主曆时由 lib/calendar-systems 给出）。 */
export interface PrimaryMonthRange {
  title: string
  startISO: string
  endISO: string
  /** 公历日期 → 格子大数字。 */
  dayLabels: ReadonlyMap<string, string>
}

/** 日期平移 delta 天（周 / 日视图翻页）。 */
export function shiftAnchorDays(anchorDate: string, delta: number): string {
  const d = new Date(toUtcMs(anchorDate) + delta * DAY_MS)
  return toKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** anchor 所在周（周一至周日）的 7 天。 */
export function weekDaysOf(anchorDate: string): string[] {
  const monday = shiftAnchorDays(anchorDate, 1 - isoWeekday(anchorDate))
  return Array.from({ length: 7 }, (_, index) => shiftAnchorDays(monday, index))
}

/**
 * 把日历项落到一串连续日期上（月格 / 周 / 日共用）：多日条带先排、单日项后排，
 * 保证相邻日条带行位对齐；完全落在窗口外的项不产生落位。
 */
export function placeItemsOnDays(
  days: readonly string[],
  items: readonly CalendarItem[],
): Map<string, CalendarDayPlacement[]> {
  const buckets = new Map<string, CalendarDayPlacement[]>()
  for (const day of days) buckets.set(day, [])
  if (days.length === 0) return buckets
  const windowStart = days[0]!
  const windowEnd = days[days.length - 1]!
  const entries = items.map((item) => ({ item, span: normalizeItemSpan(item) }))
  const multiDay = entries.filter(
    (entry) => entry.span !== null && entry.span.end > entry.span.start,
  )
  const singleDay = entries.filter(
    (entry) => entry.span !== null && entry.span.end === entry.span.start,
  )
  for (const group of [multiDay, singleDay]) {
    for (const entry of group) {
      const span = entry.span!
      if (span.end < windowStart || span.start > windowEnd) continue
      const startIdx = days.findIndex((d) => d >= span.start)
      const endIdx = days.findIndex((d) => d > span.end)
      const clampedStart = startIdx === -1 ? 0 : startIdx
      const clampedEnd = endIdx === -1 ? days.length - 1 : endIdx - 1
      for (let i = clampedStart; i <= clampedEnd; i += 1) {
        const day = days[i]!
        const isStart = span.start === day
        const isEnd = span.end === day
        buckets.get(day)!.push({ item: entry.item, isStart, isEnd, isMiddle: !isStart && !isEnd })
      }
    }
  }
  return buckets
}

/** 任意起止（主曆月份）的 7 列网格日期序列（周一起，首尾补齐周）。 */
export function rangeGridDays(startISO: string, endISO: string): string[] {
  const lead = isoWeekday(startISO) - 1
  const tail = 7 - isoWeekday(endISO)
  const startMs = toUtcMs(startISO) - lead * DAY_MS
  const endMs = toUtcMs(endISO) + tail * DAY_MS
  const days: string[] = []
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    const d = new Date(ms)
    days.push(toKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()))
  }
  return days
}

/** 推导 anchor 所在自然月的完整 7 列网格日期序列（含首尾补齐周）。 */
export function monthGridDays(anchorDate: string): {
  days: string[]
  monthTitle: string
  gridStart: string
  gridEnd: string
} {
  const { year, month } = parseParts(anchorDate)
  const firstOfMonth = toKey(year, month, 1)
  const lead = isoWeekday(firstOfMonth) - 1
  const gridStartMs = toUtcMs(firstOfMonth) - lead * DAY_MS
  const monthDayCount = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const totalDays = Math.ceil((lead + monthDayCount) / 7) * 7
  const days: string[] = []
  for (let i = 0; i < totalDays; i += 1) {
    const d = new Date(gridStartMs + i * DAY_MS)
    days.push(toKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()))
  }
  return {
    days,
    monthTitle: `${year} 年 ${month} 月`,
    gridStart: days[0]!,
    gridEnd: days[days.length - 1]!,
  }
}

/** 归一化日历项的有效起止：单端缺失取另一端；start > end 时按起点单点容错。 */
export function normalizeItemSpan(item: CalendarItem): { start: string; end: string } | null {
  const { start, end } = item.dateRange
  const s = start ?? end
  const e = end ?? start
  if (!s || !e) return null
  return s <= e ? { start: s, end: e } : { start: s, end: s }
}

/**
 * 自然月网格矩阵 + 任务/里程碑落位（tasks 3.1 契约）。
 *
 * - 单日项：落位于该自然日，`isStart`/`isEnd` 均为 true；
 * - 多日跨度项（解析跨度 > 1 天）：覆盖的每个自然日均生成一段落位，
 *   起点日 `isStart`、终点日 `isEnd`、中间日 `isMiddle`；
 * - 单元格内排序：多日条带恒排在单日微卡之前（输入顺序稳定），
 *   保证相邻日条带行位对齐、形成连续横向条带；
 * - 完全落在网格窗口外的项不产生落位；单日溢出计数见 `overflowCount`。
 */
export function computeMonthGrid(
  anchorDate: string,
  items: CalendarItem[],
  todayStr?: string,
  primary?: PrimaryMonthRange,
): MonthGrid {
  const { days, monthTitle } = primary
    ? { days: rangeGridDays(primary.startISO, primary.endISO), monthTitle: primary.title }
    : monthGridDays(anchorDate)
  const buckets = placeItemsOnDays(days, items)

  const anchor = parseParts(anchorDate)
  const monthPrefix = toKey(anchor.year, anchor.month, 1).slice(0, 7)

  const cells = days.map((day): CalendarDayCellData => {
    const placements = buckets.get(day)!
    const dayOfWeek = new Date(toUtcMs(day)).getUTCDay()
    return {
      dateString: day,
      dayNumber: parseParts(day).day,
      dayLabel: primary?.dayLabels.get(day) ?? String(parseParts(day).day),
      isCurrentMonth: primary
        ? day >= primary.startISO && day <= primary.endISO
        : day.startsWith(monthPrefix),
      isToday: todayStr !== undefined && day === todayStr,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      items: placements.map((p) => p.item),
      placements,
      overflowCount: Math.max(0, placements.length - MAX_VISIBLE_ITEMS_PER_CELL),
    }
  })

  const weeks: CalendarDayCellData[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }
  return { weeks, monthTitle }
}
