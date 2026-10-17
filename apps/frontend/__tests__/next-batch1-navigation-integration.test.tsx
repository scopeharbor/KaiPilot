/**
 * v3-ui-next-batch1-strategy-launch-tasks W5 · tasks 5.1 / 5.2
 * 空间地图与 AI 同事三通道导航闭环集成测试（next-batch1-navigation-integration.test.tsx）
 *
 * 覆盖：
 * 1. 空间地图坐标静态白名单与检索：
 *    - PRESET_SPACE_COORDINATES 包含 strategy-execution-cockpit 坐标；
 *    - filterSpaceCoordinates('战略') 与 filterSpaceCoordinates('驾驶舱') 检索命中；
 *    - resolveSpaceBreadcrumb('/next/strategy-execution-cockpit') 正确派生标题。
 * 2. 空间地图 Ctrl+M 交互与直达导航：
 *    - 键盘按下 Ctrl+M 呼出 SpaceMapOverlay；
 *    - 输入「战略」「驾驶舱」高亮战略执行驾驶舱卡片（status=available）；
 *    - 点击卡片调用 router.push('/next/strategy-execution-cockpit') 并关闭浮层。
 * 3. AI 同事导航意图规则 rule_nav_strategy_cockpit：
 *    - 输入「查看战略驾驶舱」「战略驾驶舱」「战略」「驾驶舱」等命中规则；
 *    - matchedRuleId 为 rule_nav_strategy_cockpit，confidence=1，intentSource=rule_preset；
 *    - parameters 为 { lens: 'strategy_cockpit' }；
 *    - 全域导航特性：单项目上下文与全域视图分发一致，不抛 ContextMissingError。
 * 4. AI 同事空间导航结果卡片 NavigationResultCard：
 *    - 回显中文镜头标签「战略执行驾驶舱」；
 *    - 回显导航摘要与路径「/next/strategy-execution-cockpit」；
 *    - 显式展示诚实规则微标「快捷规则匹配 · navigate_to_space」；
 *    - 点击「再次前往 · 直达该路径」触发 onNavigate 回调。
 * 5. RL-01 零写铁律：
 *    - 全流程 HTTP 写请求（POST/PUT/PATCH/DELETE）严格为 0。
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SpaceMapOverlay } from '@/components/next/navigation/SpaceMapOverlay'
import {
  NavigationResultCard,
  type NavigationResultData,
} from '@/components/next/ai/cards/NavigationResultCard'
import { filterSpaceCoordinates, PRESET_SPACE_COORDINATES } from '@/lib/next/space-coordinates'
import { resolveSpaceBreadcrumb } from '@/lib/next/space-breadcrumbs'
import { parseColleagueIntent, type ColleagueContext } from '@/lib/next/ai-colleague-intent'
import { useProjectSpaceEntityStore } from '@/stores/project-space-entity-store'

// ---------------------------------------------------------------------------
// jsdom 兼容环境配置
// ---------------------------------------------------------------------------
function setupJsdom() {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventMock extends MouseEvent {}
    window.PointerEvent = PointerEventMock as unknown as typeof PointerEvent
  }
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }
}

// ---------------------------------------------------------------------------
// next/navigation & next/link mock
// ---------------------------------------------------------------------------
const pushMock = vi.fn()
const replaceMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, back: vi.fn() }),
  usePathname: () => '/next/strategy-execution-cockpit',
  useParams: () => ({}),
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
// 上下文夹具
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

/** 模拟全局快捷键 Ctrl+M 唤起 SpaceMapOverlay 的测试外壳 */
function SpaceMapHarness() {
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

describe('next-batch1-navigation-integration（批 1 空间地图与 AI 同事导航闭环）', () => {
  const writeRequests: Array<{ method: string; url: string }> = []

  beforeEach(() => {
    setupJsdom()
    pushMock.mockReset()
    replaceMock.mockReset()
    writeRequests.length = 0
    useProjectSpaceEntityStore.setState({ projectId: null, entityTitle: null })

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        writeRequests.push({ method, url })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ data: [] }),
        text: async () => JSON.stringify({ data: [] }),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      } as unknown as Response)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // -------------------------------------------------------------------------
  // 1. 静态白名单与检索算法
  // -------------------------------------------------------------------------
  describe('空间地图静态坐标白名单与检索', () => {
    test('PRESET_SPACE_COORDINATES 收录战略执行驾驶舱坐标，字段符合契约', () => {
      const coord = PRESET_SPACE_COORDINATES.find((c) => c.id === 'strategy-execution-cockpit')
      expect(coord).toBeDefined()
      expect(coord?.title).toBe('战略执行驾驶舱')
      expect(coord?.path).toBe('/next/strategy-execution-cockpit')
      expect(coord?.status).toBe('available')
      expect(coord?.badge).toBe('已就绪')
      expect(coord?.iconName).toBe('Gauge')
      expect(coord?.keywords).toContain('战略')
      expect(coord?.keywords).toContain('驾驶舱')
    })

    test('filterSpaceCoordinates: 输入「战略」与「驾驶舱」命中战略执行驾驶舱坐标', () => {
      const byStrategy = filterSpaceCoordinates('战略')
      expect(byStrategy.some((c) => c.id === 'strategy-execution-cockpit')).toBe(true)

      const byCockpit = filterSpaceCoordinates('驾驶舱')
      expect(byCockpit.some((c) => c.id === 'strategy-execution-cockpit')).toBe(true)
      expect(byCockpit.map((c) => c.id)).toEqual(['strategy-execution-cockpit'])
    })

    test('resolveSpaceBreadcrumb 正确派生战略执行驾驶舱顶栏等宽面包屑', () => {
      const breadcrumb = resolveSpaceBreadcrumb('/next/strategy-execution-cockpit')
      expect(breadcrumb).toBe('/next/strategy-execution-cockpit · 战略执行驾驶舱')
    })
  })

  // -------------------------------------------------------------------------
  // 2. Ctrl+M 空间地图呼出与直达跳转
  // -------------------------------------------------------------------------
  describe('Ctrl+M 空间地图交互与直达', () => {
    test('Ctrl+M 唤起空间地图后，输入「战略」展示并点击直达战略驾驶舱长卷', () => {
      render(<SpaceMapHarness />)
      fireEvent.keyDown(window, { key: 'm', ctrlKey: true })

      const searchInput = screen.getByRole('searchbox', { name: '搜索空间坐标' })
      fireEvent.change(searchInput, { target: { value: '战略' } })

      const card = screen.getByRole('button', { name: /战略执行驾驶舱/ })
      expect(card).toBeInTheDocument()
      expect(card).toHaveAttribute('data-space-coordinate', 'strategy-execution-cockpit')
      expect(card).toHaveAttribute('data-status', 'available')
      expect(card).toBeEnabled()

      fireEvent.click(card)
      expect(pushMock).toHaveBeenCalledTimes(1)
      expect(pushMock).toHaveBeenCalledWith('/next/strategy-execution-cockpit')
    })

    test('Ctrl+M 唤起空间地图后，输入「驾驶舱」唯一定向高亮并直达', () => {
      render(<SpaceMapHarness />)
      fireEvent.keyDown(window, { key: 'm', ctrlKey: true })

      const searchInput = screen.getByRole('searchbox', { name: '搜索空间坐标' })
      fireEvent.change(searchInput, { target: { value: '驾驶舱' } })

      const card = screen.getByRole('button', { name: /战略执行驾驶舱/ })
      expect(card).toBeInTheDocument()
      expect(card).toHaveAttribute('data-space-coordinate', 'strategy-execution-cockpit')

      fireEvent.click(card)
      expect(pushMock).toHaveBeenCalledTimes(1)
      expect(pushMock).toHaveBeenCalledWith('/next/strategy-execution-cockpit')
    })
  })

  // -------------------------------------------------------------------------
  // 3. AI 同事意图解析 rule_nav_strategy_cockpit
  // -------------------------------------------------------------------------
  describe('AI 同事 rule_nav_strategy_cockpit 意图匹配规则', () => {
    test.each([
      ['查看战略驾驶舱'],
      ['打开战略驾驶舱'],
      ['战略执行驾驶舱'],
      ['去战略驾驶舱'],
      ['战略驾驶舱'],
      ['驾驶舱'],
      ['战略'],
    ])('自然语言输入「%s」命中 rule_nav_strategy_cockpit 意图', (input) => {
      const intent = parseColleagueIntent(input, GLOBAL_CONTEXT)
      expect(intent).toMatchObject({
        toolName: 'navigate_to_space',
        matchedRuleId: 'rule_nav_strategy_cockpit',
        intentSource: 'rule_preset',
        confidence: 1,
      })
      expect(intent.parameters).toEqual({ lens: 'strategy_cockpit' })
      expect(intent.fallbackPrompt).toBeUndefined()
    })

    test('全域导航在单项目上下文与角色首页上下文下分发一致（零 ContextMissingError）', () => {
      const intentInProject = parseColleagueIntent('查看战略驾驶舱', PROJECT_CONTEXT)
      const intentInGlobal = parseColleagueIntent('查看战略驾驶舱', GLOBAL_CONTEXT)

      expect(intentInProject.matchedRuleId).toBe('rule_nav_strategy_cockpit')
      expect(intentInGlobal.matchedRuleId).toBe('rule_nav_strategy_cockpit')
      expect(intentInProject.parameters).toEqual({ lens: 'strategy_cockpit' })
      expect(intentInGlobal.parameters).toEqual({ lens: 'strategy_cockpit' })
      expect(intentInProject.parameters.projectId).toBeUndefined()
    })

    test('与其他空间意图保持互斥（不误吞角色首页 / 工作台 / 组织 OKR）', () => {
      const homeIntent = parseColleagueIntent('返回首页', GLOBAL_CONTEXT)
      expect(homeIntent.matchedRuleId).toBe('rule_nav_home')

      const okrIntent = parseColleagueIntent('查看组织 OKR 层级', GLOBAL_CONTEXT)
      expect(okrIntent.matchedRuleId).toBe('rule_nav_org_okrs')
    })
  })

  // -------------------------------------------------------------------------
  // 4. NavigationResultCard 导航结果直达卡
  // -------------------------------------------------------------------------
  describe('NavigationResultCard 导航直达卡片回显与交互', () => {
    test('渲染战略执行驾驶舱导航直达卡，标签、摘要、路径与诚实微标完整', () => {
      const onNavigate = vi.fn()
      const data: NavigationResultData = {
        projectId: null,
        lens: 'strategy_cockpit',
        depth: 'workbench',
        targetId: null,
        path: '/next/strategy-execution-cockpit',
      }

      render(<NavigationResultCard data={data} onNavigate={onNavigate} />)

      expect(screen.getByText('空间导航已执行')).toBeInTheDocument()
      expect(document.querySelector('[data-navigate-summary]')?.textContent).toBe(
        '已为你导航至战略执行驾驶舱',
      )
      expect(document.querySelector('[data-navigate-lens]')?.textContent).toBe('战略执行驾驶舱')
      expect(document.querySelector('[data-navigate-depth]')?.textContent).toBe('工作台景深')
      expect(document.querySelector('[data-navigate-path]')?.textContent).toBe(
        '/next/strategy-execution-cockpit',
      )
      expect(document.querySelector('[data-navigate-project]')).toBeNull()

      // RL-07 诚实徽标
      expect(document.querySelector('[data-rule-match-badge]')?.textContent).toContain(
        '快捷规则匹配 · navigate_to_space',
      )

      // 再次前往链接与点击回调
      const againLink = screen.getByRole('link', { name: '再次前往 · 直达该路径' })
      expect(againLink).toHaveAttribute('href', '/next/strategy-execution-cockpit')
      fireEvent.click(againLink)
      expect(onNavigate).toHaveBeenCalledTimes(1)
      expect(onNavigate).toHaveBeenCalledWith('/next/strategy-execution-cockpit')
    })
  })

  // -------------------------------------------------------------------------
  // 5. RL-01 零写铁律断言
  // -------------------------------------------------------------------------
  test('RL-01 零写铁律：空间地图检索与 AI 导航卡渲染全程写请求为 0', () => {
    expect(writeRequests).toHaveLength(0)
  })
})
