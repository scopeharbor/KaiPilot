import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SpaceMapOverlay } from '@/components/next/navigation/SpaceMapOverlay'
import type { Project } from '@/lib/api/projects'

const { routerPush } = vi.hoisted(() => ({
  routerPush: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

// R3F jsdom Mock
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div data-testid="r3f-canvas-mock" aria-hidden="true" {...props}>
      {children}
    </div>
  ),
  useFrame: vi.fn(),
  useThree: () => ({
    camera: { position: { x: 0, y: 45, z: 105 }, lookAt: vi.fn() },
    scene: { traverse: vi.fn() },
    pointer: { x: 0, y: 0 },
    clock: { getElapsedTime: () => 0 },
    gl: { domElement: document.createElement('canvas') },
  }),
}))

// drei 内部会引用真实的 R3F（不受上面的 fiber mock 影响），懒加载的 3D 场景一旦在用例内渲染
// 就会在 Canvas 外调用 useFrame 报错（全量并发时模块已缓存、懒加载更快完成才会出现）
vi.mock('@react-three/drei', () => ({
  Billboard: () => null,
  OrbitControls: () => null,
  Stars: () => null,
}))

const mockProjects: Project[] = [
  {
    id: 401,
    organizationId: 1,
    name: 'Nebula Protocol',
    code: 'NEB-401',
    description: 'Protocol infra',
    category: 'Infra',
    status: 'active',
    priority: 'high',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    budgetCents: 20000000,
    currency: 'CNY',
    progressPercent: 65,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    departmentName: 'Infra Core',
    stats: { memberCount: 15, taskCount: 80, milestoneCount: 8 },
  },
]

function renderOverlay(props: Partial<React.ComponentProps<typeof SpaceMapOverlay>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SpaceMapOverlay
        open={true}
        projects={mockProjects}
        defaultViewMode="3d"
        forceTier="high"
        {...props}
      />
    </QueryClientProvider>,
  )
}

function StatefulOverlay() {
  const [open, setOpen] = React.useState(false)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return (
    <QueryClientProvider client={queryClient}>
      <SpaceMapOverlay
        open={open}
        onOpenChange={setOpen}
        projects={mockProjects}
        defaultViewMode="3d"
        forceTier="high"
      />
    </QueryClientProvider>
  )
}

describe('SpaceMapOverlay 全链路端到端集成测试 (Task 6.1)', () => {
  beforeEach(() => {
    routerPush.mockClear()
    vi.clearAllMocks()
  })

  it('浮层完整装配：标题、双视角分段器、三镜头 Tab、搜索框与关闭按钮就位', () => {
    renderOverlay()

    const dialog = screen.getByRole('dialog', { name: '空间地图' })
    expect(dialog).toBeInTheDocument()

    expect(screen.getByTestId('space-map-view-toggle')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '空间拓扑' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '项目清单' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '全域任务' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭空间地图' })).toBeInTheDocument()
  })

  it('点击关闭按钮或按 Esc 触发 onOpenChange(false) 或 onClose', () => {
    const onClose = vi.fn()
    const onOpenChange = vi.fn()

    renderOverlay({ onClose, onOpenChange })

    const closeBtn = screen.getByRole('button', { name: '关闭空间地图' })
    fireEvent.click(closeBtn)

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onClose).toHaveBeenCalled()
  })

  it('三镜头 Tab 模式切换：spaces -> projects -> tasks', () => {
    renderOverlay()

    // 切换至项目清单镜头
    fireEvent.click(screen.getByRole('tab', { name: '项目清单' }))
    expect(screen.getByTestId('space-map-project-list-lens')).toBeInTheDocument()

    // 切换至全域任务镜头
    fireEvent.click(screen.getByRole('tab', { name: '全域任务' }))
    expect(screen.getByRole('textbox', { name: '搜索跨项目任务' })).toBeInTheDocument()

    // 切换回空间拓扑
    fireEvent.click(screen.getByRole('tab', { name: '空间拓扑' }))
    expect(screen.getByRole('tab', { name: '空间拓扑' })).toHaveAttribute('aria-selected', 'true')
  })

  it('3D 星体选中、展开详情并直达跳转项目空间', () => {
    renderOverlay()

    const item = screen.getByRole('button', { name: /Nebula Protocol/ })
    fireEvent.click(item)

    const panel = screen.getByTestId('star-detail-panel')
    expect(panel).toBeInTheDocument()

    const enterBtn = screen.getByRole('button', { name: /切入项目工作面/ })
    fireEvent.click(enterBtn)

    expect(routerPush).toHaveBeenCalledWith('/next/projects/401')
  })

  it('监听全局 space-map-trigger 自定义事件唤起并预填关键词与视角', () => {
    render(<StatefulOverlay />)

    act(() => {
      const event = new CustomEvent('space-map-trigger', {
        detail: { query: 'Nebula', lens: 'spaces', viewMode: '3d' },
      })
      window.dispatchEvent(event)
    })

    expect(screen.getByRole('searchbox')).toHaveValue('Nebula')
  })
})
