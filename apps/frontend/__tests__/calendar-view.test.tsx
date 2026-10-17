import { QueryClient } from '@tanstack/react-query'
import { describe, expect, test, vi } from 'vitest'
import { calendarKeys, type CalendarFilters } from '@/lib/api/calendar'
import {
  parseCalendarState,
  serializeCalendarState,
  shiftCalendarAnchor,
} from '@/lib/calendar-state'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

describe('calendar API query keys', () => {
  test('list key incorporates projectId and filters', () => {
    const filters: CalendarFilters = { view: 'month', anchorDate: '2026-07-15' }
    const key = calendarKeys.list(42, filters)
    expect(key).toEqual(['calendar', 'list', 42, filters])
  })

  test('lists key is prefix of list key', () => {
    const filters: CalendarFilters = { view: 'week', anchorDate: '2026-07-01' }
    const listKey = calendarKeys.list(5, filters)
    const listsKey = calendarKeys.lists(5)
    expect(listKey.slice(0, listsKey.length)).toEqual(listsKey)
  })
})

describe('parseCalendarState', () => {
  test('defaults to month view and today when no params', () => {
    const params = new URLSearchParams()
    const state = parseCalendarState(params)
    expect(state.view).toBe('month')
    expect(state.anchorDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(state.search).toBeUndefined()
    expect(state.status).toBeUndefined()
  })

  test('parses week view with anchorDate', () => {
    const params = new URLSearchParams('view=week&anchorDate=2026-07-07')
    const state = parseCalendarState(params)
    expect(state.view).toBe('week')
    expect(state.anchorDate).toBe('2026-07-07')
  })

  test('parses day view with filters', () => {
    const params = new URLSearchParams(
      'view=day&anchorDate=2026-07-10&status=in_progress&priority=high&search=deploy',
    )
    const state = parseCalendarState(params)
    expect(state.view).toBe('day')
    expect(state.anchorDate).toBe('2026-07-10')
    expect(state.status).toBe('in_progress')
    expect(state.priority).toBe('high')
    expect(state.search).toBe('deploy')
  })

  test('rejects invalid view and falls back to month', () => {
    const params = new URLSearchParams('view=year&anchorDate=2026-07-15')
    const state = parseCalendarState(params)
    expect(state.view).toBe('month')
  })

  test('rejects invalid anchorDate and falls back to today', () => {
    const params = new URLSearchParams('view=month&anchorDate=not-a-date')
    const state = parseCalendarState(params)
    expect(state.anchorDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('serializeCalendarState', () => {
  test('omits defaults from serialized output', () => {
    const today = new Date().toISOString().slice(0, 10)
    const query = serializeCalendarState({ view: 'month', anchorDate: today })
    expect(query).toBe('')
  })

  test('includes non-default values', () => {
    const query = serializeCalendarState({
      view: 'week',
      anchorDate: '2026-07-21',
      status: 'in_progress',
      search: 'test',
    })
    expect(query).toContain('view=week')
    expect(query).toContain('anchorDate=2026-07-21')
    expect(query).toContain('status=in_progress')
    expect(query).toContain('search=test')
  })
})

describe('shiftCalendarAnchor', () => {
  test('moves month view backward and forward by one month', () => {
    expect(shiftCalendarAnchor('2026-07-15', 'month', -1)).toBe('2026-06-15')
    expect(shiftCalendarAnchor('2026-07-15', 'month', 1)).toBe('2026-08-15')
  })

  test('moves week view backward and forward by one week', () => {
    expect(shiftCalendarAnchor('2026-07-15', 'week', -1)).toBe('2026-07-08')
    expect(shiftCalendarAnchor('2026-07-15', 'week', 1)).toBe('2026-07-22')
  })

  test('moves day view backward and forward by one day', () => {
    expect(shiftCalendarAnchor('2026-07-15', 'day', -1)).toBe('2026-07-14')
    expect(shiftCalendarAnchor('2026-07-15', 'day', 1)).toBe('2026-07-16')
  })
})

describe('invalidateTaskQueries includes calendar', () => {
  test('invalidates calendar lists alongside task queries', async () => {
    const qc = createQueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    await invalidateTaskQueries(qc, 1)
    const queryKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey)
    expect(queryKeys).toEqual(
      expect.arrayContaining([expect.arrayContaining([expect.stringContaining('calendar')])]),
    )
  })
})
