import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'

// —— next/navigation mock（pathname 由 mutable 变量控制） —— //
let mockPathname = '/projects/1/kanban'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: '1' }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/hooks/use-custom-views', () => ({
  CUSTOM_VIEW_PARAM: 'customView',
  isCustomViewActive: () => false,
  useCustomViewsList: () => ({
    isLoading: false,
    isError: false,
    isSuccess: true,
    data: { personal: [], shared: [] },
  }),
}))

function renderWithProviders(ui: React.ReactNode) {
  const queryClient = new QueryClient()
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  mockPathname = '/projects/1/kanban'
})

describe('项目导航「健康与风险」入口（§5.7/5.8）', () => {
  test('基础视图 Tab 之后出现「健康与风险」链接，指向只读指挥中心路由', async () => {
    const { ProjectTabs } = await import('@/components/layout/ProjectTabs')
    renderWithProviders(<ProjectTabs />)
    const link = screen.getByRole('link', { name: /健康与风险/ })
    expect(link.getAttribute('href')).toBe('/projects/1/health-risk-command-center')
    expect(link.getAttribute('data-state')).toBe('inactive')
  })

  test('进入指挥中心路由时高亮（aria-current + data-state）', async () => {
    mockPathname = '/projects/1/health-risk-command-center'
    const { ProjectTabs } = await import('@/components/layout/ProjectTabs')
    renderWithProviders(<ProjectTabs />)
    const link = screen.getByRole('link', { name: /健康与风险/ })
    expect(link.getAttribute('data-state')).toBe('active')
    expect(link.getAttribute('aria-current')).toBe('page')
  })

  test('既有默认视图 Tab 与高亮行为不受影响（回归）', async () => {
    mockPathname = '/projects/1/gantt'
    const { ProjectTabs } = await import('@/components/layout/ProjectTabs')
    renderWithProviders(<ProjectTabs />)
    const ganttLink = screen.getByRole('link', { name: /甘特图/ })
    expect(ganttLink.getAttribute('data-state')).toBe('active')
    const healthLink = screen.getByRole('link', { name: /健康与风险/ })
    expect(healthLink.getAttribute('data-state')).toBe('inactive')
  })

  test('默认项目视图重定向逻辑保持不变（resolveDefaultEntry 不受新入口影响）', async () => {
    const { resolveDefaultEntry } = await import('@/lib/navigation')
    // 无自定义视图 → 回退看板（既有权威行为）
    expect(resolveDefaultEntry(1, null)).toBe('/projects/1/kanban')
    // 有自定义视图 → 基础视图路由带参数
    expect(resolveDefaultEntry(1, 42)).toContain('/projects/1/')
  })

  test('紧凑密度下入口仍在文档流内且可键盘聚焦（overflow-x 滚动容器承载）', async () => {
    const { ProjectTabs } = await import('@/components/layout/ProjectTabs')
    renderWithProviders(<ProjectTabs />)
    const link = screen.getByRole('link', { name: /健康与风险/ })
    // 非绝对定位：随 overflow-x 容器横向滚动可达（窄屏菜单场景）
    expect(link.className).not.toContain('absolute')
    expect(link.tagName).toBe('A')
  })
})
