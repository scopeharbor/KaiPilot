import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { type PropsWithChildren } from 'react'
import { describe, expect, test, vi } from 'vitest'
import type { CalendarItem, CalendarFullResponse } from '@/lib/calendar-types'

// ---- mocks（隔离数据/权限/重组件，聚焦容器渲染路径） ----
const scheduleState = {
  data: undefined as CalendarFullResponse | undefined,
  isLoading: false,
  error: null as Error | null,
  refetch: vi.fn(),
}
vi.mock('@/hooks/use-calendar', () => ({
  useProjectCalendarSchedule: () => scheduleState,
  useProjectCalendar: () => scheduleState,
}))

const permState = { can: (_p: string) => true }
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => permState,
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (sel: unknown) => {
    const state = { user: { id: 1 }, isAuthenticated: true }
    return typeof sel === 'function' ? (sel as (s: typeof state) => unknown)(state) : state
  },
}))

vi.mock('@/components/views/tasks/TaskDetailDrawer', () => ({
  TaskDetailDrawer: () => null,
}))
vi.mock('@/components/views/calendar/schedule/MilestoneDetailDialog', () => ({
  MilestoneDetailDialog: () => null,
}))

import { ScheduleCalendar } from '@/components/views/calendar/schedule/ScheduleCalendar'

function taskItem(name: string, start: string, end: string, sourceId = 1): CalendarItem {
  return {
    id: `task-${sourceId}`,
    kind: 'task',
    sourceId,
    projectId: 1,
    name,
    status: 'in_progress',
    priority: 'high',
    assignee: null,
    dateRange: { start, end, isSpan: start !== end, missingStart: false, missingEnd: false },
    isMultiDay: start !== end,
    isOverdue: false,
    detailUrl: `/projects/1/tasks/${sourceId}`,
  }
}

function wrapper({ children }: PropsWithChildren) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const baseFilters = { view: 'month' as const, anchorDate: '2026-07-15', mode: 'schedule' as const }

describe('ScheduleCalendar container', () => {
  test('renders derived items, unscheduled count and item-type filter', () => {
    scheduleState.data = {
      data: [taskItem('排程任务', '2026-07-10', '2026-07-14')],
      meta: { total: 1, page: 1, perPage: 200, totalPages: 1, unscheduledCount: 3 },
      workingCalendar: { workdays: [1, 2, 3, 4, 5], holidays: [], extraWorkdays: [] },
    }
    render(<ScheduleCalendar projectId={1} filters={baseFilters} onFiltersChange={vi.fn()} />, {
      wrapper,
    })
    expect(screen.getAllByText('排程任务').length).toBeGreaterThanOrEqual(1)
    // 无日期任务面板显示真实计数
    expect(screen.getByText('无日期任务（3）')).toBeTruthy()
    // item 类型筛选组
    expect(screen.getByRole('group', { name: '按日历项类型筛选' })).toBeTruthy()
  })

  test('shows truncation notice when meta.truncated', () => {
    scheduleState.data = {
      data: [taskItem('任务', '2026-07-10', '2026-07-14')],
      meta: { total: 500, page: 1, perPage: 200, totalPages: 3, truncated: true },
      workingCalendar: { workdays: [1, 2, 3, 4, 5], holidays: [], extraWorkdays: [] },
    }
    render(<ScheduleCalendar projectId={1} filters={baseFilters} onFiltersChange={vi.fn()} />, {
      wrapper,
    })
    expect(screen.getByText(/仅显示当前页/)).toBeTruthy()
  })

  test('read-only user sees a notice and no reschedule affordance', () => {
    permState.can = () => false
    scheduleState.data = {
      data: [taskItem('任务', '2026-07-10', '2026-07-14')],
      meta: { total: 1, page: 1, perPage: 200, totalPages: 1, unscheduledCount: 0 },
      workingCalendar: { workdays: [1, 2, 3, 4, 5], holidays: [], extraWorkdays: [] },
    }
    render(<ScheduleCalendar projectId={1} filters={baseFilters} onFiltersChange={vi.fn()} />, {
      wrapper,
    })
    expect(screen.getByText(/没有改期权限/)).toBeTruthy()
    permState.can = () => true
  })

  test('empty window shows empty state', () => {
    scheduleState.data = {
      data: [],
      meta: { total: 0, page: 1, perPage: 200, totalPages: 1, unscheduledCount: 0 },
      workingCalendar: { workdays: [1, 2, 3, 4, 5], holidays: [], extraWorkdays: [] },
    }
    render(<ScheduleCalendar projectId={1} filters={baseFilters} onFiltersChange={vi.fn()} />, {
      wrapper,
    })
    expect(screen.getByText('当前窗口没有排程项')).toBeTruthy()
  })
})
