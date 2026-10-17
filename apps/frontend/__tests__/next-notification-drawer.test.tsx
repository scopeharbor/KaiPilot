import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NotificationDrawer } from '@/components/next/notifications/NotificationDrawer'
import { useNotificationDrawerStore } from '@/components/next/notifications/use-notification-drawer'
import type { Notification } from '@/lib/api/notifications'

const { routerPush } = vi.hoisted(() => ({
  routerPush: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/next',
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

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 1,
    organizationId: 1,
    recipientId: 1,
    type: 'task_assigned',
    title: '指派任务：重构通知中心',
    body: '请按时完成重构并提交评审',
    severity: 'info',
    projectId: 42,
    target: { type: 'task', id: 101 },
    actionUrl: null,
    readAt: null,
    hiddenAt: null,
    metadata: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function renderDrawer(props: React.ComponentProps<typeof NotificationDrawer> = { open: true }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationDrawer {...props} />
    </QueryClientProvider>,
  )
}

describe('NotificationDrawer (W2 · tasks 2.3/2.4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    routerPush.mockClear()
    useNotificationDrawerStore.setState({ isOpen: false, activeTab: 'all' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('测试分类切换过滤：全部/指派/提及/系统', async () => {
    const mockList = [
      makeNotification({ id: 1, type: 'task_assigned', title: '任务已指派给你' }),
      makeNotification({ id: 2, type: 'comment_added', title: '新的评论提及你' }),
      makeNotification({ id: 3, type: 'project_archived', title: '项目已归档' }),
    ]

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/notifications/unread-count')) {
          return Promise.resolve(jsonResponse(200, { unreadCount: 3 }))
        }
        return Promise.resolve(
          jsonResponse(200, {
            data: mockList,
            meta: { total: 3, page: 1, perPage: 20, totalPages: 1 },
          }),
        )
      }),
    )

    renderDrawer({ open: true })

    await waitFor(() => {
      expect(screen.getByText('任务已指派给你')).toBeInTheDocument()
      expect(screen.getByText('新的评论提及你')).toBeInTheDocument()
      expect(screen.getByText('项目已归档')).toBeInTheDocument()
    })

    // 切换到「指派」
    const assignTab = screen.getByRole('tab', { name: '任务' })
    fireEvent.click(assignTab)

    await waitFor(() => {
      expect(screen.getByText('任务已指派给你')).toBeInTheDocument()
      expect(screen.queryByText('新的评论提及你')).not.toBeInTheDocument()
      expect(screen.queryByText('项目已归档')).not.toBeInTheDocument()
    })

    // 切换到「提及」
    const mentionTab = screen.getByRole('tab', { name: '提及' })
    fireEvent.click(mentionTab)

    await waitFor(() => {
      expect(screen.queryByText('任务已指派给你')).not.toBeInTheDocument()
      expect(screen.getByText('新的评论提及你')).toBeInTheDocument()
      expect(screen.queryByText('项目已归档')).not.toBeInTheDocument()
    })
  })

  test('测试单条点击调用 notificationsApi.markRead', async () => {
    const item = makeNotification({ id: 99, readAt: null, title: '未读测试通知', target: null })

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/notifications/unread-count')) {
        return Promise.resolve(jsonResponse(200, { unreadCount: 1 }))
      }
      if (url.includes('/notifications/99/read') && init?.method === 'PATCH') {
        return Promise.resolve(
          jsonResponse(200, { success: true, readAt: new Date().toISOString() }),
        )
      }
      return Promise.resolve(
        jsonResponse(200, {
          data: [item],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    renderDrawer({ open: true })

    await waitFor(() => {
      expect(screen.getByText('未读测试通知')).toBeInTheDocument()
    })

    const notificationEl = screen.getByText('未读测试通知').closest('[data-notification-item]')
    expect(notificationEl).not.toBeNull()
    fireEvent.click(notificationEl!)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/notifications/99/read'),
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
  })

  test('测试全部已读调用 notificationsApi.markAllRead', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/notifications/unread-count')) {
        return Promise.resolve(jsonResponse(200, { unreadCount: 5 }))
      }
      if (url.includes('/notifications/read-all') && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse(200, { success: true, markedCount: 5 }))
      }
      return Promise.resolve(
        jsonResponse(200, {
          data: [makeNotification({ id: 1, readAt: null })],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    renderDrawer({ open: true })

    await waitFor(() => {
      expect(screen.getByText('全部已读')).toBeInTheDocument()
    })

    const markAllBtn = screen.getByText('全部已读')
    fireEvent.click(markAllBtn)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/notifications/read-all'),
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
  })

  test('测试点击关联任务跳转并收起抽屉携带 focusTask 深链', async () => {
    const taskItem = makeNotification({
      id: 88,
      readAt: null,
      projectId: 15,
      target: { type: 'task', id: 202 },
      title: '点击直达任务',
    })

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/notifications/unread-count')) {
        return Promise.resolve(jsonResponse(200, { unreadCount: 1 }))
      }
      if (url.includes('/read')) {
        return Promise.resolve(
          jsonResponse(200, { success: true, readAt: new Date().toISOString() }),
        )
      }
      return Promise.resolve(
        jsonResponse(200, {
          data: [taskItem],
          meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
        }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const onOpenChangeMock = vi.fn()
    renderDrawer({ open: true, onOpenChange: onOpenChangeMock })

    await waitFor(() => {
      expect(screen.getByText('点击直达任务')).toBeInTheDocument()
    })

    const itemEl = screen.getByText('点击直达任务').closest('[data-notification-item]')
    fireEvent.click(itemEl!)

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith('/next/projects/15?focusTask=202')
      expect(onOpenChangeMock).toHaveBeenCalledWith(false)
    })
  })
})
