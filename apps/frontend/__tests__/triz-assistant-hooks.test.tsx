/**
 * v3-ai-triz-assistant —— AI-TRIZ 助手前端 Hooks 测试（tasks 6.5）。
 *
 * 覆盖：
 * - success / validation error / permission denial
 * - AI fallback / stale action blocking
 * - cache invalidation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  useAssistantRuns,
  useAssistantRunDetail,
  useSubmitAssistantMessage,
  useAssistantFeedback,
  useAssistantPreview,
  assistantKeys,
} from '@/hooks/use-triz-assistant'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

function mockJsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  }
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return React.createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  mockFetch.mockReset()
})

// ---------------------------------------------------------------------------
// 测试组：Queries
// ---------------------------------------------------------------------------
describe('useAssistantRuns', () => {
  it('returns data on success', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }),
    )

    const { result } = renderHook(() => useAssistantRuns(1, { page: 1, perPage: 20 }), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toBeDefined()
  })

  it('handles empty runs list', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }),
    )

    const { result } = renderHook(() => useAssistantRuns(1), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.data).toEqual([])
  })

  it('is disabled when projectId is falsy', () => {
    const { result } = renderHook(() => useAssistantRuns(''), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
  })

  it('handles permission denied error', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ error: { code: 'PERMISSION_DENIED', message: '无权访问' } }, 403),
    )

    const { result } = renderHook(() => useAssistantRuns(1), { wrapper })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
  })
})

describe('useAssistantRunDetail', () => {
  it('returns run detail on success', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        data: {
          runId: 'run-001',
          status: 'completed',
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
    )

    const { result } = renderHook(() => useAssistantRunDetail(1, 'run-001'), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.data.runId).toBe('run-001')
  })

  it('is disabled when runId is empty', () => {
    const { result } = renderHook(() => useAssistantRunDetail(1, ''), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
  })
})

// ---------------------------------------------------------------------------
// 测试组：Mutations
// ---------------------------------------------------------------------------
describe('useSubmitAssistantMessage', () => {
  it('submits message and returns response', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        data: {
          runId: 'run-new',
          messageId: 'msg-001',
          intent: 'technical_contradiction',
          routeDecisions: [],
          recommendedActions: [],
          clarificationPrompts: [],
          warnings: [],
          fallback: false,
          reviewRequired: true,
          auditRefs: {},
          createdAt: new Date().toISOString(),
        },
      }),
    )

    const { result } = renderHook(() => useSubmitAssistantMessage(1), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ message: '测试问题' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data.runId).toBe('run-new')
  })

  it('handles AI fallback response', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        data: {
          runId: 'run-fb',
          messageId: 'msg-fb',
          intent: 'general_guidance',
          routeDecisions: [
            {
              routeId: 'r1',
              destination: 'contradiction_matrix',
              confidence: 'medium',
              reason: 'fallback',
              sourceRefs: [],
              sourceHashes: [],
              warnings: [],
            },
          ],
          recommendedActions: [],
          clarificationPrompts: [],
          warnings: ['AI_FALLBACK'],
          fallback: true,
          reviewRequired: true,
          auditRefs: {},
          createdAt: new Date().toISOString(),
        },
      }),
    )

    const { result } = renderHook(() => useSubmitAssistantMessage(1), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ message: '测试' })
    })

    // 先等 pending 状态完成
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.data?.fallback).toBe(true)
  })

  it('handles validation error', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({ error: { code: 'VALIDATION_ERROR', message: '消息不能为空' } }, 422),
    )

    const { result } = renderHook(() => useSubmitAssistantMessage(1), { wrapper })

    await act(async () => {
      try {
        await result.current.mutateAsync({ message: '' })
      } catch {
        // expected
      }
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
  })

  it('handles stale action blocking', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        data: {
          runId: 'run-stale',
          messageId: 'msg-stale',
          intent: 'general_guidance',
          routeDecisions: [],
          recommendedActions: [],
          clarificationPrompts: [],
          warnings: ['STALE_ACTION_BLOCKED'],
          fallback: false,
          reviewRequired: true,
          auditRefs: {},
          createdAt: new Date().toISOString(),
        },
      }),
    )

    const { result } = renderHook(() => useSubmitAssistantMessage(1), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ message: '质量矛盾' })
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    const warnings = result.current.data?.data?.warnings ?? []
    expect(warnings).toContain('STALE_ACTION_BLOCKED')
  })
})

describe('useAssistantFeedback', () => {
  it('records feedback successfully', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        data: {
          feedbackId: 'fb-001',
          runId: 'run-001',
          messageId: 'msg-001',
          reason: 'helpful',
          recorded: true,
        },
      }),
    )

    const { result } = renderHook(() => useAssistantFeedback(1, 'run-001'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ reason: 'helpful', comment: '很有帮助' })
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.data?.reason).toBe('helpful')
    expect(result.current.data?.data?.recorded).toBe(true)
  })

  it('invalidates run detail cache on success', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    const spy = vi.spyOn(queryClient, 'invalidateQueries')

    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        data: {
          feedbackId: 'fb-002',
          runId: 'run-001',
          messageId: 'msg-001',
          reason: 'not_helpful',
          recorded: true,
        },
      }),
    )

    const customWrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)

    const { result } = renderHook(() => useAssistantFeedback(1, 'run-001'), {
      wrapper: customWrapper,
    })

    await act(async () => {
      await result.current.mutateAsync({ reason: 'not_helpful' })
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('useAssistantPreview', () => {
  it('returns preview data on success', async () => {
    mockFetch.mockResolvedValueOnce(
      mockJsonResponse({
        data: {
          actionId: 'act-001',
          destination: 'contradiction_matrix',
          staleBlocked: false,
          previewData: {},
          sourceRefs: [],
          sourceHashes: [],
          requiresUserConfirmation: true,
        },
      }),
    )

    const { result } = renderHook(() => useAssistantPreview(1), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ actionId: 'act-001', sourceHashes: [] })
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.data?.staleBlocked).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 测试组：Query Keys
// ---------------------------------------------------------------------------
describe('assistantKeys', () => {
  it('generates stable query keys', () => {
    const allKey = assistantKeys.all(1)
    expect(allKey).toEqual(['assistant', 1])

    const runsKey = assistantKeys.runs(1, { page: 1 })
    expect(runsKey).toEqual(['assistant', 1, 'runs', { page: 1 }])

    const detailKey = assistantKeys.runDetail(1, 'run-001')
    expect(detailKey).toEqual(['assistant', 1, 'run', 'run-001'])
  })
})
