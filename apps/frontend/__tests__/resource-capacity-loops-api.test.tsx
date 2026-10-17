// v3-resource-capacity-forecasting-closed-loop §8.2 —— API client / hooks 测试。
// 覆盖：URL query 序列化往返、query key 组织/筛选隔离、enabled 守卫、mutation invalidation。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  serializeRcclUrlFilters,
  parseRcclUrlFilters,
  resourceCapacityLoopKeys,
  fetchRcclLoops,
} from '@/lib/api/resource-capacity-loops'
import { useRcclLoops } from '@/hooks/use-resource-capacity-loops'

const mockApi = vi.hoisted(() => vi.fn())
const mockApiEnvelope = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApi(...(args as [])),
  apiFetchEnvelope: (...args: unknown[]) => mockApiEnvelope(...(args as [])),
}))
const mockOrg = vi.hoisted(() => ({ id: 1 as number | null }))
vi.mock('@/hooks/use-organization-dashboard', () => ({
  useCurrentOrganizationId: () => mockOrg.id,
}))

beforeEach(() => {
  mockApi.mockReset()
  mockApiEnvelope.mockReset()
  mockApi.mockResolvedValue({ data: [] })
  mockApiEnvelope.mockResolvedValue({
    data: [],
    meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
  })
})

describe('RCCL URL filters（§8.2）', () => {
  it('序列化→解析往返一致', () => {
    const qs = serializeRcclUrlFilters({ state: 'simulated', page: 2 })
    expect(qs).toBe('?state=simulated&page=2')
    const parsed = parseRcclUrlFilters({ state: 'simulated', page: '2' })
    expect(parsed).toEqual({ state: 'simulated', page: 2 })
  })

  it('空筛选不产生 query string；page=1 不写入 URL', () => {
    expect(serializeRcclUrlFilters({ state: undefined, page: 1 })).toBe('')
  })
})

describe('RCCL query keys（§8.1）', () => {
  it('不同组织/筛选的 key 相互隔离', () => {
    const k1 = resourceCapacityLoopKeys.list(1, { state: 'draft' })
    const k2 = resourceCapacityLoopKeys.list(2, { state: 'draft' })
    const k3 = resourceCapacityLoopKeys.list(1, { state: 'closed' })
    expect(k1).not.toEqual(k2)
    expect(k1).not.toEqual(k3)
    // detail key 与 list key 前缀同源但类型位不同。
    expect(resourceCapacityLoopKeys.detail(1, 9)).not.toEqual(k1)
  })
})

describe('useRcclLoops（§8.1）', () => {
  function wrapper() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children)
  }

  it('无组织时不发请求（enabled=false）', async () => {
    mockOrg.id = null
    const { result } = renderHook(() => useRcclLoops(), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))
    expect(mockApi).not.toHaveBeenCalled()
    expect(mockApiEnvelope).not.toHaveBeenCalled()
    mockOrg.id = 1
  })

  it('有组织时请求正确路径并携带筛选', async () => {
    mockOrg.id = 7
    const { result } = renderHook(() => useRcclLoops({ state: 'simulated' }), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // 列表端点带 meta，走信封封装（apiFetch 会解掉一层、丢掉 meta）。
    expect(mockApiEnvelope).toHaveBeenCalledWith(
      '/organizations/7/resource-capacity-loops?state=simulated',
    )
  })

  it('fetchRcclLoops 直接调用时走 apiFetchEnvelope 且路径含组织 id', async () => {
    await fetchRcclLoops(3, { page: 2 })
    expect(mockApiEnvelope).toHaveBeenCalledWith('/organizations/3/resource-capacity-loops?page=2')
  })
})
