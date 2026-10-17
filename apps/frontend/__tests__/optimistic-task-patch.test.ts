import { describe, expect, test } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { kanbanKeys } from '@/lib/api/kanban'
import { taskKeys, type Task } from '@/lib/api/tasks'
import { optimisticPatchTask, restoreOptimisticTaskSnapshots } from '@/lib/optimistic-task-patch'

function taskOf(id: number, overrides: Partial<Task> = {}): Task {
  return { id, name: `任务${id}`, status: 'not_started', priority: 'medium', ...overrides } as Task
}

describe('任务保存乐观更新', () => {
  test('详情 / 分页列表 / 看板列 / 裸数组视图里的目标任务立即打补丁，可回滚', () => {
    const client = new QueryClient()
    const detailKey = taskKeys.detail(1, 7)
    const listKey = taskKeys.list(1, {})
    const columnKey = kanbanKeys.column(1, 'pending', {})
    const viewKey = taskKeys.view(1, 'kanban')

    client.setQueryData(detailKey, taskOf(7))
    client.setQueryData(listKey, {
      data: [taskOf(7), taskOf(8)],
      meta: { total: 2, page: 1, perPage: 50, totalPages: 1 },
    })
    client.setQueryData(columnKey, {
      data: [taskOf(7)],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    })
    client.setQueryData(viewKey, [taskOf(7), taskOf(9)])

    const snapshots = optimisticPatchTask(client, 1, 7, {
      name: '改名了',
      priority: 'high',
      progressPercent: 40,
      description: undefined,
    })

    expect(snapshots).toHaveLength(4)
    expect(client.getQueryData<Task>(detailKey)?.name).toBe('改名了')
    expect(client.getQueryData<Task>(detailKey)?.priority).toBe('high')
    // undefined 表示没改，不能覆盖缓存里的原值
    const list = client.getQueryData<{ data: Task[] }>(listKey)!
    expect(list.data[0]!.progressPercent).toBe(40)
    expect(list.data[1]!.name).toBe('任务8')
    const column = client.getQueryData<{ data: Task[] }>(columnKey)!
    expect(column.data[0]!.name).toBe('改名了')
    const view = client.getQueryData<Task[]>(viewKey)!
    expect(view[0]!.priority).toBe('high')
    expect(view[1]!.priority).toBe('medium')

    restoreOptimisticTaskSnapshots(client, snapshots)
    expect(client.getQueryData<Task>(detailKey)?.name).toBe('任务7')
    expect(client.getQueryData<{ data: Task[] }>(listKey)!.data[0]!.progressPercent).toBeUndefined()
    expect(client.getQueryData<Task[]>(viewKey)![0]!.priority).toBe('medium')
  })

  test('目标不在缓存里的查询不动；空补丁不写缓存', () => {
    const client = new QueryClient()
    const listKey = taskKeys.list(1, {})
    const other = { data: [taskOf(8)], meta: { total: 1, page: 1, perPage: 50, totalPages: 1 } }
    client.setQueryData(listKey, other)

    const snapshots = optimisticPatchTask(client, 1, 7, { name: '改名了' })
    expect(snapshots).toHaveLength(0)
    expect(client.getQueryData(listKey)).toBe(other)

    expect(optimisticPatchTask(client, 1, 7, {})).toEqual([])
    expect(optimisticPatchTask(client, 1, 7, { description: undefined })).toEqual([])
  })
})
