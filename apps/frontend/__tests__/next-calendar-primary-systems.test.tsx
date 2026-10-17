/**
 * 日历镜头：主曆排月格（农历 / 回历）、副曆标注顺序、空月份照常显示月格并可跳到最近有任务的月份。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { CalendarFullResponse } from '@/lib/calendar-types'
import { WorkspaceCalendarLens } from '@/components/next/lenses/WorkspaceCalendarLens'

const requests: Array<{ anchorDate: string; dateFrom?: string; dateTo?: string }> = []
let meta: CalendarFullResponse['meta'] = { total: 0, page: 1, perPage: 200, totalPages: 1 }

vi.mock('@/hooks/use-calendar', () => ({
  useProjectCalendarSchedule: (
    _projectId: number,
    filters: { anchorDate: string; dateFrom?: string; dateTo?: string },
  ) => {
    requests.push(filters)
    return {
      data: { data: [], meta },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isPlaceholderData: false,
    }
  },
}))

beforeEach(() => {
  requests.length = 0
  meta = { total: 0, page: 1, perPage: 200, totalPages: 1 }
})

describe('主曆排月格', () => {
  test('农历为主：标题是农历月，格子大数字是农历日，按整个网格查询任务', () => {
    const { container } = render(
      <WorkspaceCalendarLens
        projectId={7}
        today="2026-10-01"
        initialAnchorDate="2026-10-01"
        calendarSystems={['lunar', 'solar', 'holiday']}
      />,
    )
    expect(container.querySelector('[data-calendar-month-title]')?.textContent).toBe(
      '农历丙午年八月',
    )
    expect(container.querySelector('[data-calendar-solar-span]')?.textContent).toContain(
      '公历 2026年9月11日',
    )
    const first = container.querySelector('[data-calendar-day][data-date="2026-09-11"]')!
    expect(first.getAttribute('data-current-month')).toBe('true')
    expect(first.querySelector('[data-calendar-day-number]')?.textContent).toBe('初一')
    // 前面补齐的是上个农历月的日子，也按农历显示
    const lead = container.querySelector('[data-calendar-day][data-date="2026-09-10"]')!
    expect(lead.getAttribute('data-current-month')).toBe('false')
    expect(lead.querySelector('[data-calendar-day-number]')?.textContent).toBe('廿九')
    // 副曆按顺序：公历标注 + 法定假日
    const national = container.querySelector('[data-calendar-day][data-date="2026-10-01"]')!
    expect(national.querySelector('[data-calendar-annotation="solar"]')?.textContent).toBe('10/1')
    expect(national.querySelector('[data-calendar-statutory="off"]')?.textContent).toBe('休')
    // 查询窗口覆盖整个网格（周一起）
    expect(requests.at(-1)?.dateFrom).toBe('2026-09-07')

    fireEvent.click(container.querySelector('[data-calendar-next]')!)
    expect(container.querySelector('[data-calendar-month-title]')?.textContent).toBe(
      '农历丙午年九月',
    )
  })

  test('回历为主：标题是回历月', () => {
    const { container } = render(
      <WorkspaceCalendarLens
        projectId={7}
        today="2026-10-01"
        initialAnchorDate="2026-10-01"
        calendarSystems={['jieqi', 'hijri', 'solar']}
      />,
    )
    expect(container.querySelector('[data-calendar-month-title]')?.textContent).toBe(
      '1448年赖比尔·阿色尼月',
    )
  })
})

describe('空月份', () => {
  test('照常显示月格，可跳到最近有任务的月份', () => {
    meta = { ...meta, nearestScheduled: { before: '2026-05-08', after: '2026-12-03' } }
    const { container } = render(
      <WorkspaceCalendarLens projectId={7} today="2026-10-01" initialAnchorDate="2026-10-01" />,
    )
    expect(screen.getByText('本月没有任务排期')).toBeTruthy()
    expect(container.querySelectorAll('[data-calendar-day]').length).toBeGreaterThanOrEqual(28)
    fireEvent.click(container.querySelector('[data-calendar-jump-nearest]')!)
    expect(container.querySelector('[data-calendar-month-title]')?.textContent).toBe(
      '2026 年 12 月',
    )
  })
})
