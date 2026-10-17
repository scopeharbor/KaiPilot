import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type PropsWithChildren, type ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TaskListTable } from '@/components/views/list/TaskListTable'
import { taskListViewApi, buildTaskListViewQuery, type ListSortTerm } from '@/lib/api/list-view'
import { projectMembersApi } from '@/lib/api/projects'
import { tasksApi, type Task } from '@/lib/api/tasks'
import { parseListViewState, serializeListViewState } from '@/lib/list-view-state'
import { useAuthStore } from '@/stores/auth-store'
import { useUiStore } from '@/stores/ui-store'
import { accessTokenWith } from './_jwt-helper'
// 页面模块静态预载：本机 Windows + vitest 下，首次动态 import 大型页面模块图可能
// 挂起（模块求值竞态，与页面代码无关，见任务「让前端三闸门全绿」QA 记录），
// 提前把模块图载入缓存即可稳定复现/验证页面行为。
import '@/app/(dashboard)/projects/[id]/(views)/list/page'

const replace = vi.fn()
const push = vi.fn()
let search = ''

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '7' }),
  usePathname: () => '/projects/7/list',
  useRouter: () => ({ replace, push }),
  useSearchParams: () => new URLSearchParams(search),
}))

vi.mock('@/components/PermissionGuard', () => ({
  PermissionGuard: ({ children }: { children: ReactNode }) => <>{children}</>,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const task: Task = {
  id: 11,
  projectId: 7,
  name: '发布验收',
  description: '核对发布清单',
  status: 'in_progress',
  priority: 'high',
  taskType: 'task',
  startDate: '2026-07-01',
  endDate: '2026-07-04',
  actualStartDate: null,
  actualEndDate: null,
  durationDays: 3,
  estimatedHours: 8,
  actualHours: 5,
  progressPercent: 60,
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

function wrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return function TestWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function login() {
  useAuthStore.getState().setSession({
    user: {
      id: 1,
      fullName: '项目经理',
      email: 'pm@example.com',
      organizations: [{ id: 1, name: '组织', slug: 'org', role: 'owner' }],
    },
    accessToken: accessTokenWith(
      ['task:view', 'task:create', 'task:update', 'task:assign', 'task:delete'],
      { organizationId: 1 },
    ),
    refreshToken: 'refresh',
  })
}

describe('List view', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    replace.mockReset()
    push.mockReset()
    search = ''
    useAuthStore.getState().clear()
    useUiStore.setState({ density: 'comfortable' })
  })

  test('URL state sanitizes invalid input and serializes only non-default values', () => {
    const state = parseListViewState(
      new URLSearchParams(
        'status=in_progress,unknown&priority=high&assigneeId=2,2,-1&sort=-priority,%2Bname,%2Bpriority,%2Bunknown&page=2&perPage=100',
      ),
    )
    expect(state).toMatchObject({
      statuses: ['in_progress'],
      priorities: ['high'],
      assigneeIds: [2],
      sort: ['-priority', '+name'],
      page: 2,
      perPage: 100,
    })
    expect(serializeListViewState(state)).toContain('sort=-priority%2C%2Bname')
    expect(serializeListViewState(parseListViewState(new URLSearchParams()))).toBe('')
  })

  test('API query keeps arrays bounded and URL-encodes positive sort prefixes', () => {
    const query = buildTaskListViewQuery({
      statuses: ['not_started', 'in_progress'],
      priorities: ['high'],
      assigneeIds: [1, 3],
      sort: ['+priority', '-name'],
      page: 2,
      perPage: 100,
    })
    expect(query).toBe(
      '?status=not_started%2Cin_progress&priority=high&assigneeId=1%2C3&sort=%2Bpriority%2C-name&page=2&perPage=100',
    )
  })

  test('virtual table exposes sortable headers, compact rows, selection and details', () => {
    const onOpen = vi.fn()
    const onToggle = vi.fn()
    const rows = Array.from({ length: 100 }, (_, index) => ({
      ...task,
      id: task.id + index,
      name: index === 0 ? task.name : `任务 ${index + 1}`,
    }))
    useUiStore.setState({ density: 'compact' })

    function Harness() {
      const [sort, setSort] = useState<ListSortTerm[]>(['+name'])
      return (
        <TaskListTable
          rows={rows}
          sort={sort}
          selectedIds={new Set()}
          onSortChange={setSort}
          onToggle={onToggle}
          onTogglePage={vi.fn()}
          onOpen={onOpen}
        />
      )
    }

    const { container } = render(<Harness />)
    expect(screen.getByRole('table', { name: '项目任务列表' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: '项目任务列表' })).toHaveAttribute(
      'aria-rowcount',
      '101',
    )
    expect(container.querySelectorAll('[data-task-id]').length).toBeLessThan(40)
    expect(screen.getByRole('columnheader', { name: '任务' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    fireEvent.click(screen.getByRole('button', { name: '任务' }))
    expect(screen.getByRole('columnheader', { name: '任务' })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    fireEvent.click(screen.getByRole('checkbox', { name: `选择任务：${task.name}` }))
    expect(onToggle).toHaveBeenCalledWith(task.id, true)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(task.name) }))
    expect(onOpen).toHaveBeenCalledWith(task.id)
    expect(container.querySelector('[data-task-id="11"]')).toHaveStyle({ minHeight: '36px' })
    expect(screen.getAllByText(/逾期/).length).toBeGreaterThan(0)
  })

  test('page loads real rows, creates a task, opens shared details and invalidates task views', async () => {
    login()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue()
    vi.spyOn(projectMembersApi, 'list').mockResolvedValue([])
    vi.spyOn(taskListViewApi, 'list').mockResolvedValue({
      data: [task],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    })
    const create = vi.spyOn(tasksApi, 'create').mockResolvedValue(task)
    vi.spyOn(tasksApi, 'get').mockResolvedValue(task)
    const { default: ListPage } = await import('@/app/(dashboard)/projects/[id]/(views)/list/page')
    render(<ListPage />, { wrapper: wrapper(client) })

    expect(await screen.findByRole('heading', { name: '任务列表' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: new RegExp(task.name) })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '新任务名称' }), {
      target: { value: '补充回归测试' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith(7, { name: '补充回归测试' }))
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['tasks', 'view', 7],
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: new RegExp(task.name) }))
    expect(await screen.findByText(task.description!)).toBeInTheDocument()
    expect(tasksApi.get).toHaveBeenCalledWith(7, task.id)
  })

  test('page shows filtered-empty state', async () => {
    login()
    search = 'status=completed'
    vi.spyOn(projectMembersApi, 'list').mockResolvedValue([])
    vi.spyOn(taskListViewApi, 'list').mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 50, totalPages: 0 },
    })
    const { default: ListPage } = await import('@/app/(dashboard)/projects/[id]/(views)/list/page')
    render(<ListPage />, { wrapper: wrapper() })
    expect(await screen.findByText('没有符合条件的任务')).toBeInTheDocument()
  })

  test('page shows request-error state with recovery', async () => {
    login()
    search = 'status=completed'
    vi.spyOn(projectMembersApi, 'list').mockResolvedValue([])
    const list = vi.spyOn(taskListViewApi, 'list')
    list.mockRejectedValueOnce(new Error('network')).mockResolvedValue({
      data: [task],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    })
    const { default: ListPage } = await import('@/app/(dashboard)/projects/[id]/(views)/list/page')
    render(<ListPage />, { wrapper: wrapper() })
    expect(await screen.findByText('任务列表加载失败')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('button', { name: new RegExp(task.name) })).toBeInTheDocument()
    expect(list).toHaveBeenCalled()
  })
})
