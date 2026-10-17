import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SpaceMapOverlay } from '@/components/next/navigation/SpaceMapOverlay'
import { SpaceMapStarTooltip } from '@/components/next/3d/spacemap/SpaceMapStarTooltip'
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

const mockProjects: Project[] = [
  {
    id: 301,
    organizationId: 1,
    name: 'Voyager Mission',
    code: 'VOY-301',
    description: 'Interstellar probe',
    category: 'Science',
    status: 'active',
    priority: 'critical',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    budgetCents: 10000000,
    currency: 'CNY',
    progressPercent: 88,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    departmentName: 'Deep Space Div',
    stats: { memberCount: 12, taskCount: 45, milestoneCount: 6 },
  },
  {
    id: 302,
    organizationId: 1,
    name: 'Pioneer Station',
    code: 'PIO-302',
    description: 'Orbit base',
    category: 'Infrastructure',
    status: 'active',
    priority: 'medium',
    startDate: null,
    endDate: null,
    budgetCents: null,
    currency: 'CNY',
    progressPercent: 40,
    healthStatus: 'warning',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    departmentName: 'Station Engineering',
    stats: { memberCount: 8, taskCount: 22, milestoneCount: 3 },
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

describe('空间地图 DOM 信息等价与双重视角契约测试 (Task 6.1)', () => {
  beforeEach(() => {
    routerPush.mockClear()
    vi.clearAllMocks()
  })

  it('3D 视角下全量项目数据在 DOM 等价列表中 100% 可达 (RL-01 / proposal §4)', () => {
    renderOverlay()

    const list = screen.getByRole('list', { name: '群星导航列表' })
    expect(list).toBeInTheDocument()

    // 项目名、代号、进度百分比均在 DOM 中等价可达
    expect(screen.getByText('Voyager Mission')).toBeInTheDocument()
    expect(screen.getByText('VOY-301')).toBeInTheDocument()
    expect(screen.getByText('88%')).toBeInTheDocument()

    expect(screen.getByText('Pioneer Station')).toBeInTheDocument()
    expect(screen.getByText('PIO-302')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
  })

  it('点击 DOM 等价列表项展开星体详情面板，并呈现完整指标与直达跳转', () => {
    renderOverlay()

    // 初始状态无详情面板
    expect(screen.queryByTestId('star-detail-panel')).toBeNull()

    // 点击列表项
    const item = screen.getByRole('button', { name: /Voyager Mission/ })
    fireEvent.click(item)

    // 展开详情面板
    const panel = screen.getByTestId('star-detail-panel')
    expect(panel).toBeInTheDocument()
    expect(panel.getAttribute('data-project-id')).toBe('301')

    // 验证关键指标等价呈现
    expect(screen.getByText('健康稳定')).toBeInTheDocument()
    expect(screen.getByText('Deep Space Div')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument() // memberCount
    expect(screen.getByText('45')).toBeInTheDocument() // taskCount
    expect(screen.getByText('6')).toBeInTheDocument() // milestoneCount

    // 点击直达跳转
    const enterBtn = screen.getByRole('button', { name: /切入项目工作面/ })
    fireEvent.click(enterBtn)

    expect(routerPush).toHaveBeenCalledWith('/next/projects/301')
  })

  it('视角分段切换器 [3D 星系 / 2D 地图] 平滑互切且状态无损同步', () => {
    renderOverlay()

    // 默认 3D 视角
    expect(screen.getByTestId('space-map-view-toggle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^3D 星系$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // 切至 2D 视角
    fireEvent.click(screen.getByRole('button', { name: /^2D 地图$/ }))

    expect(screen.getByRole('button', { name: /^2D 地图$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // 2D 空间坐标卡片就位
    expect(screen.getByRole('button', { name: /角色首页/ })).toBeInTheDocument()

    // 切回 3D 视角
    fireEvent.click(screen.getByRole('button', { name: /^3D 星系$/ }))
    expect(screen.getByRole('button', { name: /^3D 星系$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('list', { name: '群星导航列表' })).toBeInTheDocument()
  })

  it('快捷键 Ctrl+M 在浮层打开状态下平滑切换视角，Ctrl+G 一键直达 3D', () => {
    renderOverlay()

    // 初始 3D
    expect(screen.getByRole('button', { name: /^3D 星系$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // 按下 Ctrl+M 切到 2D
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    expect(screen.getByRole('button', { name: /^2D 地图$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // 再次按下 Ctrl+M 切回 3D
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    expect(screen.getByRole('button', { name: /^3D 星系$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // 切到 2D 后按 Ctrl+G 直达 3D
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    expect(screen.getByRole('button', { name: /^2D 地图$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.keyDown(window, { key: 'g', ctrlKey: true })
    expect(screen.getByRole('button', { name: /^3D 星系$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('检索词在双视角之间无缝保持与双向同步', () => {
    renderOverlay()

    const searchInput = screen.getByRole('searchbox')
    fireEvent.change(searchInput, { target: { value: 'Voyager' } })

    // 3D 模式下检索词已填入
    expect(searchInput).toHaveValue('Voyager')

    // 切至 2D 模式
    fireEvent.click(screen.getByRole('button', { name: /^2D 地图$/ }))

    // 检索词保持不变
    const searchInput2D = screen.getByRole('searchbox')
    expect(searchInput2D).toHaveValue('Voyager')
  })

  it('Hover 3D 星体列表项触发 SpaceMapStarTooltip 悬浮浮窗呈现指标摘要 (Task 5.2 / BLOCKER-2 闭环)', () => {
    renderOverlay()

    // 初始无悬浮浮窗
    expect(screen.queryByTestId('star-tooltip')).toBeNull()

    // 鼠标进入星体导航项
    const item = screen.getByRole('button', { name: /Voyager Mission/ })
    fireEvent.pointerEnter(item, { clientX: 120, clientY: 240 })

    // 呈现 Tooltip 悬浮窗
    const tooltip = screen.getByTestId('star-tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(tooltip).toHaveTextContent('Voyager Mission')
    expect(tooltip).toHaveTextContent('VOY-301')
    expect(tooltip).toHaveTextContent('进度 88%')

    // 鼠标离开星体项，Tooltip 销毁
    fireEvent.pointerLeave(item)
    expect(screen.queryByTestId('star-tooltip')).toBeNull()
  })

  it('SpaceMapStarTooltip 构件独立渲染空值防崩溃与指标语义呈现', () => {
    const { container: cEmpty } = render(<SpaceMapStarTooltip star={null} />)
    expect(cEmpty.firstChild).toBeNull()

    const mockStarVisual = {
      projectId: 999,
      name: 'Deep Probe X',
      code: 'DPX-999',
      departmentName: 'Deep Space',
      category: 'Science',
      position: [0, 0, 0] as [number, number, number],
      radius: 1.5,
      accretionOuterRadius: 2.5,
      hasAccretionRing: true,
      color: '#38bdf8',
      luminosity: 0.8,
      geometryType: 'sphere' as const,
      signals: [
        {
          id: 1,
          signalType: 'risk_surge' as const,
          severity: 'critical' as const,
          shape: 'cone' as const,
          orbitRadius: 3,
          orbitPeriod: 10,
          orbitSpeed: 0.5,
          orbitTilt: 0.3,
          color: '#ef4444',
        },
      ],
      isMatch: true,
      isSelected: false,
      scale: 1,
      opacity: 1,
      emissiveMultiplier: 1,
      targetCameraPosition: [0, 0, 6] as [number, number, number],
      healthStatus: 'healthy',
      progressPercent: 77,
      priority: 'high' as const,
      status: 'active' as const,
    }

    render(<SpaceMapStarTooltip star={mockStarVisual} clientX={150} clientY={250} />)
    const tooltip = screen.getByTestId('star-tooltip')
    expect(tooltip).toBeInTheDocument()
    expect(tooltip).toHaveTextContent('Deep Probe X')
    expect(tooltip).toHaveTextContent('DPX-999')
    expect(tooltip).toHaveTextContent('进度 77%')
    expect(tooltip).toHaveTextContent('1 信号')
  })
})
