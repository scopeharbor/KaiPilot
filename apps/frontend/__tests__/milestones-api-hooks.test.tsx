import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useCreateMilestone,
  useDeleteMilestone,
  useMilestones,
  useUpdateMilestone,
} from '@/hooks/use-milestones'
import { milestonesApi, milestoneKeys, type Milestone } from '@/lib/api/milestones'

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast, dismiss: vi.fn() }),
}))

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 10,
    projectId: 7,
    name: '需求冻结',
    description: null,
    status: 'planned',
    storedStatus: 'planned',
    plannedDate: '2026-07-20',
    autoCalculated: false,
    displayOrder: 0,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

describe('里程碑 API 客户端契约', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: milestone() }),
      }),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('列表/创建使用项目嵌套路由，编辑/删除使用扁平路由', async () => {
    const fetchMock = vi.mocked(fetch)
    await milestonesApi.list(7, { status: 'planned' })
    await milestonesApi.create(7, { name: '验收' })
    await milestonesApi.update(10, { status: 'achieved' })
    await milestonesApi.delete(10)

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('/projects/7/milestones?status=planned'),
      expect.stringContaining('/projects/7/milestones'),
      expect.stringContaining('/milestones/10'),
      expect.stringContaining('/milestones/10'),
    ])
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual([
      'GET',
      'POST',
      'PATCH',
      'DELETE',
    ])
  })
})

describe('里程碑 TanStack Query hooks', () => {
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

  it('查询并在增改删后失效项目全部里程碑列表', async () => {
    vi.spyOn(milestonesApi, 'list').mockResolvedValue({
      data: [milestone()],
      meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
    })
    vi.spyOn(milestonesApi, 'create').mockResolvedValue(milestone())
    vi.spyOn(milestonesApi, 'update').mockResolvedValue(milestone({ status: 'achieved' }))
    vi.spyOn(milestonesApi, 'delete').mockResolvedValue(undefined)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const query = renderHook(() => useMilestones(7), { wrapper })
    await waitFor(() => expect(query.result.current.isSuccess).toBe(true))
    const create = renderHook(() => useCreateMilestone(7), { wrapper })
    const update = renderHook(() => useUpdateMilestone(7), { wrapper })
    const remove = renderHook(() => useDeleteMilestone(7), { wrapper })

    await act(() => create.result.current.mutateAsync({ name: '需求冻结' }))
    await act(() =>
      update.result.current.mutateAsync({ milestoneId: 10, input: { status: 'achieved' } }),
    )
    await act(() => remove.result.current.mutateAsync(10))

    expect(invalidate).toHaveBeenCalledWith({ queryKey: milestoneKeys.lists(7) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: milestoneKeys.detail(10) })
  })
})
