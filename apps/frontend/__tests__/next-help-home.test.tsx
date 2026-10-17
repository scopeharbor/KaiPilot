/**
 * v3-ui-next-help-knowledge-domain W1 · tasks 1.4 —— 帮助中心首页工作区与页面装配测试
 * （spec「帮助中心首页与模块导航浏览」场景）。
 *
 * 覆盖：版本徽标/搜索框回显、学习路径「开始使用」直达链接（含缺失回退占位）、
 * 模块网格渲染与 4 篇截断、故障排查与最近更新清单、暗黑仪器感样式与
 * data-testid 完备性、真实内容 RSC 页面毫秒级直出冒烟。
 */
import * as React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { HelpHomeWorkspace } from '@/components/next/help/HelpHomeWorkspace'
import NextHelpHomePage from '@/app/(next)/next/help/page'
import type {
  HelpArticleSummary,
  HelpModuleGridItem,
  HelpRecentEntry,
  HelpResolvedLearningPath,
} from '@/lib/next/help/help-adapter'

const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const LEARNING_PATHS: HelpResolvedLearningPath[] = [
  {
    id: 'project-manager',
    label: '项目经理',
    description: '计划、执行、风险与变更的全周期操作。',
    firstArticleId: 'projects.gantt',
    articles: [{ id: 'projects.gantt', title: '甘特图排程' }],
  },
  {
    id: 'new-user',
    label: '新手入门',
    description: '注册登录后，从创建第一个项目开始。',
    firstArticleId: null,
    articles: [],
  },
]

const MODULE_GRID: HelpModuleGridItem[] = [
  {
    areaId: 'projects',
    areaLabel: '项目与视图',
    description: '项目生命周期与六种视图。',
    totalArticles: 6,
    guides: Array.from({ length: 4 }, (_, index) => ({
      id: `projects.guide-${index}`,
      title: `项目指南 ${index + 1}`,
    })),
  },
  {
    areaId: 'ai',
    areaLabel: 'AI 能力',
    totalArticles: 1,
    guides: [{ id: 'ai.configure-ai-connections', title: '配置 AI 连接' }],
  },
  {
    areaId: 'troubleshooting',
    areaLabel: '故障排查',
    totalArticles: 2,
    guides: [
      { id: 'troubleshooting.login', title: '登录失败排查' },
      { id: 'troubleshooting.loading', title: '页面加载失败排查' },
    ],
  },
]

const TROUBLESHOOTING: HelpArticleSummary[] = [
  {
    id: 'troubleshooting.login',
    title: '登录失败排查',
    summary: '登录异常怎么处理。',
  },
  {
    id: 'troubleshooting.loading',
    title: '页面加载失败排查',
    summary: '加载异常怎么处理。',
  },
]

const RECENT: HelpRecentEntry[] = [
  {
    id: 'projects.gantt',
    title: '使用甘特图排程',
    area: 'projects',
    areaLabel: '项目与视图',
    updatedAt: '2026-09-02',
  },
  {
    id: 'ai.configure-ai-connections',
    title: '配置 AI 连接',
    area: 'ai',
    areaLabel: 'AI 能力',
    updatedAt: '2026-09-01',
  },
]

function renderHome(props?: Partial<Parameters<typeof HelpHomeWorkspace>[0]>) {
  return render(
    <HelpHomeWorkspace
      productVersion={props?.productVersion ?? 'v3'}
      moduleGrid={props?.moduleGrid ?? MODULE_GRID}
      learningPaths={props?.learningPaths ?? LEARNING_PATHS}
      troubleshooting={props?.troubleshooting ?? TROUBLESHOOTING}
      recent={props?.recent ?? RECENT}
    />,
  )
}

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
})

// ---------------------------------------------------------------------------
// 首屏：版本徽标与搜索框回显
// ---------------------------------------------------------------------------

describe('HelpHomeWorkspace：首屏检索与版本状态（spec「帮助中心首页」）', () => {
  test('渲染标题、版本徽标回显 productVersion 与全宽搜索框', () => {
    renderHome({ productVersion: 'v3.1' })
    expect(screen.getByRole('heading', { name: /帮助与文档/ })).toBeInTheDocument()
    const badge = screen.getByTestId('next-help-version-badge')
    expect(badge.textContent).toContain('当前产品版本 v3.1')
    const input = screen.getByTestId('next-help-home-search-input') as HTMLInputElement
    expect(input).toBeInTheDocument()
    expect(input.getAttribute('placeholder')).toContain('创建项目')
    expect(screen.getByTestId('next-help-home-search-submit')).toHaveTextContent('搜索')
  })

  test('回车或点击搜索：携带 ?q= 客户端导航至 /next/help/search（空词不导航）', () => {
    renderHome()
    const input = screen.getByTestId('next-help-home-search-input')
    fireEvent.change(input, { target: { value: '甘特图' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(navMock.push).toHaveBeenCalledWith('/next/help/search?q=%E7%94%98%E7%89%B9%E5%9B%BE')

    navMock.push.mockClear()
    fireEvent.change(input, { target: { value: '报表' } })
    fireEvent.click(screen.getByTestId('next-help-home-search-submit'))
    expect(navMock.push).toHaveBeenCalledWith('/next/help/search?q=%E6%8A%A5%E8%A1%A8')

    navMock.push.mockClear()
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(navMock.push).not.toHaveBeenCalled()
  })

  test('故障排查 / 部署与运维支持快捷入口直达对应搜索词', () => {
    renderHome()
    expect(screen.getByTestId('next-help-quick-troubleshooting').getAttribute('href')).toBe(
      '/next/help/search?q=%E6%95%85%E9%9A%9C',
    )
    expect(screen.getByTestId('next-help-quick-deploy').getAttribute('href')).toBe(
      '/next/help/search?q=%E9%83%A8%E7%BD%B2',
    )
  })
})

// ---------------------------------------------------------------------------
// 学习路径卡片
// ---------------------------------------------------------------------------

describe('HelpHomeWorkspace：按角色学习路径（spec 场景「从角色学习卡片点击直达推荐文章」）', () => {
  test('学习路径卡片渲染「开始使用」，链接携带目标文章 ID', () => {
    renderHome()
    const section = screen.getByTestId('next-help-learning-paths')
    const card = within(section).getByTestId('next-help-path-project-manager')
    expect(within(card).getByText('项目经理')).toBeInTheDocument()
    expect(within(card).getByText('计划、执行、风险与变更的全周期操作。')).toBeInTheDocument()
    const cta = within(card).getByTestId('next-help-path-start-project-manager')
    expect(cta.getAttribute('href')).toBe('/next/help/articles/projects.gantt')
    expect(cta).toHaveTextContent('开始使用')
  })

  test('路径文章缺失：渲染「内容准备中」占位且无直达链接', () => {
    renderHome()
    const card = screen.getByTestId('next-help-path-new-user')
    expect(within(card).getByTestId('next-help-path-empty-new-user')).toHaveTextContent(
      '内容准备中',
    )
    expect(within(card).queryByRole('link')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 模块网格
// ---------------------------------------------------------------------------

describe('HelpHomeWorkspace：产品模块网格（spec「产品模块导航矩阵」）', () => {
  test('渲染全部可用模块卡片，每卡最多 4 篇指南链接', () => {
    renderHome()
    const section = screen.getByTestId('next-help-modules')
    expect(section.querySelectorAll('[data-testid^="next-help-module-"]')).toHaveLength(3)

    const projects = within(section).getByTestId('next-help-module-projects')
    expect(within(projects).getByText('项目与视图')).toBeInTheDocument()
    expect(projects.textContent).toContain('6 篇')
    // 总数 6 但只展示 4 篇推荐
    expect(within(projects).queryAllByRole('link')).toHaveLength(4)
    expect(
      projects.querySelector('[data-testid="next-help-guide-projects.guide-0"]'),
    ).not.toBeNull()
    expect(within(projects).queryByText('项目指南 5')).toBeNull()
    expect(within(projects).queryByText('项目指南 6')).toBeNull()
  })

  test('指南链接与故障排查文章链接携带文章详情路由', () => {
    renderHome()
    expect(
      screen.getByTestId('next-help-guide-ai.configure-ai-connections').getAttribute('href'),
    ).toBe('/next/help/articles/ai.configure-ai-connections')
  })
})

// ---------------------------------------------------------------------------
// 故障排查与最近更新
// ---------------------------------------------------------------------------

describe('HelpHomeWorkspace：故障排查与最近更新（spec「最近更新文档底册」）', () => {
  test('故障排查清单渲染标题与摘要；空清单时整个区块隐藏', () => {
    const first = renderHome()
    const section = screen.getByTestId('next-help-troubleshooting')
    const login = within(section).getByTestId('next-help-trouble-troubleshooting.login')
    expect(login).toHaveTextContent('登录失败排查')
    expect(login).toHaveTextContent('登录异常怎么处理。')
    expect(login.getAttribute('href')).toBe('/next/help/articles/troubleshooting.login')
    first.unmount()

    renderHome({ troubleshooting: [] })
    expect(screen.queryByTestId('next-help-troubleshooting')).toBeNull()
  })

  test('最近更新按行渲染标题、模块微标与更新时间（降序已由适配器保证）', () => {
    renderHome()
    const section = screen.getByTestId('next-help-recent')
    const first = within(section).getByTestId('next-help-recent-projects.gantt')
    expect(first).toHaveTextContent('使用甘特图排程')
    expect(first).toHaveTextContent('项目与视图')
    expect(first).toHaveTextContent('2026-09-02')
    const second = within(section).getByTestId('next-help-recent-ai.configure-ai-connections')
    expect(second.textContent).toMatch(/配置 AI 连接/)
  })
})

// ---------------------------------------------------------------------------
// 暗黑仪器感样式与 testid 完备性
// ---------------------------------------------------------------------------

describe('HelpHomeWorkspace：Layer 2 暗黑仪器感样式（RL-15）', () => {
  test('模块卡片与面板挂载发丝线边框/工作面表面令牌类', () => {
    const { container } = renderHome()
    const cards = container.querySelectorAll('[data-testid^="next-help-module-"]')
    expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) {
      expect(card.className).toContain('border-[var(--nx-border-hairline)]')
      expect(card.className).toContain('bg-[var(--nx-workspace-surface)]')
    }
    const root = screen.getByTestId('next-help-home')
    expect(root.className).toContain('max-w-6xl')
    expect(document.querySelector('[data-testid="next-help-learning-paths"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="next-help-modules"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="next-help-recent"]')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 真实内容 RSC 页面装配
// ---------------------------------------------------------------------------

describe('NextHelpHomePage：RSC 直出装配（spec「毫秒级直出」）', () => {
  test('真实内容树渲染：版本徽标 v3、全部模块卡片、5 条最近更新与故障排查区', async () => {
    const element = await NextHelpHomePage()
    render(element)
    expect(screen.getByTestId('next-help-home')).toBeInTheDocument()
    expect(screen.getByTestId('next-help-version-badge').textContent).toContain('当前产品版本 v3')

    const moduleSection = screen.getByTestId('next-help-modules')
    const moduleCards = moduleSection.querySelectorAll('[data-testid^="next-help-module-"]')
    // navigation.yaml 现有 10 个 area 全部含文章 → 10 张模块卡
    expect(moduleCards.length).toBeGreaterThanOrEqual(10)
    // 每张卡片推荐指南不超过 4 篇且至少 1 篇
    for (const card of moduleCards) {
      const guideCount = card.querySelectorAll('a').length
      expect(guideCount).toBeGreaterThanOrEqual(1)
      expect(guideCount).toBeLessThanOrEqual(4)
    }

    // 最近更新 5 条（RECENT_ARTICLES_LIMIT）
    expect(document.querySelectorAll('[data-testid^="next-help-recent-"]')).toHaveLength(5)
    // 故障排查区（area 内 7 篇）
    const troubleshootingSection = screen.getByTestId('next-help-troubleshooting')
    expect(
      troubleshootingSection.querySelectorAll('[data-testid^="next-help-trouble-"]'),
    ).toHaveLength(7)
    // 学习路径 4 条全部具备「开始使用」目标
    for (const id of ['new-user', 'project-manager', 'org-admin', 'developer']) {
      expect(document.querySelector(`[data-testid="next-help-path-${id}"]`)).not.toBeNull()
      expect(document.querySelector(`[data-testid="next-help-path-start-${id}"]`)).not.toBeNull()
    }
  })
})
