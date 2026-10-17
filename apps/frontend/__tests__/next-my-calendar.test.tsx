/**
 * 日历第 3 批：「我的日历」（跨项目、标休假、点任务跳项目、快速新建选项目）与「我的工作日历」设置。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { CalendarFullResponse } from '@/lib/calendar-types'
import { MyCalendarWorkspace } from '@/components/next/my-calendar/MyCalendarWorkspace'
import { PersonalWorkingCalendarEditor } from '@/components/next/settings/calendar/PersonalWorkingCalendarEditor'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  list: vi.fn(),
  getWorkingCalendar: vi.fn(),
  updateWorkingCalendar: vi.fn(),
  suggest: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/next/my-calendar',
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}))
vi.mock('@/lib/api/calendar-display', () => ({
  calendarDisplayApi: { get: async () => ({ systems: ['solar'] }) },
  calendarDisplayKeys: { detail: (id: number | null) => ['calendar-display', id] },
}))
vi.mock('@/lib/api/my-calendar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/my-calendar')>()
  return {
    ...actual,
    myCalendarApi: {
      list: mocks.list,
      getWorkingCalendar: mocks.getWorkingCalendar,
      updateWorkingCalendar: mocks.updateWorkingCalendar,
    },
  }
})
vi.mock('@/lib/api/calendar-quick-create', () => ({
  calendarQuickCreateApi: { suggest: mocks.suggest, check: vi.fn() },
}))

function response(): CalendarFullResponse {
  const item = (
    id: number,
    projectId: number,
    projectName: string,
    name: string,
    date: string,
  ) => ({
    id: `task-${id}`,
    kind: 'task' as const,
    sourceId: id,
    projectId,
    projectName,
    name,
    status: 'in_progress',
    assignee: null,
    dateRange: { start: date, end: date, isSpan: false, missingStart: false, missingEnd: false },
    isMultiDay: false,
    isOverdue: false,
    detailUrl: '',
  })
  return {
    data: [
      item(11, 3, '食堂订餐', '订单导出接口', '2026-10-12'),
      item(12, 5, '官网改版', '首页改版', '2026-10-20'),
    ],
    meta: { total: 2, page: 1, perPage: 2, totalPages: 1, unscheduledCount: 0 },
    personalCalendar: {
      workdays: null,
      leaves: [{ id: 'a', startDate: '2026-10-15', endDate: '2026-10-16', note: '回老家' }],
    },
    projects: [
      { id: 3, name: '食堂订餐', code: null },
      { id: 5, name: '官网改版', code: null },
    ],
  }
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T09:00:00'))
  mocks.push.mockReset()
  mocks.list.mockReset().mockResolvedValue(response())
  mocks.suggest.mockReset().mockResolvedValue({
    tasks: [],
    note: null,
    source: 'rules',
    options: { members: [], workPackages: [] },
  })
  mocks.getWorkingCalendar.mockReset()
  mocks.updateWorkingCalendar.mockReset()
  try {
    window.localStorage.clear()
  } catch {
    // ignore
  }
})

describe('我的日历', () => {
  test('按整个月格查我的任务；标出休假；点任务跳到所在项目日历', async () => {
    const { container } = renderWithClient(<MyCalendarWorkspace />)
    await screen.findByText('订单导出接口')
    expect(mocks.list).toHaveBeenCalledWith('2026-09-28', '2026-11-01')
    expect(screen.getByText('首页改版')).toBeTruthy()

    const leaveCell = container.querySelector('[data-calendar-day][data-date="2026-10-15"]')!
    expect(leaveCell.querySelector('[data-calendar-personal-off]')!.getAttribute('title')).toBe(
      '休假：回老家',
    )
    expect(
      container.querySelector(
        '[data-calendar-day][data-date="2026-10-14"] [data-calendar-personal-off]',
      ),
    ).toBeNull()

    fireEvent.click(screen.getByText('订单导出接口'))
    expect(mocks.push).toHaveBeenCalledWith('/next/projects/3?lens=calendar&focusTask=11')
  })

  test('周视图显示项目名；快速新建在卡片里选项目并记住', async () => {
    const { container } = renderWithClient(<MyCalendarWorkspace />)
    await screen.findByText('订单导出接口')
    fireEvent.click(screen.getByRole('radio', { name: '周' }))
    expect(
      within(container.querySelector('[data-date="2026-10-12"]')!).getByText(/食堂订餐/),
    ).toBeTruthy()

    fireEvent.doubleClick(container.querySelector('[data-calendar-day][data-date="2026-10-13"]')!)
    const card = await screen.findByRole('dialog', { name: '快速新建任务' })
    const picker = within(card).getByLabelText('建在哪个项目') as HTMLSelectElement
    expect(picker.value).toBe('3')
    await waitFor(() =>
      expect(mocks.suggest).toHaveBeenCalledWith(3, expect.anything(), expect.anything()),
    )

    fireEvent.change(picker, { target: { value: '5' } })
    // 换项目后按新项目重新请模型建议
    await waitFor(() => expect(mocks.suggest.mock.calls.map((call) => call[0])).toEqual([3, 5]))
    expect(window.localStorage.getItem('aiproj.myCalendar.lastProject')).toBe('5')
  })
})

describe('我的工作日历设置', () => {
  test('加一段休假、设个人工作日、保存（提交清洗后的值）', async () => {
    mocks.getWorkingCalendar.mockResolvedValue({ workdays: null, leaves: [] })
    mocks.updateWorkingCalendar.mockImplementation(async (input) => input)
    renderWithClient(<PersonalWorkingCalendarEditor />)
    await screen.findByText('还没有休假。')
    const save = screen.getByRole('button', { name: /保存我的工作日历/ })
    expect(save).toBeDisabled()

    fireEvent.click(screen.getByText('加一段休假'))
    fireEvent.change(screen.getByLabelText('休假开始'), { target: { value: '2026-10-20' } })
    fireEvent.change(screen.getByLabelText('休假结束'), { target: { value: '2026-10-22' } })
    fireEvent.change(screen.getByLabelText('休假说明'), { target: { value: '年假' } })
    for (const day of [1, 2, 3]) {
      fireEvent.click(document.querySelector<HTMLElement>(`[data-personal-workday="${day}"]`)!)
    }
    fireEvent.click(save)
    await waitFor(() => expect(mocks.updateWorkingCalendar).toHaveBeenCalled())
    expect(mocks.updateWorkingCalendar.mock.calls[0]![0]).toEqual({
      workdays: [1, 2, 3],
      leaves: [{ id: 'new-1', startDate: '2026-10-20', endDate: '2026-10-22', note: '年假' }],
    })
  })
})
