import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { TaskRecycleBinDrawer } from '@/components/next/project-space/TaskRecycleBinDrawer'
import { useAuthStore } from '@/stores/auth-store'
import * as invalidationNet from '@/lib/task-query-invalidation'

function setupJsdom() {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventMock extends MouseEvent {}
    window.PointerEvent = PointerEventMock as unknown as typeof PointerEvent
  }
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }))
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as unknown as Response
}

describe('TaskRecycleBinDrawer（任务回收站内敛管理抽屉）', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setupJsdom()

    useAuthStore.setState({
      user: {
        id: 1,
        email: 'pm@example.com',
        fullName: '项目经理',
        organizations: [{ id: 10, name: '主组织', slug: 'main', role: 'admin' }],
      },
      currentOrganizationId: 10,
      permissions: ['task:delete', 'task:view'],
      accessToken: 'token-test',
    })

    fetchSpy = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const urlStr = String(url)
      const method = init?.method ?? 'GET'

      // 任务回收站列表
      if (urlStr.includes('/recycle-bin') && method === 'GET') {
        return Promise.resolve(
          jsonResponse(200, {
            data: [
              {
                id: 15,
                projectId: 101,
                name: '性能压测用例编写',
                status: 'in_progress',
                priority: 'medium',
                assigneeId: null,
                deletedAt: '2026-09-08T10:00:00Z',
              },
              {
                id: 16,
                projectId: 101,
                name: '安全渗透测试',
                status: 'not_started',
                priority: 'high',
                assigneeId: null,
                deletedAt: '2026-09-09T14:30:00Z',
              },
            ],
            meta: { total: 2, page: 1, perPage: 50, totalPages: 1 },
          }),
        )
      }

      // 批量恢复
      if (urlStr.includes('/batch-restore') && method === 'POST') {
        const body = init?.body ? JSON.parse(String(init.body)) : {}
        const taskIds = (body.taskIds as number[]) ?? []
        return Promise.resolve(
          jsonResponse(200, {
            data: {
              action: 'restore',
              total: taskIds.length,
              successCount: taskIds.length,
              failedCount: 0,
              results: taskIds.map((id) => ({ taskId: id, success: true })),
            },
          }),
        )
      }

      // 彻底删除
      if (urlStr.includes('/projects/101/tasks/') && method === 'DELETE') {
        return Promise.resolve(jsonResponse(204, null))
      }

      return Promise.resolve(jsonResponse(200, { data: [] }))
    })

    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('测试回收站抽屉拉取已删除任务列表', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <TaskRecycleBinDrawer projectId={101} open={true} />
      </QueryClientProvider>,
    )

    // 抽屉渲染
    expect(await screen.findByTestId('task-recycle-bin-drawer')).toBeInTheDocument()
    expect(screen.getByTestId('recycle-bin-title')).toHaveTextContent('任务回收站')

    // 列表拉取展示任务名称与 ID
    expect(await screen.findByText('性能压测用例编写')).toBeInTheDocument()
    expect(screen.getByText('#15')).toBeInTheDocument()
    expect(screen.getByText('安全渗透测试')).toBeInTheDocument()
    expect(screen.getByText('#16')).toBeInTheDocument()
  })

  test('测试单项与批量恢复调用 batchRestore 并触发集中失效网', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(invalidationNet, 'invalidateTaskQueries')

    render(
      <QueryClientProvider client={queryClient}>
        <TaskRecycleBinDrawer projectId={101} open={true} />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('性能压测用例编写')).toBeInTheDocument()

    // 1. 单项恢复：点击 #15 恢复按钮
    const singleRestoreBtn = screen.getByTestId('recycle-bin-restore-single-15')
    fireEvent.click(singleRestoreBtn)

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/projects/101/tasks/batch-restore'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ taskIds: [15] }),
        }),
      )
      expect(invalidateSpy).toHaveBeenCalledWith(queryClient, 101)
    })

    // 2. 批量恢复：勾选 #16，点击批量恢复按钮
    const rowCheck16 = screen.getByTestId('recycle-bin-select-task-16')
    fireEvent.click(rowCheck16)

    const batchRestoreBtn = screen.getByTestId('recycle-bin-batch-restore')
    expect(batchRestoreBtn).toHaveTextContent('批量恢复 (1)')
    fireEvent.click(batchRestoreBtn)

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/projects/101/tasks/batch-restore'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ taskIds: [16] }),
        }),
      )
    })
  })

  test('测试彻底删除二次确认弹窗', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <TaskRecycleBinDrawer projectId={101} open={true} />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('性能压测用例编写')).toBeInTheDocument()

    // 点击彻底删除按钮唤起二次确认弹窗
    const purgeBtn = screen.getByTestId('recycle-bin-permanent-delete-trigger')
    fireEvent.click(purgeBtn)

    const confirmDialog = await screen.findByTestId('recycle-bin-permanent-delete-dialog')
    expect(confirmDialog).toBeInTheDocument()
    expect(screen.getByText('确认彻底删除？')).toBeInTheDocument()

    // 取消弹窗
    const cancelBtn = screen.getByTestId('recycle-bin-confirm-cancel')
    fireEvent.click(cancelBtn)
    await waitFor(() => {
      expect(screen.queryByTestId('recycle-bin-permanent-delete-dialog')).not.toBeInTheDocument()
    })
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'DELETE' }),
    )

    // 重新呼出确认并点击确认彻底删除
    fireEvent.click(purgeBtn)
    const confirmDeleteBtn = await screen.findByTestId('recycle-bin-confirm-delete')
    fireEvent.click(confirmDeleteBtn)

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/projects/101/tasks/15'),
        expect.objectContaining({ method: 'DELETE' }),
      )
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/projects/101/tasks/16'),
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
  })
})
