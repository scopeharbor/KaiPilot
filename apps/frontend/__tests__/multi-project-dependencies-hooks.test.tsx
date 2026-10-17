/**
 * 跨项目依赖前端 API Hooks 测试
 * v3-multi-project-dependency-crud §8.3
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- 测试 mock 数据用 any 做 enum cast 是测试惯例 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// Mock the API module
vi.mock('@/lib/api/multi-project-dependencies', () => ({
  mpdApi: {
    list: vi.fn(),
    detail: vi.fn(),
    previewCreate: vi.fn(),
    confirmCreate: vi.fn(),
    previewUpdate: vi.fn(),
    confirmUpdate: vi.fn(),
    previewArchive: vi.fn(),
    confirmArchive: vi.fn(),
    previewRestore: vi.fn(),
    confirmRestore: vi.fn(),
    previewDelete: vi.fn(),
    confirmDelete: vi.fn(),
    graph: vi.fn(),
  },
  mpdKeys: {
    all: (orgId: string) => ['multi-project-dependencies', orgId] as const,
    list: (orgId: string, filters?: any) =>
      ['multi-project-dependencies', orgId, 'list', filters ?? {}] as const,
    detail: (orgId: string, depId: string) =>
      ['multi-project-dependencies', orgId, 'detail', depId] as const,
    graph: (orgId: string, query?: any) =>
      ['multi-project-dependencies', orgId, 'graph', query ?? {}] as const,
  },
}))

import {
  useMpdList,
  useMpdConfirmCreate,
  useMpdGraph,
} from '@/hooks/use-multi-project-dependencies'
import { mpdApi } from '@/lib/api/multi-project-dependencies'

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children)
  }
}

describe('useMpdList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns loading state initially', () => {
    const { result } = renderHook(() => useMpdList('org-1'), {
      wrapper: makeWrapper(),
    })
    expect(result.current.isLoading).toBe(true)
  })

  it('returns data after fetch', async () => {
    const mockData = {
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    }
    ;(mpdApi.list as any).mockResolvedValue(mockData)
    const { result } = renderHook(() => useMpdList('org-1'), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data).toEqual(mockData)
  })

  it('uses stable query keys with filters', async () => {
    ;(mpdApi.list as any).mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    })
    const filters = { status: ['active'] as any, page: 1 }
    const { result } = renderHook(() => useMpdList('org-1', filters), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(mpdApi.list).toHaveBeenCalledWith('org-1', filters)
  })
})

describe('useMpdConfirmCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls confirmCreate API', async () => {
    const mockResult = {
      dependency: {
        id: 'dep-new',
        organizationId: 'org-1',
        provider: {
          type: 'task',
          id: 't1',
          projectId: 'p1',
          projectName: 'P1',
          label: 'T1',
          isRedacted: false,
        },
        consumer: {
          type: 'task',
          id: 't2',
          projectId: 'p2',
          projectName: 'P2',
          label: 'T2',
          isRedacted: false,
        },
        category: 'deliverable' as any,
        type: 'FS' as any,
        lagDays: 0,
        strength: 'moderate' as any,
        bufferDays: 0,
        status: 'active' as any,
        risk: 'none' as any,
        sourceMode: 'manual' as any,
        evidenceSummary: '',
        freshnessSignature: '',
        stewardId: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        warningCodes: [],
      },
      auditEventId: 'audit-001',
      isReplay: false,
    }
    ;(mpdApi.confirmCreate as any).mockResolvedValue({ data: mockResult })
    const { result } = renderHook(() => useMpdConfirmCreate('org-1'), {
      wrapper: makeWrapper(),
    })
    await act(async () => {
      await result.current.mutateAsync({
        previewId: 'p1',
        confirmationHash: 'hash1',
        idempotencyKey: 'key1',
      })
    })
    expect(mpdApi.confirmCreate).toHaveBeenCalledWith('org-1', {
      previewId: 'p1',
      confirmationHash: 'hash1',
      idempotencyKey: 'key1',
    })
  })
})

// ── Graph Hook Tests（v3-multi-project-dependency-graph §4.3） ──

describe('useMpdGraph', () => {
  const mockGraphQuery = {
    projectIds: [1, 2],
    maxDepth: 3,
    nodeLimit: 200,
    edgeLimit: 500,
  }

  const mockGraphResponse = {
    data: {
      nodes: [
        {
          nodeId: 'node-1',
          endpoint: {
            endpointType: 'project' as const,
            projectId: 1,
            projectName: '项目 1',
            taskId: null,
            taskName: null,
            milestoneId: null,
            milestoneName: null,
            externalLabel: null,
            redacted: false,
          },
          label: '项目 1',
          redacted: false,
          redactionReason: null,
          dependencyCount: 2,
          riskSummary: { critical: 0, high: 0, medium: 1, low: 1 },
          drillDownRef: null,
        },
      ],
      edges: [],
      visibleNodeCount: 1,
      redactedNodeCount: 0,
      visibleEdgeCount: 0,
      truncated: false,
      truncationReason: null,
      warningCodes: [],
      freshnessMeta: {
        checkedAt: new Date().toISOString(),
        staleCount: 0,
        freshCount: 0,
      },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('disabled when enabled=false', () => {
    const { result } = renderHook(() => useMpdGraph('org-1', mockGraphQuery, false), {
      wrapper: makeWrapper(),
    })
    expect(result.current.isLoading).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('disabled when query is null', () => {
    const { result } = renderHook(() => useMpdGraph('org-1', null, true), {
      wrapper: makeWrapper(),
    })
    expect(result.current.isLoading).toBe(false)
  })

  it('fetches graph data when enabled', async () => {
    ;(mpdApi.graph as any).mockResolvedValue(mockGraphResponse)
    const { result } = renderHook(() => useMpdGraph('org-1', mockGraphQuery, true), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data).toEqual(mockGraphResponse)
    expect(mpdApi.graph).toHaveBeenCalledWith('org-1', mockGraphQuery)
  })

  it('propagates errors', async () => {
    ;(mpdApi.graph as any).mockRejectedValue(new Error('FEATURE_DISABLED'))
    const { result } = renderHook(() => useMpdGraph('org-1', mockGraphQuery, true), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
    expect(result.current.error).toBeDefined()
  })
})
