import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TaskBatchActionBar } from '@/components/views/tasks/TaskBatchActionBar'
import { useTaskSelection } from '@/hooks/use-task-selection'
import { projectKeys } from '@/lib/api/projects'
import { taskKeys, tasksApi } from '@/lib/api/tasks'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'

function loginAs(permissions: string[]) {
  useAuthStore.getState().setSession({
    user: {
      id: 1,
      fullName: '项目经理',
      email: 'pm@example.com',
      isSuperAdmin: false,
      organizations: [{ id: 1, name: '组织', slug: 'org', role: 'owner' }],
    },
    accessToken: accessTokenWith(permissions, { organizationId: 1 }),
    refreshToken: 'refresh',
  })
}

function jsonResponse(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

describe('任务批量操作前端', () => {
  beforeEach(() => {
    useAuthStore.getState().clear()
    vi.restoreAllMocks()
  })

  test('批量删除必须确认后才提交所选任务', async () => {
    loginAs(['task:delete'])
    const onExecute = vi.fn()
    render(
      <TaskBatchActionBar
        selectedIds={[7, 9]}
        members={[]}
        onClear={vi.fn()}
        onExecute={onExecute}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '设置并执行' }))
    expect(
      await screen.findByText(
        '任务将移入回收站，30 天内可恢复。含活动子任务的父任务会保留并报告失败。',
      ),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认处理 2 项' }))
    expect(onExecute).toHaveBeenCalledWith({ action: 'delete', taskIds: [7, 9] })
  })

  test('选择模型支持当前页全选并只保留失败项', () => {
    const { result } = renderHook(() => useTaskSelection())
    act(() => result.current.setPageSelected([1, 2, 3], true))
    expect([...result.current.selectedIds]).toEqual([1, 2, 3])
    act(() => result.current.retain([2]))
    expect([...result.current.selectedIds]).toEqual([2])
    act(() => result.current.clear())
    expect(result.current.selectedIds.size).toBe(0)
  })

  test('选择模型把跨页选择限制在 100 项', () => {
    const { result } = renderHook(() => useTaskSelection())
    act(() =>
      result.current.setPageSelected(
        Array.from({ length: 120 }, (_, index) => index + 1),
        true,
      ),
    )
    expect(result.current.selectedIds.size).toBe(100)
  })

  test('集中缓存失效覆盖列表、详情、回收站、视图与项目统计', async () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()

    await invalidateTaskQueries(queryClient, 4)

    expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.lists(4) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.details(4) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.recycleBins(4) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.views(4) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectKeys.dashboard(4) })
  })

  test('API 客户端调用批量、回收站与批量恢复契约', async () => {
    loginAs(['task:view', 'task:delete'])
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock
      .mockImplementationOnce(() =>
        jsonResponse({
          data: {
            action: 'delete',
            total: 1,
            successCount: 1,
            failedCount: 0,
            results: [{ taskId: 7, success: true }],
          },
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          data: [],
          meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          data: {
            action: 'restore',
            total: 1,
            successCount: 1,
            failedCount: 0,
            results: [{ taskId: 7, success: true }],
          },
        }),
      )

    await tasksApi.batch(3, { action: 'delete', taskIds: [7] })
    await tasksApi.listRecycleBin(3, { page: 1, search: '设计' })
    await tasksApi.batchRestore(3, [7])

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/projects/3/tasks/batch')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      '/projects/3/tasks/recycle-bin?search=%E8%AE%BE%E8%AE%A1&page=1',
    )
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/projects/3/tasks/batch-restore')
  })
})
