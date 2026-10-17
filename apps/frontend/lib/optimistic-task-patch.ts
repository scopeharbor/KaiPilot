import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { kanbanKeys } from '@/lib/api/kanban'
import { taskKeys, type Task, type UpdateTaskInput } from '@/lib/api/tasks'

/** 乐观更新的缓存快照：保存失败时按快照回滚。 */
export type OptimisticTaskSnapshot = Array<[QueryKey, unknown]>

function isTaskLike(value: unknown): value is Task {
  return Boolean(value) && typeof value === 'object' && typeof (value as Task).id === 'number'
}

/** 在常见列表形状（分页 { data: [] } 与裸 Task[]）里找到目标任务并打补丁。 */
function patchListData(data: unknown, taskId: number, patch: Partial<Task>): unknown {
  if (Array.isArray(data)) {
    if (!data.some((item) => isTaskLike(item) && item.id === taskId)) return data
    return data.map((item) =>
      isTaskLike(item) && item.id === taskId ? { ...item, ...patch } : item,
    )
  }
  if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown[] }).data)) {
    const envelope = data as { data: unknown[] }
    if (!envelope.data.some((item) => isTaskLike(item) && item.id === taskId)) return data
    return {
      ...envelope,
      data: envelope.data.map((item) =>
        isTaskLike(item) && item.id === taskId ? { ...item, ...patch } : item,
      ),
    }
  }
  return data
}

/**
 * 任务保存的乐观更新：任务详情保存要等远端库数秒，期间看板 / 列表不变，容易误以为没保存。
 * 把用户改动的字段立即写进详情 / 列表 / 看板列缓存；服务端回包后仍走 invalidateTaskQueries 对齐，
 * 失败时用 restoreOptimisticTaskSnapshots 回滚。
 */
export function optimisticPatchTask(
  queryClient: QueryClient,
  projectId: number,
  taskId: number,
  input: UpdateTaskInput,
): OptimisticTaskSnapshot {
  // undefined 表示「没改这个字段」，不能盖到缓存上
  const patch = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<Task>
  if (Object.keys(patch).length === 0) return []

  const snapshots: OptimisticTaskSnapshot = []
  const apply = (key: QueryKey, updater: (data: unknown) => unknown) => {
    const previous = queryClient.getQueryData(key)
    if (previous === undefined) return
    const next = updater(previous)
    if (next === previous) return
    snapshots.push([key, previous])
    queryClient.setQueryData(key, next)
  }

  apply(taskKeys.detail(projectId, taskId), (old) => (isTaskLike(old) ? { ...old, ...patch } : old))
  const groups = [
    taskKeys.lists(projectId),
    taskKeys.views(projectId),
    kanbanKeys.columns(projectId),
  ]
  for (const group of groups) {
    for (const [key] of queryClient.getQueriesData({ queryKey: group })) {
      apply(key, (data) => patchListData(data, taskId, patch))
    }
  }
  return snapshots
}

/** 保存失败时回滚乐观更新。 */
export function restoreOptimisticTaskSnapshots(
  queryClient: QueryClient,
  snapshots: OptimisticTaskSnapshot | undefined,
): void {
  for (const [key, previous] of snapshots ?? []) queryClient.setQueryData(key, previous)
}
