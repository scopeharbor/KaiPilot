/**
 * v3-copilot-suggestion-inbox — TanStack Query hooks
 *
 * 收件箱查询、状态变更、刷新聚合。
 */

'use client'

import { useCallback, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryInbox, getUnreadCount, performAction, refreshInbox } from '@/lib/api/suggestion-inbox'
import type { InboxEntryState, InboxAction, InboxSourceKind, InboxSeverity } from '@aiproj/types'

const INBOX_QUERY_KEY = ['copilot-suggestion-inbox']
const UNREAD_COUNT_KEY = ['copilot-suggestion-inbox', 'unread-count']

/**
 * 查询收件箱条目。
 */
export function useInboxQuery(params: {
  projectId?: number
  sourceKind?: InboxSourceKind
  state?: InboxEntryState
  severity?: InboxSeverity
  page?: number
  perPage?: number
}) {
  return useQuery({
    queryKey: [...INBOX_QUERY_KEY, params],
    queryFn: () => queryInbox(params),
    staleTime: 30_000,
  })
}

/**
 * 获取未读计数。
 * @param enabled 缺省 true；传 false 暂停查询（如 AI 同事面板关闭时零请求）。
 */
export function useUnreadCount(projectId?: number, enabled = true) {
  return useQuery({
    queryKey: [...UNREAD_COUNT_KEY, projectId],
    queryFn: () => getUnreadCount(projectId),
    staleTime: 30_000,
    enabled,
  })
}

/**
 * 执行状态变更动作。
 */
export function useInboxAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ entryId, action }: { entryId: string; action: InboxAction }) =>
      performAction(entryId, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY })
    },
  })
}

/**
 * 刷新聚合（供挂载时自动触发）。
 *
 * 不用 `useMutation`：在挂载 effect 里调用 `mutateAsync` 时，开发态 StrictMode 的
 * 模拟卸载会让 `MutationObserver` 因暂无监听者而从进行中的 mutation 上摘除自身，
 * 重新订阅后收不到完成通知，`isPending` 永远为 true——收件箱一直显示「加载中」。
 * 这里改用本地状态追踪进行中，完成后直接让收件箱查询失效重取。
 */
export function useInboxRefreshRunner() {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(
    async (projectId: number) => {
      setRefreshing(true)
      try {
        const result = await refreshInbox(projectId)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY }),
          queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY }),
        ])
        return result
      } finally {
        setRefreshing(false)
      }
    },
    [queryClient],
  )

  return { refresh, refreshing }
}

/**
 * 刷新聚合。
 */
export function useInboxRefresh() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (projectId: number) => refreshInbox(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY })
    },
  })
}
