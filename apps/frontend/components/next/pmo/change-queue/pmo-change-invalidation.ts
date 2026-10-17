import type { QueryClient } from '@tanstack/react-query'

export const PMO_CHANGE_QUEUE_QUERY_KEY = ['pmo', 'change-queue'] as const

/**
 * PMO 变更审批集中失效网联动函数（v3-ui-next-batch4-reports-change-queue W4 · tasks 4.7）。
 *
 * 在变更批准、驳回或退回修改成功后调用，联动失效：
 * 1. PMO 全局变更队列缓存 ['pmo', 'change-queue']
 * 2. 当前项目级变更请求缓存 ['projects', projectId, 'change-requests']
 * 3. 全局通用变更请求缓存 ['change-requests']
 */
export async function invalidatePmoChangeQueries(
  queryClient: QueryClient,
  projectId?: number | null,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: PMO_CHANGE_QUEUE_QUERY_KEY })
  if (projectId != null && projectId > 0) {
    await queryClient.invalidateQueries({
      queryKey: ['projects', projectId, 'change-requests'],
    })
  }
  await queryClient.invalidateQueries({ queryKey: ['change-requests'] })
}
