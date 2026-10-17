import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PmoPortfolioDashboardPage from '@/app/(dashboard)/pmo/page'

/**
 * task 10.9 —— 决策工作台入口权限门控与既有 PMO 导航不变。
 * 关闭（无 pmo_decision:view 权限）时入口隐藏；既有导航项不受影响。
 */
const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}))
vi.mock('next/dynamic', () => ({
  default: () => () => null,
}))
vi.mock('@/hooks/use-portfolio-dashboard', () => ({
  usePortfolioSummary: () => ({ data: undefined, isLoading: false, error: null }),
}))
let permissionSet = new Set<string>(['portfolio:view'])
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    canAny: (permissions: string[]) =>
      permissions.some((permission) => permissionSet.has(permission)),
    can: () => true,
  }),
}))
vi.mock('@/components/views/pmo/PmoInvestmentDistributionSection', () => ({
  PmoInvestmentDistributionSection: () => null,
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PmoPortfolioDashboardPage />
    </QueryClientProvider>,
  )
}

describe('PMO 总览 —— 决策工作台入口门控（task 10.9）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    permissionSet = new Set<string>(['portfolio:view'])
  })

  it('具备 pmo_decision:view 时显示决策工作台入口', () => {
    permissionSet.add('pmo_decision:view')
    renderPage()
    expect(screen.getByRole('button', { name: /决策工作台/ })).toBeTruthy()
  })

  it('无权限时入口隐藏，且既有 PMO 导航（优先级评分等）保持不变', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: /决策工作台/ })).toBeNull()
    // 既有导航不受影响
    expect(screen.getByRole('button', { name: /优先级评分/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /组织资源池/ })).toBeTruthy()
  })
})
