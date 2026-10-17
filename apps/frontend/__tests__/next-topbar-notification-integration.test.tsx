import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NextTopbar } from '@/components/next/layout/NextTopbar'
import { useNextTrackStore } from '@/stores/next-track-store'
import { useNotificationDrawerStore } from '@/components/next/notifications/use-notification-drawer'

const { navMocks, routerPush } = vi.hoisted(() => ({
  navMocks: { pathname: '/next' },
  routerPush: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => navMocks.pathname,
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function renderTopbar(props: React.ComponentProps<typeof NextTopbar> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <NextTopbar {...props} />
    </QueryClientProvider>,
  )
}

describe('NextTopbarNotificationIntegration (W2 · tasks 2.5/2.6)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    routerPush.mockClear()
    navMocks.pathname = '/next'
    localStorage.clear()
    useNextTrackStore.getState().reset()
    useNotificationDrawerStore.setState({ isOpen: false, activeTab: 'all' })
    document.documentElement.removeAttribute('data-immersion')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/notifications/unread-count')) {
          return Promise.resolve(jsonResponse(200, { unreadCount: 2 }))
        }
        return Promise.resolve(
          jsonResponse(200, {
            data: [
              {
                id: 1,
                organizationId: 1,
                recipientId: 1,
                type: 'task_assigned',
                title: '集成测试通知',
                body: '通知内容摘要',
                severity: 'warning',
                projectId: 10,
                target: { type: 'task', id: 100 },
                actionUrl: null,
                readAt: null,
                hiddenAt: null,
                metadata: null,
                createdAt: new Date().toISOString(),
              },
            ],
            meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
          }),
        )
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.documentElement.removeAttribute('data-immersion')
  })

  test('测试顶栏完整装配渲染：触发器置于沉浸档与空间地图之间', async () => {
    renderTopbar()

    const trigger = screen.getByRole('button', { name: /通知中心/ })
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute('data-next-notification-trigger')

    const spaceMapBtn = screen.getByRole('button', { name: /空间地图/ })
    expect(spaceMapBtn).toBeInTheDocument()

    // 验证相对排列顺序：trigger 先于 spaceMapBtn
    expect(
      trigger.compareDocumentPosition(spaceMapBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    // 未读徽标显示 2
    await waitFor(() => {
      const badge = document.querySelector('[data-next-notification-badge]')
      expect(badge?.textContent).toBe('2')
    })
  })

  test('测试通知触发器无障碍标签与受控展开抽屉', async () => {
    renderTopbar()

    await waitFor(() => {
      const trigger = screen.getByRole('button', { name: /通知中心 \(2 条未读\)/ })
      expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
    })

    const trigger = screen.getByRole('button', { name: /通知中心 \(2 条未读\)/ })

    // 点击唤起抽屉
    fireEvent.click(trigger)

    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
      expect(document.querySelector('[data-notification-drawer]')).toBeInTheDocument()
      expect(screen.getByText('集成测试通知')).toBeInTheDocument()
    })
  })

  test('测试精确档（data-immersion="precise"）纯平降级呈现', async () => {
    // 激活精确档
    useNextTrackStore.getState().setImmersionTier('precise')
    document.documentElement.setAttribute('data-immersion', 'precise')

    renderTopbar()

    const trigger = screen.getByRole('button', { name: /通知中心/ })
    fireEvent.click(trigger)

    await waitFor(() => {
      const drawer = document.querySelector('[data-notification-drawer]') as HTMLElement
      expect(drawer).toBeInTheDocument()
      expect(drawer.getAttribute('data-immersion')).toBe('precise')
      expect(drawer.className).toContain('shadow-none')
      expect(drawer.className).toContain('transition-none')

      const overlay = document.querySelector('[data-notification-drawer-overlay]') as HTMLElement
      expect(overlay).toBeInTheDocument()
      expect(overlay.className).toContain('backdrop-blur-none')
    })
  })
})
