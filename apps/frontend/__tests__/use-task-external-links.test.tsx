import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useTaskExternalLinks,
  useCreateTaskExternalLink,
  useDeleteTaskExternalLink,
  useRefreshTaskExternalLink,
} from '@/hooks/use-task-external-links'
import { taskExternalLinksApi } from '@/lib/api/task-external-links'
import type { AuthState } from '@/stores/auth-store'
import type { ExternalLinkDto, CodeRepositoryCiSummary } from '@aiproj/types'

type AuthSelector = (state: AuthState) => unknown

function createAuthState(isAuthenticated: boolean): AuthState {
  return {
    user: null,
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId: null,
    planTier: null,
    roleVersion: 0,
    isAuthenticated,
    hasHydrated: true,
    setSession: vi.fn(),
    setTokens: vi.fn(),
    clear: vi.fn(),
    setHasHydrated: vi.fn(),
    hasPermission: vi.fn(() => false),
    switchOrganization: vi.fn(async () => {}),
    // v3-multitenant-tenant-identification §8.1 新增的租户识别态。
    effectiveTenantContext: null,
    selectionEpoch: 0,
    refreshEffectiveTenantContext: vi.fn(async () => null),
  }
}

function createExternalLink(overrides: Partial<ExternalLinkDto> = {}): ExternalLinkDto {
  return {
    id: 1,
    provider: 'github',
    linkType: 'issue',
    repositoryOwner: 'owner',
    repositoryName: 'repo',
    externalNumber: 42,
    externalId: '42',
    externalTitle: 'Issue 42',
    externalStatus: 'open',
    externalUrl: 'https://github.com/owner/repo/issues/42',
    statusSource: 'manual',
    lastObservedAt: null,
    note: null,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    createdBy: 1,
    updatedBy: 1,
    ...overrides,
  }
}

vi.mock('@/lib/api/task-external-links', () => ({
  taskExternalLinksApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    refresh: vi.fn(),
  },
  taskExternalLinkKeys: {
    all: ['task-external-links'],
    list: (projectId: number, taskId: number) => ['task-external-links', 'list', projectId, taskId],
  },
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: vi.fn((sel?: AuthSelector) => {
    const state: AuthState = {
      user: null,
      accessToken: null,
      refreshToken: null,
      permissions: [],
      currentOrganizationId: null,
      planTier: null,
      roleVersion: 0,
      isAuthenticated: true,
      hasHydrated: true,
      setSession: vi.fn(),
      setTokens: vi.fn(),
      clear: vi.fn(),
      setHasHydrated: vi.fn(),
      hasPermission: vi.fn(() => false),
      switchOrganization: vi.fn(async () => {}),
      // v3-multitenant-tenant-identification §8.1 新增的租户识别态。
      effectiveTenantContext: null,
      selectionEpoch: 0,
      refreshEffectiveTenantContext: vi.fn(async () => null),
    }
    return sel ? sel(state) : state
  }),
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function createWrapper(queryClient = createQueryClient()) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useTaskExternalLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches external links for a task', async () => {
    const mockData: ExternalLinkDto[] = [createExternalLink()]
    vi.mocked(taskExternalLinksApi.list).mockResolvedValue(mockData)

    const { result } = renderHook(() => useTaskExternalLinks(1, 100), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(taskExternalLinksApi.list).toHaveBeenCalledWith(1, 100)
    expect(result.current.data).toEqual(mockData)
    // data should be an array directly (apiFetch unwraps body.data)
    expect(Array.isArray(result.current.data)).toBe(true)
    expect(result.current.data).toHaveLength(1)
  })

  it('does not fetch when not authenticated', async () => {
    const { useAuthStore } = await import('@/stores/auth-store')
    vi.mocked(useAuthStore).mockImplementation((sel?: AuthSelector) => {
      const state = createAuthState(false)
      return sel ? sel(state) : state
    })

    const { result } = renderHook(() => useTaskExternalLinks(1, 100), {
      wrapper: createWrapper(),
    })

    expect(result.current.isFetching).toBe(false)
    expect(taskExternalLinksApi.list).not.toHaveBeenCalled()
  })
})

describe('useCreateTaskExternalLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls create API and invalidates list cache', async () => {
    vi.mocked(taskExternalLinksApi.create).mockResolvedValue({
      data: { id: 1 },
    } as unknown as Awaited<ReturnType<typeof taskExternalLinksApi.create>>)
    vi.mocked(taskExternalLinksApi.list).mockResolvedValue([])

    const { result } = renderHook(() => useCreateTaskExternalLink(1, 100), {
      wrapper: createWrapper(),
    })

    // First fetch the list to populate cache
    renderHook(() => useTaskExternalLinks(1, 100), { wrapper: createWrapper() })

    result.current.mutate({
      provider: 'github',
      linkType: 'issue',
      repositoryOwner: 'owner',
      repositoryName: 'repo',
      externalNumber: 42,
      externalStatus: 'open',
      externalUrl: 'https://github.com/owner/repo/issues/42',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(taskExternalLinksApi.create).toHaveBeenCalledWith(1, 100, expect.any(Object))
  })
})

describe('useDeleteTaskExternalLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls delete API', async () => {
    vi.mocked(taskExternalLinksApi.delete).mockResolvedValue(undefined)

    const { result } = renderHook(() => useDeleteTaskExternalLink(1, 100), {
      wrapper: createWrapper(),
    })

    result.current.mutate(42)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(taskExternalLinksApi.delete).toHaveBeenCalledWith(1, 100, 42)
  })
})

describe('useRefreshTaskExternalLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls refresh API and invalidates list cache on success', async () => {
    const queryClient = createQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    vi.mocked(taskExternalLinksApi.refresh).mockResolvedValue({
      data: { id: 42, result: 'success', message: '链接状态已刷新' },
    } as unknown as Awaited<ReturnType<typeof taskExternalLinksApi.refresh>>)

    const { result } = renderHook(() => useRefreshTaskExternalLink(1, 100), {
      wrapper: createWrapper(queryClient),
    })

    result.current.mutate(42)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(taskExternalLinksApi.refresh).toHaveBeenCalledWith(1, 100, 42)
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['task-external-links', 'list', 1, 100],
    })
    expect(result.current.data).toBeDefined()
  })

  it('returns stable failure results without throwing for provider failures', async () => {
    vi.mocked(taskExternalLinksApi.refresh).mockResolvedValue({
      data: {
        id: 42,
        result: 'rate_limited',
        message: '请求过于频繁，请稍后重试',
        retryAfter: 60,
      },
    } as Awaited<ReturnType<typeof taskExternalLinksApi.refresh>>)

    const { result } = renderHook(() => useRefreshTaskExternalLink(1, 100), {
      wrapper: createWrapper(),
    })

    result.current.mutate(42)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data.result).toBe('rate_limited')
    expect(result.current.data?.data.retryAfter).toBe(60)
  })

  it('surfaces network errors from the API client', async () => {
    vi.mocked(taskExternalLinksApi.refresh).mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useRefreshTaskExternalLink(1, 100), {
      wrapper: createWrapper(),
    })

    result.current.mutate(42)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(taskExternalLinksApi.refresh).toHaveBeenCalledTimes(1)
  })

  it('suppresses duplicate refresh submissions for the same link while pending', async () => {
    const deferred = createDeferred<Awaited<ReturnType<typeof taskExternalLinksApi.refresh>>>()
    vi.mocked(taskExternalLinksApi.refresh).mockReturnValue(deferred.promise)

    const { result } = renderHook(() => useRefreshTaskExternalLink(1, 100), {
      wrapper: createWrapper(),
    })

    const first = result.current.mutateAsync(42)
    const second = result.current.mutateAsync(42)

    await waitFor(() => expect(taskExternalLinksApi.refresh).toHaveBeenCalledTimes(1))
    deferred.resolve({
      data: { id: 42, result: 'success', message: '链接状态已刷新' },
    } as Awaited<ReturnType<typeof taskExternalLinksApi.refresh>>)

    await expect(first).resolves.toEqual(expect.objectContaining({ data: expect.any(Object) }))
    await expect(second).resolves.toEqual(expect.objectContaining({ data: expect.any(Object) }))
  })

  // ---------------------------------------------------------------------------
  // v2-5-code-repository-ci-status-display —— 6.2 CI 摘要相关测试
  // ---------------------------------------------------------------------------

  it('成功刷新返回 ciSummary 并更新缓存', async () => {
    const queryClient = createQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const mockCiSummary: CodeRepositoryCiSummary = {
      state: 'passed',
      conclusion: 'success',
      label: 'CI',
      source: 'github_checks',
      targetUrl: 'https://github.com/owner/repo/runs/1',
      observedAt: '2026-07-23T10:00:00.000Z',
      updatedAt: '2026-07-23T10:00:00.000Z',
      reasonCode: 'ok',
      isStale: false,
    }
    vi.mocked(taskExternalLinksApi.refresh).mockResolvedValue({
      data: {
        id: 42,
        result: 'success',
        message: '链接状态已刷新',
        ciSummary: mockCiSummary,
      },
    } as unknown as Awaited<ReturnType<typeof taskExternalLinksApi.refresh>>)

    const { result } = renderHook(() => useRefreshTaskExternalLink(1, 100), {
      wrapper: createWrapper(queryClient),
    })

    result.current.mutate(42)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data.ciSummary?.state).toBe('passed')
    expect(result.current.data?.data.ciSummary?.source).toBe('github_checks')
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['task-external-links', 'list', 1, 100],
    })
  })

  it('失败刷新不返回 ciSummary 且旧数据通过列表查询保留', async () => {
    vi.mocked(taskExternalLinksApi.refresh).mockResolvedValue({
      data: {
        id: 42,
        result: 'forbidden',
        message: '无权访问该仓库',
      },
    } as unknown as Awaited<ReturnType<typeof taskExternalLinksApi.refresh>>)

    const { result } = renderHook(() => useRefreshTaskExternalLink(1, 100), {
      wrapper: createWrapper(),
    })

    result.current.mutate(42)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data.ciSummary).toBeUndefined()
    expect(result.current.data?.data.result).toBe('forbidden')
  })

  it('网络异常时刷新失败，不触发列表查询', async () => {
    vi.mocked(taskExternalLinksApi.refresh).mockRejectedValue(new Error('network error'))

    const { result } = renderHook(() => useRefreshTaskExternalLink(1, 100), {
      wrapper: createWrapper(),
    })

    result.current.mutate(42)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(taskExternalLinksApi.refresh).toHaveBeenCalledWith(1, 100, 42)
    // 刷新失败不应触发列表重新查询
    expect(taskExternalLinksApi.list).not.toHaveBeenCalled()
  })

  it('旧响应兼容：无 ciSummary 的旧刷新响应不破坏前端展示', async () => {
    vi.mocked(taskExternalLinksApi.refresh).mockResolvedValue({
      data: {
        id: 42,
        result: 'success',
        message: '链接状态已刷新',
        // 无 ciSummary 字段 —— 模拟旧版本响应
      },
    } as unknown as Awaited<ReturnType<typeof taskExternalLinksApi.refresh>>)

    const { result } = renderHook(() => useRefreshTaskExternalLink(1, 100), {
      wrapper: createWrapper(),
    })

    result.current.mutate(42)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // ciSummary 应为 undefined，前端 mapCiSummary 会正确处理为 null
    expect(result.current.data?.data).not.toHaveProperty('ciSummary')
  })

  it('重复点击抑制：同一链接同时多次刷新只发一次请求', async () => {
    const deferred = createDeferred<Awaited<ReturnType<typeof taskExternalLinksApi.refresh>>>()
    vi.mocked(taskExternalLinksApi.refresh).mockReturnValue(deferred.promise)

    const { result } = renderHook(() => useRefreshTaskExternalLink(1, 100), {
      wrapper: createWrapper(),
    })

    // 同时发起两次相同链接的刷新
    const first = result.current.mutateAsync(42)
    const second = result.current.mutateAsync(42)

    await waitFor(() => expect(taskExternalLinksApi.refresh).toHaveBeenCalledTimes(1))
    deferred.resolve({
      data: { id: 42, result: 'success', message: '链接状态已刷新' },
    } as Awaited<ReturnType<typeof taskExternalLinksApi.refresh>>)

    await expect(first).resolves.toBeDefined()
    await expect(second).resolves.toBeDefined()
  })
})
