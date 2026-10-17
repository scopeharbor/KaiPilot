import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Mock } from 'vitest'
import {
  ORGANIZATION_DASHBOARD_EMPTY_FIXTURE,
  ORGANIZATION_DASHBOARD_NORMAL_FIXTURE,
  ORGANIZATION_DASHBOARD_PMO_UNAVAILABLE_FIXTURE,
  ORGANIZATION_DASHBOARD_RESTRICTED_FIXTURE,
} from '@aiproj/types'
import OrganizationDashboardPage from '@/app/(dashboard)/organization/page'
import { usePermissions } from '@/hooks/use-permissions'
import { useOrganizationDashboard } from '@/hooks/use-organization-dashboard'

vi.mock('@/hooks/use-permissions', () => ({ usePermissions: vi.fn() }))
vi.mock('@/hooks/use-organization-dashboard', () => ({
  useOrganizationDashboard: vi.fn(),
  useCurrentOrganizationId: vi.fn(() => 1),
}))
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganizationDashboardPage />
    </QueryClientProvider>,
  )
}

function grantAll() {
  ;(usePermissions as Mock).mockReturnValue({ canAny: () => true, can: () => true })
}

function mockDashboard(state: Partial<{ data: unknown; isLoading: boolean; error: unknown }>) {
  ;(useOrganizationDashboard as Mock).mockReturnValue({
    data: state.data ?? undefined,
    isLoading: state.isLoading ?? false,
    error: state.error ?? null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('组织总览页 —— 权限与请求状态', () => {
  it('无 org:view / portfolio:view 权限时显示无权限提示', () => {
    ;(usePermissions as Mock).mockReturnValue({ canAny: () => false, can: () => false })
    mockDashboard({ data: ORGANIZATION_DASHBOARD_NORMAL_FIXTURE })
    renderPage()
    expect(screen.getByText('您没有组织总览访问权限。')).toBeTruthy()
  })

  it('加载中显示骨架屏而不是空数据', () => {
    grantAll()
    mockDashboard({ isLoading: true })
    const { container } = renderPage()
    expect(screen.queryByText('待关注项目')).toBeNull()
    expect(
      container.querySelectorAll('[class*="animate"], [class*="skeleton"]').length,
    ).toBeGreaterThan(0)
  })

  it('请求失败显示错误提示，不渲染伪造指标', () => {
    grantAll()
    mockDashboard({ error: new Error('boom') })
    renderPage()
    expect(screen.getByText('加载组织总览失败，请稍后重试。')).toBeTruthy()
    expect(screen.queryByText('项目总数')).toBeNull()
  })
})

describe('组织总览页 —— 正常状态', () => {
  beforeEach(() => {
    grantAll()
    mockDashboard({ data: ORGANIZATION_DASHBOARD_NORMAL_FIXTURE })
  })

  it('首屏展示组织身份、KPI 条与核心区块', () => {
    renderPage()
    expect(screen.getByText('示例组织')).toBeTruthy()
    expect(screen.getByText('项目总数')).toBeTruthy()
    expect(screen.getByText('待关注')).toBeTruthy()
    expect(screen.getByText('项目状态分布')).toBeTruthy()
    expect(screen.getByText('待关注项目')).toBeTruthy()
    expect(screen.getByText('成员概览')).toBeTruthy()
    expect(screen.getByText('资源概览')).toBeTruthy()
    expect(screen.getByText('风险与延期提醒')).toBeTruthy()
    expect(screen.getByText('近期活动')).toBeTruthy()
    expect(screen.getByText('PMO 组合分析')).toBeTruthy()
    expect(screen.getByText('数据来源新鲜度')).toBeTruthy()
  })

  it('首屏没有营销式 landing 文案', () => {
    const { container } = renderPage()
    expect(container.textContent).not.toMatch(/立即开始|免费试用|了解更多产品/)
  })

  it('待关注项目展示理由徽标与授权跳转', () => {
    renderPage()
    expect(screen.getByText('健康度严重')).toBeTruthy()
    expect(screen.getByText('已延期')).toBeTruthy()
    const link = screen.getByText('核心平台重构').closest('a')
    expect(link?.getAttribute('href')).toBe('/projects/101')
  })

  it('stale 来源显示过期徽标', () => {
    renderPage()
    expect(screen.getByText(/个数据源已过期/)).toBeTruthy()
    expect(screen.getByText('数据源已过期')).toBeTruthy()
  })

  it('PMO 可用时展示摘要与工作台入口', () => {
    renderPage()
    const pmoLink = screen.getByText('进入 PMO 工作台').closest('a')
    expect(pmoLink?.getAttribute('href')).toBe('/pmo')
  })
})

describe('组织总览页 —— 空组织', () => {
  it('展示显式空态而不是零数据表格', () => {
    grantAll()
    mockDashboard({ data: ORGANIZATION_DASHBOARD_EMPTY_FIXTURE })
    renderPage()
    expect(screen.getByText('当前组织还没有可见项目')).toBeTruthy()
    expect(screen.getByText('当前没有需要关注的项目')).toBeTruthy()
    expect(screen.getByText('暂无可见活动')).toBeTruthy()
  })
})

describe('组织总览页 —— 权限受限脱敏', () => {
  beforeEach(() => {
    grantAll()
    mockDashboard({ data: ORGANIZATION_DASHBOARD_RESTRICTED_FIXTURE })
  })

  it('受限维度只显示不可见说明，不显示隐藏计数', () => {
    renderPage()
    const memberCard = screen.getByText('成员数据因权限不可见').closest('div')
    expect(memberCard).toBeTruthy()
    expect(memberCard?.textContent).not.toContain('24')

    const resourceCard = screen.getByText('资源数据因权限不可见').closest('div')
    expect(resourceCard).toBeTruthy()
    expect(resourceCard?.textContent).not.toContain('780')
  })

  it('受限风险提醒显示 -- 与「权限受限」而不是数字', () => {
    renderPage()
    const reminders = screen.getByText('风险与延期提醒').closest('section, div')
    expect(reminders).toBeTruthy()
    expect(screen.getAllByText('权限受限').length).toBeGreaterThan(0)
    expect(screen.getAllByText('--').length).toBeGreaterThan(0)
  })

  it('受限维度不渲染不安全链接', () => {
    const { container } = renderPage()
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).not.toContain('/resources')
    expect(hrefs).not.toContain('/risks')
  })
})

describe('组织总览页 —— PMO 不可用降级', () => {
  it('PMO 不可用时展示降级文案且其余区块照常渲染', () => {
    grantAll()
    mockDashboard({ data: ORGANIZATION_DASHBOARD_PMO_UNAVAILABLE_FIXTURE })
    renderPage()
    expect(screen.getByText('PMO 组合摘要暂不可用')).toBeTruthy()
    expect(screen.queryByText('进入 PMO 工作台')).toBeNull()
    expect(screen.getByText('项目总数')).toBeTruthy()
    expect(screen.getByText('待关注项目')).toBeTruthy()
  })
})

describe('组织总览页 —— 响应式与不重叠约束', () => {
  beforeEach(() => {
    grantAll()
    mockDashboard({ data: ORGANIZATION_DASHBOARD_NORMAL_FIXTURE })
  })

  it('KPI 条在窄屏用 2 列、宽屏用 6 列', () => {
    const { container } = renderPage()
    const strip = container.querySelector('section[aria-label="组织关键指标"] > div')
    expect(strip?.className).toContain('grid-cols-2')
    expect(strip?.className).toContain('sm:grid-cols-3')
    expect(strip?.className).toContain('lg:grid-cols-6')
  })

  it('组织名与徽标区带截断/换行约束，避免窄屏重叠', () => {
    const { container } = renderPage()
    const heading = screen.getByText('示例组织')
    expect(heading.className).toContain('truncate')
    const header = container.querySelector('header')
    expect(header?.className).toContain('flex-wrap')
    const badgeRow = header?.lastElementChild
    expect(badgeRow?.className).toContain('flex-wrap')
  })

  it('活动流与提醒卡使用 min-w-0 / truncate / nowrap 组合', () => {
    const { container } = renderPage()
    expect(container.querySelectorAll('.min-w-0').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.truncate').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.whitespace-nowrap').length).toBeGreaterThan(0)
  })

  it('状态分布进度条宽度被约束在 0–100%', () => {
    const { container } = renderPage()
    const bars = [...container.querySelectorAll('div[style*="width"]')] as HTMLElement[]
    expect(bars.length).toBeGreaterThan(0)
    for (const bar of bars) {
      const width = Number.parseFloat(bar.style.width)
      expect(width).toBeGreaterThanOrEqual(0)
      expect(width).toBeLessThanOrEqual(100)
    }
  })

  it('风险提醒栅格在窄屏 2 列、宽屏 4 列', () => {
    renderPage()
    // 「已延期项目」是提醒区独有标签（KPI 条不含该 key），可稳定定位到提醒栅格。
    const grid = screen.getByText('已延期项目').parentElement?.parentElement
    expect(grid?.className).toContain('grid-cols-2')
    expect(grid?.className).toContain('sm:grid-cols-4')
  })
})
