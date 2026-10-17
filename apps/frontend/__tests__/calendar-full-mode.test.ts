import { describe, expect, test } from 'vitest'
import {
  parseCalendarState,
  serializeCalendarState,
  sliceCalendarItemsToWindow,
} from '@/lib/calendar-state'
import type { CalendarItem } from '@/lib/calendar-types'

describe('parseCalendarState with mode', () => {
  test('defaults to no mode when not specified', () => {
    const params = new URLSearchParams('view=month&anchorDate=2026-07-15')
    const state = parseCalendarState(params)
    expect(state.mode).toBeUndefined()
  })

  test('parses schedule mode from URL', () => {
    const params = new URLSearchParams('view=month&anchorDate=2026-07-15&mode=schedule')
    const state = parseCalendarState(params)
    expect(state.mode).toBe('schedule')
  })

  test('parses mode=schedule with filters', () => {
    const params = new URLSearchParams(
      'view=week&anchorDate=2026-07-20&mode=schedule&status=in_progress&priority=high',
    )
    const state = parseCalendarState(params)
    expect(state.mode).toBe('schedule')
    expect(state.view).toBe('week')
    expect(state.status).toBe('in_progress')
  })

  test('rejects invalid mode', () => {
    const params = new URLSearchParams('view=month&anchorDate=2026-07-15&mode=unknown')
    const state = parseCalendarState(params)
    expect(state.mode).toBeUndefined()
  })

  test('mode persists through serialize/parse roundtrip', () => {
    const input: URLSearchParams = new URLSearchParams(
      'view=week&anchorDate=2026-07-21&mode=schedule&status=in_progress',
    )
    const parsed = parseCalendarState(input)
    expect(parsed.mode).toBe('schedule')

    const serialized = serializeCalendarState(parsed)
    expect(serialized).toContain('mode=schedule')

    const reparsed = parseCalendarState(new URLSearchParams(serialized))
    expect(reparsed.mode).toBe('schedule')
  })

  test('parses itemTypes filter from URL', () => {
    const params = new URLSearchParams(
      'view=month&anchorDate=2026-07-15&mode=schedule&itemTypes=milestone',
    )
    const state = parseCalendarState(params)
    expect(state.itemTypes).toBe('milestone')
  })

  test('drops unknown itemTypes values', () => {
    const params = new URLSearchParams('view=month&anchorDate=2026-07-15&itemTypes=task,bogus')
    const state = parseCalendarState(params)
    expect(state.itemTypes).toBe('task')
  })

  test('itemTypes persists through serialize/parse roundtrip', () => {
    const parsed = parseCalendarState(
      new URLSearchParams(
        'view=month&anchorDate=2026-07-21&mode=schedule&itemTypes=task,milestone',
      ),
    )
    const serialized = serializeCalendarState(parsed)
    expect(serialized).toContain('itemTypes=task%2Cmilestone')
    const reparsed = parseCalendarState(new URLSearchParams(serialized))
    expect(reparsed.itemTypes).toBe('task,milestone')
  })
})

describe('sliceCalendarItemsToWindow', () => {
  function makeItem(start: string | null, end: string | null): CalendarItem {
    return {
      id: `task-1`,
      kind: 'task',
      sourceId: 1,
      projectId: 1,
      name: 'Test',
      status: 'in_progress',
      dateRange: {
        start,
        end,
        isSpan: !!(start && end && start !== end),
        missingStart: !start && !!end,
        missingEnd: !!start && !end,
      },
      isMultiDay: !!(start && end && start !== end),
      isOverdue: false,
      detailUrl: '/projects/1/tasks/1',
    }
  }

  test('in-window full interval is included', () => {
    const item = makeItem('2026-07-10', '2026-07-15')
    const result = sliceCalendarItemsToWindow([item], '2026-07-01', '2026-07-31')
    expect(result).toHaveLength(1)
  })

  test('out-of-window interval is excluded', () => {
    const item = makeItem('2026-08-01', '2026-08-10')
    const result = sliceCalendarItemsToWindow([item], '2026-07-01', '2026-07-31')
    expect(result).toHaveLength(0)
  })

  test('cross-window interval (start before, end after) is included', () => {
    const item = makeItem('2026-07-28', '2026-08-03')
    const result = sliceCalendarItemsToWindow([item], '2026-07-01', '2026-07-31')
    expect(result).toHaveLength(1)
  })

  test('deadline-only item in window is included', () => {
    const item = makeItem(null, '2026-07-15')
    const result = sliceCalendarItemsToWindow([item], '2026-07-01', '2026-07-31')
    expect(result).toHaveLength(1)
  })

  test('start-only item in window is included', () => {
    const item = makeItem('2026-07-10', null)
    const result = sliceCalendarItemsToWindow([item], '2026-07-01', '2026-07-31')
    expect(result).toHaveLength(1)
  })
})
