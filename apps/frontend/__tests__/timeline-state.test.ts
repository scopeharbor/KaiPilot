import { describe, expect, test } from 'vitest'
import { timelineKeys, type TimelineFilters } from '@/lib/api/timeline'
import {
  formatRelativeTime,
  groupKeyForDate,
  hasActiveTimelineFilters,
  parseTimelineState,
  serializeTimelineState,
} from '@/lib/timeline-state'

describe('timeline API query keys', () => {
  test('list key 包含 projectId 与 filters', () => {
    const filters: TimelineFilters = { categories: ['task'], keyOnly: true }
    const key = timelineKeys.list(42, filters)
    expect(key).toEqual(['timeline', 'list', 42, filters])
  })

  test('lists key 是 list key 前缀', () => {
    const filters: TimelineFilters = { relatedToMe: true }
    const listKey = timelineKeys.list(7, filters)
    const listsKey = timelineKeys.lists(7)
    expect(listKey.slice(0, listsKey.length)).toEqual(listsKey)
  })
})

describe('parseTimelineState', () => {
  test('无参数时为空筛选', () => {
    const state = parseTimelineState(new URLSearchParams())
    expect(state).toEqual({})
    expect(hasActiveTimelineFilters(state)).toBe(false)
  })

  test('解析类型/重要性/关键/与我有关/搜索/时间范围', () => {
    const state = parseTimelineState(
      new URLSearchParams(
        'category=task,milestone&importance=high,critical&keyOnly=1&relatedToMe=1&search=部署&from=2026-07-01&to=2026-07-13',
      ),
    )
    expect(state.categories).toEqual(['task', 'milestone'])
    expect(state.importance).toEqual(['high', 'critical'])
    expect(state.keyOnly).toBe(true)
    expect(state.relatedToMe).toBe(true)
    expect(state.search).toBe('部署')
    expect(state.from).toBe('2026-07-01')
    expect(state.to).toBe('2026-07-13')
    expect(hasActiveTimelineFilters(state)).toBe(true)
  })

  test('丢弃非法 category 片段与非法日期', () => {
    const state = parseTimelineState(new URLSearchParams('category=task,__evil__&from=not-a-date'))
    expect(state.categories).toEqual(['task'])
    expect(state.from).toBeUndefined()
  })

  test('全部非法 category 时不设置该键', () => {
    const state = parseTimelineState(new URLSearchParams('category=__x__,__y__'))
    expect(state.categories).toBeUndefined()
  })
})

describe('serializeTimelineState', () => {
  test('空筛选序列化为空串', () => {
    expect(serializeTimelineState({})).toBe('')
  })

  test('与 parse 往返一致', () => {
    const filters: TimelineFilters = {
      categories: ['risk', 'change_request'],
      keyOnly: true,
      search: 'deploy',
      from: '2026-07-01',
    }
    const query = serializeTimelineState(filters)
    const round = parseTimelineState(new URLSearchParams(query))
    expect(round).toEqual(filters)
  })
})

describe('groupKeyForDate', () => {
  const now = new Date(2026, 6, 15, 10, 0, 0) // 2026-07-15 周三

  test('今天 / 昨天 / 本周 / 更早分组', () => {
    expect(groupKeyForDate('2026-07-15T08:00:00', now)).toBe('today')
    expect(groupKeyForDate('2026-07-14T23:00:00', now)).toBe('yesterday')
    expect(groupKeyForDate('2026-07-13T09:00:00', now)).toBe('thisWeek')
    expect(groupKeyForDate('2026-07-01T09:00:00', now)).toBe('earlier')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-15T10:00:00.000Z')

  test('刚刚 / 分钟前 / 小时前', () => {
    expect(formatRelativeTime('2026-07-15T09:59:30.000Z', now)).toBe('刚刚')
    expect(formatRelativeTime('2026-07-15T09:30:00.000Z', now)).toBe('30 分钟前')
    expect(formatRelativeTime('2026-07-15T07:00:00.000Z', now)).toBe('3 小时前')
  })
})
