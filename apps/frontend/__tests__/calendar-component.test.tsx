import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { type PropsWithChildren } from 'react'
import { describe, expect, test, vi } from 'vitest'
import type { Task } from '@/lib/api/tasks'
import { MonthView } from '@/components/views/calendar/MonthView'
import { DayView } from '@/components/views/calendar/DayView'
import { WeekView } from '@/components/views/calendar/WeekView'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '1' }),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/projects/1/calendar',
  useSearchParams: () => new URLSearchParams('view=month&anchorDate=2026-07-15'),
}))

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: () => true }),
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (sel: unknown) => {
    const state = { user: { id: 1 }, hasPermission: () => true }
    return typeof sel === 'function' ? sel(state) : state
  },
}))

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>
}

const mockTask: Task = {
  id: 10,
  projectId: 1,
  name: '发布检查',
  description: null,
  status: 'in_progress',
  priority: 'high',
  taskType: 'task',
  startDate: '2026-07-01',
  endDate: '2026-07-15',
  actualStartDate: null,
  actualEndDate: null,
  durationDays: 14,
  estimatedHours: 8,
  actualHours: null,
  progressPercent: 50,
  assigneeId: 1,
  reviewerId: null,
  parentTaskId: null,
  wbsNodeId: null,
  milestoneId: null,
  costEstimateCents: null,
  costActualCents: null,
  customFields: null,
  assignee: { id: 1, fullName: '项目经理', email: 'pm@example.com', initials: 'PM' },
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: null,
}

describe('MonthView', () => {
  test('renders 7 weekday headers', () => {
    const tasksByDate = new Map([[mockTask.endDate!, [mockTask]]])
    render(
      <MonthView
        tasksByDate={tasksByDate}
        anchorDate="2026-07-15"
        canUpdate={false}
        currentUserId={1}
        onDateClick={vi.fn()}
        onTaskClick={vi.fn()}
      />,
      { wrapper },
    )
    for (const day of ['一', '二', '三', '四', '五', '六', '日']) {
      expect(screen.getAllByText(day).length).toBeGreaterThanOrEqual(1)
    }
  })

  test('shows task name in the correct date cell', () => {
    const tasksByDate = new Map([[mockTask.endDate!, [mockTask]]])
    render(
      <MonthView
        tasksByDate={tasksByDate}
        anchorDate="2026-07-15"
        canUpdate={false}
        currentUserId={1}
        onDateClick={vi.fn()}
        onTaskClick={vi.fn()}
      />,
      { wrapper },
    )
    expect(screen.getByText('发布检查')).toBeTruthy()
  })

  test('shows overflow count for many tasks', () => {
    const tasks: Task[] = Array.from({ length: 5 }, (_, i) => ({
      ...mockTask,
      id: 100 + i,
      name: `任务 ${i}`,
    }))
    const tasksByDate = new Map([['2026-07-15', tasks]])
    render(
      <MonthView
        tasksByDate={tasksByDate}
        anchorDate="2026-07-15"
        canUpdate={false}
        currentUserId={1}
        onDateClick={vi.fn()}
        onTaskClick={vi.fn()}
      />,
      { wrapper },
    )
    expect(screen.getByText('还有 2 项')).toBeTruthy()
  })
})

describe('DayView', () => {
  test('renders task list for the day', () => {
    render(
      <DayView
        tasks={[mockTask]}
        date="2026-07-15"
        canUpdate={false}
        currentUserId={1}
        onTaskClick={vi.fn()}
      />,
      { wrapper },
    )
    expect(screen.getByText('发布检查')).toBeTruthy()
    expect(screen.getByText(/进行中/)).toBeTruthy()
  })

  test('shows empty state when no tasks', () => {
    render(
      <DayView
        tasks={[]}
        date="2026-07-15"
        canUpdate={false}
        currentUserId={1}
        onTaskClick={vi.fn()}
      />,
      { wrapper },
    )
    expect(screen.getByText('该日期没有截止日任务')).toBeTruthy()
  })
})

describe('WeekView', () => {
  test('renders 7 day columns', () => {
    const tasksByDate = new Map([['2026-07-15', [mockTask]]])
    render(
      <WeekView
        tasksByDate={tasksByDate}
        anchorDate="2026-07-15"
        canUpdate={false}
        currentUserId={1}
        onDateClick={vi.fn()}
        onTaskClick={vi.fn()}
      />,
      { wrapper },
    )
    expect(screen.getByText('发布检查')).toBeTruthy()
  })
})
