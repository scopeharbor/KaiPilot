/**
 * v3-ui-next-risk-change-domains W3 · tasks 3.2 —— ProjectDomainMenu 功能域菜单
 * 徽标计数与下拉导航测试（design Decision 2 / spec「功能域动态徽章」）。
 *
 * 覆盖：
 * - 菜单触发按钮与四域条目（风险管理 / 变更请求 / 报表中心 / 图表馆）渲染与
 *   直达导航；
 * - 动态计数（useRiskSummary + useChangeRequests 双状态查询）：无告警时中性徽标，
 *   存在 3 项高危风险（high 2 + critical 1）与 2 项待审变更（submitted 2）时动态
 *   呈现红标「3 项高危」与琥珀标「2 项待审」，按钮出现告警红点；
 * - 计数未解析（加载中/失败）不渲染徽标，杜绝闪烁误报；报表中心待审核徽章
 *   维持 prop 注入契约（B6e 回归）；
 * - 无 QueryClient 环境自动降级纯静态渲染（B6e 极简版既有测试兼容，零抛错）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
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
import type { ChangeRequestListResponse } from '@/lib/api/change-requests'
import type { RiskWorkbenchSummary } from '@/lib/api/risks-v2'

// ---------------------------------------------------------------------------
// next/navigation 与 API 模块 mock
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// 夹具与渲染辅助
// ---------------------------------------------------------------------------
function makeSummary(
  overrides: Partial<Pick<RiskWorkbenchSummary, 'highRiskCount' | 'criticalRiskCount'>> = {},
): RiskWorkbenchSummary {
  return {
    totalRisks: 6,
    openRisks: 5,
    highRiskCount: 0,
    criticalRiskCount: 0,
    overdueReviewCount: 1,
    incompleteResponsePlans: 1,
    trend30d: { created: 3, closed: 1 },
    healthScore: 72,
    topRisks: [],
    ...overrides,
  }
}

function makeChangeList(total: number): ChangeRequestListResponse {
  return { data: [], meta: { total, page: 1, perPage: 1, totalPages: Math.max(1, total) } }
}

function installApi(
  summary: RiskWorkbenchSummary,
  pending: { submitted: number; underReview: number },
) {
  risksV2Mock.getRiskSummary.mockResolvedValue({ data: summary })
  changeRequestsApiMock.listChangeRequests.mockImplementation(
    async (_projectId: number, filters: { status?: string } = {}) =>
      makeChangeList(filters.status === 'submitted' ? pending.submitted : pending.underReview),
  )
}

function renderMenu(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  risksV2Mock.getRiskSummary.mockReset()
  changeRequestsApiMock.listChangeRequests.mockReset()
})

describe('菜单触发与下拉条目渲染（tasks 3.1/3.2）', () => {
  test('触发按钮展开四域条目，点击风险管理 / 变更请求直达对应新轨路由', async () => {
    installApi(makeSummary(), { submitted: 0, underReview: 0 })
    renderMenu(<ProjectDomainMenu projectId={42} />)

    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    expect(screen.getByRole('menuitem', { name: /风险管理/ })).toHaveAttribute(
      'data-domain-id',
      'risks',
    )
    expect(screen.getByRole('menuitem', { name: /变更请求/ })).toHaveAttribute(
      'data-domain-id',
      'change-requests',
    )
    expect(screen.getByRole('menuitem', { name: /报表中心/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /图表馆/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: /风险管理/ }))
    expect(navMock.push).toHaveBeenLastCalledWith('/next/projects/42/risks')

    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /变更请求/ }))
    expect(navMock.push).toHaveBeenLastCalledWith('/next/projects/42/change-requests')
  })

  test('报表中心与图表馆既有条目行为不变（B6e 回归：直达 /reports /charts）', async () => {
    installApi(makeSummary(), { submitted: 0, underReview: 0 })
    renderMenu(<ProjectDomainMenu projectId={42} pendingReviewCount={3} />)
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))

    fireEvent.click(screen.getByRole('menuitem', { name: /报表中心/ }))
    expect(navMock.push).toHaveBeenLastCalledWith('/next/projects/42/reports')

    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /图表馆/ }))
    expect(navMock.push).toHaveBeenLastCalledWith('/next/projects/42/charts')
  })
})

describe('动态徽标计算（design Decision 2，tasks 3.1/3.2）', () => {
  test('无告警数据：风险与待审计数以中性徽标呈现，按钮无告警红点', async () => {
    installApi(makeSummary(), { submitted: 0, underReview: 0 })
    renderMenu(<ProjectDomainMenu projectId={42} />)
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))

    await waitFor(() => expect(document.querySelector('[data-domain-alert-badge]')).not.toBeNull())
    const riskBadge = document.querySelector('[data-domain-alert-badge]')
    expect(riskBadge?.textContent).toBe('0 项高危')
    expect(riskBadge?.getAttribute('data-domain-badge-tone')).toBe('neutral')

    const crBadge = document.querySelector('[data-domain-cr-badge]')
    expect(crBadge?.textContent).toBe('0 项待审')
    expect(crBadge?.getAttribute('data-domain-badge-tone')).toBe('neutral')
    expect(document.querySelector('[data-domain-alert-dot]')).toBeNull()
  })

  test('存在 3 项高危（high 2 + critical 1）与 2 项待审变更：红标「3 项高危」+ 琥珀标「2 项待审」+ 告警红点', async () => {
    installApi(makeSummary({ highRiskCount: 2, criticalRiskCount: 1 }), {
      submitted: 2,
      underReview: 0,
    })
    renderMenu(<ProjectDomainMenu projectId={42} />)
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))

    await waitFor(() =>
      expect(document.querySelector('[data-domain-alert-badge]')?.textContent).toBe('3 项高危'),
    )
    const riskBadge = document.querySelector('[data-domain-alert-badge]')
    expect(riskBadge?.getAttribute('data-domain-badge-tone')).toBe('danger')
    expect(riskBadge?.className).toContain('--nx-status-danger')

    const crBadge = document.querySelector('[data-domain-cr-badge]')
    expect(crBadge?.textContent).toBe('2 项待审')
    expect(crBadge?.getAttribute('data-domain-badge-tone')).toBe('warning')
    expect(crBadge?.className).toContain('--nx-status-warning')

    expect(document.querySelector('[data-domain-alert-dot]')).not.toBeNull()
  })

  test('审核中（under_review）变更同样计入待审徽标', async () => {
    installApi(makeSummary(), { submitted: 0, underReview: 2 })
    renderMenu(<ProjectDomainMenu projectId={42} />)
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))

    await waitFor(() =>
      expect(document.querySelector('[data-domain-cr-badge]')?.textContent).toBe('2 项待审'),
    )
    expect(
      document.querySelector('[data-domain-cr-badge]')?.getAttribute('data-domain-badge-tone'),
    ).toBe('warning')
  })

  test('计数未解析（请求失败）：不渲染徽标，杜绝空态误报', async () => {
    risksV2Mock.getRiskSummary.mockRejectedValue(new Error('network down'))
    changeRequestsApiMock.listChangeRequests.mockRejectedValue(new Error('network down'))
    renderMenu(<ProjectDomainMenu projectId={42} />)
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))

    // 菜单条目正常渲染，但动态徽标保持缺省（不闪烁「0 项」假数据）
    expect(screen.getByRole('menuitem', { name: /风险管理/ })).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(document.querySelector('[data-domain-alert-badge]')).toBeNull()
    expect(document.querySelector('[data-domain-cr-badge]')).toBeNull()
    expect(document.querySelector('[data-domain-alert-dot]')).toBeNull()
  })

  test('报表中心待审核徽章维持 prop 注入契约：>0 呈现「待审核 N」，缺省不展示', async () => {
    installApi(makeSummary(), { submitted: 0, underReview: 0 })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <ProjectDomainMenu projectId={42} />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    expect(document.querySelector('[data-domain-pending-badge]')).toBeNull()

    rerender(
      <QueryClientProvider client={client}>
        <ProjectDomainMenu projectId={42} pendingReviewCount={3} />
      </QueryClientProvider>,
    )
    expect(document.querySelector('[data-domain-pending-badge]')?.textContent).toBe('待审核 3')
  })
})

describe('无 QueryClient 环境降级（B6e 极简版既有用例兼容）', () => {
  test('纯静态渲染零抛错：条目齐全、无动态徽标、导航可用', () => {
    render(<ProjectDomainMenu projectId={42} />)
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    expect(screen.getByRole('menuitem', { name: /风险管理/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /变更请求/ })).toBeInTheDocument()
    expect(document.querySelector('[data-domain-alert-badge]')).toBeNull()
    expect(document.querySelector('[data-domain-cr-badge]')).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: /风险管理/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/risks')
  })

  test('降级路径下报表中心 prop 徽章契约仍生效（既有测试语义保持）', () => {
    const { rerender } = render(<ProjectDomainMenu projectId={42} />)
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    expect(document.querySelector('[data-domain-pending-badge]')).toBeNull()

    rerender(<ProjectDomainMenu projectId={42} pendingReviewCount={2} />)
    expect(document.querySelector('[data-domain-pending-badge]')?.textContent).toBe('待审核 2')
  })
})

// ---------------------------------------------------------------------------
// v3-ui-next-resource-team-domains W4 · tasks 4.2：两分组六条目重组扩展用例
// （v3-ui-next-settings-admin-domains W8 · tasks 8.5 治理组增量追加「项目设置」，
//  该批次的入口断言见 next-project-domain-menu-project-settings.test.tsx）
// ---------------------------------------------------------------------------
describe('协同管理/治理分析双分组完整呈现（tasks 4.1/4.2 重组契约）', () => {
  test('菜单白名单为两分组：协同组（资源/成员/文件）+ 治理组（风险/变更/报表/图表）保持', () => {
    expect(PROJECT_DOMAIN_MENU_GROUPS.map((group) => group.id)).toEqual([
      'collaboration',
      'governance',
    ])
    expect(PROJECT_DOMAIN_MENU_GROUPS[0]?.label).toBe('协同管理')
    expect(PROJECT_DOMAIN_MENU_GROUPS[0]?.entries.map((entry) => entry.id)).toEqual([
      'resources',
      'members',
      'files',
    ])
    expect(PROJECT_DOMAIN_MENU_GROUPS[1]?.label).toBe('治理与分析')
    expect(PROJECT_DOMAIN_MENU_GROUPS[1]?.entries.map((entry) => entry.id)).toEqual([
      'risks',
      'change-requests',
      'reports',
      'charts',
      'project-settings',
    ])
    // 扁平清单与分组推导一致（既有消费方遍历契约保持）
    expect(PROJECT_DOMAIN_MENU_ENTRIES).toHaveLength(8)
  })

  test('展开菜单：两分组标签与条目标题、说明微标完整呈现，DOM 契约不破', () => {
    installApi(makeSummary(), { submitted: 0, underReview: 0 })
    renderMenu(<ProjectDomainMenu projectId={42} />)
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))

    expect(screen.getByText('协同管理')).toBeInTheDocument()
    expect(screen.getByText('治理与分析')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-project-domain-item]')).toHaveLength(8)

    expect(document.querySelectorAll('[data-domain-group]')).toHaveLength(2)
    const collab = document.querySelector('[data-domain-group="collaboration"]')
    expect(collab?.querySelectorAll('[data-project-domain-item]')).toHaveLength(3)
    const governance = document.querySelector('[data-domain-group="governance"]')
    expect(governance?.querySelectorAll('[data-project-domain-item]')).toHaveLength(5)

    // 新增条目：标题 + 说明微标 + 图标（svg 渲染成功即图标映射契约成立）
    const resourcesItem = screen.getByRole('menuitem', { name: /资源工作台/ })
    expect(resourcesItem).toHaveAttribute('data-domain-id', 'resources')
    expect(resourcesItem.textContent).toContain('团队负荷排查')
    expect(resourcesItem.querySelector('svg')).not.toBeNull()
    const membersItem = screen.getByRole('menuitem', { name: /成员与团队/ })
    expect(membersItem).toHaveAttribute('data-domain-id', 'members')
    expect(membersItem.textContent).toContain('角色调整')
    const filesItem = screen.getByRole('menuitem', { name: /项目文件库/ })
    expect(filesItem).toHaveAttribute('data-domain-id', 'files')
    expect(filesItem.textContent).toContain('安全下载')
    expect(filesItem.querySelector('svg')).not.toBeNull()

    // 既有治理条目文本与说明微标不受重组影响
    expect(screen.getByRole('menuitem', { name: /风险管理/ }).textContent).toContain('态势评估')
    expect(screen.getByRole('menuitem', { name: /报表中心/ })).toHaveAttribute(
      'data-domain-id',
      'reports',
    )
  })

  test('点击协同组三条目分别直达 /next/projects/:id/resources|members|files', () => {
    installApi(makeSummary(), { submitted: 0, underReview: 0 })
    renderMenu(<ProjectDomainMenu projectId={42} />)

    const cases: Array<{ label: RegExp; path: string }> = [
      { label: /资源工作台/, path: '/next/projects/42/resources' },
      { label: /成员与团队/, path: '/next/projects/42/members' },
      { label: /项目文件库/, path: '/next/projects/42/files' },
    ]
    for (const item of cases) {
      fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
      fireEvent.click(screen.getByRole('menuitem', { name: item.label }))
      expect(navMock.push).toHaveBeenLastCalledWith(item.path)
    }
  })

  test('治理组条目路由与既有动态徽标归属保持（资源/成员/文件不产生告警徽标）', async () => {
    installApi(makeSummary({ highRiskCount: 1 }), { submitted: 1, underReview: 0 })
    renderMenu(<ProjectDomainMenu projectId={42} />)
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))

    await waitFor(() =>
      expect(document.querySelector('[data-domain-alert-badge]')?.textContent).toBe('1 项高危'),
    )
    // 徽标仅悬挂于治理组风险/变更条目；协同三条目零徽标（数据归属不漂移）
    const collabSection = document.querySelector('[data-domain-group="collaboration"]')
    expect(collabSection?.querySelector('[data-domain-alert-badge]')).toBeNull()
    expect(collabSection?.querySelector('[data-domain-cr-badge]')).toBeNull()
    expect(collabSection?.querySelector('[data-domain-pending-badge]')).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: /变更请求/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/change-requests')
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /图表馆/ }))
    expect(navMock.push).toHaveBeenLastCalledWith('/next/projects/42/charts')
  })
})

describe('与 LensSwitcher 六镜头排程切换器彻底解耦（tasks 4.2，design Non-Goal 6）', () => {
  test('镜头切换器选项清单不混入资源/成员/文件，点击镜头只切换排程镜头不动菜单', () => {
    const onSelect = vi.fn()
    render(
      <div>
        <LensSwitcher activeLensId="kanban" onSelect={onSelect} />
        <ProjectDomainMenu projectId={42} />
      </div>,
    )

    // 六镜头纯粹性：资源/成员/文件严禁混入 LensSwitcher
    const lensIds = LENS_SWITCHER_OPTIONS.map((option) => option.id)
    expect(lensIds).toEqual(['kanban', 'gantt', 'wbs', 'list', 'calendar', 'timeline'])
    expect(lensIds).not.toContain('resources')
    expect(lensIds).not.toContain('members')
    expect(lensIds).not.toContain('files')
    const switches = document.querySelectorAll('[data-lens-option]')
    expect(switches).toHaveLength(6)

    // 排程镜头切换：仅派发 onSelect，绝不产生路由 push
    fireEvent.click(screen.getByRole('button', { name: '甘特图' }))
    expect(onSelect).toHaveBeenCalledWith('gantt' satisfies ProjectSpaceLensId)
    expect(navMock.push).not.toHaveBeenCalled()

    // 镜头切换后功能域菜单保持独立可用（正交第二导航维度）
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    expect(screen.getByRole('menuitem', { name: /资源工作台/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /风险管理/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /资源工作台/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/resources')
  })

  test('功能域菜单开合不触碰 LensSwitcher 激活态（两维状态互不串扰）', () => {
    const onSelect = vi.fn()
    const { container } = render(
      <div>
        <LensSwitcher activeLensId="wbs" onSelect={onSelect} />
        <ProjectDomainMenu projectId={42} />
      </div>,
    )
    expect(container.querySelector('[data-lens-option="wbs"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )

    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    // 菜单开合不改变镜头激活态（仍为 WBS）
    expect(container.querySelector('[data-lens-option="wbs"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(
      container.querySelector('[data-lens-option="gantt"]')?.getAttribute('aria-pressed'),
    ).toBeNull()
  })
})
