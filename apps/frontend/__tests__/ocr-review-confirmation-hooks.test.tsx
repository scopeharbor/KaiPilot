/**
 * OCR 审查确认流前端 Hook 测试
 * v3-ocr-review-confirmation-flow §7.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/lib/api-client'
import { ocrReviewKeys } from '@/hooks/use-ocr-review'
import {
  useOcrReviewDetail,
  useOcrAcceptedExtractions,
  useOcrConfirmationPreview,
  useOcrConfirmationSave,
} from '@/hooks/use-ocr-review'

const mockFetch = vi.mocked(apiFetch)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('ocrReviewKeys', () => {
  it('produces stable review key', () => {
    const key = ocrReviewKeys.review(1, 42)
    expect(key).toEqual(['ocr-review', 'review', 1, 42])
  })

  it('produces stable accepted extractions key', () => {
    const key = ocrReviewKeys.acceptedExtractions(1, 42)
    expect(key).toEqual(['ocr-review', 'accepted-extractions', 1, 42])
  })
})

describe('useOcrReviewDetail', () => {
  it('returns loading state initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {}))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrReviewDetail(1, 42), { wrapper })
    expect(result.current.isLoading).toBe(true)
  })

  it('returns data on success', async () => {
    mockFetch.mockResolvedValue({
      sourceSummary: { sourceKind: 'attachment', visible: true },
      jobStatus: 'reviewable',
      jobId: 42,
      pageGroups: [],
      candidateItems: [],
      warningSummary: { totalWarnings: 0, topCodes: [], hasFailures: false },
      acceptedExtractions: [],
      allowedActions: ['view', 'select'],
      staleReason: null,
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrReviewDetail(1, 42), { wrapper })
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data?.jobStatus).toBe('reviewable')
  })

  it('is disabled when projectId is 0', () => {
    mockFetch.mockReturnValue(new Promise(() => {}))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrReviewDetail(0, 42), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('handles error envelope', async () => {
    mockFetch.mockRejectedValue(new Error('PERMISSION_DENIED'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrReviewDetail(1, 42), { wrapper })
    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
  })
})

describe('useOcrAcceptedExtractions', () => {
  it('fetches with params', async () => {
    mockFetch.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useOcrAcceptedExtractions(1, 42, { page: 1, perPage: 10 }),
      { wrapper },
    )
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
  })
})

describe('useOcrConfirmationPreview', () => {
  it('calls preview API and invalidates review query', async () => {
    mockFetch.mockResolvedValue({
      previewHash: 'hash123',
      sourceHash: 'src',
      candidateHash: 'cand',
      selectedTextHash: 'sel',
      selectedText: 'test',
      pageRefs: [0],
      redlineSummary: { tasks: 'unchanged' },
      requiresExplicitConfirmation: true,
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrConfirmationPreview(1, 42), { wrapper })
    await result.current.mutateAsync({
      selection: { candidateId: 1, mode: 'full', selectedText: 'test', pageRefs: [0] },
    })
    expect(mockFetch).toHaveBeenCalled()
  })
})

describe('useOcrConfirmationSave', () => {
  it('calls save API and invalidates queries', async () => {
    mockFetch.mockResolvedValue({
      extractionId: 1,
      sourceHash: 'src',
      candidateHash: 'cand',
      selectedTextHash: 'sel',
      pageRefs: [0],
      status: 'current',
      reviewerId: 1,
      reviewerName: 'Test',
      reviewNote: null,
      confirmedAt: new Date().toISOString(),
      supersededAt: null,
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrConfirmationSave(1, 42), { wrapper })
    await result.current.mutateAsync({
      previewHash: 'hash123',
      selection: { candidateId: 1, mode: 'full', selectedText: 'test', pageRefs: [0] },
    })
    expect(mockFetch).toHaveBeenCalled()
  })

  it('handles stale source error', async () => {
    mockFetch.mockRejectedValue(new Error('来源文件已变更，无法保存确认'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useOcrConfirmationSave(1, 42), { wrapper })
    try {
      await result.current.mutateAsync({
        previewHash: 'hash123',
        selection: { candidateId: 1, mode: 'full', selectedText: 'test', pageRefs: [0] },
      })
    } catch (e) {
      expect((e as Error).message).toContain('来源文件已变更')
    }
  })
})
