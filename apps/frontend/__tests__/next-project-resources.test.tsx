/**
 * v3-ui-next-resource-team-domains W1 · tasks 1.10 —— 资源工作台页面端到端装配测试
 * （/next/projects/:id/resources 页面级 + 全局伪后端）。
 *
 * 覆盖（spec「资源域工作空间与资源列表管理」/ RBAC & RL-05 场景）：
 * - 完整装配：骨架 → DomainPageHeader（项目名 × 领域名）+ 面包屑 entity-store 注册；
 * - 三子视图切换：List 底册 / Allocations 分配（选择器 + 明细面板）/ Load 紧凑负荷
 *   HUD（仅按需挂载，load 端点仅在进入 Load 视图时发出）；
 * - 资源行展开 → 即时拉取分配明细（任务标题映射）；
 * - 新建资源抽屉 → POST → 列表缓存失效并追加新行；
 * - 无权访问（缺 project:view 或 resource:view）：受限横幅 + 零业务请求（RL-06）；
 * - 跨组织 / 项目不存在 / 非数字 ID：中性 404「项目不存在或已被移除」，零 403
 *   暴露（RL-05）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import ProjectResourcesDomainPage from '@/app/(next)/next/projects/[id]/resources/page'
import { useAuthStore } from '@/stores/auth-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import type { Project } from '@/lib/api/projects'
import type { Resource, ResourceAllocation, ResourceLoadItem } from '@/lib/api/resources'
import type { Task } from '@/lib/api/tasks'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const paramsMock = vi.hoisted(() => ({ value: { id: '42' } as { id: string } }))
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/resources',
  useParams: () => paramsMock.value,
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// 会话 & 夹具
// ---------------------------------------------------------------------------
function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: organizationId,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 42,
    organizationId: 1,
    name: '开项核心引擎',
    code: 'PROJ-042',
    description: null,
    category: null,
    status: 'active',
    priority: 'high',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    budgetCents: null,
    currency: null,
    progressPercent: 35,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  }
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
    id: 901,
    resourceId: 1,
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
    name: '核心模块开发',
    description: null,
    status: 'in_progress',
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

/** 团队负荷成员：10 天样本，首日自定义其余按日容量 8h（首日 4 → 正常 95%；首日 160 → 超载）。 */
function makeLoadItem(
  resourceId: number,
  resourceName: string,
  firstDayAllocated: number,
): ResourceLoadItem {
  return {
    resourceId,
    resourceName,
    role: 'member',
    dailyCapacityHours: 8,
    days: Array.from({ length: 10 }, (_, index) => ({
      date: `2026-09-${String(index + 1).padStart(2, '0')}`,
      totalAllocatedPercent: 0,
      capacityHours: 8,
      allocatedHours: index === 0 ? firstDayAllocated : 8,
    })),
    overallUtilizationPercent: 0,
  }
}

// ---------------------------------------------------------------------------
// 伪后端（资源域页面全量端点）
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

function paginated(data: unknown[], total?: number) {
  return { data, meta: { total: total ?? data.length, page: 1, perPage: 200, totalPages: 1 } }
}

/** 团队负荷响应（与 ResourceLoadCompactView 契约一致）。 */
function teamLoadResponse(resources: ResourceLoadItem[]) {
  return {
    from: '2026-08-01',
    to: '2026-08-30',
    resources,
    teamAverageUtilizationPercent: 92.5,
  }
}

interface BackendState {
  project: Project
  resources: Resource[]
  allocationsByResource: Map<number, ResourceAllocation[]>
  tasks: Task[]
  projectMissing: boolean
  nextResourceId: number
  failProjectOnce: boolean
}

function createBackend(overrides: Partial<BackendState> = {}) {
  const state: BackendState = {
    project: makeProject(),
    resources: [
      makeResource({
        id: 1,
        name: '张工',
        resourceType: 'human',
        role: 'team_lead',
        dailyCapacityHours: 8,
      }),
      makeResource({
        id: 3,
        name: '双路 GPU 服务器',
        resourceType: 'equipment',
        role: 'owner',
        dailyCapacityHours: 24,
        timezone: 'UTC',
        costPerUnitCents: 99999,
      }),
    ],
    allocationsByResource: new Map<number, ResourceAllocation[]>([
      [1, [makeAllocation({ id: 901, resourceId: 1, taskId: 501, allocationPercent: 50 })]],
    ]),
    tasks: [
      makeTask({ id: 501, status: 'in_progress' }),
      makeTask({ id: 502, name: '性能调优', status: 'not_started' }),
    ],
    projectMissing: false,
    nextResourceId: 10,
    failProjectOnce: false,
    ...overrides,
  }

  const loadTeam = () =>
    teamLoadResponse([makeLoadItem(1, '张工', 100), makeLoadItem(3, '双路 GPU 服务器', 160)])

  const route = (
    path: string,
    method: string,
    body: Record<string, unknown> | null,
  ): Response | null => {
    // 项目详情（RL-05 判定源）
    if (path === '/projects/42' && method === 'GET') {
      if (state.projectMissing || state.failProjectOnce) {
        state.failProjectOnce = false
        return jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: '项目不存在' } })
      }
      return jsonResponse(200, { data: state.project })
    }
    // 负荷（Load 视图，view=team）
    if (/^\/projects\/42\/resources\/load(\?|$)/.test(path) && method === 'GET') {
      return jsonResponse(200, { data: loadTeam() })
    }
    // 任务底册（分配明细标题映射）
    if (/^\/projects\/42\/tasks(\?|$)/.test(path) && method === 'GET') {
      return jsonResponse(200, paginated(state.tasks))
    }
    // 资源底册
    if (/^\/projects\/42\/resources(\?|$)/.test(path) && method === 'GET') {
      return jsonResponse(200, paginated(state.resources))
    }
    // 新建资源
    if (/^\/projects\/42\/resources(\?|$)/.test(path) && method === 'POST') {
      const created = makeResource({
        id: state.nextResourceId++,
        name: String(body?.name),
        resourceType: (body?.resourceType as Resource['resourceType']) ?? 'human',
        role: (body?.role as Resource['role']) ?? 'member',
        dailyCapacityHours: Number(body?.dailyCapacityHours ?? 8),
        timezone: String(body?.timezone ?? 'Asia/Shanghai'),
        skillTags:
          Array.isArray(body?.skillTags) && (body?.skillTags as string[]).length > 0
            ? JSON.stringify(body?.skillTags)
            : null,
      })
      state.resources = [...state.resources, created]
      return jsonResponse(200, { data: created })
    }
    // 资源分配列表
    const allocListMatch = /^\/projects\/42\/resources\/(\d+)\/allocations(\?|$)/.exec(path)
    if (allocListMatch && method === 'GET') {
      const resourceId = Number(allocListMatch[1])
      const list = state.allocationsByResource.get(resourceId) ?? []
      return jsonResponse(200, paginated(list))
    }
    // 新建分配
    if (/^\/projects\/42\/resources\/(\d+)\/allocations(\?|$)/.test(path) && method === 'POST') {
      const resourceId = Number(/^\/projects\/42\/resources\/(\d+)\/allocations/.exec(path)?.[1])
      const created = makeAllocation({
        id: 950,
        resourceId,
        taskId: Number(body?.taskId),
        allocationPercent: Number(body?.allocationPercent ?? 50),
      })
      state.allocationsByResource.set(resourceId, [
        ...(state.allocationsByResource.get(resourceId) ?? []),
        created,
      ])
      return jsonResponse(200, { data: created })
    }
    return null
  }

  return { state, route, loadTeam }
}

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function writeMethods(records: RequestRecord[]): string[] {
  return records.filter((record) => record.method !== 'GET').map((record) => record.method)
}

beforeEach(() => {
  paramsMock.value = { id: '42' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
})

afterEach(() => {
  resetFetchRouter()
})

describe('ProjectResourcesDomainPage：完整装配与子视图切换', () => {
  test('骨架 → 工作台 + DomainPageHeader + 面包屑注册 + 底册渲染', async () => {
    setAuth(['project:view', 'resource:view', 'resource:manage'])
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPage(<ProjectResourcesDomainPage />)

    expect(document.querySelector('[data-project-space-skeleton]')).not.toBeNull()
    await waitFor(() =>
      expect(document.querySelector('[data-project-resources-workspace]')).not.toBeNull(),
    )
    // 页头：项目名 × 领域名 + 返回工作面按钮 + 领域操作插槽
    expect(screen.getByText('开项核心引擎 · 资源工作台')).toBeInTheDocument()
    expect(document.querySelector('[data-domain-back]')).not.toBeNull()
    expect(document.querySelector('[data-resource-create-open]')).not.toBeNull()
    expect(document.querySelector('[data-domain-header]')?.textContent).toContain('#PROJ-042')

    // 面包屑实体注册（NextAppShell 回显数据源）
    expect(useProjectSpaceEntityStore.getState().entityTitle).toBe('开项核心引擎 · 资源工作台')
    expect(useProjectSpaceEntityStore.getState().projectId).toBe(42)

    // 默认 List 视图：两行全类型资源
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(2))
    expect(screen.getByText('张工')).toBeInTheDocument()
    expect(screen.getByText('双路 GPU 服务器')).toBeInTheDocument()
    expect(
      document.querySelector('[data-resource-tab="list"]')?.getAttribute('aria-selected'),
    ).toBe('true')
  })

  test('三子视图切换：Load 视图按需挂载并渲染成员行与窗口；URL 全程稳定', async () => {
    setAuth(['project:view', 'resource:view', 'resource:manage'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<ProjectResourcesDomainPage />)
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(2))

    // Allocations：选择器 + 默认选中首个资源并展示明细
    fireEvent.click(document.querySelector('[data-resource-tab="allocations"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-resource-alloc-picker]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-alloc-row]')).toHaveLength(1))
    expect(
      document.querySelector('[data-alloc-row="901"] [data-alloc-task-title]')?.textContent,
    ).toBe('核心模块开发')

    // Load：切换后才发出负荷 GET
    const loadGetsBefore = records.filter((record) => record.url.includes('/resources/load')).length
    expect(loadGetsBefore).toBe(0)
    fireEvent.click(document.querySelector('[data-resource-tab="load"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-resource-load-compact]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-load-member]')).toHaveLength(2))
    expect(document.querySelector('[data-load-compact-window]')).not.toBeNull()
    expect(records.some((record) => record.url.includes('/resources/load'))).toBe(true)

    // 高密度交互纯只读：零写请求
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(writeMethods(records)).toEqual([])

    // URL 稳定（本地状态切换无路由改写）
    expect(navMock.push).not.toHaveBeenCalled()
    expect(navMock.replace).not.toHaveBeenCalled()
  })

  test('资源行展开：即时拉取分配明细（任务标题映射）', async () => {
    setAuth(['project:view', 'resource:view', 'resource:manage'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<ProjectResourcesDomainPage />)
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(2))

    const allocGetsBefore = records.filter((record) => record.url.includes('/allocations')).length
    expect(allocGetsBefore).toBe(0)
    fireEvent.click(document.querySelector('[data-resource-expand="1"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-resource-expand-row="1"]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-alloc-row]')).toHaveLength(1))
    expect(
      document.querySelector('[data-resource-expand-row="1"] [data-alloc-task-title]')?.textContent,
    ).toBe('核心模块开发')
    // 再次点击收起
    fireEvent.click(document.querySelector('[data-resource-expand="1"]') as Element)
    await waitFor(() => expect(document.querySelector('[data-resource-expand-row="1"]')).toBeNull())
  })
})

describe('ProjectResourcesDomainPage：新建资源并刷新缓存闭环', () => {
  test('填写名称保存：POST 成功后关闭抽屉并即时追加行', async () => {
    setAuth(['project:view', 'resource:view', 'resource:manage'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<ProjectResourcesDomainPage />)
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(2))

    fireEvent.click(document.querySelector('[data-resource-create-open]') as Element)
    expect(document.querySelector('[data-resource-create-panel]')).not.toBeNull()
    fireEvent.change(document.querySelector('[data-resource-create-name]') as Element, {
      target: { value: '新预算员' },
    })
    fireEvent.click(document.querySelector('[data-resource-create-submit]') as Element)

    await waitFor(() => expect(document.querySelector('[data-resource-create-panel]')).toBeNull())
    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(3))
    expect(screen.getByText('新预算员')).toBeInTheDocument()
    expect(
      records.some((record) => record.method === 'POST' && record.url === '/projects/42/resources'),
    ).toBe(true)
  })
})

describe('ProjectResourcesDomainPage：RBAC 门禁（RL-06）', () => {
  test('无 project:view：受限横幅渲染且业务请求零发出', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    renderPage(<ProjectResourcesDomainPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看该项目资源的权限')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(records).toHaveLength(0)
  })

  test('有 project:view 但缺 resource:view：受限横幅且资源接口零发出（spec RBAC 矩阵）', async () => {
    setAuth(['project:view'])
    const { records } = installFetchRouter(() => null)
    renderPage(<ProjectResourcesDomainPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(records).toHaveLength(0)
  })

  test('只读（resource:view 无 manage）：新建入口隐藏、停用/删除置灰锁定', async () => {
    setAuth(['project:view', 'resource:view'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<ProjectResourcesDomainPage />)

    await waitFor(() => expect(document.querySelectorAll('[data-resource-row]')).toHaveLength(2))
    expect(document.querySelector('[data-resource-create-open]')).toBeNull()
    expect(document.querySelector('[data-resource-toggle-readonly="1"]')).not.toBeNull()
    expect(document.querySelector('[data-resource-toggle="1"]')).toBeNull()
    expect(document.querySelector('[data-resource-delete-open="1"]')).toBeNull()

    // 只读工作台仍可切换 Load 纯只读视图
    fireEvent.click(document.querySelector('[data-resource-tab="load"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-resource-load-compact]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-load-member]')).toHaveLength(2))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(writeMethods(records)).toEqual([])
  })
})

describe('ProjectResourcesDomainPage：RL-05 跨租户中性 404 防探测', () => {
  test('跨组织项目（organizationId 不匹配）：中性 404，零资源业务请求', async () => {
    setAuth(['project:view', 'resource:view', 'resource:manage'], 2)
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<ProjectResourcesDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-project-space-empty="not_found"]')).not.toBeNull(),
    )
    expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('开项核心引擎')
    expect(document.querySelector('[data-project-space-back-home]')).not.toBeNull()
    // 零资源 / 任务 / 负荷请求（仅项目详情探测）
    expect(records.filter((record) => record.url.includes('resources'))).toEqual([])
    expect(writeMethods(records)).toEqual([])
  })

  test('项目不存在（HTTP 404）：统一中性 404', async () => {
    setAuth(['project:view', 'resource:view', 'resource:manage'])
    const backend = createBackend({ projectMissing: true })
    const { records } = installFetchRouter(backend.route)
    renderPage(<ProjectResourcesDomainPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
    expect(
      records.filter((record) => record.url.startsWith('/projects/42/resources')),
    ).toHaveLength(0)
  })

  test('非数字项目 ID：中性 404 且零网络请求（RL-05）', async () => {
    setAuth(['project:view', 'resource:view', 'resource:manage'])
    paramsMock.value = { id: 'abc' }
    const { records } = installFetchRouter(() => null)
    renderPage(<ProjectResourcesDomainPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(document.body.textContent).not.toContain('开项核心引擎')
    expect(records).toHaveLength(0)
  })
})
