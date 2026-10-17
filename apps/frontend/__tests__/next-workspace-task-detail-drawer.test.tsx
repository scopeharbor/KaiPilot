import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspaceTaskDetailDrawer } from '@/components/next/project-space/WorkspaceTaskDetailDrawer'
import { useAuthStore } from '@/stores/auth-store'
import { taskKeys } from '@/lib/api/tasks'

function setupJsdom() {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventMock extends MouseEvent {}
    window.PointerEvent = PointerEventMock as unknown as typeof PointerEvent
  }
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }))
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as unknown as Response
}

describe('WorkspaceTaskDetailDrawer（任务详情内敛抽屉）', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setupJsdom()

    useAuthStore.setState({
      user: {
        id: 1,
        email: 'developer@example.com',
        fullName: '前端工人',
        organizations: [{ id: 10, name: '主组织', slug: 'main', role: 'admin' }],
      },
      currentOrganizationId: 10,
      permissions: ['task:view', 'task:update', 'task:update:self'],
      accessToken: 'test-token',
    })

    fetchSpy = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const urlStr = String(url)
      const method = init?.method ?? 'GET'

      // 任务依赖列表
      if (urlStr.includes('/dependencies') && method === 'GET') {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              predecessors: [
                {
                  id: 99,
                  predecessorId: 5,
                  successorId: 7,
                  type: 'fs',
                  lagDays: 0,
                  predecessor: {
                    id: 5,
                    name: '核心接口开发',
                    status: 'completed',
                    startDate: null,
                    endDate: null,
                  },
                  successor: {
                    id: 7,
                    name: '跨系统联调验收',
                    status: 'in_progress',
                    startDate: null,
                    endDate: null,
                  },
                  createdAt: '2026-09-01T00:00:00Z',
                  updatedAt: null,
                },
              ],
              successors: [],
            },
          }),
        )
      }

      // 删除依赖
      if (urlStr.includes('/dependencies/99') && method === 'DELETE') {
        return Promise.resolve(jsonResponse(204, null))
      }

      // 外部链接
      if (urlStr.includes('/external-links')) {
        return Promise.resolve(jsonResponse(200, { data: [] }))
      }

      // 任务列表（候选依赖任务）
      if (urlStr.includes('/projects/101/tasks') && urlStr.includes('perPage=100')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: [
              { id: 5, name: '核心接口开发', status: 'completed' },
              { id: 6, name: '测试环境部署', status: 'completed' },
            ],
            meta: { total: 2, page: 1, perPage: 100, totalPages: 1 },
          }),
        )
      }

      // 任务修改提交
      if (urlStr.endsWith('/projects/101/tasks/7') && method === 'PATCH') {
        const body = init?.body ? JSON.parse(String(init.body)) : {}
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              id: 7,
              projectId: 101,
              name: body.name ?? '跨系统联调验收',
              status: body.status ?? 'in_progress',
              priority: body.priority ?? 'high',
              startDate: body.startDate ?? '2026-09-12',
              endDate: body.endDate ?? '2026-09-20',
              progressPercent: body.progressPercent ?? 40,
            },
          }),
        )
      }

      // 任务详情
      if (urlStr.endsWith('/projects/101/tasks/7') && method === 'GET') {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              id: 7,
              projectId: 101,
              name: '跨系统联调验收',
              description: '详细验收方案',
              status: 'in_progress',
              priority: 'high',
              taskType: 'task',
              startDate: '2026-09-12',
              endDate: '2026-09-20',
              durationDays: 8,
              progressPercent: 40,
              assigneeId: 11,
              createdAt: '2026-09-01T00:00:00Z',
              updatedAt: null,
            },
          }),
        )
      }

      // 项目成员
      if (urlStr.includes('/projects/101/members')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: [
              {
                id: 1,
                projectId: 101,
                userId: 11,
                projectRoleId: null,
                isActive: true,
                user: {
                  id: 11,
                  fullName: '张工',
                  email: 'zhang@example.com',
                  initials: 'ZG',
                  isActive: true,
                },
              },
            ],
          }),
        )
      }

      return Promise.resolve(jsonResponse(200, { data: [] }))
    })

    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('测试抽屉平滑滑出与任务属性渲染', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceTaskDetailDrawer projectId={101} taskId={7} open={true} />
      </QueryClientProvider>,
    )

    // 抽屉根节点渲染
    expect(await screen.findByTestId('workspace-task-detail-drawer')).toBeInTheDocument()

    // 任务 ID 徽标与基本字段
    expect(screen.getByTestId('task-detail-id')).toHaveTextContent('#7')
    const nameInput = (await screen.findByTestId('task-detail-name')) as HTMLInputElement
    expect(nameInput.value).toBe('跨系统联调验收')

    const statusSelect = screen.getByTestId('task-detail-status') as HTMLSelectElement
    expect(statusSelect.value).toBe('in_progress')

    const prioritySelect = screen.getByTestId('task-detail-priority') as HTMLSelectElement
    expect(prioritySelect.value).toBe('high')
  })

  test('测试修改任务属性并提交保存', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceTaskDetailDrawer projectId={101} taskId={7} open={true} />
      </QueryClientProvider>,
    )

    const nameInput = (await screen.findByTestId('task-detail-name')) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '跨系统联调验收-已修改' } })

    const statusSelect = screen.getByTestId('task-detail-status') as HTMLSelectElement
    fireEvent.change(statusSelect, { target: { value: 'completed' } })

    const submitBtn = screen.getByTestId('task-detail-submit')
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/projects/101/tasks/7'),
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('跨系统联调验收-已修改'),
        }),
      )
    })
  })

  test('测试前后置依赖列表与增删关联', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceTaskDetailDrawer projectId={101} taskId={7} open={true} />
      </QueryClientProvider>,
    )

    // 等待依赖面板渲染
    expect(await screen.findByText('核心接口开发')).toBeInTheDocument()
    expect(screen.getAllByText(/完成 → 开始/)[0]).toBeInTheDocument()

    // 解除依赖：点击删除图标呼出确认
    const deleteBtn = screen.getByRole('button', { name: /删除与核心接口开发的依赖/ })
    fireEvent.click(deleteBtn)

    // 点击确认解除
    const confirmBtn = await screen.findByRole('button', { name: /确认删除与核心接口开发的依赖/ })
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/dependencies/99'),
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
  })

  test('测试只读权限下编辑控件隐藏或禁用', async () => {
    // 移除 task:update 权限
    useAuthStore.setState({
      permissions: ['task:view'],
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceTaskDetailDrawer projectId={101} taskId={7} open={true} />
      </QueryClientProvider>,
    )

    // 等待数据加载完成
    await screen.findByTestId('task-detail-name-readonly')
    expect(screen.getByTestId('task-detail-name-readonly')).toHaveTextContent('跨系统联调验收')

    // 只读模式提示存在，且编辑 input 与保存按钮不渲染
    expect(screen.getByTestId('readonly-hint')).toBeInTheDocument()
    expect(screen.queryByTestId('task-detail-name')).not.toBeInTheDocument()
    expect(screen.queryByTestId('task-detail-submit')).not.toBeInTheDocument()
  })

  test('服务端数据刷新（如打勾转已完成、排期随之改）：没改过的字段跟着变，正在改的名字保留', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceTaskDetailDrawer projectId={101} taskId={7} open={true} />
      </QueryClientProvider>,
    )
    const nameInput = (await screen.findByTestId('task-detail-name')) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '改过的名字' } })

    const key = taskKeys.detail(101, 7)
    const current = queryClient.getQueryData<Record<string, unknown>>(key)!
    React.act(() => {
      queryClient.setQueryData(key, {
        ...current,
        status: 'completed',
        startDate: '2026-09-29',
        endDate: '2026-09-29',
        progressPercent: 100,
      })
    })

    await waitFor(
      () =>
        expect((screen.getByTestId('task-detail-start-date') as HTMLInputElement).value).toBe(
          '2026-09-29',
        ),
      { timeout: 3000 },
    )
    expect((screen.getByTestId('task-detail-status') as HTMLSelectElement).value).toBe('completed')
    expect(nameInput.value).toBe('改过的名字')
  })
})
