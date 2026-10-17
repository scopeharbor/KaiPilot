'use client'

import { useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/Toast'
import { useAuthStore } from '@/stores/auth-store'
import {
  notificationsApi,
  notificationKeys,
  type NotificationListFilters,
  type NotificationBatchRequest,
  type NotificationBatchAction,
} from '@/lib/api/notifications'

/**
 * 通知列表查询。
 */
export function useNotifications(filters: NotificationListFilters = { status: 'all' }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  return useQuery({
    queryKey: notificationKeys.list(filters),
    queryFn: () => notificationsApi.list(filters),
    staleTime: 30_000,
    enabled: isAuthenticated,
  })
}

/**
 * 未读通知计数查询。
 */
export function useUnreadNotificationCount() {
  const client = useQueryClient()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  const query = useQuery({
    queryKey: notificationKeys.unread(),
    queryFn: () => notificationsApi.unreadCount(),
    staleTime: 10_000,
    enabled: isAuthenticated,
  })

  // 页面可见性变化时回刷未读数
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') {
        void client.invalidateQueries({ queryKey: notificationKeys.unread() })
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [client])

  return query
}

// ---------- mutations ----------

/** 通用失效工具：清除所有通知列表及未读数缓存 */
function invalidateAll(client: ReturnType<typeof useQueryClient>) {
  void client.invalidateQueries({ queryKey: notificationKeys.lists() })
  void client.invalidateQueries({ queryKey: notificationKeys.unread() })
}

/**
 * 单条标记已读。
 */
export function useMarkNotificationRead(onUnauthorized?: () => void) {
  const client = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (notificationId: number) => notificationsApi.markRead(notificationId),
    onSuccess: () => {
      invalidateAll(client)
    },
    onError: (error) => {
      const apiError = error as { code?: string }
      if (apiError.code === 'RESOURCE_NOT_FOUND' || apiError.code === 'PERMISSION_DENIED') {
        onUnauthorized?.()
        invalidateAll(client)
      } else {
        toast({
          variant: 'error',
          title: '标记已读失败',
          description: '服务器暂时不可用，请稍后重试',
        })
      }
    },
  })
}

/**
 * 全部标记已读。
 */
export function useMarkAllNotificationsRead() {
  const client = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      invalidateAll(client)
      toast({ variant: 'success', title: '全部通知已读' })
    },
    onError: () => {
      toast({
        variant: 'error',
        title: '请求失败',
        description: '服务器暂时不可用，请稍后重试',
      })
    },
  })
}

/** 批量操作通知（V2 通知中心）。 */
export function useBatchNotifications() {
  const client = useQueryClient()
  const { toast } = useToast()

  const actionLabels: Record<NotificationBatchAction, string> = {
    mark_read: '标记已读',
    mark_unread: '标记未读',
    hide: '隐藏',
  }

  return useMutation({
    mutationFn: (request: NotificationBatchRequest) => notificationsApi.batch(request),
    onSuccess: (data, variables) => {
      invalidateAll(client)
      const label = actionLabels[variables.action] ?? '操作'
      toast({
        variant: 'success',
        title: `批量${label}成功`,
        description: `共处理 ${data.affectedCount} 条通知`,
      })
    },
    onError: (_error, variables) => {
      const label = actionLabels[variables.action] ?? '操作'
      toast({
        variant: 'error',
        title: `批量${label}失败`,
        description: '服务器暂时不可用，请稍后重试',
      })
    },
  })
}

/**
 * 通知点击导航。
 */
export function useNotificationClick() {
  const client = useQueryClient()
  const { toast } = useToast()

  const handleClick = useCallback(
    async (notification: { id: number; actionUrl: string | null }) => {
      if (!notification.actionUrl) return

      try {
        window.location.href = notification.actionUrl
      } catch {
        toast({
          variant: 'warning',
          title: '页面无法访问',
          description: '该通知目标页面不可用，已自动标记已读',
        })
        try {
          await notificationsApi.markRead(notification.id)
          invalidateAll(client)
        } catch {
          // ignore
        }
      }
    },
    [client, toast],
  )

  return handleClick
}
