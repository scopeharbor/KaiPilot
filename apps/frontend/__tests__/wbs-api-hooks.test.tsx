import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { wbsApi, wbsKeys, type WbsNode } from '@/lib/api/wbs'
import {
  useCreateWbsNode,
  useDeleteWbsNode,
  useMoveWbsNode,
  useUpdateWbsNode,
  useWbsTree,
} from '@/hooks/use-wbs-tree'

function node(overrides: Partial<WbsNode> = {}): WbsNode {
  return {
    id: 1,
    projectId: 7,
    parentId: null,
    path: '/1/',
    code: '1',
    name: '项目根',
    depth: 0,
    isLeaf: true,
    collapsed: false,
    displayOrder: 0,
    taskId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

describe('WBS API 客户端契约', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: node() }),
      }),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('使用约定路由和 HTTP 方法', async () => {
    const fetchMock = vi.mocked(fetch)
    await wbsApi.tree(7)
    await wbsApi.create(7, { name: '阶段' })
    await wbsApi.update(7, 2, { collapsed: true })
    await wbsApi.move(7, 2, { parentId: 3, displayOrder: 0 })
    await wbsApi.delete(7, 2)

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('/projects/7/wbs-tree?include=task'),
      expect.stringContaining('/projects/7/wbs/nodes'),
      expect.stringContaining('/projects/7/wbs/nodes/2'),
      expect.stringContaining('/projects/7/wbs/nodes/2/move'),
      expect.stringContaining('/projects/7/wbs/nodes/2'),
    ])
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual([
      'GET',
      'POST',
      'PATCH',
      'POST',
      'DELETE',
    ])
  })
})

describe('WBS TanStack Query hooks', () => {
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

  it('查询树并在创建、删除成功后失效缓存', async () => {
    vi.spyOn(wbsApi, 'tree').mockResolvedValue([node()])
    vi.spyOn(wbsApi, 'create').mockResolvedValue(node({ id: 2, name: '阶段' }))
    vi.spyOn(wbsApi, 'delete').mockResolvedValue(undefined)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    const query = renderHook(() => useWbsTree(7), { wrapper })
    await waitFor(() => expect(query.result.current.isSuccess).toBe(true))

    const create = renderHook(() => useCreateWbsNode(7), { wrapper })
    await act(() => create.result.current.mutateAsync({ name: '阶段' }))
    const remove = renderHook(() => useDeleteWbsNode(7), { wrapper })
    await act(() => remove.result.current.mutateAsync(2))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: wbsKeys.tree(7) })
  })

  it('更新失败回滚缓存', async () => {
    const original = [
      node({ isLeaf: false }),
      node({
        id: 2,
        parentId: 1,
        path: '/1/2/',
        code: '1.1',
        depth: 1,
        name: 'A',
      }),
      node({
        id: 3,
        parentId: 1,
        path: '/1/3/',
        code: '1.2',
        depth: 1,
        name: 'B',
      }),
    ]
    client.setQueryData(wbsKeys.tree(7), original)
    vi.spyOn(wbsApi, 'update').mockRejectedValue(new Error('失败'))
    const update = renderHook(() => useUpdateWbsNode(7), { wrapper })
    let caughtError: unknown
    await act(async () => {
      try {
        await update.result.current.mutateAsync({ nodeId: 2, input: { name: '临时名称' } })
      } catch (error) {
        caughtError = error
      }
    })
    expect(caughtError).toBeInstanceOf(Error)
    expect((caughtError as Error).message).toContain('失败')
    expect(client.getQueryData(wbsKeys.tree(7))).toEqual(original)
  })

  it('移动成功执行乐观重算', async () => {
    const original = [
      node({ isLeaf: false }),
      node({
        id: 2,
        parentId: 1,
        path: '/1/2/',
        code: '1.1',
        depth: 1,
        name: 'A',
      }),
      node({
        id: 3,
        parentId: 1,
        path: '/1/3/',
        code: '1.2',
        depth: 1,
        name: 'B',
      }),
    ]
    client.setQueryData(wbsKeys.tree(7), original)
    vi.spyOn(wbsApi, 'move').mockImplementation(async () => {
      const optimistic = client.getQueryData<WbsNode[]>(wbsKeys.tree(7))
      expect(optimistic?.find((item) => item.id === 2)).toMatchObject({
        parentId: 3,
        code: '1.1.1',
      })
      return node({ id: 2, parentId: 3 })
    })
    const move = renderHook(() => useMoveWbsNode(7), { wrapper })
    expect(move.result.current).not.toBeNull()
    await act(() =>
      move.result.current.mutateAsync({ nodeId: 2, input: { parentId: 3, displayOrder: 0 } }),
    )
  })
})
