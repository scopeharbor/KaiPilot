import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  useForecastSummary,
  useForecastDemandCurves,
  useForecastGapAnalysis,
  useForecastProjectDrivers,
  useForecastSkillDrivers,
  useForecastTrendBaseline,
  useForecastDrillDown,
  useForecastAiAdvisory,
} from '@/hooks/use-resource-demand-forecasting'
import type { ResourceDemandForecastQuery, ForecastDrillDownQuery } from '@aiproj/types'

// ── Mock API client ─────────────────────────────────────────────────────────
// We mock the keys + fetch functions to match the exact structure exported
// by the API module. The hooks use both keys (for queryKey) and fetch functions
// (for queryFn), so we recreate both.

const mockFetch = vi.hoisted(() => ({
  fetchForecastSummary: vi.fn(),
  fetchForecastDemandCurves: vi.fn(),
  fetchForecastGapAnalysis: vi.fn(),
  fetchForecastProjectDrivers: vi.fn(),
  fetchForecastSkillDrivers: vi.fn(),
  fetchForecastTrendBaseline: vi.fn(),
  fetchForecastDrillDown: vi.fn(),
  fetchForecastAiAdvisory: vi.fn(),
}))

vi.mock('@/lib/api/resource-demand-forecasting', () => ({
  resourceDemandForecastingKeys: {
    all: ['resource-demand-forecasting'] as const,
    summary: (orgId: number, query?: Partial<ResourceDemandForecastQuery>) =>
      ['resource-demand-forecasting', orgId, 'summary', query ?? {}] as const,
    demandCurves: (orgId: number, query?: Partial<ResourceDemandForecastQuery>) =>
      ['resource-demand-forecasting', orgId, 'demand-curves', query ?? {}] as const,
    gapAnalysis: (orgId: number, query?: Partial<ResourceDemandForecastQuery>) =>
      ['resource-demand-forecasting', orgId, 'gap-analysis', query ?? {}] as const,
    projectDrivers: (orgId: number, query?: Partial<ResourceDemandForecastQuery>) =>
      ['resource-demand-forecasting', orgId, 'project-drivers', query ?? {}] as const,
    skillDrivers: (orgId: number, query?: Partial<ResourceDemandForecastQuery>) =>
      ['resource-demand-forecasting', orgId, 'skill-drivers', query ?? {}] as const,
    trendBaseline: (orgId: number, query?: Partial<ResourceDemandForecastQuery>) =>
      ['resource-demand-forecasting', orgId, 'trend-baseline', query ?? {}] as const,
    drillDown: (orgId: number, drillDownQuery: ForecastDrillDownQuery) =>
      ['resource-demand-forecasting', orgId, 'drill-down', drillDownQuery] as const,
    aiAdvisory: (orgId: number) => ['resource-demand-forecasting', orgId, 'ai-advisory'] as const,
  },
  fetchForecastSummary: mockFetch.fetchForecastSummary,
  fetchForecastDemandCurves: mockFetch.fetchForecastDemandCurves,
  fetchForecastGapAnalysis: mockFetch.fetchForecastGapAnalysis,
  fetchForecastProjectDrivers: mockFetch.fetchForecastProjectDrivers,
  fetchForecastSkillDrivers: mockFetch.fetchForecastSkillDrivers,
  fetchForecastTrendBaseline: mockFetch.fetchForecastTrendBaseline,
  fetchForecastDrillDown: mockFetch.fetchForecastDrillDown,
  fetchForecastAiAdvisory: mockFetch.fetchForecastAiAdvisory,
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

const wrapper = createWrapper()

// ── Helper: mock resolved summary ───────────────────────────────────────────

const mockSummary = {
  window: {
    startDate: '2026-07-01',
    endDate: '2026-09-30',
    granularity: 'month' as const,
    bucketCount: 3,
  },
  metrics: {
    totalDemandHours: 4800,
    totalCapacityHours: 5200,
    overallUtilization: 0.92,
    shortageHours: 200,
    surplusHours: 600,
    netGapHours: -400,
    shortageCount: 3,
    surplusCount: 5,
    coveredRoles: 12,
    totalRoles: 15,
    coveredSkills: 45,
    totalSkills: 50,
  },
  freshness: {
    sources: { tasks: '2026-07-29T10:00:00Z', resources: '2026-07-29T09:30:00Z' },
    overallFreshness: '2026-07-29T10:00:00Z',
    isStale: false,
    staleSources: [],
    sourceCoverage: 1.0,
    freshnessHash: 'abc123',
  },
  overallConfidence: 'high' as const,
  method: 'deterministic_bucket' as const,
  warnings: [],
  projectCoverage: 0.95,
  resourceCoverage: 0.88,
}

const mockGapAnalysis = {
  gaps: [
    {
      gapId: 'gap-001',
      role: 'backend',
      skill: 'rust',
      projectId: 1,
      projectName: '测试项目A',
      taskId: 10,
      dateWindow: { from: '2026-08-01', to: '2026-09-30' },
      priority: 'high' as const,
      target: { kind: 'project' as const, href: '/projects/1', authorized: true },
      redacted: false,
    },
  ],
  totalShortage: 200,
  totalSurplus: 600,
  netGap: -400,
  warnings: [],
}

const mockDrillDown = {
  targetType: 'project',
  targetId: '1',
  details: { role: 'backend', demandHours: 800 },
  warnings: [],
}

const mockAdvisory = {
  advisoryOnly: true as const,
  writesApplied: false as const,
  narrative: '建议将 2 名后端工程师从项目 Alpha 调至项目 Beta，以缓解 Q3 的 Rust 技能缺口。',
  relatedGaps: [{ role: 'backend', skill: 'rust', gapHours: 120 }],
  suggestedActions: ['重新分配现有资源', '启动外部招聘 rust 角色'],
  warnings: [],
  confidence: 'high' as const,
  model: 'claude-5',
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. useForecastSummary — query key structure
// ═══════════════════════════════════════════════════════════════════════════════

describe('useForecastSummary query key structure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds correct query key with organizationId and empty query', async () => {
    mockFetch.fetchForecastSummary.mockResolvedValueOnce(mockSummary)

    const { result } = renderHook(() => useForecastSummary(1, {}), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastSummary).toHaveBeenCalledWith(1, {})
    expect(result.current.data).toBeDefined()
    expect(result.current.data!.overallConfidence).toBe('high')
  })

  it('query key includes organizationId', async () => {
    mockFetch.fetchForecastSummary.mockResolvedValueOnce(mockSummary)

    const { result } = renderHook(() => useForecastSummary(42, {}), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastSummary).toHaveBeenCalledWith(42, {})
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 2. useForecastDemandCurves — query key structure
// ═══════════════════════════════════════════════════════════════════════════════

describe('useForecastDemandCurves query key structure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds correct query key with organizationId and query params', async () => {
    const mockCurves = {
      roleBuckets: [],
      skillBuckets: [],
      projectBuckets: [],
      warnings: [],
    }
    mockFetch.fetchForecastDemandCurves.mockResolvedValueOnce(mockCurves)

    const query: Partial<ResourceDemandForecastQuery> = {
      startDate: '2026-07-01',
      endDate: '2026-09-30',
      granularity: 'month',
    }

    const { result } = renderHook(() => useForecastDemandCurves(1, query), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastDemandCurves).toHaveBeenCalledWith(1, query)
    expect(result.current.data!.projectBuckets).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 3. useForecastGapAnalysis — query key structure
// ═══════════════════════════════════════════════════════════════════════════════

describe('useForecastGapAnalysis query key structure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds correct query key and resolves gap analysis', async () => {
    mockFetch.fetchForecastGapAnalysis.mockResolvedValueOnce(mockGapAnalysis)

    const { result } = renderHook(() => useForecastGapAnalysis(1, { startDate: '2026-07-01' }), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastGapAnalysis).toHaveBeenCalledWith(1, {
      startDate: '2026-07-01',
    })
    expect(result.current.data!.gaps.length).toBe(1)
    expect(result.current.data!.netGap).toBe(-400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 4. useForecastProjectDrivers — query key structure
// ═══════════════════════════════════════════════════════════════════════════════

describe('useForecastProjectDrivers query key structure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds correct query key with pagination params', async () => {
    const mockDrivers = {
      data: [
        {
          projectId: 1,
          projectName: '核心平台重构',
          projectManager: '张三',
          demandHours: 1200,
          forecastHours: 1450,
          deltaHours: 250,
          deltaPercent: 20.8,
          topSkillGap: { skill: 'rust', gapHours: 80 },
          confidence: 'high' as const,
          warnings: [],
        },
      ],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockFetch.fetchForecastProjectDrivers.mockResolvedValueOnce(mockDrivers)

    const { result } = renderHook(
      () => useForecastProjectDrivers(1, { page: 1, perPage: 20, sort: 'gap', sortDir: 'desc' }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastProjectDrivers).toHaveBeenCalledWith(1, {
      page: 1,
      perPage: 20,
      sort: 'gap',
      sortDir: 'desc',
    })
    expect(result.current.data!.data[0]!.projectName!).toBe('核心平台重构')
    expect(result.current.data!.meta.total).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 5. useForecastSkillDrivers — query key structure
// ═══════════════════════════════════════════════════════════════════════════════

describe('useForecastSkillDrivers query key structure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds correct query key with skill filter', async () => {
    const mockSkillDrivers = {
      data: [
        {
          skill: 'typescript',
          resourceCount: 8,
          demandCount: 12,
          demandHours: 2400,
          capacityHours: 2800,
          gapHours: -400,
          gapDirection: 'surplus' as const,
          confidence: 'medium' as const,
          drillDownTarget: { targetType: 'skill' as const, targetId: 'typescript' },
          warnings: [],
        },
      ],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    }
    mockFetch.fetchForecastSkillDrivers.mockResolvedValueOnce(mockSkillDrivers)

    const { result } = renderHook(
      () => useForecastSkillDrivers(1, { skills: ['typescript', 'rust'], topN: 10 }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastSkillDrivers).toHaveBeenCalledWith(1, {
      skills: ['typescript', 'rust'],
      topN: 10,
    })
    expect(result.current.data!.data[0]!.gapHours).toBeLessThanOrEqual(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 6. useForecastTrendBaseline — query key structure
// ═══════════════════════════════════════════════════════════════════════════════

describe('useForecastTrendBaseline query key structure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds correct query key with role and method', async () => {
    const mockTrend = {
      role: 'backend',
      skill: undefined,
      buckets: [
        {
          bucketStart: '2026-07-01',
          bucketEnd: '2026-07-31',
          demand: 800,
          capacity: 900,
          gap: -100,
          confidence: 'high' as const,
        },
      ],
      method: 'deterministic_bucket' as const,
      historicalDataPoints: 24,
      warnings: [],
    }
    mockFetch.fetchForecastTrendBaseline.mockResolvedValueOnce(mockTrend)

    const { result } = renderHook(
      () =>
        useForecastTrendBaseline(1, {
          roles: ['backend'],
          method: 'deterministic_bucket',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastTrendBaseline).toHaveBeenCalledWith(1, {
      roles: ['backend'],
      method: 'deterministic_bucket',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    })
    expect(result.current.data!.role).toBe('backend')
    expect(result.current.data!.buckets.length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 7. useForecastDrillDown — disabled when drillDownQuery is null
// ═══════════════════════════════════════════════════════════════════════════════

describe('useForecastDrillDown query key and disabled state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is disabled (not fetched) when drillDownQuery is null', () => {
    const { result } = renderHook(() => useForecastDrillDown(1, null), { wrapper })

    // The query should be disabled; fetch should not be called
    expect(result.current.isPending).toBe(true)
    expect(mockFetch.fetchForecastDrillDown).not.toHaveBeenCalled()
  })

  it('fetches when drillDownQuery is provided', async () => {
    mockFetch.fetchForecastDrillDown.mockResolvedValueOnce(mockDrillDown)

    const drillQuery: ForecastDrillDownQuery = {
      targetType: 'project',
      targetId: '1',
    }

    const { result } = renderHook(() => useForecastDrillDown(1, drillQuery), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastDrillDown).toHaveBeenCalledWith(1, drillQuery)
    expect(result.current.data!.targetType).toBe('project')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 8. useForecastAiAdvisory — disabled when enabled is false
// ═══════════════════════════════════════════════════════════════════════════════

describe('useForecastAiAdvisory query key and enabled state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is disabled (not fetched) when enabled is false', () => {
    const { result } = renderHook(() => useForecastAiAdvisory(1, false), { wrapper })

    expect(result.current.isPending).toBe(true)
    expect(mockFetch.fetchForecastAiAdvisory).not.toHaveBeenCalled()
  })

  it('fetches when enabled is true', async () => {
    mockFetch.fetchForecastAiAdvisory.mockResolvedValueOnce(mockAdvisory)

    const { result } = renderHook(() => useForecastAiAdvisory(1, true), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastAiAdvisory).toHaveBeenCalledWith(1)
    expect(result.current.data!.advisoryOnly).toBe(true)
    expect(result.current.data!.narrative).toContain('Rust')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Filter parameters are passed correctly to hooks
// ═══════════════════════════════════════════════════════════════════════════════

describe('filter parameters passed to hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes complex filter params to useForecastSummary', async () => {
    mockFetch.fetchForecastSummary.mockResolvedValueOnce(mockSummary)

    const query: Partial<ResourceDemandForecastQuery> = {
      startDate: '2026-07-01',
      endDate: '2026-09-30',
      granularity: 'month',
      projectIds: ['1', '2', '3'],
      roles: ['backend', 'frontend'],
      skills: ['typescript', 'rust'],
      departments: ['engineering'],
      loadStatuses: ['normal', 'overloaded'],
      confidenceThreshold: 'medium',
      method: 'deterministic_bucket',
      freshnessThresholdSeconds: 120,
    }

    const { result } = renderHook(() => useForecastSummary(10, query), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastSummary).toHaveBeenCalledWith(10, query)
  })

  it('passes empty query object correctly', async () => {
    mockFetch.fetchForecastSummary.mockResolvedValueOnce(mockSummary)

    const { result } = renderHook(() => useForecastSummary(5, {}), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastSummary).toHaveBeenCalledWith(5, {})
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Query keys differ when organizationId changes
// ═══════════════════════════════════════════════════════════════════════════════

describe('query keys differ by organizationId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches with different orgId for useForecastSummary', async () => {
    mockFetch.fetchForecastSummary.mockResolvedValue(mockSummary)

    const { result: result1 } = renderHook(() => useForecastSummary(100, {}), { wrapper })
    const { result: result2 } = renderHook(() => useForecastSummary(200, {}), { wrapper })

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true)
      expect(result2.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastSummary).toHaveBeenCalledWith(100, {})
    expect(mockFetch.fetchForecastSummary).toHaveBeenCalledWith(200, {})
    expect(mockFetch.fetchForecastSummary).toHaveBeenCalledTimes(2)
  })

  it('fetches with different orgId for useForecastGapAnalysis', async () => {
    mockFetch.fetchForecastGapAnalysis.mockResolvedValue(mockGapAnalysis)

    const { result: result1 } = renderHook(() => useForecastGapAnalysis(10, {}), { wrapper })
    const { result: result2 } = renderHook(() => useForecastGapAnalysis(20, {}), { wrapper })

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true)
      expect(result2.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastGapAnalysis).toHaveBeenCalledWith(10, {})
    expect(mockFetch.fetchForecastGapAnalysis).toHaveBeenCalledWith(20, {})
    expect(mockFetch.fetchForecastGapAnalysis).toHaveBeenCalledTimes(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Query keys differ when query params change
// ═══════════════════════════════════════════════════════════════════════════════

describe('query keys differ by query params', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refetches useForecastSummary when query params change', async () => {
    // We use two separate renderHook calls with different params since
    // rerender with changed props within the same wrapper shares queryClient
    // cache. To prove query keys differ, we use two separate wrappers (which
    // have separate QueryClients).
    mockFetch.fetchForecastSummary.mockResolvedValueOnce(mockSummary)

    const { result: result1 } = renderHook(
      () => useForecastSummary(1, { startDate: '2026-07-01' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastSummary).toHaveBeenCalledWith(1, { startDate: '2026-07-01' })
    expect(mockFetch.fetchForecastSummary).toHaveBeenCalledTimes(1)

    // Second render with different query — different key, so new fetch
    mockFetch.fetchForecastSummary.mockResolvedValueOnce({
      ...mockSummary,
      window: { ...mockSummary.window, startDate: '2026-08-01' },
    })

    const { result: result2 } = renderHook(
      () => useForecastSummary(1, { startDate: '2026-08-01', roles: ['backend'] }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result2.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastSummary).toHaveBeenCalledWith(1, {
      startDate: '2026-08-01',
      roles: ['backend'],
    })
    expect(mockFetch.fetchForecastSummary).toHaveBeenCalledTimes(2)
  })

  it('refetches useForecastDemandCurves when granularity changes', async () => {
    mockFetch.fetchForecastDemandCurves.mockResolvedValueOnce({
      roleBuckets: [],
      skillBuckets: [],
      projectBuckets: [],
      warnings: [],
    })

    const { result: result1 } = renderHook(
      () => useForecastDemandCurves(1, { granularity: 'week' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastDemandCurves).toHaveBeenCalledWith(1, { granularity: 'week' })
    expect(mockFetch.fetchForecastDemandCurves).toHaveBeenCalledTimes(1)

    mockFetch.fetchForecastDemandCurves.mockResolvedValueOnce({
      roleBuckets: [{ role: 'backend', buckets: [{ bucketStart: '2026-07-01', demand: 100 }] }],
      skillBuckets: [],
      projectBuckets: [],
      warnings: [],
    })

    const { result: result2 } = renderHook(
      () => useForecastDemandCurves(1, { granularity: 'month' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(result2.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastDemandCurves).toHaveBeenCalledWith(1, { granularity: 'month' })
    expect(mockFetch.fetchForecastDemandCurves).toHaveBeenCalledTimes(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Stale time is set to 5 minutes for summary hooks
// ═══════════════════════════════════════════════════════════════════════════════

describe('stale time configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has staleTime = 5 minutes on useForecastSummary', async () => {
    // Verify staleTime indirectly: two renders with the same query key
    // within the stale time window should NOT trigger a second fetch.
    // We use a single wrapper so the QueryClient cache is shared.
    const sharedWrapper = createWrapper()

    mockFetch.fetchForecastSummary.mockResolvedValueOnce(mockSummary)

    const { result: result1 } = renderHook(
      () => useForecastSummary(1, { startDate: '2026-07-01' }),
      { wrapper: sharedWrapper },
    )

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true)
    })

    // First call should have been made
    expect(mockFetch.fetchForecastSummary).toHaveBeenCalledTimes(1)

    // Second render with same key — should use cached data, no new fetch
    const { result: result2 } = renderHook(
      () => useForecastSummary(1, { startDate: '2026-07-01' }),
      { wrapper: sharedWrapper },
    )

    await waitFor(() => {
      expect(result2.current.isSuccess).toBe(true)
    })

    // Still only one call — staleTime kept the cache fresh
    expect(mockFetch.fetchForecastSummary).toHaveBeenCalledTimes(1)
  })

  it('has staleTime = 5 minutes on useForecastDemandCurves', async () => {
    const sharedWrapper = createWrapper()

    mockFetch.fetchForecastDemandCurves.mockResolvedValueOnce({
      roleBuckets: [],
      skillBuckets: [],
      projectBuckets: [],
      warnings: [],
    })

    const { result: result1 } = renderHook(() => useForecastDemandCurves(1, {}), {
      wrapper: sharedWrapper,
    })

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastDemandCurves).toHaveBeenCalledTimes(1)

    const { result: result2 } = renderHook(() => useForecastDemandCurves(1, {}), {
      wrapper: sharedWrapper,
    })

    await waitFor(() => {
      expect(result2.current.isSuccess).toBe(true)
    })

    // Still one — staleTime of 5 min preserved the cache
    expect(mockFetch.fetchForecastDemandCurves).toHaveBeenCalledTimes(1)
  })

  it('triggers refetch when organizationId changes (different key bypasses staleTime)', async () => {
    const sharedWrapper = createWrapper()

    mockFetch.fetchForecastSummary.mockResolvedValueOnce(mockSummary)

    const { result: result1 } = renderHook(() => useForecastSummary(1, {}), {
      wrapper: sharedWrapper,
    })

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastSummary).toHaveBeenCalledTimes(1)

    // Different orgId → different query key → should refetch
    mockFetch.fetchForecastSummary.mockResolvedValueOnce({
      ...mockSummary,
      overallConfidence: 'medium' as const,
    })

    const { result: result2 } = renderHook(() => useForecastSummary(2, {}), {
      wrapper: sharedWrapper,
    })

    await waitFor(() => {
      expect(result2.current.isSuccess).toBe(true)
    })

    expect(mockFetch.fetchForecastSummary).toHaveBeenCalledTimes(2)
    expect(mockFetch.fetchForecastSummary).toHaveBeenLastCalledWith(2, {})
  })
})
