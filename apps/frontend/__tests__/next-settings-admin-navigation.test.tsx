/**
 * v3-ui-next-settings-admin-domains W9 · tasks 9.10 —— 设置空间 / 管理后台 / 项目设置
 * 全域导航闭环集成测试（spec「空间地图坐标与 AI 同事三通道导航闭环」/「AI 同事意图扩展」）。
 *
 * 覆盖：
 * - 空间地图坐标注册消费：Ctrl+M 检索「设置」「管理后台」即时高亮对应全局坐标卡片，
 *   点击直达 `/next/settings` / `/next/admin`；项目级「项目设置」在活跃项目上下文中
 *   解析为 `/next/projects/:id/settings`，全局视图回落角色首页引导（绝不拼装假链接）；
 * - AI 同事意图：「打开设置中心」「打开管理后台的用户管理」「改项目工作日历」命中
 *   rule_nav_settings / rule_nav_admin_users / rule_nav_project_settings 并产出正确参数
 *   （RL-07：rule_preset + confidence=1 + matchedRuleId）；全局上下文唤起项目设置规则
 *   抛 ContextMissingError 诚实引导；
 * - 「组织设置」归 settings 系规则而「组织概览」仍归既有 rule_nav_org_overview
 *   （负向守卫，新规则不吞既有组织语义）；
 * - NavigationResultCard 中文镜头回显 + 「⚡ 快捷规则匹配 · navigate_to_space」诚实徽标 +
 *   onNavigate 回跳回调；
 * - 顶栏坐标面包屑深层前缀回显（设置空间 / 管理后台 / 项目设置实体标题）；
 * - `/next/admin` 门户到 `/next/admin/users` 全链跳转，以及无控制台权限时的中性受限页
 *   零请求（D-ADM / RL-05 / RL-06）。
 */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AdminLandingHub } from '@/components/next/admin/AdminLandingHub'
import { NavigationResultCard } from '@/components/next/ai/cards/NavigationResultCard'
import { SpaceMapOverlay } from '@/components/next/navigation/SpaceMapOverlay'
import { useAuthStore } from '@/stores/auth-store'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import {
  COLLEAGUE_CONTEXT_MISSING_TEXT,
  ContextMissingError,
  parseColleagueIntent,
  type ColleagueContext,
} from '@/lib/next/ai-colleague-intent'
import { resolveSpaceBreadcrumb } from '@/lib/next/space-breadcrumbs'

// ---------------------------------------------------------------------------
// next/navigation + next/link mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/settings',
  useParams: () => ({ id: '42' }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
    ...props
  }: {
    href: string
    children: React.ReactNode
    onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void
  }) => (
    // jsdom 不支持真实导航：阻断默认跳转，只保留组件回调语义。
    <a
      href={typeof href === 'string' ? href : '#'}
      onClick={(event) => {
        event.preventDefault()
        onClick?.(event)
      }}
      {...props}
    >
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------
const PROJECT_CONTEXT: ColleagueContext = {
  contextType: 'project_space',
  currentProjectId: 42,
  pathname: '/next/projects/42',
}

const GLOBAL_CONTEXT: ColleagueContext = {
  contextType: 'role_home',
  currentProjectId: null,
  pathname: '/next',
}

interface RequestRecord {
  method: string
  url: string
}

/** 零请求断言的 fetch 记录桩：任何调用都会被记账（受限页必须恒为空）。 */
function installRecordingFetch(): RequestRecord[] {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    records.push({ method: (init?.method ?? 'GET').toUpperCase(), url: rawUrl })
    return {
      ok: false,
      status: 404,
      statusText: '404',
      json: async () => ({ error: { code: 'NOT_FOUND', message: '本测试不应发起任何请求' } }),
    } as Response
  }
  vi.stubGlobal('fetch', fetchMock)
  return records
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '平台管理员',
      organizations:
        organizationId === null
          ? []
          : [{ id: organizationId, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
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

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
  setAuth(['system:admin'])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// 空间地图 Ctrl+M：设置 / 管理后台 / 项目设置坐标
// ---------------------------------------------------------------------------
describe('Ctrl+M 空间地图：设置空间 / 管理后台 / 项目设置坐标直达（tasks 9.10）', () => {
  /** 模拟装配路径（useNextShortcuts Cmd/Ctrl+M 全局监听）的薄壳。 */
  function OverlayHarness() {
    const [open, setOpen] = React.useState(false)
    React.useEffect(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'm') {
          setOpen(true)
        }
      }
      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }, [])
    return <SpaceMapOverlay open={open} onOpenChange={setOpen} />
  }

  test('项目上下文「设置」：设置空间卡可用并直达 /next/settings（全局坐标不注入项目）', () => {
    useProjectSpaceEntityStore.setState({ projectId: 42, entityTitle: '开项核心引擎' })
    render(<OverlayHarness />)
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })

    const input = screen.getByRole('searchbox', { name: '搜索空间坐标' })
    fireEvent.change(input, { target: { value: '设置' } })

    const settingsCard = screen.getByRole('button', { name: /设置空间/ })
    expect(settingsCard).toHaveAttribute('data-space-coordinate', 'settings')
    expect(settingsCard).toHaveAttribute('data-status', 'available')
    expect(settingsCard).toBeEnabled()
    // 子串检索语义：「项目设置」含「设置」→ 项目级坐标同屏共存，互不吞没
    expect(screen.getByRole('button', { name: /项目设置/ })).toHaveAttribute(
      'data-space-coordinate',
      'project-settings',
    )

    fireEvent.click(settingsCard)
    expect(screen.queryByRole('dialog', { name: '空间地图' })).not.toBeInTheDocument()
    expect(navMock.push).toHaveBeenCalledTimes(1)
    expect(navMock.push).toHaveBeenCalledWith('/next/settings')
  })

  test('「管理后台」：唯一高亮管理后台卡并直达 /next/admin', () => {
    useProjectSpaceEntityStore.setState({ projectId: 42, entityTitle: '开项核心引擎' })
    render(<OverlayHarness />)
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '管理后台' } })
    const adminCard = screen.getByRole('button', { name: /管理后台/ })
    expect(adminCard).toHaveAttribute('data-space-coordinate', 'admin')
    expect(adminCard).toHaveAttribute('data-status', 'available')
    expect(screen.queryByRole('button', { name: /设置空间/ })).not.toBeInTheDocument()

    fireEvent.click(adminCard)
    expect(navMock.push).toHaveBeenCalledTimes(1)
    expect(navMock.push).toHaveBeenCalledWith('/next/admin')
  })

  test('「项目设置」：项目上下文直达 /next/projects/42/settings，全局视图回落 /next 引导', async () => {
    useProjectSpaceEntityStore.setState({ projectId: 42, entityTitle: '开项核心引擎' })
    const projectView = render(<OverlayHarness />)
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '项目设置' } })
    const projectSettingsCard = screen.getByRole('button', { name: /项目设置/ })
    expect(projectSettingsCard).toHaveAttribute('data-space-coordinate', 'project-settings')
    fireEvent.click(projectSettingsCard)
    expect(navMock.push).toHaveBeenLastCalledWith('/next/projects/42/settings')

    await act(async () => {
      projectView.unmount()
    })

    // 全局视图（无活跃项目实体）：项目级坐标仍可点，但按 resolveSpaceCoordinatePath
    // 回退角色首页引导选项目，绝不拼装 `/next/projects/undefined/settings`
    useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
    navMock.push.mockReset()
    render(<OverlayHarness />)
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '项目设置' } })
    fireEvent.click(screen.getByRole('button', { name: /项目设置/ }))

    expect(navMock.push).toHaveBeenCalledTimes(1)
    expect(navMock.push).toHaveBeenCalledWith('/next')
  })
})

// ---------------------------------------------------------------------------
// AI 同事意图：settings / admin / project_settings 规则
// ---------------------------------------------------------------------------
describe('AI 同事意图：设置中心 / 管理后台用户管理 / 项目工作日历', () => {
  test('「打开设置中心」→ rule_nav_settings：navigate_to_space + lens=settings（全域不注入 projectId）', () => {
    const intent = parseColleagueIntent('打开设置中心', PROJECT_CONTEXT)
    expect(intent).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_settings',
      intentSource: 'rule_preset',
      confidence: 1,
    })
    expect(intent.parameters).toEqual({ lens: 'settings' })
    expect(intent.fallbackPrompt).toBeUndefined()
  })

  test('「打开管理后台的用户管理」→ rule_nav_admin_users：lens=admin + target=users', () => {
    const intent = parseColleagueIntent('打开管理后台的用户管理', PROJECT_CONTEXT)
    expect(intent).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_admin_users',
      confidence: 1,
    })
    expect(intent.parameters).toEqual({ lens: 'admin', target: 'users' })
  })

  test('「改项目工作日历」→ rule_nav_project_settings：lens=project_settings + projectId 注入', () => {
    const intent = parseColleagueIntent('改项目工作日历', PROJECT_CONTEXT)
    expect(intent).toMatchObject({
      toolName: 'navigate_to_space',
      matchedRuleId: 'rule_nav_project_settings',
      confidence: 1,
    })
    expect(intent.parameters).toEqual({
      lens: 'project_settings',
      depth: 'workbench',
      projectId: 42,
    })
  })

  test('全局上下文「改项目工作日历」→ ContextMissingError 诚实引导（绝不拼装假路径）', () => {
    expect(() => parseColleagueIntent('改项目工作日历', GLOBAL_CONTEXT)).toThrow(
      ContextMissingError,
    )
    try {
      parseColleagueIntent('改项目工作日历', GLOBAL_CONTEXT)
    } catch (error) {
      expect((error as ContextMissingError).message).toBe(COLLEAGUE_CONTEXT_MISSING_TEXT)
    }
    expect(() => parseColleagueIntent('打开项目设置', GLOBAL_CONTEXT)).toThrow(ContextMissingError)
  })

  test('「打开组织设置」归 settings 系规则；「查看组织概览」不被它吞（仍归 rule_nav_org_overview）', () => {
    const orgSettings = parseColleagueIntent('打开组织设置', PROJECT_CONTEXT)
    expect(orgSettings.matchedRuleId).toBe('rule_nav_settings_organization')
    expect(orgSettings.parameters).toEqual({ lens: 'settings', target: 'organization' })

    const orgOverview = parseColleagueIntent('查看组织概览', PROJECT_CONTEXT)
    expect(orgOverview.matchedRuleId).toBe('rule_nav_org_overview')
    expect(orgOverview.parameters).toEqual({ lens: 'org_overview' })
  })

  test('既有语义回归：admin 审计与组织审计歧义词分派不被 settings/admin 泛化规则抢占', () => {
    expect(parseColleagueIntent('查看全局审计日志', PROJECT_CONTEXT).matchedRuleId).toBe(
      'rule_nav_admin_audit',
    )
    expect(parseColleagueIntent('查看审计日志', PROJECT_CONTEXT).matchedRuleId).toBe(
      'rule_nav_settings_audit',
    )
    expect(parseColleagueIntent('返回首页', PROJECT_CONTEXT).matchedRuleId).toBe('rule_nav_home')
  })
})

// ---------------------------------------------------------------------------
// NavigationResultCard：设置镜头中文回显 + 快捷规则徽标 + 回跳回调
// ---------------------------------------------------------------------------
describe('NavigationResultCard：设置空间导航结果卡（诚实徽标与回跳）', () => {
  test('lens=settings + projectId=null：中文镜头标签、无目标项目行、徽标与回跳回调', () => {
    const onNavigate = vi.fn()
    render(
      <NavigationResultCard
        data={{
          projectId: null,
          lens: 'settings',
          depth: 'workbench',
          targetId: null,
          path: '/next/settings',
        }}
        onNavigate={onNavigate}
      />,
    )

    expect(screen.getByText('空间导航已执行')).toBeInTheDocument()
    expect(document.querySelector('[data-navigate-summary]')?.textContent).toBe(
      '已为你导航至设置空间',
    )
    expect(document.querySelector('[data-navigate-lens]')?.textContent).toBe('设置空间')
    expect(document.querySelector('[data-navigate-depth]')?.textContent).toBe('工作台景深')
    expect(document.querySelector('[data-navigate-path]')?.textContent).toBe('/next/settings')
    // 无项目载体：不渲染「目标项目」行（settings 为全域镜头）
    expect(document.querySelector('[data-navigate-project]')).toBeNull()
    // RL-07 诚实呈现：规则直连徽标而非「模型深思」叙事
    expect(document.querySelector('[data-rule-match-badge]')?.textContent).toContain(
      '快捷规则匹配 · navigate_to_space',
    )

    fireEvent.click(screen.getByRole('link', { name: '再次前往 · 直达该路径' }))
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledWith('/next/settings')
  })

  test('lens=admin + projectId：管理后台标签与目标项目回显', () => {
    render(
      <NavigationResultCard
        data={{
          projectId: 42,
          lens: 'admin',
          depth: 'workbench',
          targetId: 7,
          path: '/next/admin/users',
        }}
      />,
    )
    expect(document.querySelector('[data-navigate-summary]')?.textContent).toBe(
      '已为你导航至项目 42 的管理后台（目标实体 #7）镜头',
    )
    expect(document.querySelector('[data-navigate-project]')?.textContent).toBe('项目 #42')
    expect(document.querySelector('[data-navigate-lens]')?.textContent).toBe('管理后台')
  })
})

// ---------------------------------------------------------------------------
// 顶栏坐标面包屑
// ---------------------------------------------------------------------------
describe('坐标面包屑深层前缀回显（tasks 9.10）', () => {
  test('门户与深层子路由：设置空间 / 管理后台前缀回显', () => {
    expect(resolveSpaceBreadcrumb('/next/settings')).toBe('/next/settings · 设置空间')
    expect(resolveSpaceBreadcrumb('/next/settings/security/sso')).toBe(
      '/next/settings/security/sso · 设置空间',
    )
    expect(resolveSpaceBreadcrumb('/next/admin/users')).toBe('/next/admin/users · 管理后台')
  })

  test('项目设置深链：实体标题就绪时回显 项目名 · 项目设置', () => {
    expect(resolveSpaceBreadcrumb('/next/projects/42/settings', '开项核心引擎 · 项目设置')).toBe(
      '/next/projects/42 · 开项核心引擎 · 项目设置',
    )
  })
})

// ---------------------------------------------------------------------------
// /next/admin 门户全链跳转 + 中性受限页
// ---------------------------------------------------------------------------
describe('/next/admin 门户：控制台直达与中性受限（D-ADM / RL-05 / RL-06）', () => {
  test('持 system:admin：门户渲染控制台清单，点「用户管理」push /next/admin/users', () => {
    render(<AdminLandingHub />)

    expect(document.querySelector('[data-admin-landing]')).not.toBeNull()
    expect(document.querySelector('[data-admin-landing-restricted]')).toBeNull()
    expect(document.querySelector('[data-admin-landing-title]')?.textContent).toBe('管理后台')
    expect(document.querySelector('[data-admin-console="users"]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '打开用户管理' }))
    expect(navMock.push).toHaveBeenCalledTimes(1)
    expect(navMock.push).toHaveBeenCalledWith('/next/admin/users')
  })

  test('无任何控制台权限：中性受限页（不泄露清单）且零网络请求', async () => {
    setAuth(['project:view'])
    const records = installRecordingFetch()
    render(<AdminLandingHub />)

    expect(document.querySelector('[data-admin-landing-restricted]')).not.toBeNull()
    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    const body = document.body.textContent ?? ''
    expect(body).toContain('暂无可用控制台')
    // RL-05：不渲染任何控制台名称、不泄露清单存在性
    expect(body).not.toContain('用户管理')
    expect(body).not.toContain('全局审计日志')
    expect(document.querySelector('[data-admin-console]')).toBeNull()

    await act(async () => {
      await settle()
    })
    expect(records).toHaveLength(0)
  })

  test('受限页「返回角色首页」回退 /next（无权限也有诚实动线）', () => {
    setAuth(['project:view'])
    installRecordingFetch()
    render(<AdminLandingHub />)

    fireEvent.click(screen.getByRole('button', { name: '返回角色首页' }))
    expect(navMock.push).toHaveBeenCalledWith('/next')
  })
})

// ---------------------------------------------------------------------------
// 设置空间门户坐标在全局检索下的可发现性（防回归：白名单与地图联动）
// ---------------------------------------------------------------------------
describe('空间地图检索与门户页装配一致性', () => {
  test('空查询展示完整白名单（含三新坐标），坐标 id 稳定', async () => {
    render(<SpaceMapOverlay open onOpenChange={() => undefined} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /设置空间/ })).toBeInTheDocument(),
    )
    expect(document.querySelector('[data-space-coordinate="settings"]')).not.toBeNull()
    expect(document.querySelector('[data-space-coordinate="admin"]')).not.toBeNull()
    expect(document.querySelector('[data-space-coordinate="project-settings"]')).not.toBeNull()
  })
})
