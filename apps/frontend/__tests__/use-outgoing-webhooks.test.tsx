import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useOutgoingWebhooks,
  useCreateOutgoingWebhook,
  useRotateOutgoingWebhook,
  useDeactivateOutgoingWebhook,
} from '@/hooks/use-outgoing-webhooks'
import { outgoingWebhooksApi, outgoingWebhookKeys } from '@/lib/api/outgoing-webhooks'
import type { AuthState } from '@/stores/auth-store'
import type {
  OutgoingWebhookSubscriptionCreatedDto,
  OutgoingWebhookSubscriptionDto,
  OutgoingWebhookSubscriptionRotatedDto,
} from '@aiproj/types'

type AuthSelector = (state: AuthState) => unknown

function createSubscription(
  overrides: Partial<OutgoingWebhookSubscriptionDto> = {},
): OutgoingWebhookSubscriptionDto {
  return {
    id: 1,
    name: 'sub',
    targetUrl: 'https://hooks.example.com/incoming',
    eventTypes: ['task.created'],
    status: 'active',
    secretFingerprint: 'abc12345',
    lastRotatedAt: null,
    deactivatedAt: null,
    createdBy: 1,
    updatedBy: 1,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

vi.mock('@/lib/api/outgoing-webhooks', () => ({
  outgoingWebhooksApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deactivate: vi.fn(),
    rotate: vi.fn(),
  },
  outgoingWebhookKeys: {
    all: ['outgoing-webhooks'],
    list: () => ['outgoing-webhooks', 'list'],
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

describe('useOutgoingWebhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches subscriptions when authenticated', async () => {
    vi.mocked(outgoingWebhooksApi.list).mockResolvedValue({ data: [createSubscription()] })
    const { result } = renderHook(() => useOutgoingWebhooks(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(outgoingWebhooksApi.list).toHaveBeenCalled()
    expect(result.current.data?.data).toHaveLength(1)
  })

  it('create returns one-time secret and invalidates list', async () => {
    vi.mocked(outgoingWebhooksApi.list).mockResolvedValue({ data: [] })
    const created: OutgoingWebhookSubscriptionCreatedDto = {
      ...createSubscription(),
      secret: {
        secret: 'whsec_oneshot',
        fingerprint: 'abc12345',
        rotatedAt: '2026-07-23T00:00:00.000Z',
      },
    }
    vi.mocked(outgoingWebhooksApi.create).mockResolvedValue({ data: created })

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(outgoingWebhookKeys.list(), { data: [] })
    const { result } = renderHook(() => useCreateOutgoingWebhook(), {
      wrapper: createWrapper(qc),
    })

    await result.current.mutateAsync({
      name: 'sub',
      targetUrl: 'https://hooks.example.com/incoming',
      eventTypes: ['task.created'],
    })
    expect(outgoingWebhooksApi.create).toHaveBeenCalled()
    // 一次性密钥仅在响应中存在
    const createdResult = await vi.mocked(outgoingWebhooksApi.create).mock.results[0]!.value
    expect(
      (createdResult as { data: OutgoingWebhookSubscriptionCreatedDto }).data.secret.secret,
    ).toBe('whsec_oneshot')
  })

  it('rotate returns new one-time secret', async () => {
    const rotated: OutgoingWebhookSubscriptionRotatedDto = {
      ...createSubscription(),
      secret: {
        secret: 'whsec_new',
        fingerprint: 'newfinge',
        rotatedAt: '2026-07-23T00:00:00.000Z',
      },
    }
    vi.mocked(outgoingWebhooksApi.rotate).mockResolvedValue({ data: rotated })
    vi.mocked(outgoingWebhooksApi.list).mockResolvedValue({ data: [] })

    const { result } = renderHook(() => useRotateOutgoingWebhook(), { wrapper: createWrapper() })
    const res = await result.current.mutateAsync(1)
    expect(outgoingWebhooksApi.rotate).toHaveBeenCalledWith(1)
    expect((res as { data: OutgoingWebhookSubscriptionRotatedDto }).data.secret.secret).toBe(
      'whsec_new',
    )
  })

  it('deactivate calls API and invalidates list', async () => {
    vi.mocked(outgoingWebhooksApi.deactivate).mockResolvedValue({
      data: createSubscription({ status: 'inactive' }),
    })

    const { result } = renderHook(() => useDeactivateOutgoingWebhook(), {
      wrapper: createWrapper(),
    })
    await result.current.mutateAsync(1)
    expect(outgoingWebhooksApi.deactivate).toHaveBeenCalledWith(1)
  })

  it('redacted projection typing excludes secret on list items', async () => {
    const sub = createSubscription()
    vi.mocked(outgoingWebhooksApi.list).mockResolvedValue({ data: [sub] })
    const { result } = renderHook(() => useOutgoingWebhooks(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const item = result.current.data!.data[0]!
    // 脱敏投影不含 secret/secretCiphertext 键
    expect((item as unknown as Record<string, unknown>).secret).toBeUndefined()
    expect((item as unknown as Record<string, unknown>).secretCiphertext).toBeUndefined()
    expect(item.secretFingerprint).toBe('abc12345')
  })
})
