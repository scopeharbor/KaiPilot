'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { notificationKeys } from '@/lib/api/notifications'
import { getRealtimeClient, RealtimeEventTypes } from '@/lib/realtime/client'
import type { RealtimeEventEnvelope } from '@/lib/realtime/client'

/**
 * useRealtimeNotifications — 实时通知事件监听（V2 通知中心）。
 *
 * 监听 notification:arrived / notification:read_status_changed / notification:batch_processed
 * 事件，收到后失效通知列表与未读数查询。
 *
 * REST/数据库仍是唯一事实来源，实时事件仅作为缓存失效信号。
 * 实时不可用时不影响页面功能（REST 轮询与手动刷新兜底）。
 */
export function useRealtimeNotifications(): void {
  const client = useQueryClient()
  const clientRef = useRef(client)
  clientRef.current = client

  useEffect(() => {
    const realtime = getRealtimeClient()

    // 通知到达：失效列表和未读数
    const unsubArrived = realtime.on(RealtimeEventTypes.NOTIFICATION_ARRIVED, () => {
      void clientRef.current.invalidateQueries({ queryKey: notificationKeys.lists() })
      void clientRef.current.invalidateQueries({ queryKey: notificationKeys.unread() })
    })

    // 读取状态变更：失效未读数（列表可能不需要立即刷新）
    const unsubReadStatus = realtime.on(RealtimeEventTypes.NOTIFICATION_READ_STATUS_CHANGED, () => {
      void clientRef.current.invalidateQueries({ queryKey: notificationKeys.unread() })
      void clientRef.current.invalidateQueries({ queryKey: notificationKeys.lists() })
    })

    // 批量处理：全量失效
    const unsubBatch = realtime.on(RealtimeEventTypes.NOTIFICATION_BATCH_PROCESSED, () => {
      void clientRef.current.invalidateQueries({ queryKey: notificationKeys.lists() })
      void clientRef.current.invalidateQueries({ queryKey: notificationKeys.unread() })
    })

    // 隐藏状态变更：全量失效
    const unsubHidden = realtime.on(RealtimeEventTypes.NOTIFICATION_HIDDEN_STATUS_CHANGED, () => {
      void clientRef.current.invalidateQueries({ queryKey: notificationKeys.lists() })
      void clientRef.current.invalidateQueries({ queryKey: notificationKeys.unread() })
    })

    return () => {
      unsubArrived()
      unsubReadStatus()
      unsubBatch()
      unsubHidden()
    }
  }, [])
}

/**
 * 解析通知实时事件负载（低敏）。
 */
export function parseNotificationEvent(event: RealtimeEventEnvelope): {
  type: string
  affectedCount?: number
  organizationId?: number
} {
  return {
    type: event.type,
    affectedCount: (event.metadata?.affectedCount as number | undefined) ?? undefined,
    organizationId: (event.metadata?.organizationId as number | undefined) ?? undefined,
  }
}
