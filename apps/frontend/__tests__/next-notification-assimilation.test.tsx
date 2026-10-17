import * as React from 'react'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import NotificationsAssimilationPage from '@/app/(next)/next/notifications/page'
import { useNotificationDrawerStore } from '@/components/next/notifications/use-notification-drawer'

const { routerReplace, currentSearchParams } = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  currentSearchParams: { value: new URLSearchParams() },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: routerReplace, back: vi.fn() }),
  usePathname: () => '/next/notifications',
  useParams: () => ({}),
  useSearchParams: () => currentSearchParams.value,
}))

describe('NotificationsAssimilationPage (/next/notifications)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    routerReplace.mockClear()
    currentSearchParams.value = new URLSearchParams()
    useNotificationDrawerStore.setState({ isOpen: false, activeTab: 'all' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('测试默认访问平滑重定向至 /next 并展开通知抽屉', async () => {
    render(<NotificationsAssimilationPage />)

    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith('/next')
      expect(useNotificationDrawerStore.getState().isOpen).toBe(true)
      expect(useNotificationDrawerStore.getState().activeTab).toBe('all')
    })
  })

  test('测试携带 filter=mentions 参数时激活提及分类并展开抽屉', async () => {
    currentSearchParams.value = new URLSearchParams('filter=mentions')

    render(<NotificationsAssimilationPage />)

    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith('/next')
      expect(useNotificationDrawerStore.getState().isOpen).toBe(true)
      expect(useNotificationDrawerStore.getState().activeTab).toBe('mentions')
    })
  })

  test('测试携带 tab=unread 参数时激活未读分类并展开抽屉', async () => {
    currentSearchParams.value = new URLSearchParams('tab=unread')

    render(<NotificationsAssimilationPage />)

    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith('/next')
      expect(useNotificationDrawerStore.getState().isOpen).toBe(true)
      expect(useNotificationDrawerStore.getState().activeTab).toBe('unread')
    })
  })
})
