import type { CalendarItem } from '@/lib/calendar-types'

/**
 * Calendar 完整（schedule）模式布局派生。
 *
 * 把后端返回的 `CalendarItem[]`（任务区间 / 里程碑单点）裁剪为月/周/日视图
 * 可直接消费的「每日占位」模型。派生结果稳定且可被 `useMemo` 缓存，
 * hover / 滚动 / 焦点移动时不需要重算全部日历项布局（spec 性能门禁）。
 */

/** 某个日历项在具体某一天的占位语义。 */
export interface DayPlacement {
  item: CalendarItem
  /** 该天是区间起点（或单点当天） */
  isStart: boolean
  /** 该天是区间终点（或单点当天） */
  isEnd: boolean
  /** 该天是跨日区间的中段/续接（早于起点之后的天） */
  isContinuation: boolean
}

/** 归一化日历项的有效起止：单端日期视为单点。 */
export function normalizeItemSpan(item: CalendarItem): { start: string; end: string } | null {
  const { start, end } = item.dateRange
  const s = start ?? end
  const e = end ?? start
  if (!s || !e) return null
  // 容错：数据异常导致 start>end 时按单点处理
  return s <= e ? { start: s, end: e } : { start: s, end: s }
}

/** 判断日历项是否与某一天相交。 */
export function itemIntersectsDay(item: CalendarItem, day: string): boolean {
  const span = normalizeItemSpan(item)
  if (!span) return false
  return span.start <= day && span.end >= day
}

/**
 * 为给定的有序日期列表构建「每日占位」桶。
 *
 * @param items  已按窗口裁剪的日历项
 * @param days   视图覆盖的连续 ISO 日期（如月视图 42 天、周视图 7 天、日视图 1 天）
 */
export function buildDayBuckets(
  items: CalendarItem[],
  days: readonly string[],
): Map<string, DayPlacement[]> {
  const buckets = new Map<string, DayPlacement[]>()
  for (const day of days) buckets.set(day, [])
  if (days.length === 0) return buckets

  const windowStart = days[0]!
  const windowEnd = days[days.length - 1]!

  for (const item of items) {
    const span = normalizeItemSpan(item)
    if (!span) continue
    if (span.start > windowEnd || span.end < windowStart) continue
    for (const day of days) {
      if (day < span.start || day > span.end) continue
      const list = buckets.get(day)
      if (!list) continue
      list.push({
        item,
        isStart: day === span.start,
        isEnd: day === span.end,
        isContinuation: day > span.start,
      })
    }
  }
  return buckets
}

/** 过滤出与窗口相交的日历项（不做每日展开，用于日视图/统计）。 */
export function itemsIntersectingWindow(
  items: CalendarItem[],
  windowStart: string,
  windowEnd: string,
): CalendarItem[] {
  return items.filter((item) => {
    const span = normalizeItemSpan(item)
    if (!span) return false
    return span.start <= windowEnd && span.end >= windowStart
  })
}
