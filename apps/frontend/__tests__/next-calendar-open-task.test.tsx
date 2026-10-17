/**
 * 日历镜头：点任务打开详情，聚焦任务（?focusTask= / AI「带我去」）自动翻到它的月份。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { CalendarItem } from '@/lib/calendar-types'
import { WorkspaceCalendarLens } from '@/components/next/lenses/WorkspaceCalendarLens'

const PROJECT_ID = 7
const monthDatasets = new Map<string, CalendarItem[]>()
const requestedMonths: string[] = []

vi.mock('@/hooks/use-calendar', () => ({
  useProjectCalendarSchedule: (_projectId: number, filters: { anchorDate: string }) => {
    const month = filters.anchorDate.slice(0, 7)
    requestedMonths.push(month)
    return {
      data: {
        data: monthDatasets.get(month) ?? [],
        meta: { total: 0, page: 1, perPage: 200, totalPages: 1 },
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isPlaceholderData: false,
    }
  },
}))

const getTask = vi.fn()
vi.mock('@/lib/api/tasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/tasks')>()
  return {
    ...actual,
    tasksApi: { ...actual.tasksApi, get: (...args: unknown[]) => getTask(...args) },
  }
})

function item(
  sourceId: number,
  name: string,
  start: string,
  end = start,
  kind: 'task' | 'milestone' = 'task',
): CalendarItem {
  return {
    id: `${kind}-${sourceId}`,
    kind,
    sourceId,
    projectId: PROJECT_ID,
    name,
    status: kind === 'milestone' ? 'planned' : 'in_progress',
    assignee: null,
    dateRange: { start, end, isSpan: start !== end, missingStart: false, missingEnd: false },
    isMultiDay: start !== end,
    isOverdue: false,
    detailUrl: `/projects/${PROJECT_ID}/tasks/${sourceId}`,
  }
}

function renderLens(props: Partial<React.ComponentProps<typeof WorkspaceCalendarLens>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceCalendarLens
        projectId={PROJECT_ID}
        today="2026-09-17"
        initialAnchorDate="2026-09-15"
        {...props}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  monthDatasets.clear()
  requestedMonths.length = 0
  getTask.mockReset()
})

describe('日历镜头：点任务打开详情', () => {
  test('单日任务、跨日条带都可点击（含键盘 Enter），里程碑不响应', () => {
    monthDatasets.set('2026-09', [
      item(11, '登录页开发', '2026-09-10'),
      item(12, '注册流程', '2026-09-14', '2026-09-16'),
      item(13, '上线评审', '2026-09-20', '2026-09-20', 'milestone'),
    ])
    const onOpenTask = vi.fn()
    const { container } = renderLens({ onOpenTask })

    fireEvent.click(screen.getByText('登录页开发'))
    expect(onOpenTask).toHaveBeenLastCalledWith(11)

    const middle = container.querySelector<HTMLElement>(
      '[data-calendar-item][data-span-edge="middle"]',
    )!
    fireEvent.click(middle)
    expect(onOpenTask).toHaveBeenLastCalledWith(12)

    fireEvent.keyDown(screen.getByText('登录页开发').closest('[role="button"]')!, {
      key: 'Enter',
    })
    expect(onOpenTask).toHaveBeenCalledTimes(3)

    fireEvent.click(screen.getByText('上线评审'))
    expect(onOpenTask).toHaveBeenCalledTimes(3)
  })

  test('「+N 项」当日面板里点任务：打开详情，面板保留', () => {
    monthDatasets.set(
      '2026-09',
      [1, 2, 3, 4, 5].map((n) => item(20 + n, `任务${n}`, '2026-09-08')),
    )
    const onOpenTask = vi.fn()
    const { container } = renderLens({ onOpenTask })
    fireEvent.click(container.querySelector('[data-calendar-overflow]')!)
    const panel = container.querySelector('[data-calendar-day-panel]')!
    fireEvent.click(panel.querySelectorAll('[data-calendar-day-panel-item]')[4]!)
    expect(onOpenTask).toHaveBeenCalledWith(25)
    expect(container.querySelector('[data-calendar-day-panel]')).not.toBeNull()
  })
})

describe('日历镜头：聚焦任务自动翻月', () => {
  test('聚焦任务在 11 月 → 日历翻到 11 月并高亮该任务', async () => {
    monthDatasets.set('2026-11', [item(42, '验收测试', '2026-11-03')])
    getTask.mockResolvedValue({ id: 42, startDate: '2026-11-03', endDate: '2026-11-05' })
    const { container } = renderLens({ focusTaskId: 42, onOpenTask: vi.fn() })

    await waitFor(() =>
      expect(container.querySelector('[data-calendar-month-title]')?.textContent).toContain('11'),
    )
    expect(getTask).toHaveBeenCalledWith(PROJECT_ID, 42)
    expect(container.querySelector('[data-task-id="42"]')?.getAttribute('data-focused')).toBe(
      'true',
    )
  })

  test('翻过一次后用户可自由翻月，不会被拉回', async () => {
    monthDatasets.set('2026-11', [item(42, '验收测试', '2026-11-03')])
    getTask.mockResolvedValue({ id: 42, startDate: null, endDate: '2026-11-05' })
    const { container } = renderLens({ focusTaskId: 42 })
    await waitFor(() => expect(requestedMonths.at(-1)).toBe('2026-11'))

    fireEvent.click(container.querySelector('[data-calendar-next]')!)
    await waitFor(() => expect(requestedMonths.at(-1)).toBe('2026-12'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(requestedMonths.at(-1)).toBe('2026-12')
  })

  test('没有聚焦任务不请求任务详情', () => {
    renderLens()
    expect(getTask).not.toHaveBeenCalled()
  })
})
