/**
 * v3-ui-next-resource-team-domains W1 · tasks 1.8 —— 资源任务分配明细面板测试
 * （ResourceAllocationPanel + 伪后端）。
 *
 * 覆盖（spec「资源任务分配明细与受控分配管理」场景）：
 * - 分配明细渲染：任务编号、任务标题（任务底册映射）、分配类型、占比与起止日期；
 * - 「分配任务」抽屉：未完成任务下拉（排除已完成与已挂接任务）、占比合法性
 *   （0 / 空 / 150 阻断零请求）、提交 POST 后刷新列表并追加行；
 * - 后端 4xx 精确错误回显；
 * - 行内编辑占比/日期 PATCH 与非法占比零请求；
 * - 解除分配两步确认 → DELETE，行移除；
 * - 只读权限（无 resource:manage）：新增 / 编辑 / 解除入口物理隐藏，零写请求。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ResourceAllocationPanel } from '@/components/next/resources/ResourceAllocationPanel'
import type { ResourceAllocation } from '@/lib/api/resources'
import type { Task } from '@/lib/api/tasks'

// ---------------------------------------------------------------------------
// 伪后端
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

export interface RequestRecord {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function installFetchRouter(
  route: (
    path: string,
    method: string,
    body: Record<string, unknown> | null,
  ) => Response | Promise<Response> | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: Record<string, unknown> | null = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>
      } catch {
        body = null
      }
    }
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path, body })
    const matched = await route(path, method, body)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function makeAllocation(overrides: Partial<ResourceAllocation>): ResourceAllocation {
  return {
    id: 901,
    resourceId: 11,
    taskId: 501,
    allocationType: 'assigned',
    allocationPercent: 50,
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    plannedUnits: null,
    actualUnits: null,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 501,
    projectId: 42,
    name: '未命名任务',
    description: null,
    status: 'not_started',
    priority: 'medium',
    taskType: 'task',
    startDate: null,
    endDate: null,
    actualStartDate: null,
    actualEndDate: null,
    durationDays: null,
    estimatedHours: null,
    actualHours: null,
    progressPercent: 0,
    assigneeId: null,
    reviewerId: null,
    parentTaskId: null,
    wbsNodeId: null,
    milestoneId: null,
    costEstimateCents: null,
    costActualCents: null,
    customFields: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

interface BackendState {
  allocations: ResourceAllocation[]
  tasks: Task[]
  nextAllocationId: number
  failAllocationsOnce: boolean
  failCreateOnce: boolean
}

function createBackend(overrides: Partial<BackendState> = {}) {
  const state: BackendState = {
    allocations: [
      makeAllocation({ id: 901, taskId: 501, allocationType: 'assigned', allocationPercent: 50 }),
      makeAllocation({
        id: 902,
        taskId: 502,
        allocationType: 'allocated',
        allocationPercent: 30,
        startDate: null,
        endDate: null,
      }),
    ],
    tasks: [
      makeTask({ id: 501, name: '核心模块开发', status: 'in_progress' }),
      makeTask({ id: 502, name: '需求评审', status: 'completed' }),
      makeTask({ id: 503, name: '性能调优', status: 'not_started' }),
    ],
    nextAllocationId: 910,
    failAllocationsOnce: false,
    failCreateOnce: false,
    ...overrides,
  }

  const route = (
    path: string,
    method: string,
    body: Record<string, unknown> | null,
  ): Response | null => {
    // 任务底册（标题映射 + 抽屉可选项）
    if (/^\/projects\/42\/tasks(\?|$)/.test(path) && method === 'GET') {
      return jsonResponse(200, {
        data: state.tasks,
        meta: { total: state.tasks.length, page: 1, perPage: 200, totalPages: 1 },
      })
    }
    const base = /^\/projects\/42\/resources\/11\/allocations/
    if (base.test(path) && method === 'GET') {
      if (state.failAllocationsOnce) {
        state.failAllocationsOnce = false
        return jsonResponse(500, { error: { code: 'INTERNAL', message: '分配服务异常' } })
      }
      const list = state.allocations
      return jsonResponse(200, {
        data: list,
        meta: { total: list.length, page: 1, perPage: 200, totalPages: 1 },
      })
    }
    // POST 新建分配
    if (/^\/projects\/42\/resources\/11\/allocations(\?|$)/.test(path) && method === 'POST') {
      if (state.failCreateOnce) {
        state.failCreateOnce = false
        return jsonResponse(409, {
          error: { code: 'ALLOCATION_CONFLICT', message: '该任务已存在冲突分配，请先解除' },
        })
      }
      const created = makeAllocation({
        id: state.nextAllocationId++,
        taskId: Number(body?.taskId),
        allocationType:
          (body?.allocationType as ResourceAllocation['allocationType']) ?? 'assigned',
        allocationPercent: Number(body?.allocationPercent),
        startDate: (body?.startDate as string | null) ?? null,
        endDate: (body?.endDate as string | null) ?? null,
      })
      state.allocations = [...state.allocations, created]
      return jsonResponse(200, { data: created })
    }
    // PATCH 调整分配
    const patchMatch = /^\/projects\/42\/resources\/11\/allocations\/(\d+)$/.exec(path)
    if (patchMatch && method === 'PATCH') {
      const id = Number(patchMatch[1])
      const target = state.allocations.find((item) => item.id === id)
      if (!target) return null
      const next = {
        ...target,
        allocationPercent: body?.allocationPercent ?? target.allocationPercent,
        startDate: body?.startDate ?? target.startDate,
        endDate: body?.endDate ?? target.endDate,
      } as ResourceAllocation
      state.allocations = state.allocations.map((item) => (item.id === id ? next : item))
      return jsonResponse(200, { data: next })
    }
    // DELETE 解除分配
    const deleteMatch = /^\/projects\/42\/resources\/11\/allocations\/(\d+)$/.exec(path)
    if (deleteMatch && method === 'DELETE') {
      const id = Number(deleteMatch[1])
      state.allocations = state.allocations.filter((item) => item.id !== id)
      return jsonResponse(204, null)
    }
    return null
  }

  return { state, route }
}

function renderPanel(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

afterEach(() => {
  resetFetchRouter()
})

const commonProps = { projectId: 42, resourceId: 11, resourceName: '张工' }

describe('ResourceAllocationPanel：分配明细渲染（spec 场景「展开资源查看关联任务分配明细」）', () => {
  test('任务编号 / 标题映射 / 分配类型 / 占比 / 日期齐备', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPanel(<ResourceAllocationPanel {...commonProps} canManage={true} />)

    await waitFor(() => expect(document.querySelectorAll('[data-alloc-row]')).toHaveLength(2))
    expect(document.querySelector('[data-alloc-count]')?.textContent).toContain('2 项')

    const row901 = document.querySelector('[data-alloc-row="901"]')
    expect(row901?.querySelector('[data-alloc-task-id]')?.textContent).toBe('#501')
    expect(row901?.querySelector('[data-alloc-task-title]')?.textContent).toBe('核心模块开发')
    expect(row901?.querySelector('[data-alloc-type]')?.textContent).toBe('已指派')
    expect(row901?.querySelector('[data-alloc-percent]')?.textContent).toBe('50%')
    expect(row901?.querySelector('[data-alloc-range]')?.textContent).toBe('2026-09-01 ~ 2026-09-30')

    const row902 = document.querySelector('[data-alloc-row="902"]')
    expect(row902?.querySelector('[data-alloc-type]')?.textContent).toBe('已分配')
    expect(row902?.querySelector('[data-alloc-range]')?.textContent).toBe('—')
    expect(document.querySelector('[data-alloc-readonly-note]')).toBeNull()
  })

  test('空分配渲染语义化空态', async () => {
    const backend = createBackend({ allocations: [] })
    installFetchRouter(backend.route)
    renderPanel(<ResourceAllocationPanel {...commonProps} canManage={true} />)
    await waitFor(() => expect(document.querySelector('[data-alloc-empty]')).not.toBeNull())
    expect(screen.getByText(/该资源暂无任务分配/)).toBeInTheDocument()
  })

  test('分配端点 500：错误卡 + 重试恢复', async () => {
    const backend = createBackend({ failAllocationsOnce: true })
    installFetchRouter(backend.route)
    renderPanel(<ResourceAllocationPanel {...commonProps} canManage={true} />)
    await waitFor(() => expect(document.querySelector('[data-alloc-error]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-alloc-retry]') as Element)
    await waitFor(() => expect(document.querySelectorAll('[data-alloc-row]')).toHaveLength(2))
  })
})

describe('ResourceAllocationPanel：受控新增分配抽屉', () => {
  test('抽屉仅提供未完成任务（已完成 #502 与已挂接 #501 被排除）', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPanel(<ResourceAllocationPanel {...commonProps} canManage={true} />)
    await waitFor(() => expect(document.querySelectorAll('[data-alloc-row]')).toHaveLength(2))

    fireEvent.click(document.querySelector('[data-alloc-add-open]') as Element)
    expect(document.querySelector('[data-alloc-create-panel]')).not.toBeNull()
    const options = Array.from(document.querySelectorAll('[data-alloc-create-task] option')).map(
      (option) => option.textContent,
    )
    expect(options.some((text) => text?.includes('核心模块开发'))).toBe(false) // 已挂接
    expect(options.some((text) => text?.includes('需求评审'))).toBe(false) // 已完成
    expect(options.some((text) => text?.includes('性能调优'))).toBe(true)
  })

  test('非法占比（空 / 0 / 150）：即时警示并零请求', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPanel(<ResourceAllocationPanel {...commonProps} canManage={true} />)
    await waitFor(() => expect(document.querySelectorAll('[data-alloc-row]')).toHaveLength(2))
    fireEvent.click(document.querySelector('[data-alloc-add-open]') as Element)

    const percentInput = document.querySelector('[data-alloc-create-percent]') as HTMLInputElement
    for (const value of ['', '0', '150']) {
      fireEvent.change(percentInput, { target: { value } })
      expect(document.querySelector('[data-alloc-create-percent-error]')?.textContent).toContain(
        '分配占比需在 1% ~ 100% 之间',
      )
      fireEvent.click(document.querySelector('[data-alloc-create-submit]') as Element)
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(records.filter((record) => record.method === 'POST')).toHaveLength(0)
    }
  })

  test('合法提交：POST allocations 后抽屉关闭并刷新追加新行', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPanel(<ResourceAllocationPanel {...commonProps} canManage={true} />)
    await waitFor(() => expect(document.querySelectorAll('[data-alloc-row]')).toHaveLength(2))

    fireEvent.click(document.querySelector('[data-alloc-add-open]') as Element)
    fireEvent.change(document.querySelector('[data-alloc-create-task]') as Element, {
      target: { value: '503' },
    })
    fireEvent.change(document.querySelector('[data-alloc-create-percent]') as Element, {
      target: { value: '40' },
    })
    fireEvent.change(document.querySelector('[data-alloc-create-type]') as Element, {
      target: { value: 'reserved' },
    })
    fireEvent.click(document.querySelector('[data-alloc-create-submit]') as Element)

    await waitFor(() => expect(document.querySelector('[data-alloc-create-panel]')).toBeNull())
    await waitFor(() => expect(document.querySelectorAll('[data-alloc-row]')).toHaveLength(3))
    const post = records.find((record) => record.method === 'POST')
    expect(post?.url).toBe('/projects/42/resources/11/allocations')
    expect(post?.body).toMatchObject({
      taskId: 503,
      allocationType: 'reserved',
      allocationPercent: 40,
    })
    // 新行已追加且标题映射生效
    const newRow = [...document.querySelectorAll('[data-alloc-row]')].find(
      (row) => row.querySelector('[data-alloc-task-id]')?.textContent === '#503',
    )
    expect(newRow?.querySelector('[data-alloc-task-title]')?.textContent).toBe('性能调优')
    expect(newRow?.querySelector('[data-alloc-type]')?.textContent).toBe('预留')
  })

  test('后端 409：精确错误回显在抽屉内（不静默吞咽）', async () => {
    const backend = createBackend({ failCreateOnce: true })
    const { records } = installFetchRouter(backend.route)
    renderPanel(<ResourceAllocationPanel {...commonProps} canManage={true} />)
    await waitFor(() => expect(document.querySelectorAll('[data-alloc-row]')).toHaveLength(2))

    fireEvent.click(document.querySelector('[data-alloc-add-open]') as Element)
    fireEvent.change(document.querySelector('[data-alloc-create-task]') as Element, {
      target: { value: '503' },
    })
    fireEvent.click(document.querySelector('[data-alloc-create-submit]') as Element)

    await waitFor(() => expect(document.querySelector('[data-alloc-create-error]')).not.toBeNull())
    expect(screen.getByText('该任务已存在冲突分配，请先解除')).toBeInTheDocument()
    expect(records.filter((record) => record.method === 'POST')).toHaveLength(1)
    // 错误后抽屉保持打开可重试/取消
    fireEvent.click(document.querySelector('[data-alloc-create-cancel]') as Element)
    expect(document.querySelector('[data-alloc-create-panel]')).toBeNull()
  })

  test('取消关闭抽屉零写请求', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPanel(<ResourceAllocationPanel {...commonProps} canManage={true} />)
    await waitFor(() => expect(document.querySelectorAll('[data-alloc-row]')).toHaveLength(2))
    fireEvent.click(document.querySelector('[data-alloc-add-open]') as Element)
    fireEvent.change(document.querySelector('[data-alloc-create-task]') as Element, {
      target: { value: '503' },
    })
    fireEvent.click(document.querySelector('[data-alloc-create-close]') as Element)
    expect(document.querySelector('[data-alloc-create-panel]')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(records.filter((record) => record.method !== 'GET')).toHaveLength(0)
  })
})

describe('ResourceAllocationPanel：调整与解除分配', () => {
  test('行内编辑占比 → PATCH，成功即时回显新占比', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPanel(<ResourceAllocationPanel {...commonProps} canManage={true} />)
    await waitFor(() => expect(document.querySelectorAll('[data-alloc-row]')).toHaveLength(2))

    fireEvent.click(document.querySelector('[data-alloc-edit-open="901"]') as Element)
    expect(document.querySelector('[data-alloc-edit-row="901"]')).not.toBeNull()

    fireEvent.change(document.querySelector('[data-alloc-edit-percent]') as Element, {
      target: { value: '60' },
    })
    fireEvent.change(document.querySelector('[data-alloc-edit-end]') as Element, {
      target: { value: '2026-10-31' },
    })
    fireEvent.click(document.querySelector('[data-alloc-edit-save]') as Element)

    await waitFor(() => expect(document.querySelector('[data-alloc-edit-row="901"]')).toBeNull())
    await waitFor(() =>
      expect(
        document.querySelector('[data-alloc-row="901"] [data-alloc-percent]')?.textContent,
      ).toBe('60%'),
    )
    const patch = records.find((record) => record.method === 'PATCH')
    expect(patch?.url).toBe('/projects/42/resources/11/allocations/901')
    expect(patch?.body).toMatchObject({ allocationPercent: 60, endDate: '2026-10-31' })
  })

  test('非法编辑占比（0）：保存按钮禁用零请求，取消退出编辑态', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPanel(<ResourceAllocationPanel {...commonProps} canManage={true} />)
    await waitFor(() => expect(document.querySelectorAll('[data-alloc-row]')).toHaveLength(2))

    fireEvent.click(document.querySelector('[data-alloc-edit-open="901"]') as Element)
    fireEvent.change(document.querySelector('[data-alloc-edit-percent]') as Element, {
      target: { value: '0' },
    })
    const save = document.querySelector('[data-alloc-edit-save]') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(records.filter((record) => record.method === 'PATCH')).toHaveLength(0)

    fireEvent.click(document.querySelector('[data-alloc-edit-cancel]') as Element)
    expect(document.querySelector('[data-alloc-edit-row="901"]')).toBeNull()
  })

  test('解除分配：两步确认 → DELETE，成功后行移除（spec 场景「移除现有任务分配」）', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPanel(<ResourceAllocationPanel {...commonProps} canManage={true} />)
    await waitFor(() => expect(document.querySelectorAll('[data-alloc-row]')).toHaveLength(2))

    // 第一步：取消不发请求
    fireEvent.click(document.querySelector('[data-alloc-delete-open="901"]') as Element)
    expect(document.querySelector('[data-alloc-delete-dialog]')).not.toBeNull()
    expect(document.querySelector('[data-alloc-delete-dialog]')?.textContent).toContain(
      '核心模块开发',
    )
    fireEvent.click(document.querySelector('[data-alloc-delete-cancel]') as Element)
    expect(document.querySelector('[data-alloc-delete-dialog]')).toBeNull()
    expect(records.filter((record) => record.method === 'DELETE')).toHaveLength(0)

    // 第二步：确认解除
    fireEvent.click(document.querySelector('[data-alloc-delete-open="901"]') as Element)
    fireEvent.click(document.querySelector('[data-alloc-delete-ok]') as Element)
    await waitFor(() => expect(document.querySelector('[data-alloc-delete-dialog]')).toBeNull())
    await waitFor(() => expect(document.querySelectorAll('[data-alloc-row]')).toHaveLength(1))
    const del = records.find((record) => record.method === 'DELETE')
    expect(del?.url).toBe('/projects/42/resources/11/allocations/901')
    expect(document.querySelector('[data-alloc-row="901"]')).toBeNull()
  })
})

describe('ResourceAllocationPanel：只读权限物理隐藏写入口（spec 权限防护）', () => {
  test('无 resource:manage：新增 / 编辑 / 解除按钮全部隐藏，仅展示明细', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPanel(<ResourceAllocationPanel {...commonProps} canManage={false} />)

    await waitFor(() => expect(document.querySelectorAll('[data-alloc-row]')).toHaveLength(2))
    expect(document.querySelector('[data-alloc-readonly-note]')).not.toBeNull()
    expect(document.querySelector('[data-alloc-add-open]')).toBeNull()
    expect(document.querySelector('[data-alloc-edit-open="901"]')).toBeNull()
    expect(document.querySelector('[data-alloc-delete-open="901"]')).toBeNull()
    // 明细本身完整可读
    expect(document.querySelector('[data-alloc-row="901"] [data-alloc-percent]')?.textContent).toBe(
      '50%',
    )

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records.filter((record) => record.method !== 'GET')).toHaveLength(0)
  })
})
