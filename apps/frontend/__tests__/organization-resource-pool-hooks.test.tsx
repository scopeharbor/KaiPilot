import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  useOrganizationResourcePoolSummary,
  useOrganizationResourcePoolResources,
  useOrganizationResourcePoolSkills,
  useOrganizationResourcePoolCapacity,
  useOrganizationResourcePoolConflicts,
  useOrganizationResourcePoolDemandGaps,
} from '@/hooks/use-organization-resource-pool'
import { emptyOrganizationResourcePool, normalOrganizationResourcePool } from '@aiproj/types'
import type { OrganizationResourcePoolQuery } from '@aiproj/types'

// ── Mock API client ─────────────────────────────────────────────────────────
//
// mock 形状必须等于**后端真实形状经 api client 解包后**的载荷：
// `summary` / `skills` / `capacity` 走 `apiFetch<T>`（返回载荷本体），
// `resources` / `conflicts` / `demandGaps` 走 `apiFetchEnvelope`（返回 `{ data, meta }` 信封）。

const mockApi = vi.hoisted(() => ({
  summary: vi.fn(),
  resources: vi.fn(),
  skills: vi.fn(),
  capacity: vi.fn(),
  conflicts: vi.fn(),
  demandGaps: vi.fn(),
}))

vi.mock('@/lib/api/organization-resource-pool', () => ({
  organizationResourcePoolApi: mockApi,
  organizationResourcePoolKeys: {
    all: ['organization-resource-pool'] as const,
    summary: (orgId: number, query?: Record<string, unknown>) =>
      ['organization-resource-pool', 'summary', orgId, query] as const,
    resources: (orgId: number, query?: Record<string, unknown>) =>
      ['organization-resource-pool', 'resources', orgId, query] as const,
    skills: (orgId: number, query?: Record<string, unknown>) =>
      ['organization-resource-pool', 'skills', orgId, query] as const,
    capacity: (orgId: number, query?: Record<string, unknown>) =>
      ['organization-resource-pool', 'capacity', orgId, query] as const,
    conflicts: (orgId: number, query?: Record<string, unknown>) =>
      ['organization-resource-pool', 'conflicts', orgId, query] as const,
    demandGaps: (orgId: number, query?: Record<string, unknown>) =>
      ['organization-resource-pool', 'demandGaps', orgId, query] as const,
  },
}))

vi.mock('@/hooks/use-organization-dashboard', () => ({
  useCurrentOrganizationId: () => 1,
}))

// ── Test wrapper ────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

// 每条用例都要新的 QueryClient：共用一个会让上一条用例缓存的结果被下一条命中，
// 表现为 loading/error/empty 断言全部拿到上一条的成功数据。
let wrapper = createWrapper()
beforeEach(() => {
  wrapper = createWrapper()
})

// ═══════════════════════════════════════════════════════════════════════════════
// Summary Hook
// ═══════════════════════════════════════════════════════════════════════════════

describe('useOrganizationResourcePoolSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves summary data', async () => {
    mockApi.summary.mockResolvedValueOnce(normalOrganizationResourcePool)

    const { result } = renderHook(() => useOrganizationResourcePoolSummary(), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toBeDefined()
    expect(result.current.data!.resourceCount).toBeGreaterThan(0)
    expect(result.current.data!.metrics.length).toBeGreaterThan(0)
  })

  it('handles empty organization pool', async () => {
    mockApi.summary.mockResolvedValueOnce(emptyOrganizationResourcePool)

    const { result } = renderHook(() => useOrganizationResourcePoolSummary(), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data!.resourceCount).toBe(0)
    expect(
      result.current.data!.warnings.some((w) => w.code === 'EMPTY_ORGANIZATION_RESOURCE_POOL'),
    ).toBe(true)
  })

  it('exposes loading state', () => {
    mockApi.summary.mockReturnValueOnce(new Promise(() => {})) // never resolves

    const { result } = renderHook(() => useOrganizationResourcePoolSummary(), {
      wrapper,
    })

    expect(result.current.isLoading).toBe(true)
  })

  it('exposes error state on failure', async () => {
    mockApi.summary.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useOrganizationResourcePoolSummary(), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error).toBeDefined()
  })

  it('accepts query parameters', async () => {
    mockApi.summary.mockResolvedValueOnce(normalOrganizationResourcePool)
    const query: OrganizationResourcePoolQuery = {
      from: '2026-01-01',
      to: '2026-03-31',
      freshnessWindowMinutes: 30,
    }

    const { result } = renderHook(() => useOrganizationResourcePoolSummary(query), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockApi.summary).toHaveBeenCalledWith(1, query)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Resources Hook
// ═══════════════════════════════════════════════════════════════════════════════

describe('useOrganizationResourcePoolResources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns paginated resource rows', async () => {
    mockApi.resources.mockResolvedValueOnce({
      data: [
        {
          resourceId: 1,
          resourceName: '张三',
          resourceType: 'human',
          role: 'developer',
          status: 'active',
          skillTags: ['typescript'],
          department: null,
          linkedUserId: null,
          projectCount: 2,
          totalCapacityHours: 240,
          totalAllocatedHours: 120,
          totalRemainingHours: 120,
          utilizationPercent: 50,
          loadStatus: 'normal',
          conflictFlags: [],
          freshness: null,
          target: null,
          redacted: false,
        },
      ],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })

    const { result } = renderHook(
      () => useOrganizationResourcePoolResources({ page: 1, perPage: 20 }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data!.data.length).toBe(1)
    expect(result.current.data!.meta.total).toBe(1)
    expect(result.current.data!.data[0]!.resourceName!).toBe('张三')
  })

  it('shows redacted resource when permission is restricted', async () => {
    mockApi.resources.mockResolvedValueOnce({
      data: [
        {
          resourceId: 1,
          resourceName: null,
          resourceType: null,
          role: null,
          status: null,
          skillTags: null,
          department: null,
          linkedUserId: null,
          projectCount: null,
          totalCapacityHours: 240,
          totalAllocatedHours: 120,
          totalRemainingHours: 120,
          utilizationPercent: 50,
          loadStatus: 'normal',
          conflictFlags: [],
          freshness: null,
          target: null,
          redacted: true,
        },
      ],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })

    const { result } = renderHook(() => useOrganizationResourcePoolResources(), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data!.data[0]!.redacted!).toBe(true)
    expect(result.current.data!.data[0]!.resourceName!).toBeNull()
    expect(result.current.data!.data[0]!.role!).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Skills Hook
// ═══════════════════════════════════════════════════════════════════════════════

describe('useOrganizationResourcePoolSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns skill coverage items', async () => {
    mockApi.skills.mockResolvedValueOnce([
      {
        skill: 'typescript',
        resourceCount: 5,
        capacityHours: 1200,
        allocatedHours: 600,
        remainingHours: 600,
        demandCount: 2,
        gap: false,
        redacted: false,
      },
    ])

    const { result } = renderHook(() => useOrganizationResourcePoolSkills(), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data![0]!.skill!).toBe('typescript')
  })

  it('handles redacted skills for low-cardinality', async () => {
    mockApi.skills.mockResolvedValueOnce([
      {
        skill: null,
        resourceCount: null,
        capacityHours: null,
        allocatedHours: null,
        remainingHours: null,
        demandCount: null,
        gap: false,
        redacted: true,
      },
    ])

    const { result } = renderHook(() => useOrganizationResourcePoolSkills(), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data![0]!.redacted!).toBe(true)
    expect(result.current.data![0]!.skill!).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Capacity Hook
// ═══════════════════════════════════════════════════════════════════════════════

describe('useOrganizationResourcePoolCapacity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns capacity matrix with date range', async () => {
    mockApi.capacity.mockResolvedValueOnce({
      from: '2026-01-01',
      to: '2026-03-31',
      rows: [
        {
          resourceId: 1,
          resourceName: '张三',
          role: 'developer',
          loadStatus: 'normal',
          totalCapacityHours: 480,
          totalAllocatedHours: 240,
          totalRemainingHours: 240,
          utilizationPercent: 50,
          cells: [
            {
              date: '2026-01-01',
              capacityHours: 8,
              allocatedHours: 4,
              remainingHours: 4,
              utilizationPercent: 50,
              loadStatus: 'normal',
              conflictFlags: [],
            },
          ],
          redacted: false,
        },
      ],
    })

    const { result } = renderHook(() => useOrganizationResourcePoolCapacity(), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data!.rows.length).toBe(1)
    expect(result.current.data!.from).toBe('2026-01-01')
    expect(result.current.data!.rows[0]!.cells.length!).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Conflicts Hook
// ═══════════════════════════════════════════════════════════════════════════════

describe('useOrganizationResourcePoolConflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns conflict list with critical severity', async () => {
    mockApi.conflicts.mockResolvedValueOnce({
      data: [
        {
          conflictId: 'abc123',
          severity: 'critical',
          resourceId: 1,
          resourceName: '张三',
          projectIds: [1],
          projectNames: ['测试项目'],
          description: '资源分配超过 100%：150%',
          date: null,
          remediationHint: '建议调整分配百分比或增加资源容量',
          target: { kind: 'resource', href: '/resources/1', authorized: true },
          redacted: false,
        },
      ],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })

    const { result } = renderHook(() => useOrganizationResourcePoolConflicts(), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data!.data[0]!.severity!).toBe('critical')
    expect(result.current.data!.data[0]!.description!).toContain('150%')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Demand Gaps Hook
// ═══════════════════════════════════════════════════════════════════════════════

describe('useOrganizationResourcePoolDemandGaps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns demand gap items', async () => {
    mockApi.demandGaps.mockResolvedValueOnce({
      data: [
        {
          gapId: 'gap123',
          skill: 'rust',
          role: 'backend',
          projectId: 1,
          projectName: '测试项目',
          taskId: 10,
          dateWindow: { from: '2026-05-01', to: '2026-06-30' },
          priority: 'high',
          target: { kind: 'project', href: '/projects/1', authorized: true },
          redacted: false,
        },
      ],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })

    const { result } = renderHook(() => useOrganizationResourcePoolDemandGaps(), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data!.data[0]!.role!).toBe('backend')
    expect(result.current.data!.data[0]!.skill!).toBe('rust')
  })

  it('filters blocked if skill not available', async () => {
    mockApi.demandGaps.mockResolvedValueOnce({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    })

    const { result } = renderHook(
      () => useOrganizationResourcePoolDemandGaps({ skill: 'nonesistent-skill' }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data!.data.length).toBe(0)
  })
})
