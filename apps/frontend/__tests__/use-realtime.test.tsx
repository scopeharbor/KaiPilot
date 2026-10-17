/**
 * v2-realtime-websocket-minimum —— useRealtime hook 测试（P0 6.5）。
 *
 * 覆盖：
 * - hook 渲染不抛异常
 * - 未连接时不影响组件渲染（降级）
 * - 正确的 context 集成
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RealtimeProvider } from '@/providers/realtime-provider'
import { useRealtime, useRealtimeStatus } from '@/hooks/use-realtime'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'
import { resetRealtimeClient } from '@/lib/realtime/client'
import type { ReactNode } from 'react'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider>{children}</RealtimeProvider>
      </QueryClientProvider>
    )
  }
}

describe('hooks/use-realtime', () => {
  beforeEach(() => {
    useAuthStore.getState().setSession({
      user: { id: 1, email: 'a@b.com', fullName: '甲', organizations: [] },
      accessToken: accessTokenWith(['task:view']),
      refreshToken: 'refresh-1',
    })
  })

  afterEach(() => {
    resetRealtimeClient()
  })

  test('useRealtime 渲染不抛异常（undefined projectId）', () => {
    const { result } = renderHook(() => useRealtime(undefined), {
      wrapper: createWrapper(),
    })
    expect(result.current).toBeUndefined()
  })

  test('useRealtime 渲染不抛异常（有 projectId）', () => {
    const { result } = renderHook(() => useRealtime(1), {
      wrapper: createWrapper(),
    })
    expect(result.current).toBeUndefined()
  })

  test('useRealtime 在 projectId 变化时不抛异常', () => {
    const { rerender } = renderHook(({ pid }: { pid?: number }) => useRealtime(pid), {
      initialProps: { pid: 1 } as { pid?: number },
      wrapper: createWrapper(),
    })
    rerender({ pid: 2 })
    rerender({ pid: undefined })
  })

  test('useRealtimeStatus 返回 disconnected 初始状态', () => {
    const { result } = renderHook(() => useRealtimeStatus(), {
      wrapper: createWrapper(),
    })
    expect(result.current.connected).toBe(false)
    expect(result.current.status).toBeDefined()
  })

  test('WebSocket 不可用时，useRealtime 不阻塞渲染', () => {
    // 即使没有 WS 连接，组件也应正常渲染
    const { result } = renderHook(() => useRealtime(1), {
      wrapper: createWrapper(),
    })
    expect(result.current).toBeUndefined()
  })
})
