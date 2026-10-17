import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useManualRetryOutgoingWebhookDelivery,
  useOutgoingWebhookDeliveries,
  useOutgoingWebhookDeliveryAttempts,
  useOutgoingWebhookDeliveryDetail,
  usePauseOutgoingWebhookDelivery,
  useUnpauseOutgoingWebhookDelivery,
} from '@/hooks/use-outgoing-webhook-deliveries'
import {
  outgoingWebhookDeliveriesApi,
  outgoingWebhookDeliveryKeys,
} from '@/lib/api/outgoing-webhook-deliveries'
import type { AuthState } from '@/stores/auth-store'
import type {
  OutgoingWebhookDeliveryEventDto,
  OutgoingWebhookManualRetryResultDto,
} from '@aiproj/types'

type AuthSelector = (state: AuthState) => unknown

function createDelivery(
  overrides: Partial<OutgoingWebhookDeliveryEventDto> = {},
): OutgoingWebhookDeliveryEventDto {
  return {
    id: 1,
    subscriptionId: 7,
    subscriptionName: '团队通知',
    eventType: 'task.created',
    status: 'failed',
    idempotencyKey: 'wh-evt-1-7-task.created-deadbeef',
    attemptCount: 3,
    maxAttempts: 5,
    lastAttemptStatus: 'failed',
    lastAttemptAt: '2026-07-23T00:00:00.000Z',
    nextAttemptAt: null,
    failureCategory: 'server_error',
    terminalFailureReason: '重试耗尽',
    paused: false,
    sourceEntityType: 'task',
    sourceEntityId: 42,
    projectId: 1,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:01:00.000Z',
    ...overrides,
  }
}

vi.mock('@/lib/api/outgoing-webhook-deliveries', () => ({
  outgoingWebhookDeliveriesApi: {
    list: vi.fn(),
    detail: vi.fn(),
    attempts: vi.fn(),
    retry: vi.fn(),
    pause: vi.fn(),
    unpause: vi.fn(),
  },
  outgoingWebhookDeliveryKeys: {
    all: ['outgoing-webhook-deliveries'],
    list: (query?: unknown) => ['outgoing-webhook-deliveries', 'list', query ?? {}],
    detail: (id: number) => ['outgoing-webhook-deliveries', 'detail', id],
    attempts: (id: number) => ['outgoing-webhook-deliveries', 'attempts', id],
  },
  OUTGOING_WEBHOOK_MANAGE_PERMISSION: 'outgoing_webhook:manage',
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

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function createWrapper(queryClient = createQueryClient()) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useOutgoingWebhookDeliveries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches deliveries when authenticated and returns data + meta', async () => {
    vi.mocked(outgoingWebhookDeliveriesApi.list).mockResolvedValue({
      data: [createDelivery()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })
    const { result } = renderHook(() => useOutgoingWebhookDeliveries(), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(outgoingWebhookDeliveriesApi.list).toHaveBeenCalledWith(undefined)
    expect(result.current.data?.data).toHaveLength(1)
    expect(result.current.data?.meta.total).toBe(1)
  })

  it('passes subscription/status/pagination filters to list', async () => {
    vi.mocked(outgoingWebhookDeliveriesApi.list).mockResolvedValue({
      data: [],
      meta: { total: 0, page: 2, perPage: 50, totalPages: 0 },
    })
    const { result } = renderHook(
      () =>
        useOutgoingWebhookDeliveries({ subscriptionId: 7, status: 'failed', page: 2, perPage: 50 }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(outgoingWebhookDeliveriesApi.list).toHaveBeenCalledWith({
      subscriptionId: 7,
      status: 'failed',
      page: 2,
      perPage: 50,
    })
  })

  it('redacted projection typing excludes secret/payload/signature on events', async () => {
    vi.mocked(outgoingWebhookDeliveriesApi.list).mockResolvedValue({
      data: [createDelivery()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })
    const { result } = renderHook(() => useOutgoingWebhookDeliveries(), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const item = result.current.data!.data[0]!
    // 脱敏投影不含 secret/payload body/signature/ciphertext 键
    expect((item as unknown as Record<string, unknown>).secret).toBeUndefined()
    expect((item as unknown as Record<string, unknown>).payload).toBeUndefined()
    expect((item as unknown as Record<string, unknown>).signature).toBeUndefined()
    expect((item as unknown as Record<string, unknown>).payloadCiphertext).toBeUndefined()
    expect(item.idempotencyKey).toBe('wh-evt-1-7-task.created-deadbeef')
  })
})

describe('useOutgoingWebhookDeliveryDetail / Attempts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detail is disabled when id is null and does not call API', () => {
    vi.mocked(outgoingWebhookDeliveriesApi.detail).mockResolvedValue({ data: createDelivery() })
    const { result } = renderHook(() => useOutgoingWebhookDeliveryDetail(null), {
      wrapper: createWrapper(),
    })
    expect(result.current.fetchStatus).toBe('idle')
    expect(outgoingWebhookDeliveriesApi.detail).not.toHaveBeenCalled()
  })

  it('detail fetches when a numeric id is provided', async () => {
    vi.mocked(outgoingWebhookDeliveriesApi.detail).mockResolvedValue({ data: createDelivery() })
    const { result } = renderHook(() => useOutgoingWebhookDeliveryDetail(1), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(outgoingWebhookDeliveriesApi.detail).toHaveBeenCalledWith(1)
  })

  it('attempts is disabled when id is null', () => {
    vi.mocked(outgoingWebhookDeliveriesApi.attempts).mockResolvedValue({ data: [] })
    const { result } = renderHook(() => useOutgoingWebhookDeliveryAttempts(null), {
      wrapper: createWrapper(),
    })
    expect(result.current.fetchStatus).toBe('idle')
    expect(outgoingWebhookDeliveriesApi.attempts).not.toHaveBeenCalled()
  })

  it('attempts fetches when a numeric id is provided', async () => {
    vi.mocked(outgoingWebhookDeliveriesApi.attempts).mockResolvedValue({
      data: [
        {
          id: 11,
          deliveryEventId: 1,
          attemptNumber: 1,
          status: 'failed',
          scheduledAt: '2026-07-23T00:00:00.000Z',
          startedAt: '2026-07-23T00:00:00.000Z',
          completedAt: '2026-07-23T00:00:01.000Z',
          responseStatus: 503,
          failureCategory: 'server_error',
          responseBodyHash: 'sha256:abc',
          responseExcerpt: 'Service Unavailable',
          retryReason: null,
        },
      ],
    })
    const { result } = renderHook(() => useOutgoingWebhookDeliveryAttempts(1), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(outgoingWebhookDeliveriesApi.attempts).toHaveBeenCalledWith(1)
    expect(result.current.data?.data[0]!.responseStatus).toBe(503)
  })
})

describe('delivery write hooks invalidate cache and call API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('manual retry calls API and invalidates list/detail/attempts', async () => {
    const retryResult: OutgoingWebhookManualRetryResultDto = {
      deliveryEventId: 1,
      newAttemptNumber: 4,
      scheduledAt: '2026-07-23T00:05:00.000Z',
      status: 'pending',
    }
    vi.mocked(outgoingWebhookDeliveriesApi.retry).mockResolvedValue({ data: retryResult })

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // 预置缓存以验证失效
    qc.setQueryData(outgoingWebhookDeliveryKeys.list(), {
      data: [createDelivery()],
      meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
    })
    qc.setQueryData(outgoingWebhookDeliveryKeys.detail(1), { data: createDelivery() })
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

    const { result } = renderHook(() => useManualRetryOutgoingWebhookDelivery(), {
      wrapper: createWrapper(qc),
    })
    const res = await result.current.mutateAsync({ id: 1, reason: 'operator retry' })
    expect(outgoingWebhookDeliveriesApi.retry).toHaveBeenCalledWith(1, 'operator retry')
    expect((res as { data: OutgoingWebhookManualRetryResultDto }).data.newAttemptNumber).toBe(4)
    // 失效覆盖 all（含 list）+ detail + attempts
    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey)
    expect(invalidatedKeys.some((k) => k?.[0] === 'outgoing-webhook-deliveries')).toBe(true)
    expect(invalidatedKeys.some((k) => k?.[1] === 'detail')).toBe(true)
    expect(invalidatedKeys.some((k) => k?.[1] === 'attempts')).toBe(true)
  })

  it('pause calls pause API and invalidates cache', async () => {
    vi.mocked(outgoingWebhookDeliveriesApi.pause).mockResolvedValue({
      data: createDelivery({ status: 'paused', paused: true }),
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => usePauseOutgoingWebhookDelivery(), {
      wrapper: createWrapper(qc),
    })
    await result.current.mutateAsync(1)
    expect(outgoingWebhookDeliveriesApi.pause).toHaveBeenCalledWith(1)
    expect(invalidateSpy).toHaveBeenCalled()
  })

  it('unpause calls unpause API and invalidates cache', async () => {
    vi.mocked(outgoingWebhookDeliveriesApi.unpause).mockResolvedValue({
      data: createDelivery({ status: 'pending', paused: false }),
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUnpauseOutgoingWebhookDelivery(), {
      wrapper: createWrapper(qc),
    })
    await result.current.mutateAsync(1)
    expect(outgoingWebhookDeliveriesApi.unpause).toHaveBeenCalledWith(1)
    expect(invalidateSpy).toHaveBeenCalled()
  })
})
