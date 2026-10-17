/**
 * 文档搜索前端 hooks 测试（v3-document-full-text-search §10.9）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// Mock API client
vi.mock('@/lib/api/document-search', () => ({
  documentSearchApi: {
    status: vi.fn().mockResolvedValue({
      data: {
        totalIndexable: 10,
        indexed: 9,
        staleOrMissing: 1,
        truncated: 0,
        lastIndexedAt: '2026-08-03T10:00:00.000Z',
      },
    }),
    reindex: vi.fn().mockResolvedValue({
      data: {
        runId: 'test-run',
        indexed: 10,
        skipped: 2,
        removed: 1,
        truncated: 0,
        warnings: [],
      },
    }),
  },
  documentSearchKeys: {
    all: ['document-search'] as const,
    status: (projectId: number) => ['document-search', 'status', projectId] as const,
  },
}))

import { useDocumentSearchStatus, useReindexDocumentSearch } from '@/hooks/use-document-search'
import { documentSearchApi } from '@/lib/api/document-search'

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

describe('useDocumentSearchStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('拉取索引状态成功', async () => {
    const { result } = renderHook(() => useDocumentSearchStatus(1), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.data?.totalIndexable).toBe(10)
    expect(result.current.data?.data?.indexed).toBe(9)
    expect(documentSearchApi.status).toHaveBeenCalledWith(1)
  })

  it('projectId <= 0 时禁用查询', () => {
    const { result } = renderHook(() => useDocumentSearchStatus(0), {
      wrapper: createWrapper(),
    })

    expect(result.current.fetchStatus).toBe('idle')
    expect(documentSearchApi.status).not.toHaveBeenCalled()
  })
})

describe('useReindexDocumentSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('触发重建 mutation 成功', async () => {
    const { result } = renderHook(() => useReindexDocumentSearch(1), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.mutateAsync(false)
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    expect(result.current.data?.data.runId).toBe('test-run')
    expect(documentSearchApi.reindex).toHaveBeenCalledWith(1, false)
  })

  it('full=true 全量重建', async () => {
    const { result } = renderHook(() => useReindexDocumentSearch(1), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.mutateAsync(true)
    })

    await waitFor(() => {
      expect(documentSearchApi.reindex).toHaveBeenCalledWith(1, true)
    })
  })
})
