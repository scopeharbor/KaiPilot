import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useTrizAnalysisList,
  useTrizAnalysisDetail,
  useTrizDraftHandoff,
} from '@/hooks/use-triz-compiler-analysis'
import { trizCompilerAnalysisApi } from '@/lib/api/triz-compiler-analysis'
import type {
  TrizAnalysisArtifact,
  TrizAnalysisListResponse,
  TrizDraftHandoffResponse,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// Mock API module
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/triz-compiler-analysis', () => ({
  trizCompilerAnalysisApi: {
    list: vi.fn(),
    detail: vi.fn(),
    handoff: vi.fn(),
    getDashboardSummary: vi.fn(),
  },
  trizCompilerAnalysisKeys: {
    all: ['triz-compiler-analysis'],
    list: (runId: number) => ['triz-compiler-analysis', 'list', runId],
    detail: (runId: number, artifactId: string) => [
      'triz-compiler-analysis',
      'detail',
      runId,
      artifactId,
    ],
    dashboardSummary: (projectId: number) => ['triz-compiler-analysis', 'dashboard', projectId],
  },
}))

// ---------------------------------------------------------------------------
// Mock auth store
// ---------------------------------------------------------------------------

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn((sel) => {
    const state = { isAuthenticated: true }
    return sel ? sel(state) : state
  }),
}))

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

const artifactFixture: TrizAnalysisArtifact = {
  schemaVersion: '1.0',
  mode: 'deterministic',
  status: 'completed',
  sourceContradictions: [],
  parameterTensions: [],
  principleCandidates: [],
  resolutionPaths: [],
  warnings: [],
  requiresHumanReview: false,
  sourceHashes: {
    inputSignatures: [],
    outputHash: 'abc',
    contentHash: 'def',
  },
  handoff: {
    status: 'none',
    draftSessionRef: null,
    selectedPathId: null,
    handedOffAt: null,
    blockedReason: null,
  },
  aiNarrative: null,
  createdAt: '2026-07-16T00:00:00.000Z',
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

// ---------------------------------------------------------------------------
// useTrizAnalysisList
// ---------------------------------------------------------------------------

describe('useTrizAnalysisList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches TRIZ analysis artifact list for a run', async () => {
    const mockListResponse: TrizAnalysisListResponse = {
      data: [artifactFixture],
      meta: { total: 1, runId: 42 },
    }
    vi.mocked(trizCompilerAnalysisApi.list).mockResolvedValue(mockListResponse)

    const { result } = renderHook(() => useTrizAnalysisList(42), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(trizCompilerAnalysisApi.list).toHaveBeenCalledWith(42)
    expect(result.current.data).toEqual(mockListResponse)
  })

  it('returns empty list when no artifacts exist', async () => {
    const emptyResponse: TrizAnalysisListResponse = {
      data: [],
      meta: { total: 0, runId: 42 },
    }
    vi.mocked(trizCompilerAnalysisApi.list).mockResolvedValue(emptyResponse)

    const { result } = renderHook(() => useTrizAnalysisList(42), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data).toHaveLength(0)
  })

  it('does not fetch when runId is invalid', async () => {
    const { result } = renderHook(() => useTrizAnalysisList(0), {
      wrapper: createWrapper(),
    })
    expect(result.current.isFetching).toBe(false)
    expect(trizCompilerAnalysisApi.list).not.toHaveBeenCalled()
  })

  it('handles 401 auth error', async () => {
    vi.mocked(trizCompilerAnalysisApi.list).mockRejectedValue({
      status: 401,
      code: 'AUTH_REQUIRED',
    })

    const { result } = renderHook(() => useTrizAnalysisList(42), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('handles 403 permission error', async () => {
    vi.mocked(trizCompilerAnalysisApi.list).mockRejectedValue({
      status: 403,
      code: 'PERMISSION_DENIED',
    })

    const { result } = renderHook(() => useTrizAnalysisList(42), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

// ---------------------------------------------------------------------------
// useTrizAnalysisDetail
// ---------------------------------------------------------------------------

describe('useTrizAnalysisDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches artifact detail by runId and artifactId', async () => {
    vi.mocked(trizCompilerAnalysisApi.detail).mockResolvedValue(artifactFixture)

    const { result } = renderHook(() => useTrizAnalysisDetail(42, 'art-001'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(trizCompilerAnalysisApi.detail).toHaveBeenCalledWith(42, 'art-001')
    expect(result.current.data).toEqual(artifactFixture)
  })

  it('does not fetch when artifactId is null', async () => {
    const { result } = renderHook(() => useTrizAnalysisDetail(42, null), {
      wrapper: createWrapper(),
    })
    expect(result.current.isFetching).toBe(false)
    expect(trizCompilerAnalysisApi.detail).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// useTrizDraftHandoff
// ---------------------------------------------------------------------------

describe('useTrizDraftHandoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls handoff API and invalidates list and detail cache', async () => {
    const handoffResponse: TrizDraftHandoffResponse['data'] = {
      handoffStatus: 'candidate_created',
      draftSessionRef: 'ds-001',
      blockedReason: null,
    }
    vi.mocked(trizCompilerAnalysisApi.handoff).mockResolvedValue(handoffResponse)

    const { result } = renderHook(() => useTrizDraftHandoff(42, 'art-001'), {
      wrapper: createWrapper(),
    })

    result.current.mutate({
      selectedPathId: 'path-001',
      note: '基于矛盾分析的建议',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(trizCompilerAnalysisApi.handoff).toHaveBeenCalledWith(42, 'art-001', {
      selectedPathId: 'path-001',
      note: '基于矛盾分析的建议',
    })
    expect(result.current.data).toEqual(handoffResponse)
  })

  it('handles handoff error', async () => {
    vi.mocked(trizCompilerAnalysisApi.handoff).mockRejectedValue(new Error('Handoff failed'))

    const { result } = renderHook(() => useTrizDraftHandoff(42, 'art-001'), {
      wrapper: createWrapper(),
    })

    result.current.mutate({ selectedPathId: 'path-001' })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
