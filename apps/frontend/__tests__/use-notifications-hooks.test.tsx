/**
 * 通知 hooks：查询启用条件、可见性回刷、各 mutation 的缓存失效与提示，以及点击导航。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { toast, api } = vi.hoisted(() => ({
  toast: vi.fn(),
  api: {
    list: vi.fn(),
    unreadCount: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    batch: vi.fn(),
  },
}))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast, dismiss: vi.fn() }),
}))

vi.mock('@/lib/api/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/notifications')>()
  return { ...actual, notificationsApi: api }
})

import {
  useBatchNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationClick,
  useNotifications,
  useUnreadNotificationCount,
} from '@/hooks/use-notifications'
import { notificationKeys } from '@/lib/api/notifications'
import { useAuthStore } from '@/stores/auth-store'

let client: QueryClient

function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('use-notifications', () => {
  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    toast.mockReset()
    for (const fn of Object.values(api)) fn.mockReset()
    useAuthStore.setState({ isAuthenticated: true })
  })

  afterEach(() => {
    client.clear()
  })

  it('已登录时拉取列表与未读数；未登录时不请求', async () => {
    api.list.mockResolvedValue({ data: [], meta: { total: 0 } })
    api.unreadCount.mockResolvedValue({ unreadCount: 3 })

    const list = renderHook(() => useNotifications(), { wrapper })
    const unread = renderHook(() => useUnreadNotificationCount(), { wrapper })
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(unread.result.current.data).toEqual({ unreadCount: 3 }))
    expect(api.list).toHaveBeenCalledWith({ status: 'all' })

    useAuthStore.setState({ isAuthenticated: false })
    api.list.mockClear()
    renderHook(() => useNotifications({ status: 'unread' }), { wrapper })
    expect(api.list).not.toHaveBeenCalled()
  })

  it('页面重新可见时回刷未读数，卸载后移除监听', async () => {
    api.unreadCount.mockResolvedValue({ unreadCount: 1 })
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { unmount } = renderHook(() => useUnreadNotificationCount(), { wrapper })

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(spy).toHaveBeenCalledWith({ queryKey: notificationKeys.unread() })

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    spy.mockClear()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(spy).not.toHaveBeenCalled()

    unmount()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(spy).not.toHaveBeenCalled()
  })

  it('单条标记已读：成功失效缓存；资源不存在回调 onUnauthorized；其他错误提示', async () => {
    const spy = vi.spyOn(client, 'invalidateQueries')
    const onUnauthorized = vi.fn()
    const { result } = renderHook(() => useMarkNotificationRead(onUnauthorized), { wrapper })

    api.markRead.mockResolvedValueOnce({})
    await act(() => result.current.mutateAsync(1))
    expect(spy).toHaveBeenCalledWith({ queryKey: notificationKeys.lists() })

    api.markRead.mockRejectedValueOnce({ code: 'RESOURCE_NOT_FOUND' })
    await act(() => result.current.mutateAsync(2).catch(() => undefined))
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(toast).not.toHaveBeenCalled()

    api.markRead.mockRejectedValueOnce({ code: 'INTERNAL_ERROR' })
    await act(() => result.current.mutateAsync(3).catch(() => undefined))
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '标记已读失败' }))
  })

  it('全部标记已读：成功与失败分别提示', async () => {
    const { result } = renderHook(() => useMarkAllNotificationsRead(), { wrapper })

    api.markAllRead.mockResolvedValueOnce({})
    await act(() => result.current.mutateAsync())
    expect(toast).toHaveBeenLastCalledWith({ variant: 'success', title: '全部通知已读' })

    api.markAllRead.mockRejectedValueOnce(new Error('down'))
    await act(() => result.current.mutateAsync().catch(() => undefined))
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: '请求失败' }))
  })

  it('批量操作：按动作名提示处理条数与失败', async () => {
    const { result } = renderHook(() => useBatchNotifications(), { wrapper })

    api.batch.mockResolvedValueOnce({ affectedCount: 4 })
    await act(() => result.current.mutateAsync({ action: 'hide', ids: [1, 2] } as never))
    expect(toast).toHaveBeenLastCalledWith({
      variant: 'success',
      title: '批量隐藏成功',
      description: '共处理 4 条通知',
    })

    api.batch.mockRejectedValueOnce(new Error('down'))
    await act(() =>
      result.current
        .mutateAsync({ action: 'mark_unread', ids: [1] } as never)
        .catch(() => undefined),
    )
    expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: '批量标记未读失败' }))
  })

  it('点击通知：无目标地址不动作；跳转失败时提示并标记已读', async () => {
    const { result } = renderHook(() => useNotificationClick(), { wrapper })
    await act(() => result.current({ id: 1, actionUrl: null }))
    expect(api.markRead).not.toHaveBeenCalled()

    const original = window.location
    const hrefSetter = vi.fn(() => {
      throw new Error('blocked')
    })
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: Object.defineProperty({}, 'href', { set: hrefSetter, configurable: true }),
    })
    try {
      api.markRead.mockResolvedValueOnce({})
      await act(() => result.current({ id: 7, actionUrl: '/next/projects/1' }))
      expect(hrefSetter).toHaveBeenCalledWith('/next/projects/1')
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: '页面无法访问' }))
      expect(api.markRead).toHaveBeenCalledWith(7)

      // 标记已读也失败时静默
      api.markRead.mockRejectedValueOnce(new Error('down'))
      await act(() => result.current({ id: 8, actionUrl: '/next/projects/2' }))
      expect(api.markRead).toHaveBeenCalledWith(8)
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })
})
