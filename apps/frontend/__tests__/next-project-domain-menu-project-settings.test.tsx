/**
 * v3-ui-next-settings-admin-domains W8 · tasks 8.6 —— 项目功能域菜单「项目设置」
 * 入口测试（design D-PROJ / spec「项目设置（工作日历）」入口条款）。
 *
 * 覆盖：
 * - 治理与分析分组新增「项目设置」条目（含说明微标与图标），点击直达
 *   `/next/projects/:id/settings`；
 * - 既有分组与条目次序不被破坏（增量追加，协同组三条目保持不变）；
 * - LensSwitcher 排程镜头切换时菜单解耦不变（镜头清单不混入项目设置）；
 * - 项目设置页在「菜单入口」与「直接 URL」双通道可达。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  PROJECT_DOMAIN_MENU_ENTRIES,
  PROJECT_DOMAIN_MENU_GROUPS,
  ProjectDomainMenu,
} from '@/components/next/project-space/ProjectDomainMenu'
import {
  LENS_SWITCHER_OPTIONS,
  LensSwitcher,
  type ProjectSpaceLensId,
} from '@/components/next/project-space/LensSwitcher'
import ProjectSettingsDomainPage from '@/app/(next)/next/projects/[id]/settings/page'
import { useAuthStore } from '@/stores/auth-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import type { ChangeRequestListResponse } from '@/lib/api/change-requests'
import type { RiskWorkbenchSummary } from '@/lib/api/risks-v2'
import type { Project } from '@/lib/api/projects'

const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42',
  useParams: () => ({ id: '42' }),
  useSearchParams: () => new URLSearchParams(),
}))

const risksV2Mock = vi.hoisted(() => ({ getRiskSummary: vi.fn() }))
vi.mock('@/lib/api/risks-v2', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/risks-v2')>()
  return { ...original, getRiskSummary: risksV2Mock.getRiskSummary }
})

const changeRequestsApiMock = vi.hoisted(() => ({ listChangeRequests: vi.fn() }))
vi.mock('@/lib/api/change-requests', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/change-requests')>()
  return { ...original, listChangeRequests: changeRequestsApiMock.listChangeRequests }
})

const API_PREFIX = 'http://localhost:3333/api/v1'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function makeProject(): Project {
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
  }
}

function makeSummary(): RiskWorkbenchSummary {
  return {
    totalRisks: 0,
    openRisks: 0,
    highRiskCount: 0,
    criticalRiskCount: 0,
    overdueReviewCount: 0,
    incompleteResponsePlans: 0,
    trend30d: { created: 0, closed: 0 },
    healthScore: 90,
    topRisks: [],
  }
}

function makeChangeList(): ChangeRequestListResponse {
  return { data: [], meta: { total: 0, page: 1, perPage: 1, totalPages: 1 } }
}

function installApi() {
  risksV2Mock.getRiskSummary.mockResolvedValue({ data: makeSummary() })
  changeRequestsApiMock.listChangeRequests.mockResolvedValue(makeChangeList())
}

function renderMenu(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function setAuth(permissions: string[]) {
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
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function installProjectBackend() {
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    if (method === 'GET' && path === '/projects/42') {
      return jsonResponse(200, { data: makeProject() })
    }
    if (method === 'GET' && path === '/projects/42/working-calendar') {
      return jsonResponse(200, {
        data: { version: 1, workdays: [1, 2, 3, 4, 5], holidays: [], extraWorkdays: [] },
      })
    }
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'not stubbed' } })
  }) as typeof fetch)
}

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  risksV2Mock.getRiskSummary.mockReset()
  changeRequestsApiMock.listChangeRequests.mockReset()
  useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('治理分组「项目设置」条目（tasks 8.5/8.6）', () => {
  test('治理与分析分组追加「项目设置」：分组次序与既有条目保持（增量追加）', () => {
    expect(PROJECT_DOMAIN_MENU_GROUPS.map((group) => group.id)).toEqual([
      'collaboration',
      'governance',
    ])
    expect(PROJECT_DOMAIN_MENU_GROUPS[0]?.entries.map((entry) => entry.id)).toEqual([
      'resources',
      'members',
      'files',
    ])
    expect(PROJECT_DOMAIN_MENU_GROUPS[1]?.entries.map((entry) => entry.id)).toEqual([
      'risks',
      'change-requests',
      'reports',
      'charts',
      'project-settings',
    ])
    expect(PROJECT_DOMAIN_MENU_ENTRIES).toHaveLength(8)
    const entry = PROJECT_DOMAIN_MENU_ENTRIES.find((item) => item.id === 'project-settings')
    expect(entry?.label).toBe('项目设置')
    expect(entry?.icon).toBe('Settings2')
  })

  test('展开菜单：项目设置条目在治理组内呈现并点击直达 /next/projects/42/settings', () => {
    installApi()
    renderMenu(<ProjectDomainMenu projectId={42} />)
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))

    const item = screen.getByRole('menuitem', { name: /项目设置/ })
    expect(item).toHaveAttribute('data-domain-id', 'project-settings')
    expect(item.textContent).toContain('工作日历')
    expect(item.querySelector('svg')).not.toBeNull()

    const governance = document.querySelector('[data-domain-group="governance"]')
    expect(governance?.querySelector('[data-domain-id="project-settings"]')).not.toBeNull()
    expect(document.querySelectorAll('[data-project-domain-item]')).toHaveLength(8)
    expect(governance?.querySelectorAll('[data-project-domain-item]')).toHaveLength(5)

    fireEvent.click(item)
    expect(navMock.push).toHaveBeenLastCalledWith('/next/projects/42/settings')
  })

  test('「项目设置」条目不带动态徽标（计数仍只归属风险/变更/报表）', async () => {
    installApi()
    renderMenu(<ProjectDomainMenu projectId={42} pendingReviewCount={2} />)
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))

    const item = screen.getByRole('menuitem', { name: /项目设置/ })
    expect(item.querySelector('[data-domain-alert-badge]')).toBeNull()
    expect(item.querySelector('[data-domain-cr-badge]')).toBeNull()
    expect(item.querySelector('[data-domain-pending-badge]')).toBeNull()
    await waitFor(() =>
      expect(document.querySelector('[data-domain-alert-badge]')?.textContent).toBe('0 项高危'),
    )
  })
})

describe('与 LensSwitcher 六镜头解耦（tasks 8.6）', () => {
  test('镜头切换器清单不混入 project-settings；镜头切换后菜单入口仍独立可用', () => {
    const onSelect = vi.fn()
    render(
      <div>
        <LensSwitcher activeLensId="kanban" onSelect={onSelect} />
        <ProjectDomainMenu projectId={42} />
      </div>,
    )

    const lensIds = LENS_SWITCHER_OPTIONS.map((option) => option.id)
    expect(lensIds).toEqual(['kanban', 'gantt', 'wbs', 'list', 'calendar', 'timeline'])
    expect(lensIds).not.toContain('project-settings')

    fireEvent.click(screen.getByRole('button', { name: '甘特图' }))
    expect(onSelect).toHaveBeenCalledWith('gantt' satisfies ProjectSpaceLensId)

    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /项目设置/ }))
    expect(navMock.push).toHaveBeenLastCalledWith('/next/projects/42/settings')
  })
})

describe('项目设置双通道可达（tasks 8.6）', () => {
  test('菜单入口与直接 URL 两通道均抵达同一页面', async () => {
    installApi()
    installProjectBackend()
    setAuth(['project:view', 'project:update'])

    // 通道一：功能域菜单点击 → 记录目标路由
    const menu = renderMenu(<ProjectDomainMenu projectId={42} />)
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /项目设置/ }))
    expect(navMock.push).toHaveBeenLastCalledWith('/next/projects/42/settings')
    menu.unmount()

    // 通道二：直接 URL 渲染同一页面（真实页面组件）
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ProjectSettingsDomainPage />
      </QueryClientProvider>,
    )
    await waitFor(() =>
      expect(document.querySelector('[data-project-settings-workspace]')).not.toBeNull(),
    )
    expect(useProjectSpaceEntityStore.getState().entityTitle).toBe('开项核心引擎 · 项目设置')
  })
})
