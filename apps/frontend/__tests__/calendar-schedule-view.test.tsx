import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { CalendarItem } from '@/lib/calendar-types'
import { ScheduleMonthView } from '@/components/views/calendar/schedule/ScheduleMonthView'
import { ScheduleWeekView } from '@/components/views/calendar/schedule/ScheduleWeekView'
import { ScheduleDayView } from '@/components/views/calendar/schedule/ScheduleDayView'

function task(
  start: string | null,
  end: string | null,
  over: Partial<CalendarItem> = {},
): CalendarItem {
  return {
    id: `task-${over.sourceId ?? 1}`,
    kind: 'task',
    sourceId: over.sourceId ?? 1,
    projectId: 1,
    name: over.name ?? '任务',
    status: over.status ?? 'in_progress',
    priority: 'high',
    assignee: null,
    dateRange: {
      start,
      end,
      isSpan: !!(start && end && start !== end),
      missingStart: !start && !!end,
      missingEnd: !!start && !end,
    },
    isMultiDay: !!(start && end && start !== end),
    isOverdue: over.isOverdue ?? false,
    detailUrl: `/projects/1/tasks/${over.sourceId ?? 1}`,
    ...over,
  }
}

function milestone(date: string, over: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: `milestone-${over.sourceId ?? 1}`,
    kind: 'milestone',
    sourceId: over.sourceId ?? 1,
    projectId: 1,
    name: over.name ?? '里程碑',
    status: over.status ?? 'not_started',
    displayStatus: over.displayStatus ?? 'not_started',
    assignee: null,
    dateRange: { start: null, end: date, isSpan: false, missingStart: true, missingEnd: false },
    isMultiDay: false,
    isOverdue: over.isOverdue ?? false,
    detailUrl: `/projects/1/milestones/${over.sourceId ?? 1}`,
    ...over,
  }
}

const allowAll = () => true
const denyAll = () => false

describe('ScheduleMonthView', () => {
  test('renders weekday headers and a cross-week task in multiple cells', () => {
    // 2026-07-10 (Fri) → 2026-07-14 (Tue) crosses a week boundary
    const items = [task('2026-07-10', '2026-07-14', { name: '跨周任务' })]
    render(
      <ScheduleMonthView
        items={items}
        anchorDate="2026-07-15"
        canRescheduleItem={denyAll}
        onDateClick={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    )
    for (const day of ['一', '二', '三', '四', '五', '六', '日']) {
      expect(screen.getAllByText(day).length).toBeGreaterThanOrEqual(1)
    }
    expect(screen.getAllByText('跨周任务').length).toBeGreaterThanOrEqual(2)
  })

  test('renders milestone marker', () => {
    render(
      <ScheduleMonthView
        items={[milestone('2026-07-20', { name: '关键节点' })]}
        anchorDate="2026-07-15"
        canRescheduleItem={denyAll}
        onDateClick={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    )
    expect(screen.getByText('关键节点')).toBeTruthy()
  })

  test('collapses overflow with 还有 X 项', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      task(null, '2026-07-15', { sourceId: i + 1, name: `截止任务 ${i}` }),
    )
    render(
      <ScheduleMonthView
        items={items}
        anchorDate="2026-07-15"
        canRescheduleItem={denyAll}
        onDateClick={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    )
    expect(screen.getByText('还有 2 项')).toBeTruthy()
  })

  test('shows working-calendar holiday hint', () => {
    render(
      <ScheduleMonthView
        items={[]}
        anchorDate="2026-07-15"
        workingCalendar={{ workdays: [1, 2, 3, 4, 5], holidays: ['2026-07-15'], extraWorkdays: [] }}
        canRescheduleItem={denyAll}
        onDateClick={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    )
    expect(screen.getAllByText('节假日').length).toBeGreaterThanOrEqual(1)
  })
})

describe('ScheduleWeekView', () => {
  test('renders a task within the week', () => {
    render(
      <ScheduleWeekView
        items={[task('2026-07-13', '2026-07-15', { name: '周内任务' })]}
        anchorDate="2026-07-15"
        canRescheduleItem={allowAll}
        onDateClick={vi.fn()}
        onOpenItem={vi.fn()}
      />,
    )
    expect(screen.getAllByText('周内任务').length).toBeGreaterThanOrEqual(1)
  })
})

describe('ScheduleDayView', () => {
  test('lists intersecting task and milestone for the day', () => {
    render(
      <ScheduleDayView
        items={[
          task('2026-07-10', '2026-07-20', { name: '进行中任务' }),
          milestone('2026-07-15', { name: '当天里程碑' }),
        ]}
        date="2026-07-15"
        onOpenItem={vi.fn()}
      />,
    )
    expect(screen.getByText('进行中任务')).toBeTruthy()
    expect(screen.getByText('当天里程碑')).toBeTruthy()
  })

  test('shows overdue label (text, not color only)', () => {
    render(
      <ScheduleDayView
        items={[task('2026-07-10', '2026-07-15', { name: '逾期任务', isOverdue: true })]}
        date="2026-07-15"
        onOpenItem={vi.fn()}
      />,
    )
    expect(screen.getByText('逾期')).toBeTruthy()
  })

  test('empty state when no items intersect', () => {
    render(<ScheduleDayView items={[]} date="2026-07-15" onOpenItem={vi.fn()} />)
    expect(screen.getByText('该日期没有排程任务或里程碑')).toBeTruthy()
  })
})
