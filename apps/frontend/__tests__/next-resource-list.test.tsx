/**
 * v3-ui-next-resource-team-domains W1 · tasks 1.6 —— 资源底册表格/卡片双视图、
 * 多维过滤、行内停用与安全删除测试（ResourceListTable + 伪后端）。
 *
 * 覆盖（spec「资源域工作空间与资源列表管理」场景）：
 * - 全类型资源（human/material/equipment/budget）表格渲染与卡片/表格切换；
 * - 类型 / 状态 / 名称关键字即时过滤与「清除筛选条件」；
 * - 行内停用/启用切换调用 PATCH /resources/:id 并刷新列表状态徽章；
 * - 删除预检：存在未结分配 → 阻断提示（零 DELETE）；无分配 → 二次确认后 DELETE；
 * - 取消删除不发请求；
 * - 只读权限（无 resource:manage）操作按钮置灰锁定，点击零写请求、零分配预检；
 * - 加载骨架与 500 错误重试 / 空态引导。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ResourceListTable } from '@/components/next/resources/ResourceListTable'
import type { Resource, ResourceAllocation } from '@/lib/api/resources'

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

function makeResource(overrides: Partial<Resource>): Resource {
  return {
    id: 1,
    projectId: 42,
    userId: null,
    name: '张工',
    email: null,
    resourceType: 'human',
    role: 'member',
    status: 'active',
    dailyCapacityHours: 8,
    skillTags: null,
    workDays: '1,2,3,4,5',
    timezone: 'Asia/Shanghai',
    costPerUnitCents: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

function makeAllocation(overrides: Partial<ResourceAllocation>): ResourceAllocation {
  return {
    id: 900,
    resourceId: 2,
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

interface BackendState {
  resources: Resource[]
  allocations: Map<number, ResourceAllocation[]>
  failListOnce: boolean
}

function createBackend(overrides: Partial<BackendState> = {}) {
  const state: BackendState = {
    resources: [
      makeResource({
        id: 1,
        name: '张工',
        email: 'zhang@example.com',
        resourceType: 'human',
        role: 'team_lead',
        status: 'active',
        dailyCapacityHours: 8,
        timezone: 'Asia/Shanghai',
        skillTags: '["React","TypeScript"]',
        costPerUnitCents: 15000,
      }),
      makeResource({
        id: 2,
        name: '李工',
        resourceType: 'human',
        role: 'member',
        status: 'active',
        dailyCapacityHours: 8,
      }),
      makeResource({
        id: 3,
        name: '双路 GPU 服务器',
        resourceType: 'equipment',
        role: 'owner',
        status: 'active',
        dailyCapacityHours: 24,
        timezone: 'UTC',
        costPerUnitCents: 99999,
      }),
      makeResource({
        id: 4,
        name: '差旅预算池',
        resourceType: 'budget',
        role: 'project_manager',
        status: 'active',
        dailyCapacityHours: 0,
      }),
      makeResource({
        id: 5,
        name: '结构钢 12mm',
        resourceType: 'material',
        role: 'viewer',
        status: 'inactive',
        dailyCapacityHours: 0,
      }),
    ],
    allocations: new Map([[2, [makeAllocation({})]]]),
    failListOnce: false,
    ...overrides,
  }

  const route = (
    path: string,
    method: string,
    body: Record<string, unknown> | null,
  ): Response | null => {
    // 资源底册
    const listMatch = /^\/projects\/42\/resources(\?|$)/.exec(path)
    if (listMatch && method === 'GET') {
      if (state.failListOnce) {
        state.failListOnce = false
        return jsonResponse(500, { error: { code: 'INTERNAL', message: '底册服务异常' } })
      }
      return jsonResponse(200, {
        data: state.resources,
        meta: { total: state.resources.length, page: 1, perPage: 200, totalPages: 1 },
      })
    }
    // 单资源 PATCH（停用/启用）
    const patchMatch = /^\/projects\/42\/resources\/(\d+)$/.exec(path)
    if (patchMatch && method === 'PATCH') {
      const id = Number(patchMatch[1])
      const target = state.resources.find((item) => item.id === id)
      if (!target) return null
      const next = { ...target, ...(body as Partial<Resource>) }
      state.resources = state.resources.map((item) => (item.id === id ? next : item))
      return jsonResponse(200, { data: next })
    }
    // 单资源 DELETE
    const deleteMatch = /^\/projects\/42\/resources\/(\d+)$/.exec(path)
    if (deleteMatch && method === 'DELETE') {
      const id = Number(deleteMatch[1])
      state.resources = state.resources.filter((item) => item.id !== id)
      return jsonResponse(204, null)
    }
    // 资源分配预检（删除两步流）
    const allocMatch = /^\/projects\/42\/resources\/(\d+)\/allocations(\?|$)/.exec(path)
    if (allocMatch && method === 'GET') {
      const resourceId = Number(allocMatch[1])
      const list = state.allocations.get(resourceId) ?? []
      return jsonResponse(200, {
        data: list,
        meta: { total: list.length, page: 1, perPage: 200, totalPages: 1 },
      })
    }
    return null
  }

  return { state, route }
}

function renderTable(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

afterEach(() => {
  resetFetchRouter()
})

describe('ResourceListTable：全类型资源渲染与双视图切换', () => {
  test('表格视图渲染 human/material/equipment/budget 全部条目与规格字段', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderTable(<ResourceListTable projectId={42} canManage={true} />)

    expect(document.querySelector('[data-resource-list-skeleton]')).not.toBeNull()
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(5))

    // 全类型徽章
    const typeOf = (id: number) =>
      document.querySelector(`[data-resource-row="${id}"] [data-resource-type]`)?.textContent
    expect(typeOf(1)).toBe('人员')
    expect(typeOf(3)).toBe('设备')
    expect(typeOf(4)).toBe('预算')
    expect(typeOf(5)).toBe('物料')

    // 角色 / 容量 / 时区 / 单价 / 技能胶囊
    const row1 = document.querySelector('[data-resource-row="1"]')
    expect(row1?.textContent).toContain('团队负责人')
    expect(row1?.textContent).toContain('8h')
    expect(row1?.textContent).toContain('Asia/Shanghai')
    expect(row1?.textContent).toContain('¥150.00')
    expect(row1?.querySelectorAll('[data-resource-skill-tag]')).toHaveLength(2)
    // 状态徽章
    expect(
      document.querySelector('[data-resource-row="5"] [data-resource-status]')?.textContent,
    ).toBe('停用')
    expect(
      document.querySelector('[data-resource-row="1"] [data-resource-status]')?.textContent,
    ).toBe('活跃')
  })

  test('表格 ↔ 卡片视图切换：偏好存组件状态，数据完整迁移', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderTable(<ResourceListTable projectId={42} canManage={true} />)
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(5))

    fireEvent.click(document.querySelector('[data-resource-mode-cards]') as Element)
    await waitFor(() => expect(document.querySelectorAll('[data-resource-card]')).toHaveLength(5))
    expect(document.querySelector('[data-resource-row]')).toBeNull()
    expect(document.querySelector('[data-resource-card="3"]')?.textContent).toContain(
      '双路 GPU 服务器',
    )
    expect(document.querySelector('[data-resource-card="3"]')?.textContent).toContain('¥999.99')

    fireEvent.click(document.querySelector('[data-resource-mode-table]') as Element)
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(5))
    expect(document.querySelector('[data-resource-card]')).toBeNull()
  })
})

describe('ResourceListTable：类型 / 状态 / 名称即时过滤', () => {
  test('选择「人员」类型仅保留 human 条目（spec 场景「浏览项目资源底册并按类型过滤」）', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderTable(<ResourceListTable projectId={42} canManage={true} />)
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(5))

    fireEvent.change(document.querySelector('[data-resource-type-filter]') as Element, {
      target: { value: 'human' },
    })
    expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(2)
    expect(screen.getByText('张工')).toBeInTheDocument()
    expect(screen.getByText('李工')).toBeInTheDocument()
    expect(screen.queryByText('双路 GPU 服务器')).not.toBeInTheDocument()
  })

  test('按状态过滤停用 + 名称模糊检索交集', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderTable(<ResourceListTable projectId={42} canManage={true} />)
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(5))

    fireEvent.change(document.querySelector('[data-resource-status-filter]') as Element, {
      target: { value: 'inactive' },
    })
    expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(1)
    expect(document.querySelector('[data-resource-row="5"]')).not.toBeNull()

    fireEvent.change(document.querySelector('[data-resource-type-filter]') as Element, {
      target: { value: 'equipment' },
    })
    fireEvent.change(document.querySelector('[data-resource-status-filter]') as Element, {
      target: { value: '' },
    })
    fireEvent.change(document.querySelector('[data-resource-keyword-input]') as Element, {
      target: { value: 'GPU' },
    })
    expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(1)
    expect(document.querySelector('[data-resource-row="3"]')).not.toBeNull()

    // 无命中空态与清除筛选
    fireEvent.change(document.querySelector('[data-resource-keyword-input]') as Element, {
      target: { value: '不存在的资源' },
    })
    expect(document.querySelector('[data-resource-list-empty-filtered]')).not.toBeNull()
    fireEvent.click(document.querySelector('[data-resource-filter-reset]') as Element)
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(5))
  })
})

describe('ResourceListTable：行内停用/启用（PATCH）', () => {
  test('停用活跃资源：PATCH status=inactive，成功后徽章更新为「停用」', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderTable(<ResourceListTable projectId={42} canManage={true} />)
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(5))

    fireEvent.click(document.querySelector('[data-resource-toggle="1"]') as Element)
    await waitFor(() =>
      expect(
        document.querySelector('[data-resource-row="1"] [data-resource-status]')?.textContent,
      ).toBe('停用'),
    )
    const patch = records.find((record) => record.method === 'PATCH')
    expect(patch?.url).toBe('/projects/42/resources/1')
    expect(patch?.body).toMatchObject({ status: 'inactive' })

    // 停用条目可再启用（双向切换）
    fireEvent.click(document.querySelector('[data-resource-toggle="1"]') as Element)
    await waitFor(() =>
      expect(
        document.querySelector('[data-resource-row="1"] [data-resource-status]')?.textContent,
      ).toBe('活跃'),
    )
  })
})

describe('ResourceListTable：安全删除两步流（未结分配校验）', () => {
  test('删除承担任务分配的资源：阻断提示且零 DELETE（spec 删除校验铁律）', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderTable(<ResourceListTable projectId={42} canManage={true} />)
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(5))

    fireEvent.click(document.querySelector('[data-resource-delete-open="2"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-resource-delete-block]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-resource-delete-dialog-title]')?.textContent).toBe(
      '删除被阻断',
    )
    expect(document.querySelector('[data-resource-delete-block]')?.textContent).toContain('1')
    expect(document.querySelector('[data-resource-delete-block]')?.textContent).toContain(
      '请先在分配视图中解除关联后再删除',
    )
    // 阻断态无确认删除按钮
    expect(document.querySelector('[data-resource-delete-confirm-ok]')).toBeNull()
    // 关闭（知道了）
    fireEvent.click(document.querySelector('[data-resource-delete-cancel]') as Element)
    await waitFor(() => expect(document.querySelector('[data-resource-delete-dialog]')).toBeNull())
    expect(records.filter((record) => record.method === 'DELETE')).toHaveLength(0)
  })

  test('删除无分配资源：二次确认后调用 DELETE 并即时移除行', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderTable(<ResourceListTable projectId={42} canManage={true} />)
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(5))

    fireEvent.click(document.querySelector('[data-resource-delete-open="1"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-resource-delete-confirm]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-resource-delete-confirm]')?.textContent).toContain('张工')

    // 取消不发请求
    fireEvent.click(document.querySelector('[data-resource-delete-cancel]') as Element)
    await waitFor(() => expect(document.querySelector('[data-resource-delete-dialog]')).toBeNull())
    expect(records.filter((record) => record.method === 'DELETE')).toHaveLength(0)

    // 再次打开并确认删除
    fireEvent.click(document.querySelector('[data-resource-delete-open="1"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-resource-delete-confirm-ok]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-resource-delete-confirm-ok]') as Element)
    await waitFor(() => expect(document.querySelector('[data-resource-delete-dialog]')).toBeNull())
    const del = records.find((record) => record.method === 'DELETE')
    expect(del?.url).toBe('/projects/42/resources/1')
    // 行从底册移除（列表刷新后仅 4 行）
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(4))
    expect(screen.queryByText('张工')).not.toBeInTheDocument()
  })
})

describe('ResourceListTable：只读权限操作置灰（RL-06）', () => {
  test('无 resource:manage：停用/删除按钮锁定为只读占位，点击零写请求且零分配预检', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderTable(<ResourceListTable projectId={42} canManage={false} />)
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(5))

    expect(document.querySelector('[data-resource-toggle="1"]')).toBeNull()
    expect(document.querySelector('[data-resource-delete-open="1"]')).toBeNull()
    expect(document.querySelector('[data-resource-toggle-readonly="1"]')).not.toBeNull()
    expect(document.querySelector('[data-resource-delete-readonly="1"]')).not.toBeNull()

    // 只读占位不可点击（span 无 onClick；兜底 fireEvent.click 不应打开任何弹窗）
    fireEvent.click(document.querySelector('[data-resource-toggle-readonly="1"]') as Element)
    fireEvent.click(document.querySelector('[data-resource-delete-readonly="1"]') as Element)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(document.querySelector('[data-resource-delete-dialog]')).toBeNull()
    expect(records.filter((record) => record.method !== 'GET')).toHaveLength(0)
    // 只读场景连分配预检也不应发生（底册 GET + 预检 GET 都没有）
    expect(records.some((record) => record.url.includes('/allocations'))).toBe(false)
  })
})

describe('ResourceListTable：三态闭环（骨架 / 错误重试 / 空态）', () => {
  test('列表 500 错误渲染警示卡，点击重试恢复', async () => {
    const backend = createBackend({ failListOnce: true })
    installFetchRouter(backend.route)
    renderTable(<ResourceListTable projectId={42} canManage={true} />)

    await waitFor(() => expect(document.querySelector('[data-resource-list-error]')).not.toBeNull())
    expect(screen.getByText(/资源底册加载失败/)).toBeInTheDocument()
    fireEvent.click(document.querySelector('[data-resource-list-retry]') as Element)
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(5))
    expect(document.querySelector('[data-resource-list-error]')).toBeNull()
  })

  test('空项目资源：语义化空态 + 新建首个资源引导（仅写权限可见）', async () => {
    const backend = createBackend({ resources: [] })
    installFetchRouter(backend.route)
    const onCreate = vi.fn()
    renderTable(<ResourceListTable projectId={42} canManage={true} onCreateResource={onCreate} />)

    await waitFor(() => expect(document.querySelector('[data-resource-list-empty]')).not.toBeNull())
    expect(screen.getByText('当前项目暂无资源')).toBeInTheDocument()
    fireEvent.click(document.querySelector('[data-resource-empty-create]') as Element)
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  test('空项目 + 只读：展示空态但不暴露新建引导按钮', async () => {
    const backend = createBackend({ resources: [] })
    installFetchRouter(backend.route)
    renderTable(<ResourceListTable projectId={42} canManage={false} />)
    await waitFor(() => expect(document.querySelector('[data-resource-list-empty]')).not.toBeNull())
    expect(document.querySelector('[data-resource-empty-create]')).toBeNull()
  })
})
