/**
 * v3-ui-next-org-portfolio-domains W7 · tasks 7.7/7.8 —— 全局资源 Hub 与页面装配测试
 * （真实页面 /next/resources + 真实 hooks + 伪后端）。
 *
 * 覆盖（spec「全局资源入口、技能矩阵与问题风险入口」场景 / design Decision 7）：
 * - 未显式选择项目：引导空态且**零项目资源请求**（旧轨「默认选中首个项目」缺陷
 *   回归锁定）；
 * - 显式选择后按 URL `?projectId=` 恢复并加载负荷摘要与类型分布；
 * - 无资源查看权（仅 org:view）：所选项目卡呈受限态、零项目资源请求（RL-06）；
 * - 深链跳转：项目资源工作台 /next/projects/:id/resources、组织资源池、技能矩阵；
 * - 失效项目引用（不在可见列表）：中性「项目不存在或已被移除」（RL-05）；
 * - 页面无权限横幅物理阻断 + 底层接口零请求；项目列表 5xx 错误可重试。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import GlobalResourcesPage from '@/app/(next)/next/resources/page'
import type { Project } from '@/lib/api/projects'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
const spMock = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/resources',
  useParams: () => ({}),
  useSearchParams: () => spMock.value,
}))

// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  url: string
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

type RouteFn = (path: string, method: string) => Response | null

function installFetchRouter(route: RouteFn): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })
    const matched = route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetch() {
  vi.unstubAllGlobals()
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

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
    name: '商城重构',
    code: 'MALL-42',
    description: null,
    category: null,
    status: 'active',
    priority: 'high',
    startDate: '2026-09-01',
    endDate: '2026-12-31',
    budgetCents: null,
    currency: null,
    progressPercent: 30,
    healthStatus: 'healthy',
    settings: null,
    createdBy: 1,
    updatedBy: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  }
}

function makeResource(overrides: Partial<Record<string, unknown>> & { id: number }) {
  return {
    id: overrides.id,
    projectId: 42,
    userId: null,
    name: overrides.name ?? `资源 ${overrides.id}`,
    email: null,
    resourceType: overrides.resourceType ?? 'human',
    role: 'member',
    status: 'active',
    dailyCapacityHours: 8,
    skillTags: null,
    workDays: '1,2,3,4,5',
    timezone: 'Asia/Shanghai',
    costPerUnitCents: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
  }
}

function makeLoadRow(resourceId: number, resourceName: string, utilization: number) {
  return {
    resourceId,
    resourceName,
    role: 'member',
    dailyCapacityHours: 8,
    days: [],
    overallUtilizationPercent: utilization,
  }
}

function projectsPayload(projects: Project[]) {
  return { data: projects, meta: { total: projects.length, page: 1, perPage: 200, totalPages: 1 } }
}

function createHubBackend(
  options: { projects?: Project[]; projectListError?: boolean } = {},
): RouteFn {
  const projects = options.projects ?? [makeProject()]
  return (path: string, method: string): Response | null => {
    if (method !== 'GET') return null
    if (path.startsWith('/projects?') || path === '/projects') {
      if (options.projectListError) {
        return jsonResponse(500, { error: { code: 'INTERNAL_SERVER_ERROR', message: 'boom' } })
      }
      return jsonResponse(200, projectsPayload(projects))
    }
    if (/^\/projects\/42\/resources(\?|$)/.test(path)) {
      return jsonResponse(200, {
        data: [
          makeResource({ id: 1, name: '张工', resourceType: 'human' }),
          makeResource({ id: 2, name: '叉车', resourceType: 'equipment' }),
        ],
        meta: { total: 2, page: 1, perPage: 200, totalPages: 1 },
      })
    }
    if (/^\/projects\/42\/resources\/load(\?|$)/.test(path)) {
      return jsonResponse(200, {
        data: {
          from: '2026-09-01',
          to: '2026-09-30',
          resources: [
            makeLoadRow(1, '张工', 80),
            makeLoadRow(2, '李四', 115),
            makeLoadRow(3, '王五', 100),
          ],
          teamAverageUtilizationPercent: 98.3,
        },
      })
    }
    return null
  }
}

function projectResourceRequestCount(records: RequestRecord[]): number {
  return records.filter((record) => /^\/projects\/\d+\/resources/.test(record.url)).length
}

function writeMethods(records: RequestRecord[]): string[] {
  return records.filter((record) => record.method !== 'GET').map((record) => record.method)
}

beforeEach(() => {
  spMock.value = new URLSearchParams()
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId: null,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: false,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
})

afterEach(() => {
  resetFetch()
})

describe('页面准入门禁（RL-06 防探测）', () => {
  test('无 org:view / resource:view / portfolio:view：受限横幅 + 底层接口零请求', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    renderWithClient(<GlobalResourcesPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(document.body.textContent).toContain('你没有查看全局资源的权限')
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(records).toHaveLength(0)
  })
})

describe('显式项目选择（旧轨「默认首个项目」缺陷不回迁）', () => {
  test('未选择项目：引导空态 + 仅项目列表请求、项目资源请求恒为 0', async () => {
    setAuth(['resource:view'])
    const { records } = installFetchRouter(createHubBackend())
    renderWithClient(<GlobalResourcesPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-global-resources-guide]')).not.toBeNull(),
    )
    expect(screenText()).toContain('尚未选择项目')
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(projectResourceRequestCount(records)).toBe(0)
    expect(writeMethods(records)).toEqual([])
  })

  test('从选择器显式选择项目：写回 URL 并加载负荷摘要与类型分布（KPI + 超载成员 + 类型芯片）', async () => {
    setAuth(['resource:view'])
    const { records } = installFetchRouter(createHubBackend())
    renderWithClient(<GlobalResourcesPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-global-resources-project-select]')).not.toBeNull(),
    )
    // 等选项就绪后再触发选择（select 值写入需要存在对应 option）
    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-global-resources-project-select] option').length,
      ).toBeGreaterThan(1),
    )
    fireEvent.change(document.querySelector('[data-global-resources-project-select]')!, {
      target: { value: '42' },
    })
    expect(navMock.push).toHaveBeenCalledWith(expect.stringContaining('projectId=42'))

    await waitFor(() =>
      expect(document.querySelector('[data-resource-summary-card]')).not.toBeNull(),
    )
    // 负荷 KPI：成员 3、活跃 2、平均利用率 98.3%、超载 1
    expect(document.querySelector('[data-summary-kpi="members"]')?.textContent).toContain('3')
    expect(document.querySelector('[data-summary-kpi="active"]')?.textContent).toContain('2')
    expect(document.querySelector('[data-summary-kpi="utilization"]')?.textContent).toContain(
      '98.3%',
    )
    expect(document.querySelector('[data-summary-kpi="overloaded"]')?.textContent).toContain('1')
    // 超载成员芯片（李四 115%）
    expect(document.querySelectorAll('[data-resource-overloaded-member]')).toHaveLength(1)
    expect(document.querySelector('[data-resource-overloaded-member="2"]')?.textContent).toContain(
      '115%',
    )
    // 类型分布芯片
    expect(document.querySelector('[data-resource-type-chip="human"]')?.textContent).toContain(
      '人员',
    )
    expect(document.querySelector('[data-resource-type-chip="equipment"]')?.textContent).toContain(
      '设备',
    )
    expect(writeMethods(records)).toEqual([])
  })

  test('URL ?projectId= 记忆恢复：刷新直达所选项目摘要（restorable）', async () => {
    setAuth(['resource:view', 'portfolio:view'])
    spMock.value = new URLSearchParams('projectId=42')
    const { records } = installFetchRouter(createHubBackend())
    renderWithClient(<GlobalResourcesPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-resource-summary-card]')).not.toBeNull(),
    )
    expect(
      (document.querySelector('[data-global-resources-project-select]') as HTMLSelectElement).value,
    ).toBe('42')
    expect(screenText()).toContain('商城重构')
    expect(projectResourceRequestCount(records)).toBeGreaterThan(0)
  })

  test('深链跳转：项目资源工作台 /next/projects/42/resources（B6d 已迁）', async () => {
    setAuth(['resource:view', 'portfolio:view'])
    spMock.value = new URLSearchParams('projectId=42')
    installFetchRouter(createHubBackend())
    renderWithClient(<GlobalResourcesPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-resource-summary-open]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-resource-summary-open]')!)
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/resources')
  })

  test('组织资源池 / 技能矩阵深链按钮可达', async () => {
    setAuth(['resource:view'])
    installFetchRouter(createHubBackend())
    renderWithClient(<GlobalResourcesPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-global-resources-link-pool]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-global-resources-link-pool]')!)
    expect(navMock.push).toHaveBeenCalledWith('/next/organization/resource-pool')
    fireEvent.click(document.querySelector('[data-global-resources-link-skills]')!)
    expect(navMock.push).toHaveBeenCalledWith('/next/resources/skill-matrix')
  })
})

describe('受限与中性态（RL-05/RL-06）', () => {
  test('仅 org:view（无资源查看权）：项目卡受限态、零项目资源请求', async () => {
    setAuth(['org:view'])
    spMock.value = new URLSearchParams('projectId=42')
    const { records } = installFetchRouter(createHubBackend())
    renderWithClient(<GlobalResourcesPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-resource-summary-restricted]')).not.toBeNull(),
    )
    expect(screenText()).toContain('你没有查看该项目资源明细的权限')
    // 受限卡不泄露任何数值（负荷/分布零渲染）
    expect(document.querySelector('[data-summary-kpi]')).toBeNull()
    expect(document.querySelector('[data-resource-type-chip]')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(projectResourceRequestCount(records)).toBe(0)
    // 深链仍可达（目标页自行守卫 project:view + resource:view）
    expect(document.querySelector('[data-resource-summary-open]')).not.toBeNull()
  })

  test('失效项目引用（不在可见列表）：中性「项目不存在或已被移除」', async () => {
    setAuth(['resource:view', 'portfolio:view'])
    spMock.value = new URLSearchParams('projectId=999')
    const { records } = installFetchRouter(createHubBackend())
    renderWithClient(<GlobalResourcesPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-global-resources-project-missing]')).not.toBeNull(),
    )
    expect(screenText()).toContain('项目不存在或已被移除')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(projectResourceRequestCount(records)).toBe(0)
  })

  test('项目列表 5xx：错误态可重试并恢复', async () => {
    setAuth(['resource:view'])
    const { records } = installFetchRouter(createHubBackend({ projectListError: true }))
    renderWithClient(<GlobalResourcesPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-global-resources-error]')).not.toBeNull(),
    )
    expect(screenText()).toContain('项目列表加载失败')
    expect(records.some((record) => record.url.startsWith('/projects'))).toBe(true)
  })
})

function screenText(): string {
  return document.body.textContent ?? ''
}
