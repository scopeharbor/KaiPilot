import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspaceKanbanBoard } from '@/components/next/project-space/WorkspaceKanbanBoard'
import { kanbanApi, type KanbanColumn } from '@/lib/api/kanban'
import type { Task } from '@/lib/api/tasks'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'

vi.mock('@/hooks/use-mobile-workspace', () => ({ useMobileWorkspace: () => true }))
vi.mock('@/components/next/project-space/TaskPlacementSlot', () => ({
  TaskPlacementSlot: () => null,
}))

const pending = {
  id: 1,
  projectId: 7,
  name: '手机待处理任务',
  status: 'not_started',
  priority: 'medium',
  progressPercent: 0,
  customFields: null,
  startDate: null,
  endDate: null,
  durationDays: null,
  estimatedHours: null,
  assigneeId: 1,
} as Task
const active = {
  ...pending,
  id: 2,
  name: '手机进行中任务',
  status: 'in_progress',
  progressPercent: 50,
} as Task
function mount(permissions: string[]) {
  useAuthStore.getState().setSession({
    user: {
      id: 1,
      email: 'phone@example.com',
      fullName: '手机测试',
      organizations: [{ id: 1, name: '组织', slug: 'org', role: 'owner' }],
    },
    accessToken: accessTokenWith(permissions, { organizationId: 1 }),
    refreshToken: 'fixture',
  })
  useAuthStore.setState({ permissions, currentOrganizationId: 1, isAuthenticated: true })
  const open = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <WorkspaceKanbanBoard projectId={7} onOpenTask={open} />
    </QueryClientProvider>,
  )
  return open
}
function nav(index: number) {
  fireEvent.click(
    within(screen.getByRole('group', { name: '任务状态' })).getAllByRole('button')[index]!,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  useAuthStore.getState().clear()
  const board: Record<KanbanColumn, Task[]> = {
    pending: [pending],
    in_progress: [active],
    completed: [],
    other: [],
  }
  vi.spyOn(kanbanApi, 'listColumn').mockImplementation(async (_, column) => ({
    data: board[column],
    meta: { total: board[column].length, page: 1, perPage: 25, totalPages: 1 },
  }))
})

describe('手机看板操作契约', () => {
  test('只读用户单列切换与键盘打开详情，零状态写请求', async () => {
    const move = vi.spyOn(kanbanApi, 'move')
    const open = mount(['task:view'])
    await screen.findByText(pending.name)
    expect(document.querySelectorAll('[data-kanban-column]')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '开始任务' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('button', { name: `任务：${pending.name}` }), {
      key: 'Enter',
    })
    expect(open).toHaveBeenCalledWith(1)
    nav(1)
    await screen.findByText(active.name)
    expect(screen.queryByText(pending.name)).not.toBeInTheDocument()
    expect(move).not.toHaveBeenCalled()
  })
  test('显式开始按钮使用既有状态移动 API，禁止直接跳到完成', async () => {
    const move = vi
      .spyOn(kanbanApi, 'move')
      .mockResolvedValue({ ...pending, status: 'in_progress' })
    mount(['task:view', 'task:update'])
    fireEvent.click(await screen.findByRole('button', { name: '开始任务' }))
    await waitFor(() =>
      expect(move).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          taskId: 1,
          targetColumn: 'in_progress',
          targetStatus: 'in_progress',
        }),
      ),
    )
    nav(0)
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: `调整状态：${pending.name}` }),
      ).toBeInTheDocument(),
    )
    expect(
      within(screen.getByRole('combobox', { name: `调整状态：${pending.name}` })).getByRole(
        'option',
        { name: '已完成' },
      ),
    ).toBeDisabled()
  })
  test('有进度退回需确认，取消恢复原卡且没有写请求', async () => {
    const move = vi.spyOn(kanbanApi, 'move')
    mount(['task:view', 'task:update'])
    await screen.findByText(pending.name)
    nav(1)
    fireEvent.click(await screen.findByRole('button', { name: '退回待处理' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(move).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '留在进行中' }))
    await screen.findByText(active.name)
    expect(move).not.toHaveBeenCalled()
  })
  test('状态保存失败呈现反馈并恢复服务器待处理任务', async () => {
    vi.spyOn(kanbanApi, 'move').mockRejectedValue(new Error('网络中断'))
    mount(['task:view', 'task:update'])
    fireEvent.click(await screen.findByRole('button', { name: '开始任务' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('网络中断'))
    await screen.findByText(pending.name)
  })
})
