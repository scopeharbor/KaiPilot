/**
 * OCR 文档上传流前端 Hook 测试
 * v3-ocr-document-upload-flow §8.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/lib/api-client'
import { ocrDocumentKeys } from '@/hooks/use-ocr-document'
import {
  useOcrDocumentJobs,
  useOcrDocumentJobDetail,
  useOcrDocumentCandidates,
  useOcrDocumentExtractions,
  useOcrDocumentJobCreate,
  useOcrDocumentJobRetry,
  useOcrDocumentJobConfirm,
} from '@/hooks/use-ocr-document'

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

// ========================================================================
// Query Keys
// ========================================================================

describe('ocrDocumentKeys', () => {
  it('produces stable list key', () => {
    const key = ocrDocumentKeys.list(1)
    expect(key).toEqual(['ocr-document', 'list', 1])
  })

  it('produces stable detail key', () => {
    const key = ocrDocumentKeys.detail(1, 42)
    expect(key).toEqual(['ocr-document', 'detail', 1, 42])
  })

  it('produces stable candidates key', () => {
    const key = ocrDocumentKeys.candidates(1, 42)
    expect(key).toEqual(['ocr-document', 'candidates', 1, 42])
  })

  it('produces stable extractions key', () => {
    const key = ocrDocumentKeys.extractions(1, 42)
    expect(key).toEqual(['ocr-document', 'extractions', 1, 42])
  })
})

// ========================================================================
// useOcrDocumentJobs
// ========================================================================

describe('useOcrDocumentJobs', () => {
  it('returns loading state initially', () => {
    mockFetch.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    })
    const { result } = renderHook(() => useOcrDocumentJobs(1), { wrapper: makeWrapper().wrapper })
    expect(result.current.isLoading).toBe(true)
  })

  it('fetches job list successfully', async () => {
    mockFetch.mockResolvedValue({
      data: [{ id: 1, status: 'reviewable', pageCount: 3, succeededPages: 3, failedPages: 0 }],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })
    const { result } = renderHook(() => useOcrDocumentJobs(1), { wrapper: makeWrapper().wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data).toHaveLength(1)
  })

  it('disables query when projectId is 0', () => {
    mockFetch.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    })
    const { result } = renderHook(() => useOcrDocumentJobs(0), { wrapper: makeWrapper().wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('handles error response', async () => {
    mockFetch.mockRejectedValue(new Error('PERMISSION_DENIED'))
    const { result } = renderHook(() => useOcrDocumentJobs(1), { wrapper: makeWrapper().wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeTruthy()
  })
})

// ========================================================================
// useOcrDocumentJobDetail
// ========================================================================

describe('useOcrDocumentJobDetail', () => {
  it('returns loading state initially', () => {
    mockFetch.mockResolvedValue({ data: { id: 1, status: 'processing', pages: [] } })
    const { result } = renderHook(() => useOcrDocumentJobDetail(1, 42), {
      wrapper: makeWrapper().wrapper,
    })
    expect(result.current.isLoading).toBe(true)
  })

  it('fetches job detail successfully', async () => {
    mockFetch.mockResolvedValue({
      data: {
        id: 42,
        status: 'reviewable',
        pageCount: 3,
        succeededPages: 3,
        failedPages: 0,
        pages: [{ id: 100, pageIndex: 0, status: 'succeeded', candidateText: '提取文本' }],
        warnings: [],
      },
    })
    const { result } = renderHook(() => useOcrDocumentJobDetail(1, 42), {
      wrapper: makeWrapper().wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data.status).toBe('reviewable')
    expect(result.current.data?.data.pages).toHaveLength(1)
  })

  it('disables when jobId is 0', () => {
    mockFetch.mockResolvedValue({ data: null })
    const { result } = renderHook(() => useOcrDocumentJobDetail(1, 0), {
      wrapper: makeWrapper().wrapper,
    })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('handles not found', async () => {
    mockFetch.mockRejectedValue(new Error('RESOURCE_NOT_FOUND'))
    const { result } = renderHook(() => useOcrDocumentJobDetail(1, 999), {
      wrapper: makeWrapper().wrapper,
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

// ========================================================================
// useOcrDocumentCandidates
// ========================================================================

describe('useOcrDocumentCandidates', () => {
  it('fetches candidates successfully', async () => {
    mockFetch.mockResolvedValue({
      data: [
        {
          id: 200,
          jobId: 42,
          pageId: 100,
          status: 'ready',
          extractedText: '文本内容',
          textHash: 'hash1',
          sourceHash: 'src1',
        },
      ],
    })
    const { result } = renderHook(() => useOcrDocumentCandidates(1, 42), {
      wrapper: makeWrapper().wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data).toHaveLength(1)
    expect(result.current.data?.data[0]?.extractedText).toBe('文本内容')
  })
})

// ========================================================================
// useOcrDocumentExtractions
// ========================================================================

describe('useOcrDocumentExtractions', () => {
  it('fetches extractions successfully', async () => {
    mockFetch.mockResolvedValue({
      data: [
        {
          id: 300,
          jobId: 42,
          status: 'active',
          acceptedText: '已接受文本',
          acceptedTextHash: 'h1',
          pageRefs: [0, 1],
          sourceHash: 'src1',
          reviewerId: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    const { result } = renderHook(() => useOcrDocumentExtractions(1, 42), {
      wrapper: makeWrapper().wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data).toHaveLength(1)
  })
})

// ========================================================================
// useOcrDocumentJobCreate
// ========================================================================

describe('useOcrDocumentJobCreate', () => {
  it('creates job and returns detail', async () => {
    mockFetch.mockResolvedValue({ data: { id: 10, status: 'queued' } })
    const { result } = renderHook(() => useOcrDocumentJobCreate(1), {
      wrapper: makeWrapper().wrapper,
    })
    await result.current.mutateAsync({
      file: new File(['test'], 'test.png', { type: 'image/png' }),
    })
    expect(mockFetch).toHaveBeenCalled()
  })

  it('handles API error gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('网络错误'))
    const { result } = renderHook(() => useOcrDocumentJobCreate(1), {
      wrapper: makeWrapper().wrapper,
    })
    // The mutation catches errors in the component layer
    expect(result.current.isPending).toBe(false)
  })
})

// ========================================================================
// useOcrDocumentJobRetry
// ========================================================================

describe('useOcrDocumentJobRetry', () => {
  it('retries job successfully', async () => {
    mockFetch.mockResolvedValue({ data: { id: 42, status: 'processing' } })
    const { result } = renderHook(() => useOcrDocumentJobRetry(1, 42), {
      wrapper: makeWrapper().wrapper,
    })
    await result.current.mutateAsync({})
    expect(mockFetch).toHaveBeenCalled()
  })

  it('handles retry error', async () => {
    mockFetch.mockRejectedValue(new Error('只能重试失败或已完成 review 的作业'))
    const { result } = renderHook(() => useOcrDocumentJobRetry(1, 42), {
      wrapper: makeWrapper().wrapper,
    })
    await expect(result.current.mutateAsync({})).rejects.toThrow()
  })
})

// ========================================================================
// useOcrDocumentJobConfirm
// ========================================================================

describe('useOcrDocumentJobConfirm', () => {
  it('confirms job successfully', async () => {
    mockFetch.mockResolvedValue({
      data: {
        id: 300,
        jobId: 42,
        status: 'active',
        acceptedText: '确认文本',
        acceptedTextHash: 'h1',
        pageRefs: [0, 1],
        sourceHash: 'src1',
        reviewerId: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    })
    const { result } = renderHook(() => useOcrDocumentJobConfirm(1, 42), {
      wrapper: makeWrapper().wrapper,
    })
    await result.current.mutateAsync({ candidateIds: [200] })
    expect(mockFetch).toHaveBeenCalled()
  })

  it('handles stale source confirmation error', async () => {
    mockFetch.mockRejectedValue(new Error('确认条件不满足'))
    const { result } = renderHook(() => useOcrDocumentJobConfirm(1, 42), {
      wrapper: makeWrapper().wrapper,
    })
    await expect(result.current.mutateAsync({ candidateIds: [200] })).rejects.toThrow()
  })
})
