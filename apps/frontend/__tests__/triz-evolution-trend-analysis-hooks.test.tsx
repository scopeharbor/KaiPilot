/**
 * TRIZ 进化趋势分析前端 API Client / Hooks 测试
 * v3-triz-evolution-trend-analysis §7.3
 *
 * 覆盖：query key 稳定性、URL 与查询串拼装、envelope 解析、错误传播、
 * enabled 守卫（projectId/runId 非法时不发请求）与 mutation 成功后的缓存失效。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

vi.mock('@/lib/api-client', () => ({
  apiFetchEnvelope: vi.fn(),
}))

import { apiFetchEnvelope } from '@/lib/api-client'
import { evolutionTrendApi, evolutionTrendKeys } from '@/lib/api/triz-evolution-trend-analysis'
import {
  useEvolutionTrendAnalyses,
  useEvolutionTrendScores,
  useEvolutionTrendRisks,
  useCreateEvolutionTrendAnalysis,
  useReviewEvolutionTrendRisk,
  useEvolutionWorkbenchPreview,
} from '@/hooks/use-evolution-trend-analysis'

const mockFetch = vi.mocked(apiFetchEnvelope)

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children)
  return { qc, wrapper }
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('evolutionTrendKeys', () => {
  it('相同入参生成稳定 key', () => {
    expect(evolutionTrendKeys.list(1, { page: 1 })).toEqual(evolutionTrendKeys.list(1, { page: 1 }))
  })

  it('不同项目/运行生成不同 key', () => {
    expect(evolutionTrendKeys.detail(1, 9)).not.toEqual(evolutionTrendKeys.detail(2, 9))
    expect(evolutionTrendKeys.trends(1, 9)).not.toEqual(evolutionTrendKeys.trends(1, 10))
  })

  it('key 携带进化趋势分析命名空间', () => {
    expect(evolutionTrendKeys.all).toContain('triz-evolution-trend-analysis')
    expect(evolutionTrendKeys.risks(1, 2)).toContain('triz-evolution-trend-analysis')
  })
})

describe('evolutionTrendApi — 路径与 envelope', () => {
  it('list 拼接项目作用域路径与查询串', async () => {
    mockFetch.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    })
    await evolutionTrendApi.list(42, { page: 2, perPage: 10, status: 'completed' })

    const url = mockFetch.mock.calls[0]![0] as string
    expect(url).toContain('/projects/42/triz/evolution-trend-analyses')
    expect(url).toContain('page=2')
    expect(url).toContain('perPage=10')
    expect(url).toContain('status=completed')
  })

  it('list 无参数时不产生多余查询串', async () => {
    mockFetch.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    })
    await evolutionTrendApi.list(42)
    expect(mockFetch.mock.calls[0]![0]).toBe('/projects/42/triz/evolution-trend-analyses')
  })

  it('create 走 POST 并解出 data', async () => {
    mockFetch.mockResolvedValue({ data: { id: 7, trends: [], risks: [] } })
    const result = await evolutionTrendApi.create(42, { userContext: '识别瓶颈' })
    const call = mockFetch.mock.calls[0]!
    expect(call[0]).toBe('/projects/42/triz/evolution-trend-analyses')
    expect(call[1]!.method).toBe('POST')
    expect(result.id).toBe(7)
  })

  it('history 解出 data', async () => {
    mockFetch.mockResolvedValue({ data: { runId: 3, baselineRunId: 1, trendDeltas: [] } })
    const result = await evolutionTrendApi.history(42, 3)
    expect(result.runId).toBe(3)
  })

  it('review 走 POST + body', async () => {
    mockFetch.mockResolvedValue({
      data: { riskKey: 'trr-1', status: 'reviewed', reviewedBy: 1, reviewedAt: 't' },
    })
    await evolutionTrendApi.review(42, 1, 2, { action: 'mark_reviewed' })
    const call = mockFetch.mock.calls[0]!
    expect(call[0]).toBe('/projects/42/triz/evolution-trend-analyses/1/risks/2/review')
    expect(call[1]!.method).toBe('POST')
    expect(call[1]!.body).toContain('mark_reviewed')
  })

  it('workbenchPreview 传 currentSourceHashes body', async () => {
    mockFetch.mockResolvedValue({
      data: { runId: 1, riskKey: 'trr-1', requiresUserConfirmation: true },
    })
    await evolutionTrendApi.workbenchPreview(42, 1, 2, {
      currentSourceHashes: { tasks_wbs: 'abc' },
    })
    const call = mockFetch.mock.calls[0]!
    expect(call[0]).toBe('/projects/42/triz/evolution-trend-analyses/1/risks/2/workbench-preview')
    expect(call[1]!.body).toContain('abc')
  })
})

describe('useEvolutionTrendAnalyses — enabled 守卫与 envelope', () => {
  it('projectId 非法时不发请求', () => {
    const { wrapper } = makeWrapper()
    renderHook(() => useEvolutionTrendAnalyses(0, {}), { wrapper })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('projectId 合法时发请求并返回 data', async () => {
    mockFetch.mockResolvedValue({
      data: [{ id: 1 }],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useEvolutionTrendAnalyses(42, {}), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data!.data).toHaveLength(1)
  })
})

describe('useEvolutionTrendScores — enabled 守卫', () => {
  it('runId 非法时不发请求', () => {
    const { wrapper } = makeWrapper()
    renderHook(() => useEvolutionTrendScores(42, 0, {}), { wrapper })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('useEvolutionTrendRisks — enabled 守卫', () => {
  it('runId 合法时发请求', async () => {
    mockFetch.mockResolvedValue({
      data: [{ riskKey: 'trr-1' }],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useEvolutionTrendRisks(42, 1, {}), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data!.data[0]!.riskKey).toBe('trr-1')
  })
})

describe('useCreateEvolutionTrendAnalysis — invalidation', () => {
  it('创建成功后失效 list 查询', async () => {
    mockFetch.mockResolvedValue({ data: { id: 9, trends: [], risks: [] } })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useCreateEvolutionTrendAnalysis(), { wrapper })
    await result.current.mutateAsync({ projectId: 42 })
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled())
    const invalidatedKey = invalidateSpy.mock.calls[0]![0]!.queryKey
    expect(invalidatedKey).toContain('triz-evolution-trend-analysis')
  })
})

describe('useReviewEvolutionTrendRisk — invalidation', () => {
  it('审查成功后失效 risks 查询', async () => {
    mockFetch.mockResolvedValue({
      data: { riskKey: 'trr-1', status: 'reviewed', reviewedBy: 1, reviewedAt: 't' },
    })
    const { qc, wrapper } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useReviewEvolutionTrendRisk(), { wrapper })
    await result.current.mutateAsync({
      projectId: 42,
      runId: 1,
      riskId: 2,
      body: { action: 'mark_reviewed' },
    })
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled())
    const invalidatedKey = invalidateSpy.mock.calls[0]![0]!.queryKey
    expect(invalidatedKey).toContain('risks')
  })
})

describe('useEvolutionWorkbenchPreview', () => {
  it('调用预览并返回 data', async () => {
    mockFetch.mockResolvedValue({
      data: { runId: 1, riskKey: 'trr-1', targetType: 'workbench', requiresUserConfirmation: true },
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useEvolutionWorkbenchPreview(), { wrapper })
    const res = await result.current.mutateAsync({ projectId: 42, runId: 1, riskId: 2 })
    expect(res.targetType).toBe('workbench')
    expect(res.requiresUserConfirmation).toBe(true)
  })
})
