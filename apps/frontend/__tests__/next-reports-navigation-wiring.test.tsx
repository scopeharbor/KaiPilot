/**
 * v3-ui-next-reports-domain W3 · tasks 3.7 —— 空间地图点亮、AI 意图与 DomainMenu
 * 导航接线测试。
 *
 * 覆盖（design「导航接线：空间地图坐标、AI 意图与 DomainMenu 协同」/ spec 三通道）：
 * - 通道一（空间地图）：检索「周报」即时过滤出报表中心（available / 已就绪）；
 *   项目空间内点击把 path 的 :id 解析为当前项目 ID 直达；全局视图无项目时引导回
 *   角色首页（绝不拼装假链接）；
 * - 通道二（AI 同事意图）：周报/月报规则命中 navigate_to_space 并携带
 *   tab/template 预填参数（rule_preset + confidence 1，RL-07 诚实标注由结果卡
 *   RuleMatchBadge 呈现）；全局非项目空间唤起周报意图抛 ContextMissingError 由
 *   对话框输出诚实引导文案，不发生错误跳转；泛化「去报表中心」不强制项目上下文；
 * - 通道三（DomainMenu）：项目空间头部「功能域」菜单挂载点存在，报表中心/图表馆
 *   条目点击直达对应新轨路由，待审核计数徽章按 prop 呈现。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import { SpaceMapOverlay } from '@/components/next/navigation/SpaceMapOverlay'
import { ProjectDomainMenu } from '@/components/next/project-space/ProjectDomainMenu'
import { ProjectSpaceContainer } from '@/components/next/project-space/ProjectSpaceContainer'
import {
  COLLEAGUE_CONTEXT_MISSING_TEXT,
  ContextMissingError,
  parseColleagueIntent,
  type ColleagueContext,
} from '@/lib/next/ai-colleague-intent'
import { kanbanApi, type KanbanColumn } from '@/lib/api/kanban'
import type { Project, ProjectMember } from '@/lib/api/projects'
import { useAuthStore } from '@/stores/auth-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'

// ---------------------------------------------------------------------------
// next/navigation 与 API 模块 mock
// ---------------------------------------------------------------------------

const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/101',
  useParams: () => ({ id: '101' }),
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

// ---------------------------------------------------------------------------
// 夹具与渲染辅助
// ---------------------------------------------------------------------------

const PROJECT_ID = 101

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    organizationId: 1,
    name: '开项核心引擎',
    code: 'PROJ-101',
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

/** 覆盖 Overlay 搜索与直达。 */
function OverlayHarness() {
  const [open, setOpen] = React.useState(true)
  return <SpaceMapOverlay open={open} onOpenChange={setOpen} />
}

function renderOverlay() {
  return render(<OverlayHarness />)
}

const projectCtx: ColleagueContext = {
  contextType: 'project_space',
  currentProjectId: 42,
  pathname: '/next/projects/42',
}

const homeCtx: ColleagueContext = {
  contextType: 'role_home',
  currentProjectId: null,
  pathname: '/next',
}

let kanbanListSpy: MockInstance<typeof kanbanApi.listColumn>
let rectSpy: MockInstance<typeof Element.prototype.getBoundingClientRect>

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
  setAuth(['project:view', 'task:view', 'task:create', 'task:update', 'report:view'])
  projectsApiMock.get.mockReset()
  projectsApiMock.members.mockReset()
  projectsApiMock.get.mockResolvedValue(makeProject())
  projectsApiMock.members.mockResolvedValue([] as ProjectMember[])
})

describe('通道一：空间地图检索与点击直达（spec「用户通过空间地图直达项目报表中心」）', () => {
  test('搜索「周报」即时返回报表中心卡片（available / 已就绪）', async () => {
    useProjectSpaceEntityStore.setState({ projectId: 42, entityTitle: '开项核心引擎' })
    renderOverlay()

    const input = screen.getByLabelText('搜索空间坐标')
    fireEvent.change(input, { target: { value: '周报' } })

    const card = await screen.findByRole('button', { name: /报表中心/ })
    expect(card).toHaveAttribute('data-space-coordinate', 'reports')
    expect(card).toHaveAttribute('data-status', 'available')
    expect(card).toBeEnabled()
    expect(document.querySelectorAll('[data-space-coordinate]')).toHaveLength(1)
  })

  test('项目空间内点击报表中心：:id 解析为当前项目并直达 /next/projects/42/reports', async () => {
    useProjectSpaceEntityStore.setState({ projectId: 42, entityTitle: '开项核心引擎' })
    renderOverlay()

    fireEvent.change(screen.getByLabelText('搜索空间坐标'), {
      target: { value: '周报' },
    })
    const card = await screen.findByRole('button', { name: /报表中心/ })
    fireEvent.click(card)

    expect(navMock.push).toHaveBeenCalledTimes(1)
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/reports')
  })

  test('全局视图（无活跃项目）点击项目级坐标 → 引导回角色首页，绝不拼装假链接', async () => {
    renderOverlay()

    fireEvent.change(screen.getByLabelText('搜索空间坐标'), {
      target: { value: '报表' },
    })
    // 「报表」为图表馆历史关键词 + 报表中心 + 批4 org-reports-wing/pmo-reports 共享词：四卡并存互不吞没
    const reportsCard = await screen.findByRole('button', { name: /报表中心/ })
    expect(document.querySelectorAll('[data-space-coordinate]')).toHaveLength(4)
    fireEvent.click(reportsCard)

    expect(navMock.push).toHaveBeenCalledWith('/next')
    expect(navMock.push).not.toHaveBeenCalledWith(expect.stringContaining('/next/projects/:id'))
  })
})

describe('通道二：AI 同事报表意图识别（spec「AI 同事识别周报意图导航」）', () => {
  test('「帮我出一份本周项目周报」→ rule_nav_periodic_weekly + 周报模板预填参数', () => {
    const intent = parseColleagueIntent('帮我出一份本周项目周报', projectCtx)
    expect(intent.toolName).toBe('navigate_to_space')
    expect(intent.matchedRuleId).toBe('rule_nav_periodic_weekly')
    expect(intent.intentSource).toBe('rule_preset')
    expect(intent.confidence).toBe(1)
    expect(intent.parameters).toEqual({
      lens: 'reports',
      depth: 'workbench',
      projectId: 42,
      tab: 'periodic',
      template: 'weekly-ai-summary',
    })
  })

  test('「生成月报」/「每月总结」→ rule_nav_periodic_monthly + 月报模板预填', () => {
    for (const prompt of ['帮我生成这个月的月报', '每月总结']) {
      const intent = parseColleagueIntent(prompt, projectCtx)
      expect(intent.toolName, prompt).toBe('navigate_to_space')
      expect(intent.matchedRuleId, prompt).toBe('rule_nav_periodic_monthly')
      expect(intent.parameters).toMatchObject({
        lens: 'reports',
        tab: 'periodic',
        template: 'monthly-ai-summary',
      })
    }
  })

  test('「查看报表中心」→ rule_nav_reports 直达主页（不带 tab/template）', () => {
    const intent = parseColleagueIntent('去报表中心', projectCtx)
    expect(intent.toolName).toBe('navigate_to_space')
    expect(intent.matchedRuleId).toBe('rule_nav_reports')
    expect(intent.parameters).toEqual({ lens: 'reports', depth: 'workbench', projectId: 42 })

    const viaView = parseColleagueIntent('查看项目报表', projectCtx)
    expect(viaView.matchedRuleId).toBe('rule_nav_reports')
    expect(viaView.parameters.lens).toBe('reports')
  })

  test('「每月总结」先于摘要规则判定，不被 rule_query_summary 误吞', () => {
    const intent = parseColleagueIntent('每月总结一下项目进度', projectCtx)
    expect(intent.matchedRuleId).toBe('rule_nav_periodic_monthly')
    expect(intent.toolName).toBe('navigate_to_space')
  })

  test('全局非项目空间唤起周报/月报意图 → ContextMissingError 诚实引导，不发生错误跳转', () => {
    for (const prompt of ['帮我生成本周周报', '生成月报']) {
      expect(() => parseColleagueIntent(prompt, homeCtx)).toThrow(ContextMissingError)
      try {
        parseColleagueIntent(prompt, homeCtx)
      } catch (error) {
        expect((error as ContextMissingError).message).toBe(COLLEAGUE_CONTEXT_MISSING_TEXT)
      }
    }
  })

  test('全局视图泛化「去报表中心」不强制项目上下文（与既有导航规则一致）', () => {
    const intent = parseColleagueIntent('去报表中心', homeCtx)
    expect(intent.toolName).toBe('navigate_to_space')
    expect('projectId' in intent.parameters).toBe(false)
    expect(intent.parameters).toEqual({ lens: 'reports', depth: 'workbench' })
    expect(intent.matchedRuleId).toBe('rule_nav_reports')
  })
})

describe('通道三：ProjectDomainMenu 功能域菜单（tasks 3.6/3.7）', () => {
  test('报表中心与图表馆条目直达对应新轨路由', () => {
    render(<ProjectDomainMenu projectId={42} />)
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))

    fireEvent.click(screen.getByRole('menuitem', { name: /报表中心/ }))
    expect(navMock.push).toHaveBeenLastCalledWith('/next/projects/42/reports')

    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /图表馆/ }))
    expect(navMock.push).toHaveBeenLastCalledWith('/next/projects/42/charts')
  })

  test('待审核版本计数徽章：>0 呈现「待审核 N」，缺省不展示', () => {
    const { rerender } = render(<ProjectDomainMenu projectId={42} />)
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    expect(document.querySelector('[data-domain-pending-badge]')).toBeNull()

    // rerender 保留 open 状态：注入计数后徽章即时呈现
    rerender(<ProjectDomainMenu projectId={42} pendingReviewCount={3} />)
    expect(document.querySelector('[data-domain-pending-badge]')?.textContent).toBe('待审核 3')
  })
})

describe('项目空间头部挂载 ProjectDomainMenu（ProjectSpaceContainer 装配）', () => {
  /** 安装看板列读取桩（工作面默认看板镜头 + 汇出菜单均消费 kanbanApi.listColumn）。 */
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

  function renderSpace() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <ProjectSpaceContainer projectId={PROJECT_ID} />
      </QueryClientProvider>,
    )
  }

  test('Header 工具栏槽位存在功能域菜单，点击报表中心直达报表中心路由', async () => {
    installKanbanSpy()
    renderSpace()

    // 项目数据就绪后 Header 呈现
    await screen.findByText('开项核心引擎')
    expect(document.querySelector('[data-project-domain-menu]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /报表中心/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/101/reports')

    kanbanListSpy.mockRestore()
    rectSpy.mockRestore()
  })

  test('数据加载期（骨架屏）不渲染功能域菜单：仅成功态挂载', async () => {
    installKanbanSpy()
    renderSpace()
    expect(document.querySelector('[data-project-domain-menu]')).toBeNull()
    await screen.findByText('开项核心引擎')
    expect(document.querySelector('[data-project-domain-menu]')).not.toBeNull()
    kanbanListSpy.mockRestore()
    rectSpy.mockRestore()
  })
})
