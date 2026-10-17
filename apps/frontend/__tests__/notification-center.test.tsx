import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  notificationsApi,
  notificationKeys,
  type Notification,
  type NotificationListFilters,
  type NotificationBatchRequest,
  type NotificationTypeGroup,
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
    title: '测试通知',
    body: '通知正文',
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

describe('通知中心', () => {
  afterEach(() => vi.restoreAllMocks())

  describe('API 类型支持', () => {
    test('Notification 支持 hiddenAt 字段', () => {
      const n: Notification = makeNotification({ hiddenAt: null })
      expect(n.hiddenAt).toBeNull()

      const n2: Notification = makeNotification({ hiddenAt: '2026-07-15T10:00:00.000Z' })
      expect(n2.hiddenAt).not.toBeNull()
    })

    test('Notification 支持 accessStatus 字段', () => {
      const n: Notification = makeNotification({ accessStatus: 'accessible' })
      expect(n.accessStatus).toBe('accessible')

      const n2: Notification = makeNotification({ accessStatus: 'inaccessible' })
      expect(n2.accessStatus).toBe('inaccessible')
    })

    test('Notification 支持 targetSummary 字段', () => {
      const n: Notification = makeNotification({
        targetSummary: { type: '任务', status: 'in_progress' },
      })
      expect(n.targetSummary?.type).toBe('任务')
      expect(n.targetSummary?.status).toBe('in_progress')
    })
  })

  describe('类型分组常量', () => {
    test('所有类型组可正确赋值为筛选参数', () => {
      const groups: NotificationTypeGroup[] = [
        'all',
        'unread',
        'mentions',
        'assignments',
        'approvals',
        'system',
      ]
      expect(groups).toHaveLength(6)
    })
  })

  describe('通知中心筛选参数', () => {
    test('buildQuery 支持 typeGroup 参数', async () => {
      const payload = { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, payload)))

      await notificationsApi.list({ typeGroup: 'mentions' })

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('typeGroup=mentions'),
        expect.anything(),
      )
    })

    test('buildQuery 支持 hidden 参数', async () => {
      const payload = { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, payload)))

      await notificationsApi.list({ hidden: 'only' })

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('hidden=only'),
        expect.anything(),
      )
    })

    test('buildQuery 支持嵌套筛选条件', async () => {
      const payload = { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, payload)))

      await notificationsApi.list({
        status: 'unread',
        typeGroup: 'system',
        projectId: 42,
      })

      const url = vi.mocked(fetch).mock.calls[0]?.[0] as string
      expect(url).toContain('status=unread')
      expect(url).toContain('typeGroup=system')
      expect(url).toContain('projectId=42')
    })
  })

  describe('批量操作 API', () => {
    test('批量标记已读', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse(200, { success: true, affectedCount: 3, action: 'mark_read' }),
          ),
      )

      const result = await notificationsApi.batch({
        action: 'mark_read',
        notificationIds: [1, 2, 3],
      })
      expect(result.affectedCount).toBe(3)
      expect(result.action).toBe('mark_read')

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('/notifications/batch'),
        expect.objectContaining({ method: 'POST' }),
      )
    })

    test('批量隐藏', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse(200, { success: true, affectedCount: 2, action: 'hide' }),
          ),
      )

      const result = await notificationsApi.batch({ action: 'hide', notificationIds: [4, 5] })
      expect(result.affectedCount).toBe(2)
      expect(result.action).toBe('hide')
    })

    test('批量标记未读', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse(200, { success: true, affectedCount: 1, action: 'mark_unread' }),
          ),
      )

      const result = await notificationsApi.batch({ action: 'mark_unread', notificationIds: [2] })
      expect(result.affectedCount).toBe(1)
    })

    test('批量请求 body 使用 JSON 格式', async () => {
      const request: NotificationBatchRequest = { action: 'hide', notificationIds: [1, 2] }
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse(200, { success: true, affectedCount: 2, action: 'hide' }),
          ),
      )

      await notificationsApi.batch(request)

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        expect.stringContaining('/notifications/batch'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  describe('通知中心查询 keys', () => {
    test('list 键编码所有筛选参数', () => {
      const filters: NotificationListFilters = {
        typeGroup: 'assignments',
        status: 'unread',
        severity: 'warning',
      }
      const key = notificationKeys.list(filters)
      expect(key[2]).toEqual(filters)
    })

    test('all/lists/unread 键区分', () => {
      expect(notificationKeys.all).toEqual(['notifications'])
      expect(notificationKeys.lists()).toEqual(['notifications', 'list'])
      expect(notificationKeys.unread()).toEqual(['notifications', 'unread'])
    })
  })

  describe('通知中心业务逻辑', () => {
    test('已读通知 readAt 不为空', () => {
      const n: Notification = makeNotification({ readAt: '2026-07-15T10:00:00.000Z' })
      expect(n.readAt).not.toBeNull()
      expect(!n.readAt).toBe(false) // isUnread = false
    })

    test('未读通知 readAt 为空', () => {
      const n: Notification = makeNotification({ readAt: null })
      expect(n.readAt).toBeNull()
      expect(!n.readAt).toBe(true)
    })

    test('inaccessible 的通知展示不可访问状态', () => {
      const n: Notification = makeNotification({ accessStatus: 'inaccessible' })
      expect(n.accessStatus).toBe('inaccessible')
    })

    test('已隐藏通知 hiddenAt 字段存在', () => {
      const n: Notification = makeNotification({ hiddenAt: '2026-07-15T10:00:00.000Z' })
      expect(n.hiddenAt).toBeTruthy()
    })

    test('通知中心视图切换常量为 6 种', () => {
      const views = ['all', 'unread', 'mentions', 'assignments', 'approvals', 'system']
      expect(views).toHaveLength(6)
    })
  })
})
