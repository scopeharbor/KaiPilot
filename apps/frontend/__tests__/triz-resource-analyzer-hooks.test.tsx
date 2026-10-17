/**
 * TRIZ 资源分析器前端 API Client / Hooks 测试
 * v3-triz-resource-analyzer §7.3
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
import { resourceAnalyzerApi, resourceAnalyzerKeys } from '@/lib/api/triz-resource-analyzer'
import {
  useResourceAnalyses,
  useResourceSnapshots,
  useResourceOpportunities,
  useCreateResourceAnalysis,
  useReviewResourceOpportunity,
} from '@/hooks/use-resource-analyzer'

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

describe('resourceAnalyzerKeys', () => {
  it('相同入参生成稳定 key', () => {
    expect(resourceAnalyzerKeys.list(1, { page: 1 })).toEqual(
      resourceAnalyzerKeys.list(1, { page: 1 }),
    )
  })

  it('不同项目/运行生成不同 key', () => {
    expect(resourceAnalyzerKeys.detail(1, 9)).not.toEqual(resourceAnalyzerKeys.detail(2, 9))
    expect(resourceAnalyzerKeys.opportunities(1, 9)).not.toEqual(
      resourceAnalyzerKeys.opportunities(1, 10),
    )
  })

  it('key 携带资源分析器命名空间', () => {
    expect(resourceAnalyzerKeys.resources(1, 2)).toContain('triz-resource-analyzer')
  })
})

describe('resourceAnalyzerApi — 路径与 envelope', () => {
  it('list 拼接项目作用域路径与查询串', async () => {
    mockFetch.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    })
    await resourceAnalyzerApi.list(42, { page: 2, perPage: 10, status: 'completed' })

    const url = mockFetch.mock.calls[0]![0] as string
    expect(url).toContain('/projects/42/triz/resource-analyses')
    expect(url).toContain('page=2')
    expect(url).toContain('perPage=10')
    expect(url).toContain('status=completed')
  })

  it('list 无参数时不产生多余查询串', async () => {
    mockFetch.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    })
    await resourceAnalyzerApi.list(42)
    expect(mockFetch.mock.calls[0]![0]).toBe('/projects/42/triz/resource-analyses')
  })

  it('create 走 POST 并解出 data', async () => {
    mockFetch.mockResolvedValue({ data: { id: 7, opportunities: [] } })
    const result = await resourceAnalyzerApi.create(42, { userContext: '降本' })

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/projects/42/triz/resource-analyses')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ userContext: '降本' })
    expect(result).toMatchObject({ id: 7 })
  })

  it('review / preview 端点带 run 与 opportunity 段', async () => {
    mockFetch.mockResolvedValue({ data: {} })
    await resourceAnalyzerApi.review(42, 7, 11, { action: 'mark_reviewed' })
    expect(mockFetch.mock.calls[0]![0]).toBe(
      '/projects/42/triz/resource-analyses/7/opportunities/11/review',
    )

    mockFetch.mockResolvedValue({ data: {} })
    await resourceAnalyzerApi.workbenchPreview(42, 7, 11)
    expect(mockFetch.mock.calls[1]![0]).toBe(
      '/projects/42/triz/resource-analyses/7/opportunities/11/workbench-preview',
    )

    mockFetch.mockResolvedValue({ data: {} })
    await resourceAnalyzerApi.resourcePreview(42, 7, 11)
    expect(mockFetch.mock.calls[2]![0]).toBe(
      '/projects/42/triz/resource-analyses/7/opportunities/11/resource-preview',
    )
  })

  it('resources 过滤参数进入查询串', async () => {
    mockFetch.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 50, totalPages: 0 },
    })
    await resourceAnalyzerApi.listResources(42, 7, {
      resourceKind: 'human',
      origin: 'user_supplied',
    })

    const url = mockFetch.mock.calls[0]![0] as string
    expect(url).toContain('resourceKind=human')
    expect(url).toContain('origin=user_supplied')
  })
})

describe('hooks — enabled 守卫与数据流', () => {
  it('projectId 非法时不发请求', () => {
    const { wrapper } = makeWrapper()
    renderHook(() => useResourceAnalyses(0), { wrapper })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('runId 为 0 时快照/机会查询不发请求', () => {
    const { wrapper } = makeWrapper()
    renderHook(() => useResourceSnapshots(42, 0), { wrapper })
    renderHook(() => useResourceOpportunities(42, 0), { wrapper })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('合法入参时返回 { data, meta } envelope', async () => {
    mockFetch.mockResolvedValue({
      data: [{ opportunityKey: 'rop-1', id: 11 }],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useResourceOpportunities(42, 7), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data[0]).toMatchObject({ id: 11 })
    expect(result.current.data?.meta.total).toBe(1)
  })

  it('请求失败时向上暴露错误', async () => {
    mockFetch.mockRejectedValue(new Error('PERMISSION_DENIED'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useResourceAnalyses(42), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as Error).message).toBe('PERMISSION_DENIED')
  })
})

describe('hooks — mutation 与缓存失效', () => {
  it('创建成功后失效运行列表缓存', async () => {
    mockFetch.mockResolvedValue({ data: { id: 7 } })
    const { qc, wrapper } = makeWrapper()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useCreateResourceAnalysis(), { wrapper })
    result.current.mutate({ projectId: 42 })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(spy).toHaveBeenCalledWith({ queryKey: resourceAnalyzerKeys.list(42) })
  })

  it('审查成功后失效机会候选缓存', async () => {
    mockFetch.mockResolvedValue({ data: { opportunityKey: 'rop-1', status: 'reviewed' } })
    const { qc, wrapper } = makeWrapper()
    const spy = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useReviewResourceOpportunity(), { wrapper })
    result.current.mutate({
      projectId: 42,
      runId: 7,
      opportunityId: 11,
      body: { action: 'mark_reviewed' },
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(spy).toHaveBeenCalledWith({
      queryKey: resourceAnalyzerKeys.opportunities(42, 7),
    })
  })
})
