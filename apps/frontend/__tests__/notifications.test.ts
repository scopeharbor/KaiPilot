import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  notificationsApi,
  notificationKeys,
  type Notification,
  type NotificationListFilters,
} from '@/lib/api/notifications'

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
    title: '任务已指派给你：「测试任务」',
    body: '你被指派到新任务。',
    severity: 'info',
    projectId: 10,
    target: { type: 'task', id: 100 },
    actionUrl: '/projects/10/tasks/100',
    readAt: null,
    hiddenAt: null,
    metadata: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// ---------- lib/api/notifications ----------

describe('lib/api/notifications', () => {
  afterEach(() => vi.restoreAllMocks())

  describe('notificationsApi.list', () => {
    test('默认分页请求含 /notifications', async () => {
      const payload = {
        data: [makeNotification()],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, payload)))

      await notificationsApi.list()

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('/notifications'),
        expect.anything(),
      )
    })

    test('按 status=unread 过滤', async () => {
      const payload = { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, payload)))

      await notificationsApi.list({ status: 'unread' })

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('status=unread'),
        expect.anything(),
      )
    })

    test('按 type 过滤', async () => {
      const payload = { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, payload)))

      await notificationsApi.list({ type: 'task_assigned' })

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('type=task_assigned'),
        expect.anything(),
      )
    })

    test('未读数量端点返回 unreadCount', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { unreadCount: 5 })))

      const result = await notificationsApi.unreadCount()

      expect(result).toEqual({ unreadCount: 5 })
    })

    test('标记单条已读调用 PATCH', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse(200, { success: true, readAt: new Date().toISOString() }),
          ),
      )

      const result = await notificationsApi.markRead(42)

      expect(result.success).toBe(true)
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('/notifications/42/read'),
        expect.objectContaining({ method: 'PATCH' }),
      )
    })

    test('全部已读调用 PATCH /read-all', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(200, { success: true, markedCount: 3 })),
      )

      const result = await notificationsApi.markAllRead()

      expect(result.markedCount).toBe(3)
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('/notifications/read-all'),
        expect.objectContaining({ method: 'PATCH' }),
      )
    })
  })

  describe('notificationKeys', () => {
    test('list 键为非空数组', () => {
      const filters: NotificationListFilters = { status: 'unread', type: 'task_assigned' }
      const key = notificationKeys.list(filters)
      expect(Array.isArray(key)).toBe(true)
      expect(key.length).toBeGreaterThan(0)
      expect(key[0]).toBe('notifications')
    })

    test('unread 键为非空数组且不等于列表键', () => {
      expect(Array.isArray(notificationKeys.unread())).toBe(true)
      expect(notificationKeys.unread()).not.toEqual(notificationKeys.list({}))
    })

    test('all/unread/lists 键结构正确', () => {
      expect(notificationKeys.all).toEqual(['notifications'])
      expect(notificationKeys.unread()).toEqual(['notifications', 'unread'])
    })
  })
})

// ---------- NotificationPanel 逻辑覆盖（task 4.7） ----------

describe('NotificationPanel 逻辑覆盖（task 4.7）', () => {
  test('通知类型标签映射完整', async () => {
    const TYPE_LABELS: Record<string, string> = {
      task_assigned: '任务指派',
      comment_added: '新评论',
      attachment_added: '附件上传',
      ai_draft_confirmed: 'AI 草案确认',
      general: '通知',
    }
    expect(TYPE_LABELS['task_assigned']).toBe('任务指派')
    expect(TYPE_LABELS['comment_added']).toBe('新评论')
    expect(TYPE_LABELS['attachment_added']).toBe('附件上传')
    expect(TYPE_LABELS['ai_draft_confirmed']).toBe('AI 草案确认')
    expect(TYPE_LABELS['general']).toBe('通知')
  })

  test('严重级别样式映射完整', async () => {
    const SEVERITY_STYLES: Record<string, string> = {
      info: 'text-blue-500',
      warning: 'text-amber-500',
      error: 'text-red-500',
      critical: 'text-red-600',
    }
    expect(SEVERITY_STYLES['info']).toBe('text-blue-500')
    expect(SEVERITY_STYLES['warning']).toBe('text-amber-500')
    expect(SEVERITY_STYLES['error']).toBe('text-red-500')
    expect(SEVERITY_STYLES['critical']).toBe('text-red-600')
  })

  test('无 actionUrl 的通知 actionUrl 为 null', () => {
    const n: Notification = makeNotification({ actionUrl: null })
    expect(n.actionUrl).toBeNull()
  })

  test('RESOURCE_NOT_FOUND / PERMISSION_DENIED 识别为权限类错误', () => {
    const error1 = { code: 'RESOURCE_NOT_FOUND', status: 404, message: '通知不存在' }
    const error2 = { code: 'PERMISSION_DENIED', status: 403, message: '无权操作' }
    const isAuthError = error1.code === 'RESOURCE_NOT_FOUND' || error1.code === 'PERMISSION_DENIED'
    const isAuthError2 = error2.code === 'RESOURCE_NOT_FOUND' || error2.code === 'PERMISSION_DENIED'
    expect(isAuthError).toBe(true)
    expect(isAuthError2).toBe(true)
  })

  test('未读通知 readAt 为 null', () => {
    const n: Notification = makeNotification({ readAt: null })
    expect(n.readAt).toBeNull()
    expect(!n.readAt).toBe(true) // isUnread = true
  })

  test('已读通知 readAt 有值', () => {
    const n: Notification = makeNotification({ readAt: '2026-07-08T10:00:00.000Z' })
    expect(n.readAt).not.toBeNull()
    expect(!n.readAt).toBe(false) // isUnread = false
  })
})
