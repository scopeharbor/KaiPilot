/**
 * v2-triz-decision-log-traceability —— Frontend tests for decision log hooks, panel,
 * Draft blocker, Dashboard, Timeline, and permission states (tasks 8.7).
 */
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { trizDecisionLogApi } from '@/lib/api/triz-decision-log'
import {
  useTrizDecisionLogsList,
  useTrizDecisionLogDetail,
  useTrizDecisionSubjectLookup,
  useCreateTrizDecisionLog,
  useSupersedeTrizDecisionLog,
  useTrizDecisionAiDraft,
} from '@/hooks/use-triz-decision-log'
import { TrizDecisionDashboardCard } from '@/components/ai-copilot/TrizDecisionDashboardCard'
import {
  TrizDecisionTimelineEvent,
  TrizTimelineEventSkeleton,
} from '@/components/ai-copilot/TrizDecisionTimelineEvent'
import type {
  TrizDecisionLogEntry,
  TrizDecisionDashboardSummary,
  TrizDecisionTimelineEvent as TrizDecisionTimelineEventType,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// Mock API module
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/triz-decision-log', () => ({
  trizDecisionLogApi: {
    list: vi.fn(),
    detail: vi.fn(),
    create: vi.fn(),
    supersede: vi.fn(),
    subjectLookup: vi.fn(),
    draftReason: vi.fn(),
  },
  trizDecisionLogKeys: {
    all: ['triz-decision-log'],
    list: (projectId: number, page = 1, perPage = 20) => [
      'triz-decision-log',
      'list',
      projectId,
      page,
      perPage,
    ],
    detail: (projectId: number, decisionLogId: number) => [
      'triz-decision-log',
      'detail',
      projectId,
      decisionLogId,
    ],
    subjectLookup: (projectId: number, kind: string, id: string) => [
      'triz-decision-log',
      'subject',
      projectId,
      kind,
      id,
    ],
  },
}))

// ---------------------------------------------------------------------------
// Mock permission hooks
// ---------------------------------------------------------------------------

const mockPermissions: { value: string[] } = {
  value: ['triz_decision:view', 'triz_decision:manage'],
}

function createPermissionMock(permissions: string[]) {
  return () => ({
    permissions,
    can: (p: string) => permissions.includes(p),
    canAny: (list: string[]) => list.some((p: string) => permissions.includes(p)),
    canAll: (list: string[]) => list.every((p: string) => permissions.includes(p)),
  })
}

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => createPermissionMock(mockPermissions.value)(),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const subjectRef = {
  kind: 'contradiction' as const,
  id: 'tc-dur-vs-res',
  version: 'v1',
  summaryLevel: 'low' as const,
  visibility: 'public' as const,
  title: '工期与资源负载取舍',
}

const sourceRefs = [
  { kind: 'contradiction', id: 'tc-dur-vs-res', hash: 'abc123', summary: '工期 vs 资源' },
]

const decisionLogEntryFixture: TrizDecisionLogEntry = {
  id: 1,
  organizationId: 1,
  projectId: 42,
  decisionType: 'adopt',
  decisionStatus: 'active',
  subjectRefs: [subjectRef],
  sourceRefs,
  artifactHashes: [],
  reasonSummary: '优先保证工期，适当增加资源投入。',
  reasonHash: 'a1b2c3d4',
  alternativeSummary: null,
  supersedesDecisionLogId: null,
  supersededByDecisionLogId: null,
  createdBy: 1,
  createdAt: '2026-07-16T08:00:00.000Z',
  updatedAt: null,
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
// Hook Tests
// ===========================================================================

describe('useTrizDecisionLogsList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches paginated decision log list', async () => {
    vi.mocked(trizDecisionLogApi.list).mockResolvedValue([decisionLogEntryFixture])

    const { result } = renderHook(() => useTrizDecisionLogsList(42, 1, 20), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(trizDecisionLogApi.list).toHaveBeenCalledWith(42, 1, 20)
    expect(result.current.data).toEqual([decisionLogEntryFixture])
  })

  it('returns empty list when no decisions exist', async () => {
    vi.mocked(trizDecisionLogApi.list).mockResolvedValue([])

    const { result } = renderHook(() => useTrizDecisionLogsList(42), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(0)
  })

  it('does not fetch when projectId is invalid', async () => {
    const { result } = renderHook(() => useTrizDecisionLogsList(0), {
      wrapper: createWrapper(),
    })
    expect(result.current.isFetching).toBe(false)
    expect(trizDecisionLogApi.list).not.toHaveBeenCalled()
  })

  it('handles auth error', async () => {
    vi.mocked(trizDecisionLogApi.list).mockRejectedValue({ status: 401, code: 'AUTH_REQUIRED' })

    const { result } = renderHook(() => useTrizDecisionLogsList(42), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('handles permission error', async () => {
    vi.mocked(trizDecisionLogApi.list).mockRejectedValue({ status: 403, code: 'PERMISSION_DENIED' })

    const { result } = renderHook(() => useTrizDecisionLogsList(42), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('useTrizDecisionLogDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches decision log detail', async () => {
    vi.mocked(trizDecisionLogApi.detail).mockResolvedValue(decisionLogEntryFixture)

    const { result } = renderHook(() => useTrizDecisionLogDetail(42, 1), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(trizDecisionLogApi.detail).toHaveBeenCalledWith(42, 1)
    expect(result.current.data).toEqual(decisionLogEntryFixture)
  })

  it('does not fetch when decisionLogId is null', async () => {
    const { result } = renderHook(() => useTrizDecisionLogDetail(42, null), {
      wrapper: createWrapper(),
    })
    expect(result.current.isFetching).toBe(false)
    expect(trizDecisionLogApi.detail).not.toHaveBeenCalled()
  })
})

describe('useTrizDecisionSubjectLookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches decision logs by subject ref', async () => {
    vi.mocked(trizDecisionLogApi.subjectLookup).mockResolvedValue([decisionLogEntryFixture])

    const { result } = renderHook(
      () => useTrizDecisionSubjectLookup(42, 'contradiction', 'tc-dur-vs-res'),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(trizDecisionLogApi.subjectLookup).toHaveBeenCalled()
    expect(result.current.data).toEqual([decisionLogEntryFixture])
  })

  it('does not fetch when kind is null', async () => {
    const { result } = renderHook(() => useTrizDecisionSubjectLookup(42, null, 'tc-dur-vs-res'), {
      wrapper: createWrapper(),
    })
    expect(result.current.isFetching).toBe(false)
    expect(trizDecisionLogApi.subjectLookup).not.toHaveBeenCalled()
  })
})

describe('useCreateTrizDecisionLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates decision log and invalidates queries', async () => {
    vi.mocked(trizDecisionLogApi.create).mockResolvedValue(decisionLogEntryFixture)

    const { result } = renderHook(() => useCreateTrizDecisionLog(42), {
      wrapper: createWrapper(),
    })

    result.current.mutate({
      decisionType: 'adopt',
      subjectRefs: [subjectRef],
      sourceRefs: [],
      artifactHashes: [],
      reasonSummary: '采纳决策',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(trizDecisionLogApi.create).toHaveBeenCalled()
  })
})

describe('useSupersedeTrizDecisionLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('supersedes decision log', async () => {
    vi.mocked(trizDecisionLogApi.supersede).mockResolvedValue({
      ...decisionLogEntryFixture,
      id: 2,
      supersedesDecisionLogId: 1,
    })

    const { result } = renderHook(() => useSupersedeTrizDecisionLog(42), {
      wrapper: createWrapper(),
    })

    result.current.mutate({
      decisionLogId: 1,
      data: {
        decisionType: 'supersede',
        subjectRefs: [subjectRef],
        sourceRefs: [],
        artifactHashes: [],
        reasonSummary: '纠正先前的决策理由',
      },
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(trizDecisionLogApi.supersede).toHaveBeenCalledWith(42, 1, expect.any(Object))
  })
})

describe('useTrizDecisionAiDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates AI draft reason', async () => {
    vi.mocked(trizDecisionLogApi.draftReason).mockResolvedValue({
      draftReason: '基于矛盾分析，建议采纳此解决路径',
      warnings: [],
      costSummary: null,
      isFallback: true,
    })

    const { result } = renderHook(() => useTrizDecisionAiDraft(42), {
      wrapper: createWrapper(),
    })

    result.current.mutate({
      subjectRefs: [subjectRef],
      sourceRefs: [],
      decisionType: 'adopt',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(trizDecisionLogApi.draftReason).toHaveBeenCalled()
  })
})

// ===========================================================================
// Component Tests — TrizDecisionDashboardCard
// ===========================================================================

describe('TrizDecisionDashboardCard', () => {
  it('renders summary with stat tiles', () => {
    const summary: TrizDecisionDashboardSummary = {
      pendingDecisionCount: 3,
      missingReasonCount: 1,
      staleRefCount: 2,
      recentKeyDecisions: [decisionLogEntryFixture],
    }

    render(<TrizDecisionDashboardCard projectId={42} summary={summary} />)

    expect(screen.getByText('TRIZ 决策')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('待处理')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('缺失理由')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('过期引用')).toBeTruthy()
    expect(screen.getByText(/优先保证工期/)).toBeTruthy()
  })

  it('shows stale ref warning when staleRefCount > 0', () => {
    const summary: TrizDecisionDashboardSummary = {
      pendingDecisionCount: 0,
      missingReasonCount: 0,
      staleRefCount: 2,
      recentKeyDecisions: [],
    }

    render(<TrizDecisionDashboardCard projectId={42} summary={summary} />)

    expect(screen.getByText(/已过期/)).toBeTruthy()
  })

  it('shows empty state when all counts are zero', () => {
    const summary: TrizDecisionDashboardSummary = {
      pendingDecisionCount: 0,
      missingReasonCount: 0,
      staleRefCount: 0,
      recentKeyDecisions: [],
    }

    render(<TrizDecisionDashboardCard projectId={42} summary={summary} />)

    expect(screen.getByText('暂无决策')).toBeTruthy()
  })

  it('shows loading skeleton', () => {
    render(<TrizDecisionDashboardCard projectId={42} summary={null} isLoading />)

    expect(screen.getByRole('status', { name: /加载决策摘要中/i })).toBeTruthy()
  })

  it('shows error state', () => {
    render(<TrizDecisionDashboardCard projectId={42} summary={null} isError />)

    expect(screen.getByText('加载失败')).toBeTruthy()
  })

  it('shows null-data fallback when summary is null', () => {
    render(<TrizDecisionDashboardCard projectId={42} summary={null} />)

    expect(screen.getByText('暂无数据')).toBeTruthy()
  })

  it('renders navigation button when onNavigateToDecisions is provided', () => {
    const summary: TrizDecisionDashboardSummary = {
      pendingDecisionCount: 1,
      missingReasonCount: 0,
      staleRefCount: 0,
      recentKeyDecisions: [],
    }

    render(
      <TrizDecisionDashboardCard
        projectId={42}
        summary={summary}
        onNavigateToDecisions={vi.fn()}
      />,
    )

    expect(screen.getByText('查看完整决策日志')).toBeTruthy()
  })
})

// ===========================================================================
// Component Tests — TrizDecisionTimelineEvent
// ===========================================================================

describe('TrizDecisionTimelineEvent', () => {
  const baseEvent: TrizDecisionTimelineEventType = {
    id: 1,
    decisionType: 'adopt',
    reasonSummary: '优先保证工期，适当增加资源投入',
    createdBy: 1,
    createdAt: '2026-07-16T08:00:00.000Z',
    subjectSummary: '工期与资源负载取舍',
    hasAccess: true,
  }

  it('renders decision type badge and subject summary with access', () => {
    render(<TrizDecisionTimelineEvent event={baseEvent} />)

    expect(screen.getByText('采纳')).toBeTruthy()
    // subjectSummary is rendered when hasAccess is true
    expect(screen.getByText('工期与资源负载取舍')).toBeTruthy()
  })

  it('renders subject summary when hasAccess is true', () => {
    render(<TrizDecisionTimelineEvent event={baseEvent} />)

    expect(screen.getByText('工期与资源负载取舍')).toBeTruthy()
  })

  it('renders unavailable-target state when no access', () => {
    const noAccessEvent: TrizDecisionTimelineEventType = {
      ...baseEvent,
      hasAccess: false,
      subjectSummary: null,
    }

    render(<TrizDecisionTimelineEvent event={noAccessEvent} />)

    expect(screen.getByText('无法访问目标详情')).toBeTruthy()
  })

  it('does not show detail button when onNavigateToDetail is missing', () => {
    render(<TrizDecisionTimelineEvent event={baseEvent} />)

    expect(screen.queryByText('查看详情')).toBeNull()
  })

  it('shows detail button when onNavigateToDetail is provided', () => {
    render(<TrizDecisionTimelineEvent event={baseEvent} onNavigateToDetail={vi.fn()} />)

    expect(screen.getByText('查看详情')).toBeTruthy()
  })

  it('does not show detail button when hasAccess is false even with callback', () => {
    const noAccessEvent: TrizDecisionTimelineEventType = {
      ...baseEvent,
      hasAccess: false,
      subjectSummary: null,
    }

    render(<TrizDecisionTimelineEvent event={noAccessEvent} onNavigateToDetail={vi.fn()} />)

    expect(screen.queryByText('查看详情')).toBeNull()
  })

  it('calls onNavigateToDetail on button click', () => {
    const onNav = vi.fn()

    render(<TrizDecisionTimelineEvent event={baseEvent} onNavigateToDetail={onNav} />)

    screen.getByText('查看详情').click()
    expect(onNav).toHaveBeenCalledWith(1)
  })

  it('renders fallback label for unknown decision type', () => {
    const unknownEvent: TrizDecisionTimelineEventType = {
      ...baseEvent,
      decisionType: 'unknown_type' as unknown as TrizDecisionTimelineEventType['decisionType'],
    }

    render(<TrizDecisionTimelineEvent event={unknownEvent} />)

    expect(screen.getByText('unknown_type')).toBeTruthy()
  })

  it('has correct aria-label for accessibility', () => {
    render(<TrizDecisionTimelineEvent event={baseEvent} />)

    expect(screen.getByRole('listitem')).toHaveAttribute('aria-label', 'TRIZ 决策事件: 采纳')
  })
})

describe('TrizTimelineEventSkeleton', () => {
  it('renders with correct aria label', () => {
    render(<TrizTimelineEventSkeleton />)

    expect(screen.getByRole('status', { name: /加载时间线事件中/i })).toBeTruthy()
  })
})

// ===========================================================================
// Component Tests — Permission Hiding on Dashboard
// ===========================================================================

describe('TrizDecisionDashboardCard — permission hiding', () => {
  it('shows no-permission empty state when user lacks triz_decision:view', async () => {
    mockPermissions.value = []

    const summary: TrizDecisionDashboardSummary = {
      pendingDecisionCount: 5,
      missingReasonCount: 2,
      staleRefCount: 1,
      recentKeyDecisions: [decisionLogEntryFixture],
    }

    render(<TrizDecisionDashboardCard projectId={42} summary={summary} />)

    expect(screen.getByText('无权限查看')).toBeTruthy()
    // Actual counts should not be visible
    expect(screen.queryByText('5')).toBeNull()
    expect(screen.queryByText('待处理')).toBeNull()
    expect(screen.queryByText('近期关键决策')).toBeNull()
  })

  it('shows no-permission empty state with correct icon and description', async () => {
    mockPermissions.value = []

    const summary: TrizDecisionDashboardSummary = {
      pendingDecisionCount: 0,
      missingReasonCount: 0,
      staleRefCount: 0,
      recentKeyDecisions: [],
    }

    render(<TrizDecisionDashboardCard projectId={42} summary={summary} />)

    expect(screen.getByText('您没有查看 TRIZ 决策摘要的权限。')).toBeTruthy()
  })
})

// ===========================================================================
// Component Module Tests（组件存在性验证）
// ===========================================================================

describe('TrizDecisionLogPanel module', () => {
  it('exports TrizDecisionLogPanel component', async () => {
    const mod = await import('@/components/ai-copilot/TrizDecisionLogPanel')
    expect(mod.TrizDecisionLogPanel).toBeDefined()
  }, 30_000)
})

describe('TrizDecisionDraftBlocker module', () => {
  it('exports TrizDecisionDraftBlocker component', async () => {
    const mod = await import('@/components/ai-copilot/TrizDecisionDraftBlocker')
    expect(mod.TrizDecisionDraftBlocker).toBeDefined()
  })

  it('exports TrizDecisionBlocker type as a function component', async () => {
    const mod = await import('@/components/ai-copilot/TrizDecisionDraftBlocker')
    expect(typeof mod.TrizDecisionDraftBlocker).toBe('function')
  })
})

describe('TrizDecisionDashboardCard module', () => {
  it('exports TrizDecisionDashboardCard component', async () => {
    const mod = await import('@/components/ai-copilot/TrizDecisionDashboardCard')
    expect(mod.TrizDecisionDashboardCard).toBeDefined()
  })
})

describe('TrizDecisionTimelineEvent module', () => {
  it('exports TrizDecisionTimelineEvent component', async () => {
    const mod = await import('@/components/ai-copilot/TrizDecisionTimelineEvent')
    expect(mod.TrizDecisionTimelineEvent).toBeDefined()
  })
})
