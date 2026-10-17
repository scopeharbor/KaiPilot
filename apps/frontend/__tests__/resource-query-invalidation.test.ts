import { QueryClient } from '@tanstack/react-query'
import { describe, expect, test, vi } from 'vitest'
import { calendarKeys } from '@/lib/api/calendar'
import { projectKeys } from '@/lib/api/projects'
import { resourcePlanningKeys } from '@/lib/api/resources'
import { taskKeys } from '@/lib/api/tasks'
import { invalidateResourceQueries } from '@/lib/resource-query-invalidation'

describe('invalidateResourceQueries', () => {
  test('refreshes resource workspace and project views touched by resource changes', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const spy = vi.spyOn(queryClient, 'invalidateQueries')

    await invalidateResourceQueries(queryClient, 42)

    const calledKeys = spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey)
    expect(calledKeys).toEqual(
      expect.arrayContaining([
        resourcePlanningKeys.all,
        taskKeys.views(42),
        calendarKeys.lists(42),
        ['kanban', 'columns', 42],
        ['wbs', 'tree', 42],
        ['gantt', 42],
        projectKeys.dashboard(42),
      ]),
    )
  })
})
