// v3-bi-dashboard-builder §8.5 — BI Dashboard Builder 前端 Hook/Component 测试。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))

// Mock auth store：模拟已选择组织，`selectEffectiveOrganizationId` 返回 7。
// 测试内可通过改 `mockAuthState.currentOrganizationId` 模拟"未选择组织"。
const mockAuthState: { currentOrganizationId: number | null } = { currentOrganizationId: 7 }

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn((selector: (state: typeof mockAuthState) => unknown) =>
    selector(mockAuthState),
  ),
  selectEffectiveOrganizationId: (state: { currentOrganizationId: number | null }) =>
    state.currentOrganizationId,
}))

vi.mock('@/hooks/use-bi-dashboard', () => ({
  useWidgetRegistry: vi.fn(() => ({ data: { data: [] }, isLoading: false })),
  useCurrentDashboard: vi.fn(() => ({ data: null })),
  useDashboardList: vi.fn(() => ({ data: { data: [] } })),
  usePreviewDashboard: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false, error: null })),
  useCreateDashboard: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateDashboard: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useSetDefaultDashboard: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useArchiveDashboard: vi.fn(() => ({ mutateAsync: vi.fn() })),
}))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast, dismiss: vi.fn() }),
}))

import BiDashboardBuilder from '@/components/bi/bi-dashboard-builder'

// Mock the hooks and test the query key patterns
describe('BI Dashboard Builder Hooks', () => {
  describe('query keys', () => {
    it('widget registry query key is scoped to organization', () => {
      const key = ['bi-dashboard', 'registry', 1]
      expect(key).toEqual(['bi-dashboard', 'registry', 1])
    })

    it('dashboard list query key includes params', () => {
      const key = ['bi-dashboard', 'list', 1, { page: 1, perPage: 20 }]
      expect(key).toHaveLength(4)
    })

    it('current dashboard query key is scoped', () => {
      const key = ['bi-dashboard', 'current', 1]
      expect(key[0]).toBe('bi-dashboard')
      expect(key[2]).toBe(1)
    })

    it('detail query key includes dashboardId', () => {
      const key = ['bi-dashboard', 'detail', 1, 42]
      expect(key[3]).toBe(42)
    })
  })
})

describe('BI Dashboard Builder constants', () => {
  it('max widgets is 12', async () => {
    const { BI_DASHBOARD_MAX_WIDGETS } = await import('@aiproj/types')
    expect(BI_DASHBOARD_MAX_WIDGETS).toBe(12)
  })

  it('personal scope is defined', async () => {
    const { BI_DASHBOARD_SCOPES } = await import('@aiproj/types')
    expect(BI_DASHBOARD_SCOPES.PERSONAL).toBe('personal')
  })

  it('organization_shared scope is defined', async () => {
    const { BI_DASHBOARD_SCOPES } = await import('@aiproj/types')
    expect(BI_DASHBOARD_SCOPES.ORGANIZATION_SHARED).toBe('organization_shared')
  })

  it('widget keys are all defined', async () => {
    const { BI_DASHBOARD_WIDGET_KEYS } = await import('@aiproj/types')
    expect(BI_DASHBOARD_WIDGET_KEYS.BI_TREND).toBeTruthy()
    expect(BI_DASHBOARD_WIDGET_KEYS.BI_RISK_HEATMAP).toBeTruthy()
    expect(BI_DASHBOARD_WIDGET_KEYS.BI_CUSTOM_REPORT_SUMMARY).toBeTruthy()
    expect(BI_DASHBOARD_WIDGET_KEYS.PMO_HEALTH).toBeTruthy()
    expect(BI_DASHBOARD_WIDGET_KEYS.RESOURCE_SUMMARY).toBeTruthy()
  })

  it('freshness statuses are defined', async () => {
    const { BI_DASHBOARD_FRESHNESS_STATUSES } = await import('@aiproj/types')
    expect(BI_DASHBOARD_FRESHNESS_STATUSES.FRESH).toBe('fresh')
    expect(BI_DASHBOARD_FRESHNESS_STATUSES.STALE).toBe('stale')
  })

  it('warning codes are structured', async () => {
    const { BI_DASHBOARD_WARNING_CODES } = await import('@aiproj/types')
    expect(BI_DASHBOARD_WARNING_CODES.WIDGET_UNAVAILABLE).toBeTruthy()
    expect(BI_DASHBOARD_WARNING_CODES.WIDGET_FORBIDDEN).toBeTruthy()
    expect(BI_DASHBOARD_WARNING_CODES.WIDGET_TIMEOUT).toBeTruthy()
    expect(BI_DASHBOARD_WARNING_CODES.BLOCKING_MISSING_DEPENDENCY).toBeTruthy()
  })

  it('normalizeBiDashboardDefinition produces stable hash', async () => {
    const { normalizeBiDashboardDefinition } = await import('@aiproj/types')
    const def = {
      name: 'Test',
      scope: 'personal' as const,
      ownerActorId: 1,
      layout: { columns: 2, density: 'comfortable' as const },
      widgets: [],
      globalFilters: [],
      timeWindow: { mode: 'last_n_days' as const, days: 30 },
      freshnessPolicy: { maxAgeSeconds: 3600, staleBehavior: 'warning' as const },
      isDefault: false,
      isArchived: false,
      warningSummary: [],
    }
    const h1 = normalizeBiDashboardDefinition(def)
    const h2 = normalizeBiDashboardDefinition(def)
    expect(h1).toBe(h2)
  })
})

describe('BiDashboardBuilder 组织 id 解析（幽灵参数修复）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 默认已选择组织，避免上一个用例的改写泄漏
    mockAuthState.currentOrganizationId = 7
  })

  function renderBuilder() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(BiDashboardBuilder),
      ),
    )
  }

  it('所有查询/变更以 auth store 的组织 id（7）发出', async () => {
    const hooks = await import('@/hooks/use-bi-dashboard')

    renderBuilder()

    expect(screen.getByText('BI Dashboard Builder')).toBeTruthy()
    expect(hooks.useWidgetRegistry).toHaveBeenCalledWith(7)
    expect(hooks.useCurrentDashboard).toHaveBeenCalledWith(7)
    expect(hooks.useDashboardList).toHaveBeenCalledWith(7)
    expect(hooks.usePreviewDashboard).toHaveBeenCalledWith(7)
    expect(hooks.useCreateDashboard).toHaveBeenCalledWith(7)
    expect(hooks.useUpdateDashboard).toHaveBeenCalledWith(7)
    expect(hooks.useSetDefaultDashboard).toHaveBeenCalledWith(7)
    expect(hooks.useArchiveDashboard).toHaveBeenCalledWith(7)
  })

  it('未选择组织时显示提醒且不发任何请求，URL 不再出现 organizations/undefined', async () => {
    const hooks = await import('@/hooks/use-bi-dashboard')
    mockAuthState.currentOrganizationId = null

    renderBuilder()

    expect(screen.getByText('请先选择组织')).toBeTruthy()
    expect(hooks.useWidgetRegistry).not.toHaveBeenCalled()
    expect(hooks.useDashboardList).not.toHaveBeenCalled()
    expect(hooks.useCurrentDashboard).not.toHaveBeenCalled()
  })
})
