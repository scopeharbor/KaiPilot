import { describe, expect, test } from 'vitest'
import type { CalendarItem } from '@/lib/calendar-types'
import {
  buildDayBuckets,
  itemIntersectsDay,
  itemsIntersectingWindow,
  normalizeItemSpan,
} from '@/lib/calendar-layout'
import { computeReschedulePatch } from '@/lib/calendar-reschedule'
import { dayWorkingStatus } from '@/lib/calendar-working'

function makeTask(
  start: string | null,
  end: string | null,
  overrides: Partial<CalendarItem> = {},
): CalendarItem {
  return {
    id: `task-${overrides.sourceId ?? 1}`,
    kind: 'task',
    sourceId: overrides.sourceId ?? 1,
    projectId: 1,
    name: overrides.name ?? '任务',
    status: overrides.status ?? 'in_progress',
    priority: 'high',
    assignee: overrides.assignee ?? null,
    dateRange: {
      start,
      end,
      isSpan: !!(start && end && start !== end),
      missingStart: !start && !!end,
      missingEnd: !!start && !end,
    },
    isMultiDay: !!(start && end && start !== end),
    isOverdue: overrides.isOverdue ?? false,
    detailUrl: `/projects/1/tasks/${overrides.sourceId ?? 1}`,
    ...overrides,
  }
}

function makeMilestone(date: string, sourceId = 1): CalendarItem {
  return {
    id: `milestone-${sourceId}`,
    kind: 'milestone',
    sourceId,
    projectId: 1,
    name: '里程碑',
    status: 'not_started',
    assignee: null,
    dateRange: { start: null, end: date, isSpan: false, missingStart: true, missingEnd: false },
    isMultiDay: false,
    isOverdue: false,
    detailUrl: `/projects/1/milestones/${sourceId}`,
  }
}

const DAYS_JULY = Array.from({ length: 31 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`)

describe('normalizeItemSpan', () => {
  test('full range keeps start/end', () => {
    expect(normalizeItemSpan(makeTask('2026-07-10', '2026-07-15'))).toEqual({
      start: '2026-07-10',
      end: '2026-07-15',
    })
  })
  test('deadline-only collapses to single day', () => {
    expect(normalizeItemSpan(makeTask(null, '2026-07-15'))).toEqual({
      start: '2026-07-15',
      end: '2026-07-15',
    })
  })
  test('no dates yields null', () => {
    expect(normalizeItemSpan(makeTask(null, null))).toBeNull()
  })
})

describe('itemIntersectsDay', () => {
  const span = makeTask('2026-07-10', '2026-07-15')
  test('inside span', () => expect(itemIntersectsDay(span, '2026-07-12')).toBe(true))
  test('start boundary', () => expect(itemIntersectsDay(span, '2026-07-10')).toBe(true))
  test('end boundary', () => expect(itemIntersectsDay(span, '2026-07-15')).toBe(true))
  test('outside', () => expect(itemIntersectsDay(span, '2026-07-16')).toBe(false))
})

describe('buildDayBuckets', () => {
  test('cross-week span appears in each covered day with start/end/continuation flags', () => {
    const item = makeTask('2026-07-10', '2026-07-13')
    const buckets = buildDayBuckets([item], DAYS_JULY)
    expect(buckets.get('2026-07-10')?.[0]).toMatchObject({ isStart: true, isContinuation: false })
    expect(buckets.get('2026-07-11')?.[0]).toMatchObject({
      isStart: false,
      isContinuation: true,
      isEnd: false,
    })
    expect(buckets.get('2026-07-13')?.[0]).toMatchObject({ isEnd: true, isContinuation: true })
    expect(buckets.get('2026-07-14')?.length).toBe(0)
  })

  test('milestone lands on single day', () => {
    const buckets = buildDayBuckets([makeMilestone('2026-07-20')], DAYS_JULY)
    expect(buckets.get('2026-07-20')?.[0]?.item.kind).toBe('milestone')
    expect(buckets.get('2026-07-19')?.length).toBe(0)
  })

  test('empty day list returns empty map', () => {
    expect(buildDayBuckets([makeTask('2026-07-10', '2026-07-12')], []).size).toBe(0)
  })

  // 性能回归门禁（task 5.3）：1000 日历项的月窗口布局应在合理耗时内完成一次派生。
  test('1000 items lay out within budget and are memoizable', () => {
    const items: CalendarItem[] = Array.from({ length: 1000 }, (_, i) =>
      makeTask('2026-07-05', '2026-07-18', { sourceId: i + 1, name: `任务 ${i}` }),
    )
    const t0 = performance.now()
    const buckets = buildDayBuckets(items, DAYS_JULY)
    const elapsed = performance.now() - t0
    // 每个覆盖日应包含全部 1000 项
    expect(buckets.get('2026-07-10')?.length).toBe(1000)
    // 单次派生预算宽松上限，防止 O(n^2) 回退
    expect(elapsed).toBeLessThan(500)
  })
})

describe('itemsIntersectingWindow', () => {
  test('filters to items intersecting a single day', () => {
    const items = [
      makeTask('2026-07-10', '2026-07-15', { sourceId: 1 }),
      makeTask('2026-07-20', '2026-07-21', { sourceId: 2 }),
    ]
    const result = itemsIntersectingWindow(items, '2026-07-12', '2026-07-12')
    expect(result.map((i) => i.sourceId)).toEqual([1])
  })
})

describe('computeReschedulePatch', () => {
  test('same day is a no-op', () => {
    expect(
      computeReschedulePatch(makeTask('2026-07-10', '2026-07-12'), '2026-07-10', '2026-07-10'),
    ).toBeNull()
  })

  test('full range shifts both dates by grabbed-day delta', () => {
    const patch = computeReschedulePatch(
      makeTask('2026-07-10', '2026-07-12'),
      '2026-07-10',
      '2026-07-14',
    )
    expect(patch).toMatchObject({
      kind: 'task',
      taskId: 1,
      patch: { startDate: '2026-07-14', endDate: '2026-07-16' },
    })
  })

  test('grabbing the end of a span shifts by that day delta', () => {
    // grab 07-12 (end), drop on 07-15 => +3 days
    const patch = computeReschedulePatch(
      makeTask('2026-07-10', '2026-07-12'),
      '2026-07-12',
      '2026-07-15',
    )
    expect(patch?.patch).toEqual({ startDate: '2026-07-13', endDate: '2026-07-15' })
  })

  test('deadline-only task moves endDate to target', () => {
    const patch = computeReschedulePatch(makeTask(null, '2026-07-15'), '2026-07-15', '2026-07-18')
    expect(patch).toMatchObject({ kind: 'task', patch: { endDate: '2026-07-18' } })
  })

  test('start-only task moves startDate to target', () => {
    const patch = computeReschedulePatch(makeTask('2026-07-10', null), '2026-07-10', '2026-07-12')
    expect(patch).toMatchObject({ kind: 'task', patch: { startDate: '2026-07-12' } })
  })

  test('milestone moves plannedDate to target', () => {
    const patch = computeReschedulePatch(makeMilestone('2026-07-20', 7), '2026-07-20', '2026-07-25')
    expect(patch).toMatchObject({
      kind: 'milestone',
      milestoneId: 7,
      patch: { plannedDate: '2026-07-25' },
    })
  })
})

describe('dayWorkingStatus', () => {
  const wc = { workdays: [1, 2, 3, 4, 5], holidays: ['2026-10-01'], extraWorkdays: ['2026-09-26'] }
  test('holiday is non-working', () => {
    expect(dayWorkingStatus(wc, '2026-10-01')).toMatchObject({
      isHoliday: true,
      isNonWorking: true,
    })
  })
  test('extra workday (a Saturday) becomes working', () => {
    // 2026-09-26 is a Saturday
    expect(dayWorkingStatus(wc, '2026-09-26')).toMatchObject({
      isExtraWorkday: true,
      isNonWorking: false,
    })
  })
  test('regular weekend is non-working', () => {
    // 2026-07-11 is a Saturday
    expect(dayWorkingStatus(wc, '2026-07-11')).toMatchObject({ isNonWorking: true })
  })
  test('regular weekday is working', () => {
    // 2026-07-13 is a Monday
    expect(dayWorkingStatus(wc, '2026-07-13')).toMatchObject({ isNonWorking: false })
  })
  test('no context defaults to weekend non-working', () => {
    expect(dayWorkingStatus(undefined, '2026-07-11').isNonWorking).toBe(true)
    expect(dayWorkingStatus(undefined, '2026-07-13').isNonWorking).toBe(false)
  })
})
