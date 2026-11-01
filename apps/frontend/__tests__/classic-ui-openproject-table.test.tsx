/**
 * v3-classic-ui-openproject-table —— 旧版任务表格的 OpenProject 式配置视图与行内编辑。
 *
 * 覆盖：
 * - 列配置（固定列 + 可选列、开始日期、本机持久化与脏数据清洗）
 * - 分组（服务端整份结果计数、组头、折叠）与合计行
 * - 行内编辑（优先级 / 状态合法流转 / 负责人 / 截止日期；无权限只读）
 * - 列表页：工具列菜单驱动 API 参数，行内编辑走正确接口并显示依赖提示
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PropsWithChildren, ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TaskListTable, type TaskListTableProps } from '@/components/views/list/TaskListTable'
import { buildTaskListViewQuery, taskListViewApi } from '@/lib/api/list-view'
import { projectMembersApi } from '@/lib/api/projects'
import { tasksApi, type Task } from '@/lib/api/tasks'
import { useAuthStore } from '@/stores/auth-store'
import {
  DEFAULT_TASK_TABLE_COLUMNS,
  TASK_TABLE_STORE_KEY,
  useTaskTableStore,
} from '@/stores/task-table-store'
import { accessTokenWith } from './_jwt-helper'
import '@/app/(dashboard)/projects/[id]/(views)/list/page'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '7' }),
  usePathname: () => '/projects/7/list',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

vi.mock('@/components/PermissionGuard', () => ({
  PermissionGuard: ({ children }: { children: ReactNode }) => <>{children}</>,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const base: Task = {
  id: 11,
  projectId: 7,
  name: '发布验收',
  description: null,
  status: 'in_progress',
  priority: 'medium',
  taskType: 'task',
  startDate: '2026-07-01',
  endDate: '2099-07-04',
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

const rows: Task[] = [
  { ...base, id: 1, name: '待办一', status: 'not_started', assigneeId: null, assignee: undefined },
  { ...base, id: 2, name: '进行一', status: 'in_progress' },
  { ...base, id: 3, name: '进行二', status: 'in_progress' },
]

function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
}

function renderTable(props: Partial<TaskListTableProps> = {}) {
  return render(
    <TaskListTable
      rows={rows}
      sort={['+name']}
      selectedIds={new Set()}
      onSortChange={vi.fn()}
      onToggle={vi.fn()}
      onTogglePage={vi.fn()}
      onOpen={vi.fn()}
      {...props}
    />,
  )
}

function login(permissions: string[]) {
  useAuthStore.getState().setSession({
    user: {
      id: 1,
      fullName: '项目经理',
      email: 'pm@example.com',
      organizations: [{ id: 1, name: '组织', slug: 'org', role: 'owner' }],
    },
    accessToken: accessTokenWith(permissions, { organizationId: 1 }),
    refreshToken: 'refresh',
  })
}

function wrapper(client: QueryClient) {
  return function TestWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  useTaskTableStore.getState().reset()
})

describe('表格偏好', () => {
  test('默认显示除开始日期外的可选列；显隐按固定顺序', () => {
    expect(useTaskTableStore.getState().columns).toEqual([...DEFAULT_TASK_TABLE_COLUMNS])
    expect(DEFAULT_TASK_TABLE_COLUMNS).not.toContain('startDate')
    act(() => {
      useTaskTableStore.getState().setColumnVisible('estimatedHours', false)
      useTaskTableStore.getState().setColumnVisible('startDate', true)
    })
    expect(useTaskTableStore.getState().columns).toEqual([
      'priority',
      'status',
      'assignee',
      'startDate',
      'progressPercent',
      'endDate',
    ])
  })

  test('本机脏数据：未知列与分组被丢弃', async () => {
    localStorage.setItem(
      TASK_TABLE_STORE_KEY,
      JSON.stringify({
        state: { columns: ['status', 'evil', 'priority'], groupBy: 'name', showSums: 'yes' },
        version: 1,
      }),
    )
    await useTaskTableStore.persist.rehydrate()
    const state = useTaskTableStore.getState()
    expect(state.columns).toEqual(['priority', 'status'])
    expect(state.groupBy).toBeNull()
    expect(state.showSums).toBe(false)
  })

  test('分组与合计进入列表查询参数', () => {
    expect(buildTaskListViewQuery({ groupBy: 'status', sums: true })).toBe('?groupBy=status&sums=1')
    expect(buildTaskListViewQuery({})).toBe('')
  })
})

describe('TaskListTable', () => {
  test('列配置：隐藏工时、显示开始日期', () => {
    renderTable({ columns: ['priority', 'status', 'startDate'] })
    expect(screen.queryByRole('columnheader', { name: /工时/ })).toBeNull()
    expect(screen.getByRole('columnheader', { name: '开始日期' })).toBeInTheDocument()
    expect(screen.getAllByText('2026/7/1').length).toBeGreaterThan(0)
  })

  test('分组：组头显示整份结果数量，折叠后隐藏该组任务行', () => {
    const { container } = renderTable({
      groupBy: 'status',
      groups: [
        { key: 'not_started', count: 4, estimatedHours: 0, actualHours: 0 },
        { key: 'in_progress', count: 9, estimatedHours: 20, actualHours: 6 },
      ],
    })
    const header = container.querySelector('[data-task-group="in_progress"]') as HTMLElement
    expect(within(header).getByText('进行中')).toBeInTheDocument()
    expect(within(header).getByText('9 项')).toBeInTheDocument()
    expect(container.querySelector('[data-task-group="not_started"]')).not.toBeNull()
    expect(container.querySelector('[data-task-id="2"]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '折叠分组：进行中' }))
    expect(container.querySelector('[data-task-id="2"]')).toBeNull()
    expect(container.querySelector('[data-task-id="3"]')).toBeNull()
    expect(container.querySelector('[data-task-id="1"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: '展开分组：进行中' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  test('负责人分组：未分配单独成组，名称取项目成员', () => {
    const { container } = renderTable({
      groupBy: 'assignee',
      memberNames: new Map([[1, '张经理']]),
    })
    expect(
      within(container.querySelector('[data-task-group="null"]') as HTMLElement).getByText(
        '未分配',
      ),
    ).toBeInTheDocument()
    expect(
      within(container.querySelector('[data-task-group="1"]') as HTMLElement).getByText('张经理'),
    ).toBeInTheDocument()
  })

  test('合计行显示服务端整份结果的合计', () => {
    const { container } = renderTable({
      sums: { count: 5, estimatedHours: 11.5, actualHours: 2.5, progressPercent: 44 },
    })
    const sums = container.querySelector('[data-task-table-sums]') as HTMLElement
    expect(within(sums).getByText('合计 · 5 项')).toBeInTheDocument()
    expect(within(sums).getByText('平均 44%')).toBeInTheDocument()
    expect(within(sums).getByLabelText('实际合计 2.5h，预计合计 11.5h')).toBeInTheDocument()
  })

  test('行内编辑：优先级、状态只列合法流转、负责人、截止日期', () => {
    const onEdit = vi.fn()
    renderTable({
      editing: {
        canUpdate: true,
        canAssign: true,
        members: [
          [1, '项目经理'],
          [2, '开发甲'],
        ],
        pendingTaskIds: new Set(),
        onEdit,
      },
    })

    fireEvent.click(screen.getAllByRole('button', { name: '编辑优先级：中' })[0]!)
    fireEvent.change(screen.getByRole('combobox', { name: '优先级' }), {
      target: { value: 'high' },
    })
    expect(onEdit).toHaveBeenLastCalledWith(rows[0], { priority: 'high' })

    fireEvent.click(screen.getByRole('button', { name: '编辑状态：待处理' }))
    const status = screen.getByRole('combobox', { name: '状态' })
    expect(
      within(status)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['待处理', '进行中', '已取消'])
    fireEvent.change(status, { target: { value: 'in_progress' } })
    expect(onEdit).toHaveBeenLastCalledWith(rows[0], { status: 'in_progress' })

    fireEvent.click(screen.getAllByRole('button', { name: '编辑负责人：项目经理' })[0]!)
    fireEvent.change(screen.getByRole('combobox', { name: '负责人' }), {
      target: { value: '' },
    })
    expect(onEdit).toHaveBeenLastCalledWith(rows[1], { assigneeId: null })

    fireEvent.click(screen.getAllByRole('button', { name: /^编辑计划截止：/ })[0]!)
    const date = screen.getByLabelText('计划截止')
    fireEvent.change(date, { target: { value: '2099-08-01' } })
    fireEvent.keyDown(date, { key: 'Enter' })
    expect(onEdit).toHaveBeenLastCalledWith(rows[0], { endDate: '2099-08-01' })
  })

  test('Esc 取消编辑，不提交', () => {
    const onEdit = vi.fn()
    renderTable({
      editing: {
        canUpdate: true,
        canAssign: false,
        members: [],
        pendingTaskIds: new Set(),
        onEdit,
      },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /^编辑计划截止：/ })[0]!)
    const date = screen.getByLabelText('计划截止')
    fireEvent.change(date, { target: { value: '2099-08-01' } })
    fireEvent.keyDown(date, { key: 'Escape' })
    expect(onEdit).not.toHaveBeenCalled()
    // 无 task:assign：负责人只读
    expect(screen.queryByRole('button', { name: /^编辑负责人/ })).toBeNull()
  })

  test('无编辑权限时单元格只读', () => {
    renderTable()
    expect(screen.queryByRole('button', { name: /^编辑/ })).toBeNull()
  })
})

describe('列表页', () => {
  async function renderPage(permissions: string[]) {
    login(permissions)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(projectMembersApi, 'list').mockResolvedValue([])
    const list = vi.spyOn(taskListViewApi, 'list').mockResolvedValue({
      data: rows,
      meta: {
        total: 3,
        page: 1,
        perPage: 50,
        totalPages: 1,
        groups: [
          { key: 'not_started', count: 1, estimatedHours: 8, actualHours: 5 },
          { key: 'in_progress', count: 2, estimatedHours: 16, actualHours: 10 },
        ],
        sums: { count: 3, estimatedHours: 24, actualHours: 15, progressPercent: 60 },
      },
    })
    const { default: ListPage } = await import('@/app/(dashboard)/projects/[id]/(views)/list/page')
    const utils = render(<ListPage />, { wrapper: wrapper(client) })
    await screen.findByText('进行一')
    return { list, ...utils }
  }

  test('工具列菜单：列、分组、合计驱动表格与查询参数', async () => {
    const { list, container } = await renderPage(['task:view', 'task:update'])
    expect(list).toHaveBeenLastCalledWith(7, expect.not.objectContaining({ groupBy: 'status' }))

    openMenu(screen.getByRole('button', { name: '列' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '工时' }))
    expect(screen.queryByRole('columnheader', { name: /工时/ })).toBeNull()
    expect(useTaskTableStore.getState().columns).not.toContain('estimatedHours')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    openMenu(screen.getByRole('button', { name: '分组' }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '状态' }))
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(7, expect.objectContaining({ groupBy: 'status' })),
    )
    expect(await screen.findByRole('button', { name: '分组：状态' })).toBeInTheDocument()
    await waitFor(() =>
      expect(container.querySelector('[data-task-group="in_progress"]')).not.toBeNull(),
    )

    fireEvent.click(screen.getByRole('button', { name: '合计' }))
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(7, expect.objectContaining({ sums: true })),
    )
    expect(screen.getByRole('button', { name: '合计' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('合计 · 3 项')).toBeInTheDocument()
  })

  test('行内编辑走正确接口并显示依赖顺延提示', async () => {
    const update = vi
      .spyOn(tasksApi, 'updateWithWarnings')
      .mockResolvedValue({ task: rows[1]!, warnings: ['已按依赖自动顺延 2 个后续任务'] })
    const changeStatus = vi.spyOn(tasksApi, 'changeStatus').mockResolvedValue(rows[0]!)
    await renderPage(['task:view', 'task:update'])

    fireEvent.click(screen.getAllByRole('button', { name: '编辑优先级：中' })[1]!)
    fireEvent.change(screen.getByRole('combobox', { name: '优先级' }), {
      target: { value: 'high' },
    })
    await waitFor(() => expect(update).toHaveBeenCalledWith(7, 2, { priority: 'high' }))
    expect(await screen.findByText('已按依赖自动顺延 2 个后续任务')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '编辑状态：待处理' }))
    fireEvent.change(screen.getByRole('combobox', { name: '状态' }), {
      target: { value: 'in_progress' },
    })
    await waitFor(() => expect(changeStatus).toHaveBeenCalledWith(7, 1, { status: 'in_progress' }))
    // 没有 task:assign：负责人只读
    expect(screen.queryByRole('button', { name: /^编辑负责人/ })).toBeNull()
  })

  test('行内修改失败显示错误', async () => {
    vi.spyOn(tasksApi, 'updateWithWarnings').mockRejectedValue({ message: '截止日期早于开始日期' })
    await renderPage(['task:view', 'task:update'])
    fireEvent.click(screen.getAllByRole('button', { name: '编辑优先级：中' })[0]!)
    fireEvent.change(screen.getByRole('combobox', { name: '优先级' }), {
      target: { value: 'low' },
    })
    expect(await screen.findByText('任务 #1 未更新：截止日期早于开始日期')).toBeInTheDocument()
  })

  test('只读成员看不到编辑入口', async () => {
    await renderPage(['task:view'])
    expect(screen.queryByRole('button', { name: /^编辑/ })).toBeNull()
  })
})
