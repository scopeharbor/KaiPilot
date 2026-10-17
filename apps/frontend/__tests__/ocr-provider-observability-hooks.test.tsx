/**
 * v3-ocr-provider-observability-cost-controls — 前端 hooks 测试。
 *
 * 覆盖：摘要加载、事件列表、disabled、错误处理。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@/lib/api-client'
import {
  useOcrProviderObservabilitySummary,
  useOcrProviderObservabilityEvents,
} from '@/hooks/use-ocr-provider-observability'

const mockSummary = {
  projectId: 1,
  totalAttempts: 5,
  totalPages: 5,
  succeededAttempts: 4,
  failedAttempts: 1,
  budgetBlockedAttempts: 0,
  rateLimitedAttempts: 0,
  totalLatencyMs: 1250,
  totalInputTokens: 2500,
  totalOutputTokens: 1000,
  totalEstimatedCost: 0.025,
  currency: 'USD',
  costStatus: 'estimated',
  budgetStatus: 'allowed',
  rateLimitStatus: 'allowed',
  errorCategories: { none: 4, timeout: 1 },
  warningCodes: [],
  providerRefs: [{ provider: 'openai', model: 'gpt-4o' }],
  computedAt: '2024-06-01T12:00:00Z',
}

const mockEventsData = [
  {
    id: 1,
    ocrJobId: 1,
    pageId: 1,
    attemptNumber: 1,
    provider: 'openai',
    model: 'gpt-4o',
    status: 'succeeded',
    latencyMs: 250,
    estimatedCost: 0.005,
    currency: 'USD',
    costStatus: 'estimated',
    errorCategory: 'none',
    warningCodes: [],
    occurredAt: '2024-06-01T12:00:00Z',
  },
]

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('useOcrProviderObservabilitySummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('成功加载摘要', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ data: mockSummary })

    const { result } = renderHook(() => useOcrProviderObservabilitySummary(1), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.data).toEqual(mockSummary)
  })

  it('disabled 时不触发查询', () => {
    const { result } = renderHook(() => useOcrProviderObservabilitySummary(1, false), {
      wrapper: createWrapper(),
    })

    expect(result.current.isPending).toBe(true)
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('API 错误时返回 error 状态', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('PERMISSION_DENIED'))

    const { result } = renderHook(() => useOcrProviderObservabilitySummary(1, true), {
      wrapper: createWrapper(),
    })

    // TanStack Query 默认 retry=1，等待失败状态出现
    // 用 waitFor 轮询直到 error 出现或成功（以防万一）
    await waitFor(
      () => {
        expect(result.current.isError).toBe(true)
      },
      { timeout: 5000, interval: 100 },
    )
  })
})

describe('useOcrProviderObservabilityEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('成功加载事件列表', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      data: mockEventsData,
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })

    const { result } = renderHook(() => useOcrProviderObservabilityEvents(1), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.data).toEqual(mockEventsData)
    expect(result.current.data?.meta.total).toBe(1)
  })

  it('disabled 时不触发', () => {
    const { result } = renderHook(() => useOcrProviderObservabilityEvents(1, undefined, false), {
      wrapper: createWrapper(),
    })

    expect(result.current.isPending).toBe(true)
    expect(apiFetch).not.toHaveBeenCalled()
  })
})
