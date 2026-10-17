/**
 * v3-ui-next-resource-team-domains W4 · tasks 4.6 —— 三通道导航闭环集成测试
 * （空间地图坐标点亮 + AI 同事自然语言意图直达，spec「空间地图坐标与 AI 同事
 * 三通道导航闭环」/「AI 同事意图扩展」场景）。
 *
 * 覆盖：
 * - 空间地图坐标注册：resources / members / files 三条项目级坐标均为 available ·
 *   已就绪 · 图标契约（Users / Users / FolderArchive）；
 * - Ctrl+M 装配路径：地图搜索「资源」「成员」「文件」即时高亮唯一对应坐标卡片，
 *   点击在项目上下文下直达 /next/projects/:id/[resources|members|files]；
 *   「人员」为资源与成员共享词 → 双卡片共存互不吞没；全局（无项目上下文）点击
 *   项目级坐标回退角色首页引导，绝不拼装假链接；
 * - AI 同事意图：「查看项目资源」「管理项目成员」「打开项目文件」等指令命中
 *   rule_nav_resources / rule_nav_members / rule_nav_files，派发 navigate_to_space
 *   并注入当前 projectId（RL-07：rule_preset + confidence=1 + matchedRuleId）；
 * - 与既有确定性规则共存回归：图表馆资源负荷诉求仍归 rule_nav_chart_resource_load，
 *   风险列表聊天查询语义不被吞没；
 * - 无项目上下文唤起三域意图 → ContextMissingError 诚实引导，绝不拼装假链接。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { SpaceMapOverlay } from '@/components/next/navigation/SpaceMapOverlay'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'
import {
  COLLEAGUE_CONTEXT_MISSING_TEXT,
  ContextMissingError,
  parseColleagueIntent,
  type ColleagueContext,
} from '@/lib/next/ai-colleague-intent'
import {
  PRESET_SPACE_COORDINATES,
  filterSpaceCoordinates,
  resolveSpaceCoordinatePath,
} from '@/lib/next/space-coordinates'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42',
  useParams: () => ({ id: '42' }),
  useSearchParams: () => new URLSearchParams(),
}))

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

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
})

// ---------------------------------------------------------------------------
describe('空间地图坐标注册与项目级占位路径（spec「坐标点亮」）', () => {
  test('resources/members/files 三坐标：available / 已就绪 / 图标契约 / :id 占位路径', () => {
    const resources = PRESET_SPACE_COORDINATES.find((c) => c.id === 'resources')!
    const members = PRESET_SPACE_COORDINATES.find((c) => c.id === 'members')!
    const files = PRESET_SPACE_COORDINATES.find((c) => c.id === 'files')!

    expect(resources.title).toBe('资源工作台')
    expect(resources.path).toBe('/next/projects/:id/resources')
    expect(resources.status).toBe('available')
    expect(resources.badge).toBe('已就绪')
    expect(resources.iconName).toBe('Users')

    expect(members.title).toBe('成员与团队')
    expect(members.path).toBe('/next/projects/:id/members')
    expect(members.status).toBe('available')
    expect(members.badge).toBe('已就绪')
    expect(members.iconName).toBe('Users')

    expect(files.title).toBe('项目文件库')
    expect(files.path).toBe('/next/projects/:id/files')
    expect(files.status).toBe('available')
    expect(files.badge).toBe('已就绪')
    expect(files.iconName).toBe('FolderArchive')
  })

  test('检索语义：资源/成员/文件专属词归属与组织层注册后的共享词扩展；人员共享词双命中', () => {
    // v3-ui-next-org-portfolio-domains 10.2：组织/全局资源系坐标注册后裸「资源」
    // 为项目资源工作台与组织/全局资源系坐标的共享词（子串命中）；复合词
    // 「组织资源池/技能矩阵/插件目录/容量环」等仍精准归属（见 next-org-coordinates.test）
    // 批4 pmo-reports 描述含「资源负荷」，与既有资源系坐标共享词共存
    expect(filterSpaceCoordinates('资源').map((c) => c.id)).toEqual([
      'resources',
      'org_resource_pool',
      'org_resource_gaps',
      'org_resource_contentions',
      'org_resource_demand',
      'global_resources',
      'pmo-reports',
    ])
    expect(filterSpaceCoordinates('成员').map((c) => c.id)).toEqual(['members'])
    expect(filterSpaceCoordinates('文件').map((c) => c.id)).toEqual(['files'])
    expect(filterSpaceCoordinates('人员').map((c) => c.id)).toEqual(['resources', 'members'])
  })

  test('项目级路径解析：:id 替换当前项目；全局无项目上下文 → 回退首页引导', () => {
    const resources = PRESET_SPACE_COORDINATES.find((c) => c.id === 'resources')!
    expect(resolveSpaceCoordinatePath(resources.path, 42)).toBe('/next/projects/42/resources')
    expect(resolveSpaceCoordinatePath(resources.path, null)).toBe('/next')
  })
})

// ---------------------------------------------------------------------------
describe('Ctrl+M 空间地图：输入「资源」「成员」「文件」高亮坐标并点击直达（tasks 4.6）', () => {
  /** 模拟 W4 装配路径（useNextShortcuts Cmd/Ctrl+M 全局监听）的薄壳。 */
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

  test('项目上下文中按 Ctrl+M 输入「资源」：唯一高亮资源工作台卡并直达 /next/projects/42/resources', () => {
    useProjectSpaceEntityStore.setState({ projectId: 42, entityTitle: '开项核心引擎' })
    render(<OverlayHarness />)
    expect(screen.queryByRole('dialog', { name: '空间地图' })).toBeNull()

    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    const dialog = screen.getByRole('dialog', { name: '空间地图' })
    expect(dialog).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜索空间坐标' }))

    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: '资源' } })
    const resourcesCard = screen.getByRole('button', { name: /资源工作台/ })
    expect(resourcesCard).toHaveAttribute('data-space-coordinate', 'resources')
    expect(resourcesCard).toHaveAttribute('data-status', 'available')
    expect(resourcesCard).toBeEnabled()
    expect(screen.queryByRole('button', { name: /成员与团队/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /项目文件库/ })).not.toBeInTheDocument()

    fireEvent.click(resourcesCard)
    expect(screen.queryByRole('dialog', { name: '空间地图' })).not.toBeInTheDocument()
    expect(navMock.push).toHaveBeenCalledTimes(1)
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/resources')
  })

  test('输入「成员」/「文件」：唯一高亮对应坐标并直达成员域与文件域', () => {
    useProjectSpaceEntityStore.setState({ projectId: 42, entityTitle: '开项核心引擎' })
    render(<OverlayHarness />)
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })

    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: '成员' } })
    const membersCard = screen.getByRole('button', { name: /成员与团队/ })
    expect(membersCard).toHaveAttribute('data-space-coordinate', 'members')
    expect(screen.queryByRole('button', { name: /资源工作台/ })).not.toBeInTheDocument()
    fireEvent.click(membersCard)
    expect(navMock.push).toHaveBeenLastCalledWith('/next/projects/42/members')

    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '文件' } })
    const filesCard = screen.getByRole('button', { name: /项目文件库/ })
    expect(filesCard).toHaveAttribute('data-space-coordinate', 'files')
    expect(screen.queryByRole('button', { name: /成员与团队/ })).not.toBeInTheDocument()
    fireEvent.click(filesCard)
    expect(navMock.push).toHaveBeenLastCalledWith('/next/projects/42/files')
  })

  test('共享检索词「人员」双卡片共存；Esc 关闭后完全卸载', () => {
    useProjectSpaceEntityStore.setState({ projectId: 42, entityTitle: '开项核心引擎' })
    render(<OverlayHarness />)
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '人员' } })
    expect(screen.getByRole('button', { name: /资源工作台/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /成员与团队/ })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /项目文件库/ })).not.toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '空间地图' })).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-space-coordinate]')).toHaveLength(0)
  })

  test('全局视图（无项目上下文）点击项目级坐标：回退角色首页引导，绝不拼装假链接', () => {
    useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })
    render(<OverlayHarness />)
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true })

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '资源' } })
    // 坐标仍可点（available），点击按 resolveSpaceCoordinatePath 引导至角色首页
    fireEvent.click(screen.getByRole('button', { name: /资源工作台/ }))
    expect(screen.queryByRole('dialog', { name: '空间地图' })).not.toBeInTheDocument()
    expect(navMock.push).toHaveBeenCalledTimes(1)
    expect(navMock.push).toHaveBeenCalledWith('/next')
  })
})

// ---------------------------------------------------------------------------
describe('AI 同事三域意图规则（rule_nav_resources / rule_nav_members / rule_nav_files）', () => {
  test('「查看项目资源」→ rule_nav_resources：navigate_to_space + lens=resources + projectId 注入', () => {
    const intent = parseColleagueIntent('查看项目资源', projectCtx)
    expect(intent.toolName).toBe('navigate_to_space')
    expect(intent.matchedRuleId).toBe('rule_nav_resources')
    expect(intent.intentSource).toBe('rule_preset')
    expect(intent.confidence).toBe(1)
    expect(intent.parameters).toEqual({ lens: 'resources', depth: 'workbench', projectId: 42 })
    expect(intent.fallbackPrompt).toBeUndefined()
  })

  test('「管理项目成员」→ rule_nav_members：lens=members + projectId 注入', () => {
    const intent = parseColleagueIntent('管理项目成员', projectCtx)
    expect(intent.toolName).toBe('navigate_to_space')
    expect(intent.matchedRuleId).toBe('rule_nav_members')
    expect(intent.parameters).toEqual({ lens: 'members', depth: 'workbench', projectId: 42 })
  })

  test('「打开项目文件」→ rule_nav_files：lens=files + projectId 注入', () => {
    const intent = parseColleagueIntent('打开项目文件', projectCtx)
    expect(intent.toolName).toBe('navigate_to_space')
    expect(intent.matchedRuleId).toBe('rule_nav_files')
    expect(intent.parameters).toEqual({ lens: 'files', depth: 'workbench', projectId: 42 })
  })

  test('spec 变体均归入三域：资源库/工时负荷、人员列表/邀请成员、文档资料/文件列表', () => {
    expect(parseColleagueIntent('前往资源库', projectCtx).matchedRuleId).toBe('rule_nav_resources')
    expect(parseColleagueIntent('查看工时负荷', projectCtx).matchedRuleId).toBe(
      'rule_nav_resources',
    )
    expect(parseColleagueIntent('查看人员列表', projectCtx).matchedRuleId).toBe('rule_nav_members')
    expect(parseColleagueIntent('邀请成员', projectCtx).matchedRuleId).toBe('rule_nav_members')
    expect(parseColleagueIntent('查看文档资料', projectCtx).matchedRuleId).toBe('rule_nav_files')
    expect(parseColleagueIntent('打开项目文件列表', projectCtx).matchedRuleId).toBe(
      'rule_nav_files',
    )
  })

  test('无项目上下文（角色首页）唤起三域意图 → ContextMissingError 诚实引导', () => {
    for (const prompt of ['查看项目资源', '管理项目成员', '打开项目文件']) {
      expect(() => parseColleagueIntent(prompt, homeCtx)).toThrow(ContextMissingError)
      try {
        parseColleagueIntent(prompt, homeCtx)
      } catch (error) {
        expect((error as ContextMissingError).message).toBe(COLLEAGUE_CONTEXT_MISSING_TEXT)
      }
    }
  })
})

// ---------------------------------------------------------------------------
describe('与既有确定性规则共存回归（新规则不吞既有语义）', () => {
  test('图表馆专属诉求不被资源域规则抢占：「看资源负荷 / 人员负荷分析」仍为 chart=resource-load', () => {
    const viaLoad = parseColleagueIntent('看资源负荷', projectCtx)
    expect(viaLoad.matchedRuleId).toBe('rule_nav_chart_resource_load')
    expect(viaLoad.parameters.chart).toBe('resource-load')
    const viaTeam = parseColleagueIntent('人员负荷分析', projectCtx)
    expect(viaTeam.parameters.chart).toBe('resource-load')
    // 资源分解结构仍归 rbs 图表（先于泛化资源导航规则）
    expect(parseColleagueIntent('看资源分解结构', projectCtx).matchedRuleId).toBe(
      'rule_nav_chart_rbs',
    )
  })

  test('风险/变更治理语义不被协同域规则抢占；home 语义保持', () => {
    expect(parseColleagueIntent('打开项目风险工作台', projectCtx).matchedRuleId).toBe(
      'rule_nav_project_risks',
    )
    expect(parseColleagueIntent('去处理当前项目的变更请求', projectCtx).matchedRuleId).toBe(
      'rule_nav_project_change_requests',
    )
    expect(parseColleagueIntent('查看风险列表', projectCtx).toolName).toBe('list_project_risks')
    expect(parseColleagueIntent('返回首页', projectCtx).parameters).toEqual({ lens: 'overview' })
    expect(parseColleagueIntent('去工作台', projectCtx).parameters).toEqual({ lens: 'overview' })
  })

  test('全域（无项目上下文）「查看项目资源」仍抛上下文缺失而非返回假路径', () => {
    expect(() => parseColleagueIntent('查看项目资源', homeCtx)).toThrow(ContextMissingError)
    expect(() => parseColleagueIntent('查看资源', homeCtx)).toThrow(ContextMissingError)
  })
})
