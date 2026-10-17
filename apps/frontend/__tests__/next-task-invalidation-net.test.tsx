/**
 * v3-ui-next-batch1-strategy-launch-tasks W3 任务 3.7 & 3.8
 * 批量与放置操作全图表集中失效联动测试。
 *
 * 覆盖：
 * 1. invalidateTaskQueries 集中失效网覆盖契约：
 *    - taskKeys.lists(projectId)
 *    - taskKeys.details(projectId)
 *    - taskKeys.recycleBins(projectId)
 *    - taskKeys.views(projectId)
 *    - ['kanban', projectId]
 *    - ['gantt', projectId]
 *    - calendarKeys.lists(projectId)
 *    - milestoneKeys.lists(projectId)
 *    - projectKeys.dashboard(projectId)
 *    - projectKeys.detail(projectId)
 * 2. 反应式缓存状态重对齐：预热缓存数据在失效后被正确标记为 isInvalidated = true；
 * 3. 浮动批量操作栏 TaskBatchActionBar 批量变更状态成功后触发集中失效网；
 * 4. 浮动批量操作栏 TaskBatchActionBar 批量移入回收站二次确认成功后触发集中失效网；
 * 5. 行间放置建任务插槽 InRowTaskPlacementSlot 人工确认落库成功后触发集中失效网。
 *
 * 遵循硬约束：
 * - 一律使用 vi.stubGlobal('fetch')，严禁 vi.mock('@/lib/api/*')；
 * - 0 ESLint warning / error。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { InRowTaskPlacementSlot } from '@/components/next/project-space/InRowTaskPlacementSlot'
import { TaskBatchActionBar } from '@/components/next/project-space/TaskBatchActionBar'
import { calendarKeys } from '@/lib/api/calendar'
import { milestoneKeys } from '@/lib/api/milestones'
import { projectKeys, type ProjectMember } from '@/lib/api/projects'
import { taskKeys } from '@/lib/api/tasks'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
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
      fullName: '张工',
      email: 'zhang@example.com',
      initials: '张',
      isActive: true,
    },
  },
]

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => body,
  } as unknown as Response
}

describe('next-task-invalidation-net 集中失效网联动测试（W3 任务 3.7 / 3.8）', () => {
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
        fullName: '项目经理',
        organizations: [{ id: 1, name: '主组织', slug: 'main', role: 'admin' }],
      },
      currentOrganizationId: 1,
      permissions: ['task:view', 'task:create', 'task:update', 'task:delete', 'task:assign'],
      isAuthenticated: true,
      hasHydrated: true,
    })

    fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const method = init?.method?.toUpperCase() || 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : {}

      // tasksApi.batch -> POST /api/v1/projects/:id/tasks/batch
      if (method === 'POST' && body.taskIds) {
        return Promise.resolve(
          jsonResponse({
            action: body.action || 'update',
            total: body.taskIds.length,
            successCount: body.taskIds.length,
            failedCount: 0,
            results: body.taskIds.map((id: number) => ({ taskId: id, success: true })),
          }),
        )
      }

      // tasksApi.create -> POST /api/v1/projects/:id/tasks
      if (method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            id: 999,
            projectId: PROJECT_ID,
            title: body.title || '新任务',
            status: body.status || 'todo',
            priority: body.priority || 'medium',
            durationDays: body.durationDays ?? 2,
            createdAt: '2026-09-11T10:00:00Z',
            updatedAt: '2026-09-11T10:00:00Z',
          }),
        )
      }

      return Promise.resolve(jsonResponse({}))
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    useAuthStore.getState().clear()
  })

  test('invalidateTaskQueries 集中广播覆盖 taskKeys.lists、kanban、gantt、calendarKeys 等全图表', async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')

    await invalidateTaskQueries(queryClient, PROJECT_ID)

    const calledQueryKeys = spy.mock.calls.map(
      (call) => (call[0] as { queryKey: unknown[] }).queryKey,
    )

    // 断言 1: 列表镜头
    expect(calledQueryKeys).toContainEqual(taskKeys.lists(PROJECT_ID))
    // 断言 2: 看板镜头
    expect(calledQueryKeys).toContainEqual(['kanban', PROJECT_ID])
    // 断言 3: 甘特图镜头
    expect(calledQueryKeys).toContainEqual(['gantt', PROJECT_ID])
    // 断言 4: 日历排程
    expect(calledQueryKeys).toContainEqual(calendarKeys.lists(PROJECT_ID))
    // 辅助视图：详情、回收站、通用视图、里程碑、项目看板仪表盘
    expect(calledQueryKeys).toContainEqual(taskKeys.details(PROJECT_ID))
    expect(calledQueryKeys).toContainEqual(taskKeys.recycleBins(PROJECT_ID))
    expect(calledQueryKeys).toContainEqual(taskKeys.views(PROJECT_ID))
    expect(calledQueryKeys).toContainEqual(milestoneKeys.lists(PROJECT_ID))
    expect(calledQueryKeys).toContainEqual(projectKeys.dashboard(PROJECT_ID))
    expect(calledQueryKeys).toContainEqual(projectKeys.detail(PROJECT_ID))
  })

  test('各图表现有缓存数据在 invalidateTaskQueries 后被统一标记为失效 (isInvalidated: true)', async () => {
    // 预热多视图活跃缓存
    queryClient.setQueryData(taskKeys.lists(PROJECT_ID), [{ id: 1, title: '列表数据' }])
    queryClient.setQueryData(['kanban', PROJECT_ID], { todo: [{ id: 1 }] })
    queryClient.setQueryData(['gantt', PROJECT_ID], [{ id: 1, progress: 50 }])
    queryClient.setQueryData(calendarKeys.lists(PROJECT_ID), [{ id: 1, date: '2026-09-11' }])

    expect(queryClient.getQueryState(taskKeys.lists(PROJECT_ID))?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(['kanban', PROJECT_ID])?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(['gantt', PROJECT_ID])?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(calendarKeys.lists(PROJECT_ID))?.isInvalidated).toBe(false)

    // 执行集中失效
    await invalidateTaskQueries(queryClient, PROJECT_ID)

    // 验证全图表重对齐标记
    expect(queryClient.getQueryState(taskKeys.lists(PROJECT_ID))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['kanban', PROJECT_ID])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['gantt', PROJECT_ID])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(calendarKeys.lists(PROJECT_ID))?.isInvalidated).toBe(true)
  })

  test('TaskBatchActionBar 批量变更状态成功后触发集中失效网', async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')

    render(
      <QueryClientProvider client={queryClient}>
        <TaskBatchActionBar
          projectId={PROJECT_ID}
          selectedIds={[1, 2, 3]}
          members={MEMBERS}
          onClear={vi.fn()}
        />
      </QueryClientProvider>,
    )

    const applyStatusBtn = screen.getByRole('button', { name: '应用状态变更' })
    await React.act(async () => {
      fireEvent.click(applyStatusBtn)
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    // 验证集中失效网调用覆盖
    const calledQueryKeys = spy.mock.calls.map(
      (call) => (call[0] as { queryKey: unknown[] }).queryKey,
    )
    expect(calledQueryKeys).toContainEqual(taskKeys.lists(PROJECT_ID))
    expect(calledQueryKeys).toContainEqual(['kanban', PROJECT_ID])
    expect(calledQueryKeys).toContainEqual(['gantt', PROJECT_ID])
    expect(calledQueryKeys).toContainEqual(calendarKeys.lists(PROJECT_ID))
  })

  test('TaskBatchActionBar 批量移入回收站二次确认成功后触发集中失效网', async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')

    render(
      <QueryClientProvider client={queryClient}>
        <TaskBatchActionBar
          projectId={PROJECT_ID}
          selectedIds={[5, 6]}
          members={MEMBERS}
          onClear={vi.fn()}
        />
      </QueryClientProvider>,
    )

    // 点击批量删除唤起二次确认弹窗
    const deleteBtn = screen.getByRole('button', { name: '批量移入回收站' })
    await React.act(async () => {
      fireEvent.click(deleteBtn)
    })

    // 确认弹窗内点击确认删除
    const confirmDeleteBtn = await screen.findByTestId('batch-confirm-delete')
    await React.act(async () => {
      fireEvent.click(confirmDeleteBtn)
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const calledQueryKeys = spy.mock.calls.map(
      (call) => (call[0] as { queryKey: unknown[] }).queryKey,
    )
    expect(calledQueryKeys).toContainEqual(taskKeys.lists(PROJECT_ID))
    expect(calledQueryKeys).toContainEqual(['kanban', PROJECT_ID])
    expect(calledQueryKeys).toContainEqual(['gantt', PROJECT_ID])
    expect(calledQueryKeys).toContainEqual(taskKeys.recycleBins(PROJECT_ID))
  })

  test('InRowTaskPlacementSlot 行间放置确认建任务成功后触发集中失效网', async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')

    render(
      <QueryClientProvider client={queryClient}>
        <InRowTaskPlacementSlot projectId={PROJECT_ID} afterTaskId={1} />
      </QueryClientProvider>,
    )

    // 点击行间加号插槽展开卡片
    await React.act(async () => {
      fireEvent.click(screen.getByLabelText('在行间放置新任务'))
    })

    // 输入一句话按回车生成推断
    const input = screen.getByLabelText('一句话任务描述')
    await React.act(async () => {
      fireEvent.change(input, { target: { value: '联调支付网关接口 2天 紧急' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    // 验证推断徽标
    expect(await screen.findByText(/⚡ 待确认推断/)).toBeInTheDocument()

    // 点击确认创建按钮
    const confirmBtn = screen.getByText('确认创建')
    await React.act(async () => {
      fireEvent.click(confirmBtn)
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const calledQueryKeys = spy.mock.calls.map(
      (call) => (call[0] as { queryKey: unknown[] }).queryKey,
    )
    expect(calledQueryKeys).toContainEqual(taskKeys.lists(PROJECT_ID))
    expect(calledQueryKeys).toContainEqual(['kanban', PROJECT_ID])
    expect(calledQueryKeys).toContainEqual(['gantt', PROJECT_ID])
    expect(calledQueryKeys).toContainEqual(calendarKeys.lists(PROJECT_ID))
  })
})
