/**
 * OKR Dashboard API client + hooks 测试（v3-okr-dashboard §5.2）。
 *
 * 覆盖：
 *   - fetchOkrDashboardSummary：路径、白名单序列化、envelope 解包、错误传递
 *   - okrDashboardKeys.summary：跨组织稳定性、query 语义等价性（数组顺序）
 *   - useOkrDashboardSummary hook：成功、forbidden(403) 不重试、
 *     validation(422)、无组织时 disabled、retry 策略
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { computeOkrDashboardSummary, makeOkrDashboardFixtureInput } from '@aiproj/types'
import { fetchOkrDashboardSummary, okrDashboardKeys } from '@/lib/api/okr-dashboard'
import { useOkrDashboardSummary } from '@/hooks/use-okr-dashboard'
import React from 'react'
import type { OkrDashboardQuery, OkrDashboardWarning } from '@aiproj/types'

const apiFetchEnvelope = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return {
    ...actual,
    apiFetchEnvelope,
  }
})

const summary = computeOkrDashboardSummary(makeOkrDashboardFixtureInput())

beforeEach(() => {
  apiFetchEnvelope.mockReset()
  apiFetchEnvelope.mockResolvedValue({ data: summary })
})

// ─── API client ───────────────────────────────────────────────────────────────

describe('OKR Dashboard API client —— fetch', () => {
  it('无 query 时路径不带查询串', async () => {
    await fetchOkrDashboardSummary(42)
    expect(apiFetchEnvelope).toHaveBeenCalledWith('/organizations/42/okrs/dashboard')
  })

  it('单值 query 参数按白名单序列化', async () => {
    await fetchOkrDashboardSummary(42, {
      cycleId: 10,
      ownerId: 3,
      attentionLimit: 5,
      attentionSort: 'confidence',
      attentionOrder: 'desc',
      staleThresholdMinutes: 60,
      dateFrom: '2026-07-01',
      dateTo: '2026-07-30',
      search: '目标',
    })
    const path = String(apiFetchEnvelope.mock.calls[0]?.[0])
    expect(path.startsWith('/organizations/42/okrs/dashboard?')).toBe(true)
    const params = new URLSearchParams(path.split('?')[1])
    expect(params.get('cycleId')).toBe('10')
    expect(params.get('ownerId')).toBe('3')
    expect(params.get('attentionLimit')).toBe('5')
    expect(params.get('attentionSort')).toBe('confidence')
    expect(params.get('attentionOrder')).toBe('desc')
    expect(params.get('staleThresholdMinutes')).toBe('60')
    expect(params.get('dateFrom')).toBe('2026-07-01')
    expect(params.get('dateTo')).toBe('2026-07-30')
    expect(params.get('search')).toBe('目标')
  })

  it('数组 query（scope/status/sections/include）走重复 key，不用逗号', async () => {
    await fetchOkrDashboardSummary(42, {
      scope: ['organization', 'project'],
      status: ['active', 'paused'],
      sections: ['kpi', 'attention'],
      include: ['alignment_health'],
    })
    const path = String(apiFetchEnvelope.mock.calls[0]?.[0])
    const params = new URLSearchParams(path.split('?')[1])
    expect(params.getAll('scope')).toEqual(['organization', 'project'])
    expect(params.getAll('status')).toEqual(['active', 'paused'])
    expect(params.getAll('sections')).toEqual(['kpi', 'attention'])
    expect(params.getAll('include')).toEqual(['alignment_health'])
  })

  it('undefined/null/空数组不进 URL', async () => {
    await fetchOkrDashboardSummary(42, {
      cycleId: undefined,
      ownerId: undefined,
      scope: [],
      status: undefined,
      search: '',
    })
    expect(apiFetchEnvelope).toHaveBeenCalledWith('/organizations/42/okrs/dashboard')
  })

  it('解包 envelope.data', async () => {
    const result = await fetchOkrDashboardSummary(42)
    expect(result.meta.metricVersion).toBe(summary.meta.metricVersion)
    expect(result.cycleContext.cycleId).toBe(summary.cycleContext.cycleId)
  })

  it('底层抛错时向上传递（不吞异常）', async () => {
    apiFetchEnvelope.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 }))
    await expect(fetchOkrDashboardSummary(42)).rejects.toMatchObject({
      status: 403,
    })
  })
})

// ─── Query keys ───────────────────────────────────────────────────────────────

describe('OKR Dashboard query keys —— 稳定性', () => {
  it('组织 ID 不同 → key 不同（不串组织缓存）', () => {
    const a = okrDashboardKeys.summary(1)
    const b = okrDashboardKeys.summary(2)
    expect(a).not.toEqual(b)
  })

  it('组织为 null → key 中出现 "none"', () => {
    expect(JSON.stringify(okrDashboardKeys.summary(null))).toContain('none')
  })

  it('query 语义等价（数组顺序不同、undefined 存在）→ key 相同', () => {
    const a = okrDashboardKeys.summary(1, {
      scope: ['organization', 'project'],
      cycleId: 10,
      ownerId: undefined,
    })
    const b = okrDashboardKeys.summary(1, {
      cycleId: 10,
      scope: ['project', 'organization'],
    })
    expect(a).toEqual(b)
  })

  it('不同 cycle → key 不同', () => {
    const a = okrDashboardKeys.summary(1, { cycleId: 10 })
    const b = okrDashboardKeys.summary(1, { cycleId: 11 })
    expect(a).not.toEqual(b)
  })
})

// ─── Hook ─────────────────────────────────────────────────────────────────────

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
  return { client, Wrapper }
}

describe('useOkrDashboardSummary —— hook', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('organizationId=null 时 hook disabled，不发请求', async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useOkrDashboardSummary({ organizationId: null }), {
      wrapper: Wrapper,
    })
    // 等一 tick 确认没有触发 fetch
    await new Promise((r) => setTimeout(r, 10))
    expect(apiFetchEnvelope).not.toHaveBeenCalled()
    expect(result.current.isFetching).toBe(false)
  })

  it('成功路径：返回 summary', async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useOkrDashboardSummary({ organizationId: 42 }), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.meta.metricVersion).toBe(summary.meta.metricVersion)
  })

  it('403 forbidden → 不重试，isError=true', async () => {
    apiFetchEnvelope.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }))
    // 由 queryRetry 判断，不由 wrapper 强制 retry=false 遮蔽
    const client = new QueryClient()
    const Wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client }, children)
    const { result } = renderHook(() => useOkrDashboardSummary({ organizationId: 42 }), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(apiFetchEnvelope).toHaveBeenCalledTimes(1) // 403 不重试
  })

  it('422 validation error → queryRetry 允许通用错误重试（非 401/403）', async () => {
    // 单独验证 queryRetry 函数逻辑：非 401/403 且 failureCount<2 时应该允许重试
    const { queryRetry } = await import('@/lib/api-client')
    const err = Object.assign(new Error('validation'), { status: 422 })
    expect(queryRetry(0, err)).toBe(true) // 第 1 次失败，允许重试
    expect(queryRetry(1, err)).toBe(true) // 第 2 次失败，允许重试
    expect(queryRetry(2, err)).toBe(false) // 第 3 次失败，停止
    // 403 立即停止
    const forbidden = Object.assign(new Error('forbidden'), { status: 403 })
    expect(queryRetry(0, forbidden)).toBe(false)
    // 401 立即停止
    const unauthorized = Object.assign(new Error('auth'), { status: 401 })
    expect(queryRetry(0, unauthorized)).toBe(false)
  })

  it('enabled=false 时不发请求', async () => {
    const { Wrapper } = makeWrapper()
    renderHook(() => useOkrDashboardSummary({ organizationId: 42, enabled: false }), {
      wrapper: Wrapper,
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(apiFetchEnvelope).not.toHaveBeenCalled()
  })

  it('query 变化触发新请求（缓存不串）', async () => {
    const { Wrapper } = makeWrapper()
    const { rerender, result } = renderHook(
      ({ query }: { query: OkrDashboardQuery }) =>
        useOkrDashboardSummary({ organizationId: 42, query }),
      { wrapper: Wrapper, initialProps: { query: { cycleId: 10 } } },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiFetchEnvelope).toHaveBeenCalledTimes(1)
    rerender({ query: { cycleId: 11 } })
    await waitFor(() => expect(apiFetchEnvelope).toHaveBeenCalledTimes(2))
  })
})

// ─── backflow unavailable / stale warning 场景（fixture 层） ─────────────────

describe('useOkrDashboardSummary —— 语义分支（fixture）', () => {
  it('summary 携带 backflow.available=false（不可用）时 hook 仍视为成功', async () => {
    const withUnavailable = {
      ...summary,
      backflow: { ...summary.backflow, available: false },
    }
    apiFetchEnvelope.mockResolvedValue({ data: withUnavailable })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useOkrDashboardSummary({ organizationId: 42 }), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.backflow.available).toBe(false)
  })

  it('summary 携带 stale warning 时 hook 成功且 warning 可读', async () => {
    const withWarning = {
      ...summary,
      warnings: [{ code: 'SOURCE_STALE', message: 'stale' }] as OkrDashboardWarning[],
    }
    apiFetchEnvelope.mockResolvedValue({ data: withWarning })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useOkrDashboardSummary({ organizationId: 42 }), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.warnings.some((w) => w.code === 'SOURCE_STALE')).toBe(true)
  })
})
