/**
 * 空间地图任务 HUD 镜头集成测试（v3-ui-next-batch3-global-convergence W4/W5 · tasks 4.8）。
 *
 * 覆盖：
 * 1. 空间地图模式切换器支持「全域任务」Tab 切换与 Ctrl+L 快捷键循环切入；
 * 2. 空间地图内嵌入渲染跨项目任务高密度 HUD 表格与指标；
 * 3. 扫视任务行并按 Enter（或单击任务）直达目标单项目空间并携带 ?focusTask=，同时关闭浮层；
 * 4. Esc 退出空间地图。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { SpaceMapOverlay } from '@/components/next/navigation/SpaceMapOverlay'
import type { Project } from '@/lib/api/projects'

const { pushMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/next',
  useSearchParams: () => new URLSearchParams(),
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
}

const mockProjects: Project[] = [
  {
    id: 101,
    organizationId: 1,
    name: '北极星重构项目',
    code: 'NS-01',
    description: null,
    category: null,
    status: 'active',
    priority: 'high',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    budgetCents: 10000000,
    currency: 'CNY',
    progressPercent: 45,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  },
]

import { useAuthStore } from '@/stores/auth-store'

describe('SpaceMapOverlay 全域任务 HUD 镜头集成 (tasks 4.7 / 4.8)', () => {
  let queryClient: QueryClient
  let onOpenChange: Mock

  beforeEach(() => {
    setupJsdom()
    vi.restoreAllMocks()
    pushMock.mockClear()
    onOpenChange = vi.fn()
    useAuthStore.setState({
      currentOrganizationId: 1,
      user: {
        id: 1,
        email: 'test@example.com',
        fullName: '测试用户',
        organizations: [{ id: 1, name: '测试组织', slug: 'test', role: 'owner' }],
      },
    })

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/v1/projects/101/tasks')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: 42,
                projectId: 101,
                name: '全域任务直达测试项',
                description: '测试任务',
                status: 'in_progress',
                priority: 'highest',
                taskType: 'task',
                endDate: '2026-10-01T00:00:00.000Z',
                progressPercent: 50,
                createdAt: '2026-09-01T00:00:00.000Z',
                updatedAt: '2026-09-02T00:00:00.000Z',
              },
            ],
            meta: { total: 1, page: 1, perPage: 100 },
          }),
        })
      }
      if (url.includes('/api/v1/projects')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: mockProjects,
            meta: { total: 1, page: 1, perPage: 20 },
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      })
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderOverlay(props: Partial<React.ComponentProps<typeof SpaceMapOverlay>> = {}) {
    return render(
      <QueryClientProvider client={queryClient}>
        <SpaceMapOverlay
          open={true}
          onOpenChange={onOpenChange}
          projects={mockProjects}
          {...props}
        />
      </QueryClientProvider>,
    )
  }

  test('测试空间地图模式切换至全域任务（通过 Tab 点击或 defaultLens）', () => {
    renderOverlay()

    // 默认在空间拓扑
    const spacesTab = screen.getByRole('tab', { name: '空间拓扑' })
    const tasksTab = screen.getByRole('tab', { name: '全域任务' })
    expect(spacesTab).toHaveAttribute('aria-selected', 'true')
    expect(tasksTab).toHaveAttribute('aria-selected', 'false')

    // 点击切至全域任务
    fireEvent.click(tasksTab)
    expect(tasksTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('cross-project-tasks-hud')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '跨项目任务 HUD 镜头' })).toBeInTheDocument()
  })

  test('测试 Ctrl+L 快捷键在 spaces -> projects -> tasks 模式之间循环切换', () => {
    renderOverlay()

    const spacesTab = screen.getByRole('tab', { name: '空间拓扑' })
    const projectsTab = screen.getByRole('tab', { name: '项目清单' })
    const tasksTab = screen.getByRole('tab', { name: '全域任务' })

    expect(spacesTab).toHaveAttribute('aria-selected', 'true')

    // 第一次 Ctrl+L -> projects
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    expect(projectsTab).toHaveAttribute('aria-selected', 'true')

    // 第二次 Ctrl+L -> tasks
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    expect(tasksTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('cross-project-tasks-hud')).toBeInTheDocument()

    // 第三次 Ctrl+L -> 回到 spaces
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    expect(spacesTab).toHaveAttribute('aria-selected', 'true')
  })

  test('测试在空间地图内扫视任务并回车直达项目抽屉', async () => {
    renderOverlay({ defaultLens: 'tasks' })

    // 等待任务加载并呈现
    const taskRow = await screen.findByText('全域任务直达测试项')
    expect(taskRow).toBeInTheDocument()

    const rowElement = screen
      .getByTestId('cross-project-tasks-hud')
      .querySelector('[data-task-id="42"]')
    expect(rowElement).not.toBeNull()

    // 键盘回车直达
    fireEvent.keyDown(rowElement!, { key: 'Enter' })
    expect(pushMock).toHaveBeenCalledWith('/next/projects/101?focusTask=42')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('测试点击关闭按钮或按 Esc 键退出空间地图', () => {
    renderOverlay({ defaultLens: 'tasks' })

    const closeBtn = screen.getByRole('button', { name: '关闭空间地图' })
    fireEvent.click(closeBtn)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
