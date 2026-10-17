import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useCreateDependency,
  useDeleteDependency,
  useTaskDependencies,
} from '@/hooks/use-task-dependencies'
import { dependenciesApi, dependencyKeys, type TaskDependency } from '@/lib/api/dependencies'
import { taskKeys } from '@/lib/api/tasks'

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast, dismiss: vi.fn() }),
}))

function dependency(overrides: Partial<TaskDependency> = {}): TaskDependency {
  return {
    id: 10,
    predecessorId: 1,
    successorId: 2,
    type: 'fs',
    lagDays: 0,
    predecessor: {
      id: 1,
      name: '需求确认',
      status: 'completed',
      startDate: null,
      endDate: null,
    },
    successor: {
      id: 2,
      name: '开发',
      status: 'not_started',
      startDate: null,
      endDate: null,
    },
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

describe('任务依赖 API 客户端契约', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: dependency() }),
      }),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('使用嵌套查询/创建与扁平删除路由', async () => {
    const fetchMock = vi.mocked(fetch)
    await dependenciesApi.list(7, 2)
    await dependenciesApi.create(7, 2, { predecessorId: 1, type: 'ss', lagDays: -2 })
    await dependenciesApi.delete(10)

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('/projects/7/tasks/2/dependencies'),
      expect.stringContaining('/projects/7/tasks/2/dependencies'),
      expect.stringContaining('/dependencies/10'),
    ])
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual([
      'GET',
      'POST',
      'DELETE',
    ])
  })
})

describe('任务依赖 TanStack Query hooks', () => {
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

  it('查询依赖并在建删后刷新列表、详情与任务列表', async () => {
    vi.spyOn(dependenciesApi, 'list').mockResolvedValue({
      predecessors: [dependency()],
      successors: [],
    })
    vi.spyOn(dependenciesApi, 'create').mockResolvedValue(dependency())
    vi.spyOn(dependenciesApi, 'delete').mockResolvedValue(undefined)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const query = renderHook(() => useTaskDependencies(7, 2), { wrapper })
    await waitFor(() => expect(query.result.current.isSuccess).toBe(true))

    const create = renderHook(() => useCreateDependency(7, 2), { wrapper })
    await act(() => create.result.current.mutateAsync({ predecessorId: 1 }))
    const remove = renderHook(() => useDeleteDependency(7, 2), { wrapper })
    await act(() => remove.result.current.mutateAsync(10))

    expect(invalidate).toHaveBeenCalledWith({ queryKey: dependencyKeys.task(7, 2) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.detail(7, 2) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.lists(7) })
  })

  it('循环 422 以明确 Toast 反馈', async () => {
    vi.spyOn(dependenciesApi, 'create').mockRejectedValue(new Error('将形成循环依赖'))
    const result = renderHook(() => useCreateDependency(7, 2), { wrapper })
    let caughtError: unknown
    await act(async () => {
      try {
        await result.result.current.mutateAsync({ predecessorId: 1 })
      } catch (error) {
        caughtError = error
      }
    })
    expect(caughtError).toBeInstanceOf(Error)
    expect((caughtError as Error).message).toContain('将形成循环依赖')
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        variant: 'error',
        title: '无法添加：将形成循环依赖',
        description: '将形成循环依赖',
      }),
    )
  })
})
