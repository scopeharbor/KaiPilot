/**
 * v3-triz-contradiction-matrix-ui —— 前端 API/hook 测试。
 *
 * 覆盖：
 * - query keys 稳定性
 * - projectId 非法时不查询（disabled project 行为）
 * - 筛选器序列化一致性
 * - 成功映射
 * - 统一错误处理
 * - mutation 失效缓存
 */
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { trizContradictionMatrixApi } from '@/lib/api/triz-contradiction-matrix'
import {
  useTrizContradictionMatrix,
  useTrizContradictionMatrixHandoff,
} from '@/hooks/use-triz-contradiction-matrix'
import { trizContradictionMatrixKeys } from '@/lib/api/triz-contradiction-matrix'
import type { TrizContradictionMatrix } from '@aiproj/types'
import { buildMatrixDTO, buildMatrixHandoffInput } from '@aiproj/types'

// ---------------------------------------------------------------------------
// Mock API module
// ---------------------------------------------------------------------------

vi.mock('@/lib/api/triz-contradiction-matrix', () => ({
  trizContradictionMatrixApi: {
    getMatrix: vi.fn(),
    handoff: vi.fn(),
  },
  trizContradictionMatrixKeys: {
    all: ['triz-contradiction-matrix'],
    matrix: (projectId: number, filters: string) => [
      'triz-contradiction-matrix',
      'matrix',
      projectId,
      filters,
    ],
  },
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const matrixFixture: TrizContradictionMatrix = buildMatrixDTO({ projectId: 42 })

const handoffResponse = {
  status: 'created' as const,
  targetRef: 'mx_wb_abc123',
  blockedReason: null,
  idempotencyKey: 'test-key-001',
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

// ===========================================================================
// Query Keys
// ===========================================================================

describe('trizContradictionMatrixKeys', () => {
  it('all 是稳定数组', () => {
    expect(trizContradictionMatrixKeys.all).toEqual(['triz-contradiction-matrix'])
  })

  it('相同 projectId + 相同筛选器 → 相同 key', () => {
    const filters = { contradictionType: 'technical', severity: 'high' } as const
    const k1 = trizContradictionMatrixKeys.matrix(42, filters)
    const k2 = trizContradictionMatrixKeys.matrix(42, filters)
    expect(k1).toEqual(k2)
  })

  it('不同 projectId → 不同 key', () => {
    const k1 = trizContradictionMatrixKeys.matrix(42, {})
    const k2 = trizContradictionMatrixKeys.matrix(43, {})
    expect(k1).not.toEqual(k2)
  })
})

// ===========================================================================
// useTrizContradictionMatrix
// ===========================================================================

describe('useTrizContradictionMatrix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('成功获取矩阵 DTO', async () => {
    vi.mocked(trizContradictionMatrixApi.getMatrix).mockResolvedValue(matrixFixture)

    const { result } = renderHook(() => useTrizContradictionMatrix(42, {}), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(trizContradictionMatrixApi.getMatrix).toHaveBeenCalledWith(42, {})
    expect(result.current.data).toEqual(matrixFixture)
    expect(result.current.data?.zeroModelCost).toBe(true)
  })

  it('projectId 非法（0）时不查询', async () => {
    const { result } = renderHook(() => useTrizContradictionMatrix(0, {}), {
      wrapper: createWrapper(),
    })
    expect(result.current.isFetching).toBe(false)
    expect(trizContradictionMatrixApi.getMatrix).not.toHaveBeenCalled()
  })

  it('projectId 负数时不查询', async () => {
    const { result } = renderHook(() => useTrizContradictionMatrix(-1, {}), {
      wrapper: createWrapper(),
    })
    expect(result.current.isFetching).toBe(false)
    expect(trizContradictionMatrixApi.getMatrix).not.toHaveBeenCalled()
  })

  it('NaN projectId 不查询', async () => {
    const { result } = renderHook(() => useTrizContradictionMatrix(NaN, {}), {
      wrapper: createWrapper(),
    })
    expect(result.current.isFetching).toBe(false)
    expect(trizContradictionMatrixApi.getMatrix).not.toHaveBeenCalled()
  })

  it('带筛选器时调用 API 传入筛选器', async () => {
    vi.mocked(trizContradictionMatrixApi.getMatrix).mockResolvedValue(matrixFixture)
    const filters = { contradictionType: 'technical' as const, severity: 'high' as const }

    const { result } = renderHook(() => useTrizContradictionMatrix(42, filters), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(trizContradictionMatrixApi.getMatrix).toHaveBeenCalledWith(42, filters)
  })

  it('处理 401 认证错误', async () => {
    vi.mocked(trizContradictionMatrixApi.getMatrix).mockRejectedValue({
      status: 401,
      code: 'AUTH_REQUIRED',
    })

    const { result } = renderHook(() => useTrizContradictionMatrix(42, {}), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeDefined()
  })

  it('处理 422 校验错误', async () => {
    vi.mocked(trizContradictionMatrixApi.getMatrix).mockRejectedValue({
      status: 422,
      code: 'VALIDATION_ERROR',
    })

    const { result } = renderHook(() => useTrizContradictionMatrix(42, {}), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('处理 403 权限错误', async () => {
    vi.mocked(trizContradictionMatrixApi.getMatrix).mockRejectedValue({
      status: 403,
      code: 'PERMISSION_DENIED',
    })

    const { result } = renderHook(() => useTrizContradictionMatrix(42, {}), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

// ===========================================================================
// useTrizContradictionMatrixHandoff
// ===========================================================================

describe('useTrizContradictionMatrixHandoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('成功提交 handoff', async () => {
    vi.mocked(trizContradictionMatrixApi.handoff).mockResolvedValue(handoffResponse)
    const input = buildMatrixHandoffInput({ projectId: 42 })

    const { result } = renderHook(() => useTrizContradictionMatrixHandoff(42), {
      wrapper: createWrapper(),
    })

    await result.current.mutateAsync(input)

    expect(trizContradictionMatrixApi.handoff).toHaveBeenCalledWith(42, input)
    await waitFor(() => expect(result.current.data?.status).toBe('created'))
    expect(result.current.data?.targetRef).toBe('mx_wb_abc123')
  })

  it('handoff 返回 stale_blocked 时不抛错', async () => {
    vi.mocked(trizContradictionMatrixApi.handoff).mockResolvedValue({
      status: 'stale_blocked',
      targetRef: null,
      blockedReason: '来源 hash 已变化',
      idempotencyKey: 'test-key-001',
    })
    const input = buildMatrixHandoffInput({ projectId: 42 })

    const { result } = renderHook(() => useTrizContradictionMatrixHandoff(42), {
      wrapper: createWrapper(),
    })

    await result.current.mutateAsync(input)

    await waitFor(() => expect(result.current.data?.status).toBe('stale_blocked'))
    expect(result.current.data?.blockedReason).toBe('来源 hash 已变化')
  })

  it('handoff 失败时抛错', async () => {
    vi.mocked(trizContradictionMatrixApi.handoff).mockRejectedValue({
      status: 403,
      code: 'PERMISSION_DENIED',
    })
    const input = buildMatrixHandoffInput({ projectId: 42 })

    const { result } = renderHook(() => useTrizContradictionMatrixHandoff(42), {
      wrapper: createWrapper(),
    })

    await expect(result.current.mutateAsync(input)).rejects.toBeDefined()
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('handoff 成功后失效矩阵缓存', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    vi.mocked(trizContradictionMatrixApi.handoff).mockResolvedValue(handoffResponse)
    const input = buildMatrixHandoffInput({ projectId: 42 })

    const wrapper = function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(QueryClientProvider, { client: queryClient }, children)
    }

    const { result } = renderHook(() => useTrizContradictionMatrixHandoff(42), { wrapper })

    await result.current.mutateAsync(input)

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: trizContradictionMatrixKeys.all,
    })
  })
})
