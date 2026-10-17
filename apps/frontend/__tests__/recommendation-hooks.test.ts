import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import {
  listRecommendations,
  getRecommendationSummary,
  getRecommendationDetail,
  refreshRecommendations,
  updateRecommendationStatus,
  type RecommendationRecord,
} from '@/lib/api/recommendations'
import {
  useRecommendationsList,
  useRecommendationSummary,
  useRecommendationDetail,
} from '@/lib/api/use-recommendations'

// 模拟全局 fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
}

describe('recommendations API', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('listRecommendations builds correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [],
        meta: { total: 0, page: 1, perPage: 20, totalPages: 1 },
        summary: {
          totalCount: 0,
          criticalCount: 0,
          highCount: 0,
          mediumCount: 0,
          newCount: 0,
          acceptedCount: 0,
          topRecommendations: [],
          maxSeverity: null,
          updatedAt: null,
          available: false,
          warnings: [],
        },
      }),
    })

    await listRecommendations(1, { status: 'new', page: 1 })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/projects/1/recommendations?status=new&page=1'),
      expect.any(Object),
    )
  })

  it('getRecommendationSummary returns summary', async () => {
    const summary = {
      totalCount: 5,
      criticalCount: 1,
      highCount: 2,
      mediumCount: 2,
      newCount: 3,
      acceptedCount: 0,
      topRecommendations: [],
      maxSeverity: 'critical',
      updatedAt: '2026-07-16T00:00:00Z',
      available: true,
      warnings: [],
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => summary,
    })

    const result = await getRecommendationSummary(1)
    expect(result.totalCount).toBe(5)
    expect(result.maxSeverity).toBe('critical')
  })

  it('getRecommendationDetail returns record', async () => {
    const mockData = {
      data: {
        id: 1,
        projectId: 1,
        sourceType: 'risk',
        title: 'Test',
        summary: 'Test',
        status: 'new',
        priority: 80,
        severity: 'high',
      } as unknown as RecommendationRecord,
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    })

    const result = await getRecommendationDetail(1, 1)
    expect(result.id).toBe(1)
    expect(result.title).toBe('Test')
  })

  it('refreshRecommendations calls POST', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], warnings: [], created: 0, merged: 0 }),
    })

    await refreshRecommendations(1, ['risk'])
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/refresh'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('updateRecommendationStatus calls PUT', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: 1, status: 'accepted' } }),
    })

    await updateRecommendationStatus(1, 1, 'accepted')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/status'),
      expect.objectContaining({ method: 'PUT' }),
    )
  })
})

describe('recommendation hooks', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('useRecommendationsList returns data', async () => {
    const mockData = {
      data: [
        {
          id: 1,
          sourceType: 'risk',
          title: 'Test',
          summary: 'Test',
          severity: 'high',
          priority: 80,
          status: 'new',
          dedupeKey: 'k1',
          stale: false,
          expiresAt: null,
          createdBy: 1,
          createdAt: '2026-07-16T00:00:00Z',
          handledBy: null,
          handledAt: null,
          projectId: 1,
        },
      ],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      summary: {
        totalCount: 1,
        criticalCount: 0,
        highCount: 1,
        mediumCount: 0,
        newCount: 1,
        acceptedCount: 0,
        topRecommendations: [],
        maxSeverity: 'high',
        updatedAt: null,
        available: true,
        warnings: [],
      },
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    })

    const { result } = renderHook(() => useRecommendationsList(1), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data).toHaveLength(1)
    expect(result.current.data?.meta.total).toBe(1)
  })

  it('useRecommendationSummary returns summary', async () => {
    const mockSummary = {
      totalCount: 3,
      criticalCount: 1,
      highCount: 1,
      mediumCount: 1,
      newCount: 2,
      acceptedCount: 0,
      topRecommendations: [],
      maxSeverity: 'critical',
      updatedAt: null,
      available: true,
      warnings: [],
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockSummary,
    })

    const { result } = renderHook(() => useRecommendationSummary(1), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.totalCount).toBe(3)
  })

  it('useRecommendationDetail returns detail', async () => {
    const mockDetail = {
      data: {
        id: 1,
        projectId: 1,
        sourceType: 'risk',
        title: 'Detail',
        summary: 'Detail',
        sourceId: 'risk-1',
        targetRef: { entityType: 'task', entityId: 1, displayName: 'Task', url: '' },
        recommendedAction: 'Check',
        actionType: 'navigate',
        severity: 'high',
        priority: 80,
        confidence: 'high',
        status: 'new',
        dedupeKey: 'k1',
        inputSignature: 'sig',
        evidenceHash: 'hash',
        evidenceRefs: [],
        warnings: [],
        aiMetadata: null,
        expiresAt: null,
        stale: false,
        staleReason: null,
        createdBy: 1,
        handledBy: null,
        handledAt: null,
        createdAt: '2026-07-16T00:00:00Z',
        updatedAt: '2026-07-16T00:00:00Z',
        organizationId: 1,
      },
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockDetail,
    })

    const { result } = renderHook(() => useRecommendationDetail(1, 1), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.id).toBe(1)
  })
})
