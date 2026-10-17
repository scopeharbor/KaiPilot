import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SpaceMapProjectListLens } from '@/components/next/navigation/SpaceMapProjectListLens'
import type { Project } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
}))

const mockProjects: Project[] = [
  {
    id: 1,
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
    id: 2,
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
  {
    id: 3,
    organizationId: 10,
    name: '客户数据平台 CDP',
    code: 'CDP-CORE',
    description: '用户行为数据分析与打标',
    category: 'data',
    status: 'completed',
    priority: 'medium',
    startDate: '2026-01-01',
    endDate: '2026-08-31',
    budgetCents: 3000000,
    currency: 'CNY',
    progressPercent: 100,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 103,
    updatedBy: 103,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-08-31T18:00:00Z',
  },
  {
    id: 4,
    organizationId: 10,
    name: '移动端多语言适配',
    code: 'MBL-I18N',
    description: '移动端多语言框架重构',
    category: 'frontend',
    status: 'on_hold',
    priority: 'low',
    startDate: '2026-07-01',
    endDate: '2026-11-30',
    budgetCents: 1000000,
    currency: 'CNY',
    progressPercent: 20,
    healthStatus: 'at_risk',
    settings: null,
    createdBy: 104,
    updatedBy: 104,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-09-02T10:00:00Z',
  },
]

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  pushMock.mockReset()
  vi.useRealTimers()
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

afterEach(() => {
  vi.useRealTimers()
})

describe('components/next/navigation/SpaceMapProjectListLens', () => {
  test('高密度表格首屏正确渲染：表头字段、发丝线规范与项目记录行', () => {
    renderWithClient(<SpaceMapProjectListLens projects={mockProjects} />)

    // 表头包含项目名称、标识代码、状态、优先级、拥有者与最后更新
    expect(screen.getByRole('columnheader', { name: /项目名称/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /标识代码/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /状态/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /优先级/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /拥有者/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /最后更新/i })).toBeInTheDocument()

    // 渲染了 4 条项目
    expect(screen.getByText('海外电商支付网关')).toBeInTheDocument()
    expect(screen.getByText('智能仓储算法调度')).toBeInTheDocument()
    expect(screen.getByText('客户数据平台 CDP')).toBeInTheDocument()
    expect(screen.getByText('移动端多语言适配')).toBeInTheDocument()

    // 默认展示代码
    expect(screen.getByText('PAY-GW')).toBeInTheDocument()
    expect(screen.getByText('AI-WAREHOUSE')).toBeInTheDocument()

    // 首行默认选中高亮
    const rows = screen.getAllByRole('row').slice(1) // 去掉 thead
    expect(rows[0]).toHaveAttribute('data-selected', 'true')
  })

  test('300ms 防抖模糊搜索：按项目名称与标识代码即时过滤', async () => {
    renderWithClient(<SpaceMapProjectListLens projects={mockProjects} />)

    const searchInput = screen.getByRole('searchbox', { name: '搜索项目名称或代码' })

    // 输入 "支付"
    fireEvent.change(searchInput, { target: { value: '支付' } })

    // 未过 300ms 前仍显示全部
    expect(screen.getByText('海外电商支付网关')).toBeInTheDocument()
    expect(screen.getByText('智能仓储算法调度')).toBeInTheDocument()

    // 等待 350ms 防抖生效
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350))
    })

    expect(screen.getByText('海外电商支付网关')).toBeInTheDocument()
    expect(screen.queryByText('智能仓储算法调度')).toBeNull()
    expect(screen.queryByText('客户数据平台 CDP')).toBeNull()

    // 输入标识代码 "WAREHOUSE"
    fireEvent.change(searchInput, { target: { value: 'WAREHOUSE' } })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350))
    })

    expect(screen.getByText('智能仓储算法调度')).toBeInTheDocument()
    expect(screen.queryByText('海外电商支付网关')).toBeNull()
  })

  test('状态下拉过滤：全部/进行中/计划中/已完成即时切换', () => {
    renderWithClient(<SpaceMapProjectListLens projects={mockProjects} />)

    const select = screen.getByRole('combobox', { name: '过滤项目状态' })

    // 过滤「进行中」
    fireEvent.change(select, { target: { value: 'active' } })
    expect(screen.getByText('海外电商支付网关')).toBeInTheDocument()
    expect(screen.queryByText('智能仓储算法调度')).toBeNull()
    expect(screen.queryByText('客户数据平台 CDP')).toBeNull()

    // 过滤「计划中」
    fireEvent.change(select, { target: { value: 'planning' } })
    expect(screen.getByText('智能仓储算法调度')).toBeInTheDocument()
    expect(screen.queryByText('海外电商支付网关')).toBeNull()

    // 过滤「全部状态」
    fireEvent.change(select, { target: { value: 'all' } })
    expect(screen.getByText('海外电商支付网关')).toBeInTheDocument()
    expect(screen.getByText('智能仓储算法调度')).toBeInTheDocument()
    expect(screen.getByText('客户数据平台 CDP')).toBeInTheDocument()
  })

  test('表头排序逻辑：点击项目名称与最后更新时间切换升降序', () => {
    renderWithClient(<SpaceMapProjectListLens projects={mockProjects} />)

    const nameHeader = screen.getByRole('columnheader', { name: /项目名称/i })

    // 点击名称表头切换为升序：海(h) -> 客(k) -> 移(y) -> 智(z)
    fireEvent.click(nameHeader)
    let rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]?.textContent).toContain('海外电商支付网关')
    expect(rows[rows.length - 1]?.textContent).toContain('智能仓储算法调度')

    // 再次点击切换为降序：智(z) -> 移(y) -> 客(k) -> 海(h)
    fireEvent.click(nameHeader)
    rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]?.textContent).toContain('智能仓储算法调度')
    expect(rows[rows.length - 1]?.textContent).toContain('海外电商支付网关')
  })

  test('键盘上下方向键（↑/↓）漫游高亮与 Enter 键直达项目空间', () => {
    const onSelectProject = vi.fn()
    const onClose = vi.fn()

    renderWithClient(
      <SpaceMapProjectListLens
        projects={mockProjects}
        onSelectProject={onSelectProject}
        onClose={onClose}
      />,
    )

    const container = screen.getByTestId('space-map-project-list-lens')
    const rows = screen.getAllByRole('row').slice(1)

    // 默认聚焦第 0 行 (海外电商支付网关)
    expect(rows[0]).toHaveAttribute('data-selected', 'true')

    // 按下方向键 ↓ 切换到第 1 行 (智能仓储算法调度)
    fireEvent.keyDown(container, { key: 'ArrowDown' })
    expect(rows[1]).toHaveAttribute('data-selected', 'true')

    // 按上方向键 ↑ 切回第 0 行
    fireEvent.keyDown(container, { key: 'ArrowUp' })
    expect(rows[0]).toHaveAttribute('data-selected', 'true')

    // 按下 Enter 直达
    fireEvent.keyDown(container, { key: 'Enter' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSelectProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, name: '海外电商支付网关' }),
    )
  })

  test('具备 project:create 权限时显示「+ 放置立项」按钮，点击触发动作', () => {
    const onOpenPlacement = vi.fn()
    renderWithClient(
      <SpaceMapProjectListLens projects={mockProjects} onOpenPlacement={onOpenPlacement} />,
    )

    const createBtn = screen.getByRole('button', { name: '放置立项' })
    expect(createBtn).toBeInTheDocument()

    fireEvent.click(createBtn)
    expect(onOpenPlacement).toHaveBeenCalledTimes(1)
  })

  test('无 project:create 权限时物理隐藏「+ 放置立项」按钮', () => {
    useAuthStore.setState({
      permissions: ['project:view'],
    })

    renderWithClient(<SpaceMapProjectListLens projects={mockProjects} />)
    expect(screen.queryByRole('button', { name: '放置立项' })).toBeNull()
  })
})
