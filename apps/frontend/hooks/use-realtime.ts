'use client'

/**
 * useRealtime hook（design D8）。
 *
 * 在项目视图组件中使用，自动加入/离开项目频道，
 * 收到后端事件后调用既有 TanStack Query 失效逻辑触发重取。
 *
 * 使用方式：
 * ```tsx
 * function TaskListView({ projectId }: { projectId: number }) {
 *   useRealtime(projectId)
 *   // ... 组件渲染
 * }
 * ```
 */

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRealtimeContext } from '@/providers/realtime-provider'
import { invalidateResourceQueries } from '@/lib/resource-query-invalidation'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import { type RealtimeEventEnvelope, RealtimeEventTypes } from '@/lib/realtime/client'

/**
 * 让组件加入项目实时频道，并在收到事件后失效对应 TanStack Query。
 *
 * 自动处理：
 * - 连接可用时加入项目 room
 * - 组件卸载时离开 room
 * - 收到 task:* 事件后调用 invalidateTaskQueries
 * - 收到 resource:invalidated 事件后调用 invalidateResourceQueries
 *
 * 确保组件**不以 WebSocket 为前提**：连不上时 REST + TanStack Query 不变。
 */
export function useRealtime(projectId: number | undefined): void {
  const { client, connected } = useRealtimeContext()
  const queryClient = useQueryClient()
  const joinedRef = useRef(false)

  useEffect(() => {
    if (!projectId || !client || !connected) {
      joinedRef.current = false
      return
    }

    // 加入项目频道
    client.joinProject(projectId).then((ok) => {
      joinedRef.current = ok
    })

    // 订阅事件
    const unsub = client.on('realtime:event', (event: RealtimeEventEnvelope) => {
      // 只处理当前项目的事件
      if (event.projectId !== projectId) return

      switch (event.type) {
        case RealtimeEventTypes.TASK_CREATED:
        case RealtimeEventTypes.TASK_UPDATED:
        case RealtimeEventTypes.TASK_STATUS_CHANGED:
        case RealtimeEventTypes.TASK_DELETED:
        case RealtimeEventTypes.TASK_RESTORED: {
          // 复用既有失效逻辑
          invalidateTaskQueries(queryClient, projectId).catch(() => {
            // 静默：失效失败由 TanStack Query 下次 refetchOnFocus 兜底
          })
          break
        }
        case RealtimeEventTypes.RESOURCE_INVALIDATED: {
          invalidateResourceQueries(queryClient, projectId).catch(() => {
            // 静默：失效失败由 TanStack Query 下次 refetchOnFocus 兜底
          })
          break
        }
        default:
          break
      }
    })

    return () => {
      unsub()
      if (joinedRef.current) {
        client.leaveProject(projectId)
        joinedRef.current = false
      }
    }
  }, [projectId, client, connected, queryClient])
}

/**
 * 仅获取当前连接状态（不上报项目频道）。
 * 用于在组件中显示连接状态指示器。
 */
export function useRealtimeStatus(): { connected: boolean; status: string } {
  const { connected, status } = useRealtimeContext()
  return { connected, status }
}
