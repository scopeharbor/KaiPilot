import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGanttBaseline, useSaveGanttBaseline } from '@/hooks/use-gantt-baseline'
import { ganttBaselineApi, ganttBaselineKeys, type GanttBaseline } from '@/lib/api/gantt-baseline'

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast, dismiss: vi.fn() }),
}))

const baseline: GanttBaseline = {
  id: 1,
  projectId: 7,
  createdBy: 1,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: null,
  snapshot: { tasks: [], milestones: [], savedAt: '2026-07-06T00:00:00.000Z' },
}

describe('甘特基线 API hooks', () => {
  let client: QueryClient
  let wrapper: ({ children }: { children: ReactNode }) => React.JSX.Element

  beforeEach(() => {
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

  it('读取空态并在保存后失效当前项目基线', async () => {
    vi.spyOn(ganttBaselineApi, 'get').mockResolvedValue(null)
    vi.spyOn(ganttBaselineApi, 'save').mockResolvedValue(baseline)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const query = renderHook(() => useGanttBaseline(7), { wrapper })
    await waitFor(() => expect(query.result.current.isSuccess).toBe(true))
    expect(query.result.current.data).toBeNull()

    const save = renderHook(() => useSaveGanttBaseline(7), { wrapper })
    await act(() => save.result.current.mutateAsync())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ganttBaselineKeys.detail(7) })
  })
})
