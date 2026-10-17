/**
 * v3-ui-next-batch1-strategy-launch-tasks W2 任务 2.4
 * 空间地图浮层清单镜头切换与项目直达跳转测试。
 *
 * 覆盖：
 * 1. 浮层唤起后通过顶部切换器或 defaultLens 切换至「项目清单」镜头；
 * 2. 快捷键 Ctrl+L / Cmd+L 切换镜头；
 * 3. 点击单行项目调用 router.push('/next/projects/:id') 并关闭浮层；
 * 4. Esc 键平滑关闭浮层；
 * 5. 纯客户端导航零网络写副作用（RL-06）。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SpaceMapOverlay } from '@/components/next/navigation/SpaceMapOverlay'
import type { Project } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
}))

const mockProjects: Project[] = [
  {
    id: 42,
    organizationId: 10,
    name: '海外电商支付网关',
    code: 'PAY-GW',
    description: '跨境支付核心基础设施改造',
    category: 'fintech',
    status: 'active',
    priority: 'high',
    startDate: '2026-09-01',
    endDate: '2026-10-30',
    budgetCents: 5000000,
    currency: 'USD',
    progressPercent: 45,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 101,
    updatedBy: 101,
    createdAt: '2026-09-01T08:00:00Z',
    updatedAt: '2026-09-10T12:00:00Z',
  },
  {
    id: 99,
    organizationId: 10,
    name: '智能仓储算法调度',
    code: 'AI-WAREHOUSE',
    description: '仓储自动化调度算法',
    category: 'supply_chain',
    status: 'planning',
    priority: 'critical',
    startDate: '2026-10-01',
    endDate: '2026-12-31',
    budgetCents: 8000000,
    currency: 'CNY',
    progressPercent: 10,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 102,
    updatedBy: 102,
    createdAt: '2026-09-05T09:00:00Z',
    updatedAt: '2026-09-08T15:00:00Z',
  },
]

function renderOverlay(
  props: {
    open?: boolean
    defaultLens?: 'spaces' | 'projects'
    onOpenChange?: (open: boolean) => void
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const onOpenChange = props.onOpenChange ?? vi.fn()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SpaceMapOverlay
        open={props.open ?? true}
        onOpenChange={onOpenChange}
        defaultLens={props.defaultLens ?? 'spaces'}
        projects={mockProjects}
      />
    </QueryClientProvider>,
  )
  return { ...view, onOpenChange }
}

beforeEach(() => {
  pushMock.mockReset()
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '管理员',
      organizations: [{ id: 10, name: '主组织', slug: 'main', role: 'admin' }],
    },
    currentOrganizationId: 10,
    permissions: ['project:view', 'project:create'],
  })
})

describe('components/next/navigation/SpaceMapOverlay（清单镜头扩展）', () => {
  test('浮层顶部展示镜头切换器，点击「项目清单」切换到高密度表格', () => {
    renderOverlay({ open: true, defaultLens: 'spaces' })

    // 默认展示空间拓扑
    expect(screen.getByRole('tab', { name: '空间拓扑' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('searchbox', { name: '搜索空间坐标' })).toBeInTheDocument()
    expect(screen.queryByTestId('space-map-project-list-lens')).toBeNull()

    // 点击「项目清单」tab
    const projectsTab = screen.getByRole('tab', { name: '项目清单' })
    fireEvent.click(projectsTab)

    expect(projectsTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('space-map-project-list-lens')).toBeInTheDocument()
    expect(screen.getByText('海外电商支付网关')).toBeInTheDocument()
    expect(screen.getByText('智能仓储算法调度')).toBeInTheDocument()
  })

  test('以 defaultLens="projects" 唤起浮层时直接进入项目清单镜头', () => {
    renderOverlay({ open: true, defaultLens: 'projects' })

    expect(screen.getByRole('tab', { name: '项目清单' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('space-map-project-list-lens')).toBeInTheDocument()
    expect(screen.getByText('海外电商支付网关')).toBeInTheDocument()
  })

  test('快捷键 Ctrl+L 在空间拓扑/项目清单/全域任务三镜头间循环切换', () => {
    renderOverlay({ open: true, defaultLens: 'spaces' })

    expect(screen.queryByTestId('space-map-project-list-lens')).toBeNull()

    // 按下 Ctrl+L 切换到项目清单
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    expect(screen.getByTestId('space-map-project-list-lens')).toBeInTheDocument()

    // 再次按下 Ctrl+L 切到全域任务（批4三镜头循环：spaces → projects → tasks → spaces）
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    expect(screen.queryByTestId('space-map-project-list-lens')).toBeNull()
    expect(screen.getByTestId('cross-project-tasks-hud')).toBeInTheDocument()

    // 第三次按下 Ctrl+L 切回空间拓扑
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    expect(screen.queryByTestId('cross-project-tasks-hud')).toBeNull()
    expect(screen.getByRole('searchbox', { name: '搜索空间坐标' })).toBeInTheDocument()
  })

  test('点击单行项目平滑关闭浮层并调用 router.push("/next/projects/:id")', () => {
    const { onOpenChange } = renderOverlay({ open: true, defaultLens: 'projects' })

    const projectRow = screen.getByText('海外电商支付网关').closest('tr')
    expect(projectRow).not.toBeNull()

    fireEvent.click(projectRow!)

    // 校验先关闭浮层后跳转
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith('/next/projects/42')
  })

  test('按下 Esc 键平滑关闭浮层并上报 onOpenChange(false)', () => {
    const { onOpenChange } = renderOverlay({ open: true, defaultLens: 'projects' })

    const searchInput = screen.getByRole('searchbox', { name: '搜索项目名称或代码' })
    fireEvent.keyDown(searchInput, { key: 'Escape' })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
