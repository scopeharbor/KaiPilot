import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NextTopbarNotificationTrigger } from '@/components/next/layout/NextTopbarNotificationTrigger'
import { useNotificationDrawerStore } from '@/components/next/notifications/use-notification-drawer'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function renderTrigger(props: React.ComponentProps<typeof NextTopbarNotificationTrigger> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <NextTopbarNotificationTrigger {...props} />
    </QueryClientProvider>,
  )
}

describe('NextTopbarNotificationTrigger (W2 · tasks 2.1/2.2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useNotificationDrawerStore.setState({ isOpen: false, activeTab: 'all' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('测试未读数为 0 时徽标隐藏', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { unreadCount: 0 })))

    renderTrigger()

    await waitFor(() => {
      const trigger = screen.getByRole('button', { name: /通知/ })
      expect(trigger).toBeInTheDocument()
    })

    const badge = document.querySelector('[data-next-notification-badge]')
    expect(badge).toBeNull()
  })

  test('测试未读数 > 0 时正确呈现数量', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { unreadCount: 5 })))

    renderTrigger()

    await waitFor(() => {
      const badge = document.querySelector('[data-next-notification-badge]')
      expect(badge).not.toBeNull()
      expect(badge?.textContent).toBe('5')
    })

    const trigger = screen.getByRole('button', { name: /通知中心 \(5 条未读\)/ })
    expect(trigger).toBeInTheDocument()
  })

  test('测试未读数 > 99 时呈现 99+ 边界', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { unreadCount: 150 })))

    renderTrigger()

    await waitFor(() => {
      const badge = document.querySelector('[data-next-notification-badge]')
      expect(badge).not.toBeNull()
      expect(badge?.textContent).toBe('99+')
    })
  })

  test('测试点击触发抽屉回调与状态流转', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { unreadCount: 3 })))

    const onClickMock = vi.fn()
    renderTrigger({ onClick: onClickMock, open: false })

    const trigger = screen.getByRole('button', { name: /通知/ })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)
    expect(onClickMock).toHaveBeenCalledTimes(1)
  })

  test('测试缺省 onClick 时触发全局 store toggleDrawer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { unreadCount: 2 })))

    renderTrigger()

    const trigger = screen.getByRole('button', { name: /通知/ })
    expect(useNotificationDrawerStore.getState().isOpen).toBe(false)

    fireEvent.click(trigger)
    expect(useNotificationDrawerStore.getState().isOpen).toBe(true)

    fireEvent.click(trigger)
    expect(useNotificationDrawerStore.getState().isOpen).toBe(false)
  })
})
