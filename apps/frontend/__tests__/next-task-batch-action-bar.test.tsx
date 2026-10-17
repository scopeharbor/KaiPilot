/**
 * v3-ui-next-batch1-strategy-launch-tasks W3 任务 3.4
 * 浮动暗黑仪器感批量操作栏组件单元测试。
 *
 * 覆盖：
 * 1. 浮动操作栏在有选中任务时平滑滑出（selectedIds >= 1 呈现，0 项收起）；
 * 2. 批量变更状态发送包含目标 ID 的 POST batch 请求；
 * 3. 批量调整优先级发送包含目标 ID 的 POST batch 请求；
 * 4. 批量指派成员发送包含目标 ID 的 POST batch 请求；
 * 5. 批量移入回收站弹出二次确认弹窗，确认后发送 POST batch 请求；
 * 6. 权限防护：无 task:delete 时删除按钮置灰；无 task:update 时更新状态/优先级置灰。
 *
 * 硬约束遵循：
 * - 一律使用 vi.stubGlobal('fetch')，严禁 vi.mock('@/lib/api/*')；
 * - 集中失效网触发。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { TaskBatchActionBar } from '@/components/next/project-space/TaskBatchActionBar'
import type { ProjectMember } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'

const PROJECT_ID = 42

const MEMBERS: ProjectMember[] = [
  {
    id: 1,
    projectId: PROJECT_ID,
    userId: 88,
    projectRoleId: null,
    isActive: true,
    user: {
      id: 88,
      fullName: '李工程师',
      email: 'li@example.com',
      initials: '李',
      isActive: true,
    },
  },
  {
    id: 2,
    projectId: PROJECT_ID,
    userId: 99,
    projectRoleId: null,
    isActive: true,
    user: {
      id: 99,
      fullName: '王测试',
      email: 'wang@example.com',
      initials: '王',
      isActive: true,
    },
  },
]

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as unknown as Response
}

function renderBar(
  queryClient: QueryClient,
  props: Partial<React.ComponentProps<typeof TaskBatchActionBar>> = {},
) {
  const defaultProps = {
    projectId: PROJECT_ID,
    selectedIds: [10, 11, 12],
    members: MEMBERS,
    onClear: vi.fn(),
    onSuccess: vi.fn(),
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskBatchActionBar {...defaultProps} {...props} />
    </QueryClientProvider>,
  )
}

describe('TaskBatchActionBar 浮动批量操作栏（W3 任务 3.3 / 3.4）', () => {
  let queryClient: QueryClient
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    useAuthStore.setState({
      user: {
        id: 1,
        email: 'pm@example.com',
        fullName: '项目总监',
        organizations: [{ id: 1, name: '主组织', slug: 'main', role: 'admin' }],
      },
      currentOrganizationId: 1,
      permissions: ['task:view', 'task:create', 'task:update', 'task:delete', 'task:assign'],
      isAuthenticated: true,
      hasHydrated: true,
    })

    fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      return Promise.resolve(
        jsonResponse({
          action: body.action || 'update',
          total: body.taskIds?.length || 0,
          successCount: body.taskIds?.length || 0,
          failedCount: 0,
          results: (body.taskIds || []).map((id: number) => ({ taskId: id, success: true })),
        }),
      )
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('浮动操作栏仅在 selectedIds >= 1 时滑出，显示已选计数', () => {
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <TaskBatchActionBar projectId={PROJECT_ID} selectedIds={[]} onClear={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.queryByTestId('task-batch-action-bar')).toBeNull()

    rerender(
      <QueryClientProvider client={queryClient}>
        <TaskBatchActionBar projectId={PROJECT_ID} selectedIds={[10, 11, 12]} onClear={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('task-batch-action-bar')).toBeInTheDocument()
    expect(screen.getByText('已选择 3 项任务')).toBeInTheDocument()
  })

  test('批量变更状态：发送包含目标 ID 与状态的 POST batch 请求', async () => {
    const onClear = vi.fn()
    const onSuccess = vi.fn()
    renderBar(queryClient, { onClear, onSuccess })

    const select = screen.getByLabelText('选择批量目标状态')
    fireEvent.change(select, { target: { value: 'completed' } })

    const applyBtn = screen.getByLabelText('应用状态变更')
    fireEvent.click(applyBtn)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const firstCall = fetchMock.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [calledUrl, calledInit] = firstCall!
    expect(calledUrl).toContain(`/projects/${PROJECT_ID}/tasks/batch`)
    expect(calledInit.method).toBe('POST')

    const sentBody = JSON.parse(calledInit.body)
    expect(sentBody).toEqual({
      action: 'change_status',
      taskIds: [10, 11, 12],
      data: { status: 'completed' },
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  test('批量调整优先级：发送包含目标 ID 与优先级的 POST batch 请求', async () => {
    const onClear = vi.fn()
    const onSuccess = vi.fn()
    renderBar(queryClient, { onClear, onSuccess })

    const select = screen.getByLabelText('选择批量目标优先级')
    fireEvent.change(select, { target: { value: 'highest' } })

    const applyBtn = screen.getByLabelText('应用优先级调整')
    fireEvent.click(applyBtn)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const priorityCall = fetchMock.mock.calls[0]
    expect(priorityCall).toBeDefined()
    const [calledUrl, calledInit] = priorityCall!
    expect(calledUrl).toContain(`/projects/${PROJECT_ID}/tasks/batch`)
    const sentBody = JSON.parse(calledInit.body)
    expect(sentBody).toEqual({
      action: 'update',
      taskIds: [10, 11, 12],
      data: { priority: 'highest' },
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  test('批量指派成员：发送包含目标 ID 与指派人的 POST batch 请求', async () => {
    const onClear = vi.fn()
    const onSuccess = vi.fn()
    renderBar(queryClient, { onClear, onSuccess })

    const select = screen.getByLabelText('选择批量指派成员')
    fireEvent.change(select, { target: { value: '99' } })

    const applyBtn = screen.getByLabelText('应用指派成员')
    fireEvent.click(applyBtn)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const assignCall = fetchMock.mock.calls[0]
    expect(assignCall).toBeDefined()
    const [calledUrl, calledInit] = assignCall!
    expect(calledUrl).toContain(`/projects/${PROJECT_ID}/tasks/batch`)
    const sentBody = JSON.parse(calledInit.body)
    expect(sentBody).toEqual({
      action: 'reassign',
      taskIds: [10, 11, 12],
      data: { assigneeId: 99 },
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  test('批量移入回收站：弹出二次确认弹窗，确认后调用 batch delete', async () => {
    const onClear = vi.fn()
    const onSuccess = vi.fn()
    renderBar(queryClient, { onClear, onSuccess })

    // 1. 点击移入回收站按钮，弹出弹窗
    const deleteBtn = screen.getByLabelText('批量移入回收站')
    fireEvent.click(deleteBtn)

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('移入回收站确认')).toBeInTheDocument()
    expect(screen.getByText(/确定要将选中的 3 项任务移入回收站吗/)).toBeInTheDocument()

    // 2. 点击取消，弹窗关闭且零网络请求
    fireEvent.click(screen.getByTestId('batch-cancel-delete'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()

    // 3. 再次点击并点击确认移入
    fireEvent.click(deleteBtn)
    const confirmBtn = screen.getByText('确认移入')
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const deleteCall = fetchMock.mock.calls[0]
    expect(deleteCall).toBeDefined()
    const [calledUrl, calledInit] = deleteCall!
    expect(calledUrl).toContain(`/projects/${PROJECT_ID}/tasks/batch`)
    const sentBody = JSON.parse(calledInit.body)
    expect(sentBody).toEqual({
      action: 'delete',
      taskIds: [10, 11, 12],
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  test('权限防护：未具备 task:delete 时删除按钮置灰，未具备 task:update 时更新操作禁用', () => {
    // 降级为只读权限
    useAuthStore.setState({
      permissions: ['task:view'],
    })

    renderBar(queryClient)

    const deleteBtn = screen.getByLabelText('批量移入回收站')
    expect(deleteBtn).toBeDisabled()
    expect(deleteBtn).toHaveAttribute('title', '无删除权限')

    const statusSelect = screen.getByLabelText('选择批量目标状态')
    const applyStatusBtn = screen.getByLabelText('应用状态变更')
    expect(statusSelect).toBeDisabled()
    expect(applyStatusBtn).toBeDisabled()

    const prioritySelect = screen.getByLabelText('选择批量目标优先级')
    const applyPriorityBtn = screen.getByLabelText('应用优先级调整')
    expect(prioritySelect).toBeDisabled()
    expect(applyPriorityBtn).toBeDisabled()
  })

  test('取消多选：点击取消按钮清空已选集合', () => {
    const onClear = vi.fn()
    renderBar(queryClient, { onClear })

    const clearBtn = screen.getByLabelText('取消选择')
    fireEvent.click(clearBtn)
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
