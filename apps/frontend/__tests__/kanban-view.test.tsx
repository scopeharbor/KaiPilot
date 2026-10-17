import { DndContext } from '@dnd-kit/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TaskCard } from '@/components/views/tasks/TaskCard'
import { TaskDetailDrawer } from '@/components/views/tasks/TaskDetailDrawer'
import { useKanbanColumns } from '@/hooks/use-kanban'
import { KANBAN_COLUMNS, columnForStatus, kanbanApi } from '@/lib/api/kanban'
import { projectMembersApi } from '@/lib/api/projects'
import { tasksApi, type Task } from '@/lib/api/tasks'
import { canTransition } from '@/lib/task-status'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '7' }),
  usePathname: () => '/projects/7/tasks',
}))

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: ['task:view', 'task:create', 'task:update'],
    can: () => true,
    canAny: () => true,
    canAll: () => true,
  }),
}))

vi.mock('@/hooks/use-organization-dashboard', () => ({
  useCurrentOrganizationId: () => 1,
}))

const task: Task = {
  id: 11,
  projectId: 7,
  name: '整理发布清单',
  description: '核对发布门禁与负责人',
  status: 'not_started',
  priority: 'high',
  taskType: 'task',
  startDate: null,
  endDate: '2026-07-08',
  actualStartDate: null,
  actualEndDate: null,
  durationDays: null,
  estimatedHours: 4,
  actualHours: null,
  progressPercent: 0,
  kanbanRank: 1024,
  assigneeId: 1,
  reviewerId: null,
  parentTaskId: null,
  wbsNodeId: null,
  milestoneId: null,
  costEstimateCents: null,
  costActualCents: null,
  customFields: null,
  assignee: { id: 1, fullName: '项目经理', email: 'pm@example.com', initials: 'PM' },
  createdAt: '2026-07-05T00:00:00.000Z',
  updatedAt: null,
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function TestWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function login() {
  const permissions = ['task:view', 'task:create', 'task:update']
  useAuthStore.getState().setSession({
    user: {
      id: 1,
      fullName: '项目经理',
      email: 'pm@example.com',
      isSuperAdmin: true,
      organizations: [{ id: 1, name: '组织', slug: 'org', role: 'owner' }],
    },
    accessToken: accessTokenWith(permissions, {
      organizationId: 1,
    }),
    refreshToken: 'refresh',
  })
  useAuthStore.setState({ permissions, currentOrganizationId: 1, isAuthenticated: true })
}

describe('Kanban view', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useAuthStore.getState().clear()
  })

  test('status mapping and transition table preserve the six-state model', () => {
    expect(KANBAN_COLUMNS).toHaveLength(4)
    expect(columnForStatus('blocked')).toBe('other')
    expect(columnForStatus('cancelled')).toBe('other')
    expect(canTransition('not_started', 'in_progress')).toBe(true)
    expect(canTransition('not_started', 'completed')).toBe(false)
  })

  test('column hook issues four independent paginated queries', async () => {
    login()
    const list = vi
      .spyOn(kanbanApi, 'listColumn')
      .mockImplementation(async (_projectId, column) => ({
        data: column === 'pending' ? [task] : [],
        meta: { total: column === 'pending' ? 1 : 0, page: 1, perPage: 25, totalPages: 1 },
      }))
    const { result } = renderHook(
      () =>
        useKanbanColumns(
          7,
          { search: '发布', perPage: 25 },
          { pending: 1, in_progress: 1, completed: 1, other: 1 },
        ),
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(result.current.every((query) => query.isSuccess)).toBe(true))
    expect(list).toHaveBeenCalledTimes(4)
    expect(list).toHaveBeenCalledWith(7, 'pending', {
      search: '发布',
      perPage: 25,
      page: 1,
    })
  })

  test('TaskCard 整卡即拖动手柄，点击打开详情', () => {
    const onOpen = vi.fn()
    render(
      <DndContext>
        <TaskCard task={task} onOpen={onOpen} />
      </DndContext>,
    )
    // 整张卡片是可拖动手柄（dnd-kit attributes 赋 role=button）+ 点击打开详情。
    const card = screen.getByRole('button', { name: `任务：${task.name}` })
    expect(card).toBeInTheDocument()
    fireEvent.click(card)
    expect(onOpen).toHaveBeenCalledWith(task.id)
    // 卡片正面不再显示全局 #id 编号。
    expect(screen.queryByText(`#${task.id}`)).not.toBeInTheDocument()
    expect(screen.getByText('项目经理')).toBeInTheDocument()
  })

  test('TaskDetailDrawer loads the latest task by id and keeps context on close', async () => {
    vi.spyOn(tasksApi, 'get').mockResolvedValue(task)
    const onOpenChange = vi.fn()
    render(<TaskDetailDrawer projectId={7} taskId={task.id} onOpenChange={onOpenChange} />, {
      wrapper: wrapper(),
    })
    expect(await screen.findByText(task.description!)).toBeInTheDocument()
    expect(tasksApi.get).toHaveBeenCalledWith(7, task.id)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('page renders four real columns and quick creation uses the column status', async () => {
    login()
    vi.spyOn(projectMembersApi, 'list').mockResolvedValue([])
    vi.spyOn(kanbanApi, 'listColumn').mockImplementation(async (_projectId, column) => ({
      data: column === 'pending' ? [task] : [],
      meta: { total: column === 'pending' ? 1 : 0, page: 1, perPage: 25, totalPages: 1 },
    }))
    const create = vi.spyOn(tasksApi, 'create').mockResolvedValue(task)
    const { default: KanbanPage } =
      await import('@/app/(dashboard)/projects/[id]/(views)/kanban/page')
    render(<KanbanPage />, { wrapper: wrapper() })

    expect(await screen.findByRole('heading', { name: '待处理' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '进行中' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '已完成' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '其他' })).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: '快速创建' })[0]!)
    fireEvent.change(screen.getByPlaceholderText('任务名称'), {
      target: { value: '新待办' },
    })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(7, { name: '新待办', status: 'not_started' }),
    )
  })
})
