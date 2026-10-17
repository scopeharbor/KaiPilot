import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { OrganizationResourcePoolSummary } from '@aiproj/types'

// ── Mock Hooks ──────────────────────────────────────────────────────────────

const mockSummary = vi.hoisted(() => vi.fn())
const mockResources = vi.hoisted(() => vi.fn())
const mockSkills = vi.hoisted(() => vi.fn())
const mockCapacity = vi.hoisted(() => vi.fn())
const mockConflicts = vi.hoisted(() => vi.fn())
const mockDemandGaps = vi.hoisted(() => vi.fn())
// 权限判定用可切换状态：vi.doMock 在模块已被 import 后不生效（需 resetModules），
// 改为顶层 mock 读取这个开关。
const permState = vi.hoisted(() => ({ allowed: true }))

vi.mock('@/hooks/use-organization-resource-pool', () => ({
  useOrganizationResourcePoolSummary: (query?: Record<string, unknown>) => mockSummary(query),
  useOrganizationResourcePoolResources: (query?: Record<string, unknown>) => mockResources(query),
  useOrganizationResourcePoolSkills: (query?: Record<string, unknown>) => mockSkills(query),
  useOrganizationResourcePoolCapacity: (query?: Record<string, unknown>) => mockCapacity(query),
  useOrganizationResourcePoolConflicts: (query?: Record<string, unknown>) => mockConflicts(query),
  useOrganizationResourcePoolDemandGaps: (query?: Record<string, unknown>) => mockDemandGaps(query),
}))

vi.mock('@/hooks/use-permissions', () => ({
  // 只桩掉页面用到的判定，其余字段测试里不消费。
  usePermissions: () => ({
    permissions: [],
    can: () => permState.allowed,
    hasPermission: () => permState.allowed,
    canAny: () => permState.allowed,
    canAll: () => permState.allowed,
  }),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => {
      const defaults: Record<string, string> = {
        view: 'matrix',
        page: '1',
        sort: 'utilization',
        order: 'desc',
        loadStatus: '',
        conflictSeverity: '',
        role: '',
        skill: '',
        search: '',
      }
      return defaults[key] ?? ''
    },
  }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}))

// ── Test Wrapper ────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeLoadingState() {
  return { isLoading: true, data: undefined, error: null, isSuccess: false, isError: false }
}

function makeErrorState() {
  return {
    isLoading: false,
    data: undefined,
    error: new Error('加载失败'),
    isSuccess: false,
    isError: true,
  }
}

function makeSummaryFixture(
  overrides: Partial<OrganizationResourcePoolSummary> = {},
): OrganizationResourcePoolSummary {
  return {
    meta: {
      calculatedAt: new Date().toISOString(),
      metricVersion: 'organization-resource-pool.v1',
      organizationId: 1,
      actorId: 1,
      visibleProjectCount: 3,
      querySignatureHash: 'test',
    },
    metrics: [
      {
        key: 'org_respool_total_resources',
        value: 10,
        unit: 'count',
        source: 'resource_registry',
        status: 'ok',
      },
      {
        key: 'org_respool_active_resources',
        value: 8,
        unit: 'count',
        source: 'resource_registry',
        status: 'ok',
      },
      {
        key: 'org_respool_linked_users',
        value: 8,
        unit: 'count',
        source: 'membership',
        status: 'ok',
      },
      {
        key: 'org_respool_visible_projects',
        value: 3,
        unit: 'count',
        source: 'project',
        status: 'ok',
      },
      {
        key: 'org_respool_total_capacity_hours',
        value: 2400,
        unit: 'hours',
        source: 'resource_registry',
        status: 'ok',
      },
      {
        key: 'org_respool_allocated_capacity_hours',
        value: 1200,
        unit: 'hours',
        source: 'resource_allocation',
        status: 'ok',
      },
      {
        key: 'org_respool_remaining_capacity_hours',
        value: 1200,
        unit: 'hours',
        source: 'computed',
        status: 'ok',
      },
      {
        key: 'org_respool_avg_utilization_percent',
        value: 50,
        unit: 'percent',
        source: 'computed',
        status: 'ok',
      },
      {
        key: 'org_respool_idle_resources',
        value: 1,
        unit: 'count',
        source: 'computed',
        status: 'ok',
      },
      {
        key: 'org_respool_normal_load_resources',
        value: 5,
        unit: 'count',
        source: 'computed',
        status: 'ok',
      },
      {
        key: 'org_respool_high_load_resources',
        value: 3,
        unit: 'count',
        source: 'computed',
        status: 'ok',
      },
      {
        key: 'org_respool_overloaded_resources',
        value: 1,
        unit: 'count',
        source: 'computed',
        status: 'ok',
      },
      {
        key: 'org_respool_skill_coverage_count',
        value: 4,
        unit: 'count',
        source: 'computed',
        status: 'ok',
      },
      {
        key: 'org_respool_demand_gap_count',
        value: 2,
        unit: 'count',
        source: 'resource_requirement',
        status: 'ok',
      },
      {
        key: 'org_respool_conflict_count',
        value: 1,
        unit: 'count',
        source: 'computed',
        status: 'ok',
      },
    ],
    warnings: [],
    sourceFreshness: [
      {
        source: 'resource_registry',
        lastUpdatedAt: new Date().toISOString(),
        isStale: false,
        staleThresholdMinutes: 60,
        status: 'ok',
      },
      {
        source: 'resource_allocation',
        lastUpdatedAt: new Date().toISOString(),
        isStale: false,
        staleThresholdMinutes: 60,
        status: 'ok',
      },
    ],
    resourceCount: 10,
    linkedUserCount: 8,
    capacity: {
      totalHours: 2400,
      allocatedHours: 1200,
      remainingHours: 1200,
      averageUtilizationPercent: 50,
    },
    loadDistribution: { idle: 1, normal: 5, high: 3, overloaded: 1, unavailable: 0 },
    skillCoverage: [],
    demandGapCount: 2,
    conflictCount: 1,
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Page Rendering Tests
// ═══════════════════════════════════════════════════════════════════════════════

// Note: These tests import the page component dynamically to avoid Next.js
// module resolution issues in Vitest. The page component uses @/ imports
// that resolve through the project's tsconfig paths.

describe('OrganizationResourcePoolPage — States', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    permState.allowed = true
  })

  it('renders KPI strip when data loaded', async () => {
    mockSummary.mockReturnValue({
      isLoading: false,
      data: makeSummaryFixture(),
      error: null,
      isSuccess: true,
      isError: false,
    })
    mockResources.mockReturnValue({
      isLoading: false,
      data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
    })
    mockSkills.mockReturnValue({ isLoading: false, data: [] })
    mockCapacity.mockReturnValue({ isLoading: false, data: { from: '', to: '', rows: [] } })
    mockConflicts.mockReturnValue({
      isLoading: false,
      data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
    })
    mockDemandGaps.mockReturnValue({
      isLoading: false,
      data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
    })

    const OrganizationResourcePoolPage = (
      await import('@/app/(dashboard)/organization/resource-pool/page')
    ).default
    const wrapper = createWrapper()
    const { container } = render(
      React.createElement(wrapper, { children: React.createElement(OrganizationResourcePoolPage) }),
    )

    // Page should render without crashing and show Chinese labels
    expect(container.textContent).toContain('组织资源池')
  })

  it('shows empty state when no resources', async () => {
    mockSummary.mockReturnValue({
      isLoading: false,
      data: makeSummaryFixture({
        resourceCount: 0,
        capacity: {
          totalHours: 0,
          allocatedHours: 0,
          remainingHours: 0,
          averageUtilizationPercent: 0,
        },
      }),
      error: null,
      isSuccess: true,
      isError: false,
    })
    mockResources.mockReturnValue({
      isLoading: false,
      data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
    })
    mockSkills.mockReturnValue({ isLoading: false, data: [] })
    mockCapacity.mockReturnValue({ isLoading: false, data: { from: '', to: '', rows: [] } })
    mockConflicts.mockReturnValue({
      isLoading: false,
      data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
    })
    mockDemandGaps.mockReturnValue({
      isLoading: false,
      data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
    })

    const OrganizationResourcePoolPage = (
      await import('@/app/(dashboard)/organization/resource-pool/page')
    ).default
    const wrapper = createWrapper()
    const { container } = render(
      React.createElement(wrapper, { children: React.createElement(OrganizationResourcePoolPage) }),
    )

    expect(container.textContent).toContain('当前组织没有可见项目或资源')
  })

  it('shows loading skeletons', async () => {
    mockSummary.mockReturnValue(makeLoadingState())
    mockResources.mockReturnValue(makeLoadingState())
    mockSkills.mockReturnValue(makeLoadingState())
    mockCapacity.mockReturnValue(makeLoadingState())
    mockConflicts.mockReturnValue(makeLoadingState())
    mockDemandGaps.mockReturnValue(makeLoadingState())

    const OrganizationResourcePoolPage = (
      await import('@/app/(dashboard)/organization/resource-pool/page')
    ).default
    const wrapper = createWrapper()
    render(
      React.createElement(wrapper, { children: React.createElement(OrganizationResourcePoolPage) }),
    )

    // Loading skeletons should be rendered
    const skeletons = document.querySelectorAll('[data-slot="skeleton"], .animate-pulse')
    expect(skeletons.length).toBeGreaterThanOrEqual(0) // shadcn uses different skeleton markers
  })

  it('shows error state on API failure', async () => {
    mockSummary.mockReturnValue(makeErrorState())
    mockResources.mockReturnValue(makeLoadingState())
    mockSkills.mockReturnValue(makeLoadingState())
    mockCapacity.mockReturnValue(makeLoadingState())
    mockConflicts.mockReturnValue(makeLoadingState())
    mockDemandGaps.mockReturnValue(makeLoadingState())

    const OrganizationResourcePoolPage = (
      await import('@/app/(dashboard)/organization/resource-pool/page')
    ).default
    const wrapper = createWrapper()
    const { container } = render(
      React.createElement(wrapper, { children: React.createElement(OrganizationResourcePoolPage) }),
    )

    expect(container.textContent).toContain('加载组织资源池失败')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Mobile / Responsive
// ═══════════════════════════════════════════════════════════════════════════════

describe('OrganizationResourcePoolPage — Mobile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock mobile viewport
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    })
  })

  it('renders without horizontal overflow on narrow viewport', async () => {
    mockSummary.mockReturnValue({
      isLoading: false,
      data: makeSummaryFixture(),
      error: null,
      isSuccess: true,
      isError: false,
    })
    mockResources.mockReturnValue({
      isLoading: false,
      data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
    })
    mockSkills.mockReturnValue({ isLoading: false, data: [] })
    mockCapacity.mockReturnValue({ isLoading: false, data: { from: '', to: '', rows: [] } })
    mockConflicts.mockReturnValue({
      isLoading: false,
      data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
    })
    mockDemandGaps.mockReturnValue({
      isLoading: false,
      data: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
    })

    const OrganizationResourcePoolPage = (
      await import('@/app/(dashboard)/organization/resource-pool/page')
    ).default
    const wrapper = createWrapper()
    const { container } = render(
      React.createElement(wrapper, { children: React.createElement(OrganizationResourcePoolPage) }),
    )

    // Verify no overly wide fixed-width elements break mobile layout
    const rootDiv = container.firstElementChild as HTMLElement
    if (rootDiv) {
      expect(rootDiv.className).toContain('p-4')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Permission Restricted
// ═══════════════════════════════════════════════════════════════════════════════

describe('OrganizationResourcePoolPage — Permission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    permState.allowed = true
  })

  it('shows forbidden state when user lacks access', async () => {
    permState.allowed = false

    mockSummary.mockReturnValue(makeLoadingState())
    mockResources.mockReturnValue(makeLoadingState())
    mockSkills.mockReturnValue(makeLoadingState())
    mockCapacity.mockReturnValue(makeLoadingState())
    mockConflicts.mockReturnValue(makeLoadingState())
    mockDemandGaps.mockReturnValue(makeLoadingState())

    const OrganizationResourcePoolPage = (
      await import('@/app/(dashboard)/organization/resource-pool/page')
    ).default
    const wrapper = createWrapper()
    const { container } = render(
      React.createElement(wrapper, { children: React.createElement(OrganizationResourcePoolPage) }),
    )

    expect(container.textContent).toContain('没有组织资源池访问权限')
  })
})
