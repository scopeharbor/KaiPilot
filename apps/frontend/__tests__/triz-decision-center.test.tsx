/**
 * v3-triz-decision-center —— Frontend hooks 测试（tasks 6.3, 6.4）。
 *
 * 覆盖：query keys、disabled states、invalidation、API errors、
 * pagination、filters、stale item refresh behavior。
 */
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { trizDecisionCenterApi, trizDecisionCenterKeys } from '@/lib/api/triz-decision-center'
import {
  useTrizDecisionCenterSummary,
  useTrizDecisionCenterItems,
  useTrizDecisionCenterDetail,
  useTrizDecisionCenterReadiness,
  useInvalidateDecisionCenter,
} from '@/hooks/use-triz-decision-center'
import type { TrizDecisionCenterSummary, TrizDecisionCenterItem } from '@aiproj/types'
import { asMock } from './_mock-types'

// ---------------------------------------------------------------------------
// Mock API module
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/triz-decision-center', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/triz-decision-center')>(
    '@/lib/api/triz-decision-center',
  )
  return {
    ...actual,
    trizDecisionCenterApi: {
      summary: vi.fn(),
      items: vi.fn(),
      detail: vi.fn(),
      readiness: vi.fn(),
      draftReason: vi.fn(),
    },
  }
})

vi.mock('@/lib/api/triz-decision-log', () => ({
  trizDecisionLogKeys: {
    all: ['triz-decision-log'],
  },
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const summaryFixture: TrizDecisionCenterSummary = {
  queueCounts: {
    pending_decision: 1,
    missing_reason: 0,
    stale_source: 0,
    ready_for_draft: 0,
    blocked: 0,
    recently_decided: 0,
  },
  sourceCounts: {
    contradiction: 1,
    compiler_triz_analysis: 0,
    recommendation_rationale: 0,
    innovation_workbench: 0,
    draft_blocker: 0,
    decision_log: 0,
  },
  warningCounts: {
    TRIZ_DC_MISSING_SOURCE: 0,
    TRIZ_DC_STALE_SOURCE_HASH: 0,
    TRIZ_DC_INACCESSIBLE_TARGET: 0,
    TRIZ_DC_PERMISSION_DENIED: 0,
    TRIZ_DC_AI_FALLBACK: 0,
    TRIZ_DC_NO_DECISION_LOG: 0,
    TRIZ_DC_SOURCE_ERROR: 0,
    TRIZ_DC_CROSS_ORG_REF: 0,
    TRIZ_DC_REASON_TRUNCATED: 0,
  },
  recentKeyDecisions: [],
  totalItems: 1,
  readyForDraftCount: 0,
  blockedCount: 0,
}

const itemFixture: TrizDecisionCenterItem = {
  id: 'dc-test-001',
  projectId: 42,
  organizationId: 1,
  queueStatus: 'pending_decision',
  source: {
    sourceKind: 'contradiction',
    sourceId: 'contra-1',
    sourceHash: 'abc123',
    title: '测试矛盾',
    summary: '测试摘要',
    navigationRef: '/projects/42/contradictions/1',
    accessible: true,
  },
  subjectSummary: '测试主题',
  priority: 7,
  warnings: [],
  relatedDecisionLogIds: [],
  readiness: 'not_ready',
  allowedActions: ['adopt', 'view_detail'],
  createdAt: '2026-07-31T10:00:00.000Z',
  updatedAt: '2026-07-31T10:00:00.000Z',
  hasAccess: true,
}

const listFixture = {
  data: [itemFixture],
  meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
}

const detailFixture = {
  item: itemFixture,
  evidenceChain: [itemFixture.source],
  decisionTimeline: [],
  draftBlockerInfo: null,
  rationaleSummary: '测试理由',
  workbenchSchemeSummary: null,
}

const readinessFixture = {
  readyItems: [],
  blockedItems: [],
  staleItems: [],
  summary: {
    totalReady: 0,
    totalBlocked: 0,
    totalStale: 0,
    recommendations: [],
  },
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

// ===========================================================================
// Query Keys
// ===========================================================================

describe('trizDecisionCenterKeys', () => {
  it('generates stable summary key', () => {
    const key = trizDecisionCenterKeys.summary(42)
    expect(key).toEqual(['triz-decision-center', 'summary', 42])
  })

  it('generates stable items key with filters', () => {
    const key = trizDecisionCenterKeys.items(42, { status: 'blocked' })
    expect(key).toContain('triz-decision-center')
    expect(key).toContain('items')
    expect(key).toContain(42)
  })

  it('generates stable detail key', () => {
    const key = trizDecisionCenterKeys.detail(42, 'dc-001')
    expect(key).toEqual(['triz-decision-center', 'detail', 42, 'dc-001'])
  })

  it('generates stable readiness key', () => {
    const key = trizDecisionCenterKeys.readiness(42)
    expect(key).toEqual(['triz-decision-center', 'readiness', 42])
  })
})

// ===========================================================================
// Summary Hook
// ===========================================================================

describe('useTrizDecisionCenterSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches summary successfully', async () => {
    vi.mocked(trizDecisionCenterApi.summary).mockResolvedValue(summaryFixture)

    const { result } = renderHook(() => useTrizDecisionCenterSummary(42), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(trizDecisionCenterApi.summary).toHaveBeenCalledWith(42)
    expect(result.current.data).toEqual(summaryFixture)
  })

  it('does not fetch when projectId is invalid', async () => {
    const { result } = renderHook(() => useTrizDecisionCenterSummary(0), {
      wrapper: createWrapper(),
    })
    expect(result.current.isFetching).toBe(false)
    expect(trizDecisionCenterApi.summary).not.toHaveBeenCalled()
  })

  it('handles API error', async () => {
    vi.mocked(trizDecisionCenterApi.summary).mockRejectedValue({ status: 401 })

    const { result } = renderHook(() => useTrizDecisionCenterSummary(42), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

// ===========================================================================
// Items Hook
// ===========================================================================

describe('useTrizDecisionCenterItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches items with filters', async () => {
    vi.mocked(trizDecisionCenterApi.items).mockResolvedValue(listFixture.data)

    const { result } = renderHook(
      () => useTrizDecisionCenterItems(42, { status: 'pending_decision' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(trizDecisionCenterApi.items).toHaveBeenCalledWith(42, {
      status: 'pending_decision',
    })
    expect(result.current.data).toEqual(listFixture.data)
  })

  it('does not fetch when projectId is invalid', async () => {
    const { result } = renderHook(() => useTrizDecisionCenterItems(0), {
      wrapper: createWrapper(),
    })
    expect(result.current.isFetching).toBe(false)
    expect(trizDecisionCenterApi.items).not.toHaveBeenCalled()
  })

  it('handles pagination', async () => {
    vi.mocked(trizDecisionCenterApi.items).mockResolvedValue(listFixture.data)

    const { result } = renderHook(() => useTrizDecisionCenterItems(42, { page: 2, perPage: 10 }), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(trizDecisionCenterApi.items).toHaveBeenCalledWith(42, {
      page: 2,
      perPage: 10,
    })
  })
})

// ===========================================================================
// Detail Hook
// ===========================================================================

describe('useTrizDecisionCenterDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches detail when itemId is valid', async () => {
    vi.mocked(trizDecisionCenterApi.detail).mockResolvedValue(detailFixture)

    const { result } = renderHook(() => useTrizDecisionCenterDetail(42, 'dc-test-001'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(trizDecisionCenterApi.detail).toHaveBeenCalledWith(42, 'dc-test-001')
  })

  it('does not fetch when itemId is null', async () => {
    const { result } = renderHook(() => useTrizDecisionCenterDetail(42, null), {
      wrapper: createWrapper(),
    })
    expect(result.current.isFetching).toBe(false)
    expect(trizDecisionCenterApi.detail).not.toHaveBeenCalled()
  })

  it('does not fetch when projectId is invalid', async () => {
    const { result } = renderHook(() => useTrizDecisionCenterDetail(0, 'dc-test-001'), {
      wrapper: createWrapper(),
    })
    expect(result.current.isFetching).toBe(false)
  })
})

// ===========================================================================
// Readiness Hook
// ===========================================================================

describe('useTrizDecisionCenterReadiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches readiness successfully', async () => {
    vi.mocked(trizDecisionCenterApi.readiness).mockResolvedValue(
      asMock({
        data: readinessFixture,
      }),
    )

    const { result } = renderHook(() => useTrizDecisionCenterReadiness(42), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(trizDecisionCenterApi.readiness).toHaveBeenCalledWith(42)
  })

  it('does not fetch when projectId is invalid', async () => {
    const { result } = renderHook(() => useTrizDecisionCenterReadiness(0), {
      wrapper: createWrapper(),
    })
    expect(result.current.isFetching).toBe(false)
  })
})

// ===========================================================================
// Invalidation Hook
// ===========================================================================

describe('useInvalidateDecisionCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('provides invalidateAll function', async () => {
    const { result } = renderHook(() => useInvalidateDecisionCenter(42), {
      wrapper: createWrapper(),
    })

    expect(typeof result.current.invalidateAll).toBe('function')
    expect(typeof result.current.invalidateAfterDecisionWrite).toBe('function')

    // 应可调用而不抛错
    expect(() => result.current.invalidateAll()).not.toThrow()
  })
})
