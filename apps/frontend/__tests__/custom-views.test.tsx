import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useCustomViewsList,
  useCustomView,
  useCreateCustomView,
  useUpdateCustomView,
  useDeleteCustomView,
  useCloneCustomView,
  useReorderCustomViews,
  useSetDefaultCustomView,
  useDefaultCustomViewId,
} from '@/hooks/use-custom-views'
import {
  customViewsApi,
  customViewsKeys,
  type CustomViewResponse,
  type CustomViewListResponse,
} from '@/lib/api/custom-views'

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast, dismiss: vi.fn() }),
}))

function personalView(overrides: Partial<CustomViewResponse> = {}): CustomViewResponse {
  return {
    id: 10,
    organizationId: 1,
    projectId: 7,
    ownerUserId: 1,
    name: '我的看板',
    baseViewType: 'kanban',
    visibility: 'personal',
    config: {
      schemaVersion: 1,
      baseViewType: 'kanban',
      filters: {},
      sort: [],
      display: {},
      scope: {},
      state: {},
    },
    schemaVersion: 1,
    position: 0,
    isDefault: true,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

function sharedView(overrides: Partial<CustomViewResponse> = {}): CustomViewResponse {
  return {
    id: 20,
    organizationId: 1,
    projectId: 7,
    ownerUserId: 1,
    name: '团队看板',
    baseViewType: 'list',
    visibility: 'shared',
    config: {
      schemaVersion: 1,
      baseViewType: 'list',
      filters: { statuses: ['in_progress'] },
      sort: [],
      display: { columns: ['name', 'status'] },
      scope: {},
      state: {},
    },
    schemaVersion: 1,
    position: 0,
    isDefault: false,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

function listResponse(personalCount = 2, sharedCount = 1): CustomViewListResponse {
  return {
    personal: Array.from({ length: personalCount }, (_, i) =>
      personalView({ id: 10 + i, name: `个人视图${i + 1}`, isDefault: i === 0 }),
    ),
    shared: Array.from({ length: sharedCount }, (_, i) =>
      sharedView({ id: 20 + i, name: `共享视图${i + 1}` }),
    ),
  }
}

describe('自定义视图 API 客户端契约', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: personalView() }),
      }),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('API 方法使用项目嵌套端点', async () => {
    const fetchMock = vi.mocked(fetch)
    await customViewsApi.list(7)
    await customViewsApi.show(7, 10)
    await customViewsApi.create(7, {
      name: '新视图',
      baseViewType: 'kanban',
      visibility: 'personal',
      config: {
        schemaVersion: 1,
        baseViewType: 'kanban',
        filters: {},
        sort: [],
        display: {},
        scope: {},
        state: {},
      },
    })
    await customViewsApi.update(7, 10, { name: '重命名' })
    await customViewsApi.destroy(7, 10)
    await customViewsApi.clone(7, 20, { name: '副本' })
    await customViewsApi.reorder(7, { viewIds: [10, 20] })
    await customViewsApi.setDefault(7, 10)

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('/projects/7/custom-views'),
      expect.stringContaining('/projects/7/custom-views/10'),
      expect.stringContaining('/projects/7/custom-views'),
      expect.stringContaining('/projects/7/custom-views/10'),
      expect.stringContaining('/projects/7/custom-views/10'),
      expect.stringContaining('/projects/7/custom-views/20/clone'),
      expect.stringContaining('/projects/7/custom-views/reorder'),
      expect.stringContaining('/projects/7/custom-views/10/default'),
    ])
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual([
      'GET',
      'GET',
      'POST',
      'PATCH',
      'DELETE',
      'POST',
      'PUT',
      'PUT',
    ])
  })
})

describe('自定义视图 TanStack Query hooks', () => {
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

  // ─── 列表查询 ─────────────────────────────

  it('列表查询：加载状态 → 成功状态返回 personal + shared', async () => {
    vi.spyOn(customViewsApi, 'list').mockResolvedValue(listResponse(1, 1))

    const { result } = renderHook(() => useCustomViewsList(7), { wrapper })
    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.personal).toHaveLength(1)
    expect(result.current.data?.shared).toHaveLength(1)
  })

  it('列表查询：网络错误时 isError 为 true', async () => {
    vi.spyOn(customViewsApi, 'list').mockRejectedValue(new Error('网络错误'))

    const { result } = renderHook(() => useCustomViewsList(7), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeDefined()
  })

  it('列表查询：403 错误透传', async () => {
    vi.spyOn(customViewsApi, 'list').mockRejectedValue({ status: 403, code: 'PERMISSION_DENIED' })

    const { result } = renderHook(() => useCustomViewsList(7), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('列表查询：404 错误透传', async () => {
    vi.spyOn(customViewsApi, 'list').mockRejectedValue({ status: 404, code: 'RESOURCE_NOT_FOUND' })

    const { result } = renderHook(() => useCustomViewsList(99), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  // ─── 详情查询 ─────────────────────────────

  it('详情查询返回正确视图', async () => {
    vi.spyOn(customViewsApi, 'show').mockResolvedValue(personalView())

    const { result } = renderHook(() => useCustomView(7, 10), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.name).toBe('我的看板')
    expect(result.current.data?.id).toBe(10)
  })

  it('详情查询：无效 viewId 时 disabled', () => {
    const { result } = renderHook(() => useCustomView(7, 0), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })

  // ─── 创建 ─────────────────────────────────

  it('创建后失效列表', async () => {
    vi.spyOn(customViewsApi, 'list').mockResolvedValue(listResponse())
    vi.spyOn(customViewsApi, 'create').mockResolvedValue(personalView())
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    renderHook(() => useCustomViewsList(7), { wrapper })
    const { result } = renderHook(() => useCreateCustomView(7), { wrapper })
    await act(() =>
      result.current.mutateAsync({
        name: '新视图',
        baseViewType: 'kanban',
        visibility: 'personal',
        config: {
          schemaVersion: 1,
          baseViewType: 'kanban',
          filters: {},
          sort: [],
          display: {},
          scope: {},
          state: {},
        },
      }),
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: customViewsKeys.list(7) })
  })

  // ─── 更新 ─────────────────────────────────

  it('更新后失效列表', async () => {
    vi.spyOn(customViewsApi, 'list').mockResolvedValue(listResponse())
    vi.spyOn(customViewsApi, 'update').mockResolvedValue(personalView({ name: '新名称' }))
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    renderHook(() => useCustomViewsList(7), { wrapper })
    const { result } = renderHook(() => useUpdateCustomView(7), { wrapper })
    await act(() => result.current.mutateAsync({ viewId: 10, data: { name: '新名称' } }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: customViewsKeys.list(7) })
  })

  // ─── 删除 ─────────────────────────────────

  it('删除后失效列表', async () => {
    vi.spyOn(customViewsApi, 'list').mockResolvedValue(listResponse())
    vi.spyOn(customViewsApi, 'destroy').mockResolvedValue(undefined)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    renderHook(() => useCustomViewsList(7), { wrapper })
    const { result } = renderHook(() => useDeleteCustomView(7), { wrapper })
    await act(() => result.current.mutateAsync(10))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: customViewsKeys.list(7) })
  })

  // ─── 克隆 ─────────────────────────────────

  it('克隆后失效列表', async () => {
    vi.spyOn(customViewsApi, 'list').mockResolvedValue(listResponse())
    vi.spyOn(customViewsApi, 'clone').mockResolvedValue(
      personalView({ id: 30, name: '视图（副本）' }),
    )
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    renderHook(() => useCustomViewsList(7), { wrapper })
    const { result } = renderHook(() => useCloneCustomView(7), { wrapper })
    await act(() => result.current.mutateAsync({ viewId: 20, data: { name: '副本' } }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: customViewsKeys.list(7) })
  })

  // ─── 排序 ─────────────────────────────────

  it('排序后失效列表', async () => {
    vi.spyOn(customViewsApi, 'list').mockResolvedValue(listResponse())
    vi.spyOn(customViewsApi, 'reorder').mockResolvedValue(undefined)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    renderHook(() => useCustomViewsList(7), { wrapper })
    const { result } = renderHook(() => useReorderCustomViews(7), { wrapper })
    await act(() => result.current.mutateAsync({ viewIds: [20, 10] }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: customViewsKeys.list(7) })
  })

  // ─── 设默认 ───────────────────────────────

  it('设置默认视图后失效列表', async () => {
    vi.spyOn(customViewsApi, 'list').mockResolvedValue(listResponse())
    vi.spyOn(customViewsApi, 'setDefault').mockResolvedValue(personalView({ isDefault: true }))
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    renderHook(() => useCustomViewsList(7), { wrapper })
    const { result } = renderHook(() => useSetDefaultCustomView(7), { wrapper })
    await act(() => result.current.mutateAsync(10))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: customViewsKeys.list(7) })
  })

  // ─── 默认视图 ID ──────────────────────────

  it('默认视图 ID 查询：有默认返回 id', async () => {
    vi.spyOn(customViewsApi, 'list').mockResolvedValue(listResponse(2, 1))

    const { result } = renderHook(() => useDefaultCustomViewId(7), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBe(10) // 第一个 personal view 的 id
  })

  it('默认视图 ID 查询：无默认返回 null', async () => {
    const noDefault = listResponse(2, 1)
    noDefault.personal = noDefault.personal.map((v) => ({ ...v, isDefault: false }))
    vi.spyOn(customViewsApi, 'list').mockResolvedValue(noDefault)

    const { result } = renderHook(() => useDefaultCustomViewId(7), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  // ─── 错误 toast ───────────────────────────

  it('删除失败时显示错误 toast', async () => {
    vi.spyOn(customViewsApi, 'destroy').mockRejectedValue(new Error('权限不足'))
    const { result } = renderHook(() => useDeleteCustomView(7), { wrapper })
    await act(() => result.current.mutateAsync(99).catch(() => {}))
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', title: '删除视图失败' }),
    )
  })

  it('创建失败时显示错误 toast', async () => {
    vi.spyOn(customViewsApi, 'create').mockRejectedValue(new Error('名称重复'))
    const { result } = renderHook(() => useCreateCustomView(7), { wrapper })
    await act(() =>
      result.current
        .mutateAsync({
          name: '重复',
          baseViewType: 'kanban',
          visibility: 'personal',
          config: {
            schemaVersion: 1,
            baseViewType: 'kanban',
            filters: {},
            sort: [],
            display: {},
            scope: {},
            state: {},
          },
        })
        .catch(() => {}),
    )
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', title: '保存视图失败' }),
    )
  })
})
