'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import { useRealtimeContext } from '@/providers/realtime-provider'
import {
  timelineApi,
  timelineKeys,
  type TimelineFilters,
  type TimelineListResponse,
} from '@/lib/api/timeline'
import { type RealtimeEventEnvelope } from '@/lib/realtime/client'

/**
 * 项目 Timeline 游标分页查询。
 *
 * REST 为事实来源：WebSocket 只做「有新动态」旁路提示（见 useTimelineRealtimeHint），
 * 断线时本 hook 完全不受影响。
 */
export function useProjectTimeline(projectId: number, filters: TimelineFilters) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  return useInfiniteQuery({
    queryKey: timelineKeys.list(projectId, filters),
    queryFn: ({ pageParam }) => timelineApi.list(projectId, filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: TimelineListResponse) =>
      lastPage.meta.hasMore ? lastPage.meta.nextCursor : undefined,
    enabled: isAuthenticated && Number.isFinite(projectId),
  })
}

/** timeline:activity 实时事件名（与后端 RealtimeEvents.TIMELINE_ACTIVITY 对齐）。 */
export const TIMELINE_REALTIME_EVENT = 'timeline:activity'

/**
 * 订阅当前项目的 timeline:activity 实时提示。
 *
 * 收到当前项目新活动时置 hasNew=true（前端据此显示「有新动态」入口）；
 * 调用 refresh() 才通过 REST 重取——刷新绝不自动修改任何业务数据。
 */
export function useTimelineRealtimeHint(projectId: number): {
  hasNew: boolean
  refresh: () => void
  dismiss: () => void
} {
  const { client, connected } = useRealtimeContext()
  const queryClient = useQueryClient()
  const [hasNew, setHasNew] = useState(false)
  const joinedRef = useRef(false)

  useEffect(() => {
    if (!projectId || !client || !connected) {
      joinedRef.current = false
      return
    }

    client.joinProject(projectId).then((ok) => {
      joinedRef.current = ok
    })

    const unsub = client.on('realtime:event', (event: RealtimeEventEnvelope) => {
      if (event.projectId !== projectId) return
      // 只对 Timeline 活动提示置位；其它事件（如 task:*）交给各自视图处理
      if (event.type === TIMELINE_REALTIME_EVENT) {
        setHasNew(true)
      }
    })

    return () => {
      unsub()
      if (joinedRef.current) {
        client.leaveProject(projectId)
        joinedRef.current = false
      }
    }
  }, [projectId, client, connected])

  const refresh = useCallback(() => {
    setHasNew(false)
    queryClient.invalidateQueries({ queryKey: timelineKeys.lists(projectId) }).catch(() => {
      /* 失效失败由 refetchOnFocus 兜底 */
    })
  }, [projectId, queryClient])

  const dismiss = useCallback(() => setHasNew(false), [])

  return { hasNew, refresh, dismiss }
}
