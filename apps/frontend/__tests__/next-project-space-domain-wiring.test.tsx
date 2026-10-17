/**
 * v3-ui-next-risk-change-domains W3 · tasks 3.4 —— 项目空间工具栏接线与面包屑回退测试
 * （spec「项目空间内功能域导航入口与架构解耦」）。
 *
 * 覆盖：
 * - ProjectSpaceContainer 成功态头部工具栏槽位（data-project-space-toolbar-slot）内
 *   正确挂载 ProjectDomainMenu，且位于 LensSwitcher 与 ManualTaskCreateDrawer 之间，
 *   6 镜头 LensSwitcher 保持纯粹；
 * - 从项目空间点击功能域菜单「风险管理 / 变更请求」→ router.push 直达对应新轨主页；
 * - 功能域主页（风险工作台）头部「返回项目空间」→ 平滑切回 `/next/projects/:id`
 *   看板工作面（W1 已建动线，本测试验证闭环接线）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import ProjectRisksDomainPage from '@/app/(next)/next/projects/[id]/risks/page'
import { ProjectSpaceContainer } from '@/components/next/project-space/ProjectSpaceContainer'
import { kanbanApi, type KanbanColumn } from '@/lib/api/kanban'
import { useAuthStore } from '@/stores/auth-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import type { Project, ProjectMember } from '@/lib/api/projects'

// ---------------------------------------------------------------------------
// next/navigation 与 API 模块 mock（全部本地确定性桩，零真实网络）
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/risks',
  useParams: () => ({ id: '42' }),
  useSearchParams: () => new URLSearchParams(),
}))

const projectsApiMock = vi.hoisted(() => ({ get: vi.fn(), members: vi.fn() }))
vi.mock('@/lib/api/projects', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/projects')>()
  return {
    ...original,
    projectsApi: { ...original.projectsApi, get: projectsApiMock.get },
    projectMembersApi: { ...original.projectMembersApi, list: projectsApiMock.members },
  }
})

const risksV2Mock = vi.hoisted(() => ({ getRiskSummary: vi.fn(), getReviewQueue: vi.fn() }))
vi.mock('@/lib/api/risks-v2', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/risks-v2')>()
  return {
    ...original,
    getRiskSummary: risksV2Mock.getRiskSummary,
    getReviewQueue: risksV2Mock.getReviewQueue,
  }
})

const changeRequestsApiMock = vi.hoisted(() => ({ listChangeRequests: vi.fn() }))
vi.mock('@/lib/api/change-requests', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/change-requests')>()
  return { ...original, listChangeRequests: changeRequestsApiMock.listChangeRequests }
})

// ---------------------------------------------------------------------------
// 会话与夹具
// ---------------------------------------------------------------------------
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

function zeroSummary() {
  return {
    totalRisks: 0,
    openRisks: 0,
    highRiskCount: 0,
    criticalRiskCount: 0,
    overdueReviewCount: 0,
    incompleteResponsePlans: 0,
    trend30d: { created: 0, closed: 0 },
    healthScore: null,
    topRisks: [],
  }
}

function emptyChangeList() {
  return { data: [], meta: { total: 0, page: 1, perPage: 1, totalPages: 0 } }
}

let kanbanListSpy: MockInstance<typeof kanbanApi.listColumn>
let rectSpy: MockInstance<typeof Element.prototype.getBoundingClientRect>

function installKanbanSpy() {
  kanbanListSpy = vi
    .spyOn(kanbanApi, 'listColumn')
    .mockImplementation(async (_projectId: number, _column: KanbanColumn) => ({
      data: [],
      meta: { total: 0, page: 1, perPage: 25, totalPages: 0 },
    }))
  rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    return {
      x: 0,
      y: 0,
      width: 280,
      height: 600,
      top: 0,
      left: 0,
      right: 280,
      bottom: 600,
      toJSON: () => ({}),
    } as DOMRect
  })
}

function installDomainApiMocks(project: Project) {
  projectsApiMock.get.mockResolvedValue(project)
  projectsApiMock.members.mockResolvedValue([] as ProjectMember[])
  risksV2Mock.getRiskSummary.mockResolvedValue({ data: zeroSummary() })
  risksV2Mock.getReviewQueue.mockResolvedValue({ data: [] })
  changeRequestsApiMock.listChangeRequests.mockResolvedValue(emptyChangeList())
}

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
  projectsApiMock.get.mockReset()
  projectsApiMock.members.mockReset()
  risksV2Mock.getRiskSummary.mockReset()
  risksV2Mock.getReviewQueue.mockReset()
  changeRequestsApiMock.listChangeRequests.mockReset()
})

describe('ProjectSpaceContainer 工具栏接线（tasks 3.3/3.4）', () => {
  function renderSpace() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <ProjectSpaceContainer projectId={42} />
      </QueryClientProvider>,
    )
  }

  test('成功态 Header 工具栏槽位挂载 ProjectDomainMenu（位于 LensSwitcher 与手动新建之间）', async () => {
    setAuth(['project:view', 'task:view', 'task:create', 'task:update', 'risk:view'])
    installKanbanSpy()
    installDomainApiMocks(makeProject())
    renderSpace()

    await screen.findByText('开项核心引擎')
    const slot = document.querySelector('[data-project-space-toolbar-slot]')
    expect(slot).not.toBeNull()
    const menu = slot?.querySelector('[data-project-domain-menu]')
    const manual = slot?.querySelector('[data-manual-task-create-trigger]')
    const lens = document.querySelector('[data-lens-switcher]')
    expect(menu).not.toBeNull()
    expect(manual).not.toBeNull()
    expect(lens).not.toBeNull()

    // 顺序断言：LensSwitcher … ProjectDomainMenu … ManualTaskCreateDrawer（均在工具栏区）
    const following = Node.DOCUMENT_POSITION_FOLLOWING
    expect(lens!.compareDocumentPosition(menu!) & following).not.toBe(0)
    expect(menu!.compareDocumentPosition(manual!) & following).not.toBe(0)

    kanbanListSpy.mockRestore()
    rectSpy.mockRestore()
  })

  test('点击功能域菜单「风险管理」直达 /next/projects/42/risks，「变更请求」直达变更主页', async () => {
    setAuth(['project:view', 'task:view', 'task:create', 'task:update', 'risk:view'])
    installKanbanSpy()
    installDomainApiMocks(makeProject())
    renderSpace()

    await screen.findByText('开项核心引擎')
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /风险管理/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/risks')

    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /变更请求/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/change-requests')

    // LensSwitcher 六镜头保持纯粹：无任何风险/变更镜头被注入
    expect(document.querySelectorAll('[data-lens-trigger]')).toHaveLength(6)

    kanbanListSpy.mockRestore()
    rectSpy.mockRestore()
  })

  test('数据加载期（骨架屏）不渲染功能域菜单：项目数据就绪后才挂载（回归）', async () => {
    setAuth(['project:view', 'task:view', 'task:create', 'task:update', 'risk:view'])
    installKanbanSpy()
    installDomainApiMocks(makeProject())
    let resolveProject!: (project: Project) => void
    const gate = new Promise<Project>((resolve) => {
      resolveProject = resolve
    })
    projectsApiMock.get.mockReturnValue(gate)
    renderSpace()

    expect(document.querySelector('[data-project-space-skeleton]')).not.toBeNull()
    expect(document.querySelector('[data-project-domain-menu]')).toBeNull()

    resolveProject(makeProject())
    await waitFor(() => expect(document.querySelector('[data-project-domain-menu]')).not.toBeNull())
    kanbanListSpy.mockRestore()
    rectSpy.mockRestore()
  })
})

describe('功能域主页「返回项目空间」动线闭环（tasks 3.3/3.4）', () => {
  test('风险工作台头部返回按钮一键切回 /next/projects/42 看板工作面', async () => {
    setAuth(['risk:view'])
    installDomainApiMocks(makeProject())
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ProjectRisksDomainPage />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(document.querySelector('[data-risk-back-to-space]')).not.toBeNull())
    expect(document.querySelector('[data-risk-workspace-title]')?.textContent).toContain(
      '开项核心引擎 · 风险管理',
    )

    fireEvent.click(document.querySelector('[data-risk-back-to-space]') as Element)
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42')
  })

  test('返回按钮点击后不做页面内二次导航（仅切回主工作面一次）', async () => {
    setAuth(['risk:view'])
    installDomainApiMocks(makeProject())
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ProjectRisksDomainPage />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(document.querySelector('[data-risk-back-to-space]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-risk-back-to-space]') as Element)
    expect(navMock.push).toHaveBeenCalledTimes(1)
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42')
  })
})
