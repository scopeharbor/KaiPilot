import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadGanttTasks } from '@/hooks/use-project-gantt'
import { tasksApi } from '@/lib/api/tasks'

vi.mock('@/lib/api/tasks', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/tasks')>()
  return {
    ...original,
    tasksApi: {
      ...original.tasksApi,
      list: vi.fn(),
    },
  }
})

describe('loadGanttTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('按后端 100 条上限聚合甘特任务分页', async () => {
    vi.mocked(tasksApi.list)
      .mockResolvedValueOnce({
        data: [{ id: 1 }] as Awaited<ReturnType<typeof tasksApi.list>>['data'],
        meta: { total: 101, page: 1, perPage: 100, totalPages: 2 },
      })
      .mockResolvedValueOnce({
        data: [{ id: 101 }] as Awaited<ReturnType<typeof tasksApi.list>>['data'],
        meta: { total: 101, page: 2, perPage: 100, totalPages: 2 },
      })

    const result = await loadGanttTasks(7)

    expect(tasksApi.list).toHaveBeenNthCalledWith(1, 7, { page: 1, perPage: 100 })
    expect(tasksApi.list).toHaveBeenNthCalledWith(2, 7, { page: 2, perPage: 100 })
    expect(result.data.map((task) => task.id)).toEqual([1, 101])
  })
})
