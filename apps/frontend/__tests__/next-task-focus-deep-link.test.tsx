import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ProjectSpaceContainer } from '@/components/next/project-space/ProjectSpaceContainer'
import { useAuthStore } from '@/stores/auth-store'

const { mockPush, mockReplace } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
}))

let currentSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: vi.fn(),
  }),
  useSearchParams: () => currentSearchParams,
  useParams: () => ({ id: '42' }),
  usePathname: () => '/next/projects/42',
}))

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

describe('ProjectSpaceContainer ?focusTask= 深链消费与抽屉联动测试', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setupJsdom()
    mockPush.mockReset()
    mockReplace.mockReset()
    currentSearchParams = new URLSearchParams()

    useAuthStore.setState({
      user: {
        id: 1,
        email: 'pm@example.com',
        fullName: '项目经理',
        organizations: [{ id: 10, name: '主组织', slug: 'main', role: 'admin' }],
      },
      currentOrganizationId: 10,
      permissions: ['project:view', 'task:view', 'task:update'],
      accessToken: 'token-test',
    })

    fetchSpy = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const urlStr = String(url)
      const method = init?.method ?? 'GET'

      // 项目详情
      if (
        urlStr.includes('/projects/42') &&
        !urlStr.includes('/tasks') &&
        !urlStr.includes('/members')
      ) {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              id: 42,
              organizationId: 10,
              name: '核心架构改造',
              code: 'ARCH-42',
              startDate: '2026-09-01',
              endDate: '2026-10-30',
              progressPercent: 50,
              createdAt: '2026-09-01T00:00:00Z',
              updatedAt: null,
            },
          }),
        )
      }

      // 依赖列表
      if (urlStr.includes('/dependencies')) {
        return Promise.resolve(jsonResponse(200, { data: { predecessors: [], successors: [] } }))
      }

      // 外部链接
      if (urlStr.includes('/external-links')) {
        return Promise.resolve(jsonResponse(200, { data: [] }))
      }

      // 任务列表候选
      if (urlStr.includes('/projects/42/tasks') && !urlStr.match(/\/tasks\/\d+/)) {
        return Promise.resolve(jsonResponse(200, { data: [], meta: { total: 0 } }))
      }

      // 单任务详情
      if (urlStr.includes('/projects/42/tasks/7') && method === 'GET') {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              id: 7,
              projectId: 42,
              name: '核心接口性能调优',
              description: null,
              status: 'in_progress',
              priority: 'high',
              taskType: 'task',
              startDate: '2026-09-10',
              endDate: '2026-09-15',
              durationDays: 5,
              progressPercent: 60,
              assigneeId: null,
              createdAt: '2026-09-01T00:00:00Z',
              updatedAt: null,
            },
          }),
        )
      }

      // 看板数据
      if (urlStr.includes('/projects/42/kanban')) {
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              columns: [
                { id: 'pending', title: '待处理', tasks: [] },
                { id: 'in_progress', title: '进行中', tasks: [] },
                { id: 'completed', title: '已完成', tasks: [] },
                { id: 'blocked', title: '受阻', tasks: [] },
              ],
            },
          }),
        )
      }

      // 成员列表
      if (urlStr.includes('/projects/42/members')) {
        return Promise.resolve(jsonResponse(200, { data: [] }))
      }

      // 信号
      if (urlStr.includes('/projects/42/signals')) {
        return Promise.resolve(jsonResponse(200, { data: [] }))
      }

      // 变更请求
      if (urlStr.includes('/projects/42/change-requests')) {
        return Promise.resolve(jsonResponse(200, { data: [] }))
      }

      // 风险
      if (urlStr.includes('/projects/42/risks')) {
        return Promise.resolve(jsonResponse(200, { data: [] }))
      }

      return Promise.resolve(jsonResponse(200, { data: [] }))
    })

    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/next/projects/42')
  })

  test('测试进入 /next/projects/42?focusTask=7 自动打开 ID 为 7 的任务详情抽屉', async () => {
    currentSearchParams = new URLSearchParams('focusTask=7')
    window.history.replaceState(null, '', '/next/projects/42?focusTask=7')

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectSpaceContainer projectId={42} />
      </QueryClientProvider>,
    )

    // 等待项目空间加载完成
    expect(await screen.findByText('核心架构改造')).toBeInTheDocument()

    // 自动唤起任务详情抽屉，展示 ID 为 7 的任务信息
    expect(await screen.findByTestId('workspace-task-detail-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('task-detail-id')).toHaveTextContent('#7')
    expect(await screen.findByDisplayValue('核心接口性能调优')).toBeInTheDocument()
  })

  test('测试点击关闭抽屉后 URL 中 focusTask 参数被平滑清除', async () => {
    currentSearchParams = new URLSearchParams('focusTask=7')
    window.history.replaceState(null, '', '/next/projects/42?focusTask=7')

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectSpaceContainer projectId={42} />
      </QueryClientProvider>,
    )

    expect(await screen.findByTestId('workspace-task-detail-drawer')).toBeInTheDocument()

    // 点击关闭按钮
    const closeBtn = screen.getByTestId('task-detail-close')
    fireEvent.click(closeBtn)

    // 校验 router.replace 被调用且不包含 focusTask
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalled()
      const replacedUrl = mockReplace.mock.calls[0]?.[0] as string
      expect(replacedUrl).not.toContain('focusTask')
    })
  })

  test('测试非数字非法参数安全忽略', async () => {
    currentSearchParams = new URLSearchParams('focusTask=invalid_id')
    window.history.replaceState(null, '', '/next/projects/42?focusTask=invalid_id')

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectSpaceContainer projectId={42} />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('核心架构改造')).toBeInTheDocument()

    // 详情抽屉不得展开
    expect(screen.queryByTestId('workspace-task-detail-drawer')).not.toBeInTheDocument()

    // 严禁发起向非法 ID 的详情网络请求
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('/tasks/invalid_id'),
      expect.anything(),
    )
  })
})
