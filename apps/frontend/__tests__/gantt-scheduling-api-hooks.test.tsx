import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGanttSchedule } from '@/hooks/use-gantt-scheduling'
import { ganttSchedulingApi, type GanttScheduleResponse } from '@/lib/api/gantt-scheduling'
import { dependencyKeys } from '@/lib/api/dependencies'
import { projectKeys } from '@/lib/api/projects'
import { taskKeys } from '@/lib/api/tasks'
import { createGanttViewStore } from '@/stores/gantt-store'

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast, dismiss: vi.fn() }),
}))

const response: GanttScheduleResponse = {
  changes: [
    {
      taskId: 1,
      taskName: '任务A',
      before: { startDate: '2026-07-06', endDate: '2026-07-06', durationDays: 1 },
      after: { startDate: '2026-07-07', endDate: '2026-07-07', durationDays: 1 },
      reason: 'direct_move',
      dependencyIds: [],
    },
  ],
  conflicts: [],
  warnings: [],
  affectedTaskIds: [1],
  previewToken: 'a'.repeat(64),
  committed: true,
  calendar: { version: 1, workdays: [1, 2, 3, 4, 5], holidays: [], extraWorkdays: [] },
}

describe('甘特排程 API 与 mutation', () => {
  let client: QueryClient
  let wrapper: ({ children }: { children: ReactNode }) => React.JSX.Element

  beforeEach(() => {
    toast.mockReset()
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    wrapper = ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    client.clear()
  })

  it('commit 成功后刷新所有任务视图、项目与依赖', async () => {
    vi.spyOn(ganttSchedulingApi, 'execute').mockResolvedValue(response)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const hook = renderHook(() => useGanttSchedule(7), { wrapper })
    await act(() =>
      hook.result.current.mutateAsync({
        mode: 'commit',
        taskId: 1,
        operation: 'move',
        startDate: '2026-07-07',
        autoSchedule: true,
        previewToken: 'a'.repeat(64),
      }),
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.lists(7) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.views(7) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectKeys.dashboard(7) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: dependencyKeys.project(7) })
  })

  it('preview 不触发共享查询失效', async () => {
    vi.spyOn(ganttSchedulingApi, 'execute').mockResolvedValue({ ...response, committed: false })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const hook = renderHook(() => useGanttSchedule(7), { wrapper })
    await act(() =>
      hook.result.current.mutateAsync({
        mode: 'preview',
        taskId: 1,
        operation: 'move',
        startDate: '2026-07-07',
        autoSchedule: true,
      }),
    )
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('甘特短生命周期 store', () => {
  it('分别维护拖拽、待确认排程与依赖草稿', () => {
    const store = createGanttViewStore()
    const schedule = { taskId: 1, operation: 'move' as const, startDay: 2, endDay: 3 }
    const dependency = {
      predecessorId: 1,
      successorId: 2,
      type: 'fs' as const,
    }
    store.getState().setDragPreview(schedule)
    store.getState().setPendingSchedule(schedule)
    store.getState().setDependencyDraft(dependency)
    expect(store.getState().dragPreview).toEqual(schedule)
    expect(store.getState().pendingSchedule).toEqual(schedule)
    expect(store.getState().dependencyDraft).toEqual(dependency)
  })
})
