import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { RealtimeEventTypes } from '@/lib/realtime/client'
import { useRealtime } from '@/hooks/use-realtime'

const realtimeMock = vi.hoisted(() => {
  const state: {
    handler: ((event: unknown) => void) | null
    invalidateResourceQueries: ReturnType<typeof vi.fn>
    client: {
      joinProject: ReturnType<typeof vi.fn>
      leaveProject: ReturnType<typeof vi.fn>
      on: ReturnType<typeof vi.fn>
    }
  } = {
    handler: null,
    invalidateResourceQueries: vi.fn().mockResolvedValue(undefined),
    client: {
      joinProject: vi.fn().mockResolvedValue(true),
      leaveProject: vi.fn(),
      on: vi.fn((_event: string, handler: (event: unknown) => void) => {
        state.handler = handler
        return vi.fn()
      }),
    },
  }
  return state
})

vi.mock('@/providers/realtime-provider', () => ({
  useRealtimeContext: () => ({
    client: realtimeMock.client,
    connected: true,
    status: 'connected',
  }),
}))

vi.mock('@/lib/resource-query-invalidation', () => ({
  invalidateResourceQueries: realtimeMock.invalidateResourceQueries,
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useRealtime resource invalidation', () => {
  beforeEach(() => {
    realtimeMock.handler = null
    realtimeMock.invalidateResourceQueries.mockClear()
    realtimeMock.client.joinProject.mockClear()
    realtimeMock.client.leaveProject.mockClear()
    realtimeMock.client.on.mockClear()
  })

  test('invalidates resource and cross-view queries for same-project resource events', async () => {
    renderHook(() => useRealtime(42), { wrapper: createWrapper() })

    await waitFor(() => expect(realtimeMock.client.on).toHaveBeenCalled())
    act(() => {
      realtimeMock.handler?.({
        type: RealtimeEventTypes.RESOURCE_INVALIDATED,
        projectId: 42,
        payload: { reason: 'resource_allocation_changed' },
      })
    })

    await waitFor(() =>
      expect(realtimeMock.invalidateResourceQueries).toHaveBeenCalledWith(
        expect.any(QueryClient),
        42,
      ),
    )
  })

  test('ignores resource events from other projects', async () => {
    renderHook(() => useRealtime(42), { wrapper: createWrapper() })

    await waitFor(() => expect(realtimeMock.client.on).toHaveBeenCalled())
    act(() => {
      realtimeMock.handler?.({
        type: RealtimeEventTypes.RESOURCE_INVALIDATED,
        projectId: 41,
        payload: { reason: 'other_project' },
      })
    })

    expect(realtimeMock.invalidateResourceQueries).not.toHaveBeenCalled()
  })
})
