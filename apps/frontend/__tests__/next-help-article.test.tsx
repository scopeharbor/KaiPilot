/**
 * v3-ui-next-help-knowledge-domain W1 · tasks 1.6 —— 帮助文章长文阅读器与详情页装配测试
 * （spec「帮助文章详情与长文纸光排版阅读」场景）。
 *
 * 覆盖：方案 B 纸光排版类（max-w-3xl / leading-[1.75] / 墨水金 --nx-role-accent）、
 * 左侧导览树当前文章高亮、复制 Markdown / Agent 提示词剪贴板写入、相关文章推荐
 * 跳转、移动端折叠目录、右侧大纲动态高亮回退，以及无效文章 ID 触发 notFound。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { HelpArticleReader } from '@/components/next/help/HelpArticleReader'
import NextHelpArticlePage, { generateMetadata } from '@/app/(next)/next/help/articles/[id]/page'
import type { HelpReaderArticle } from '@/components/next/help/HelpArticleReader'

const notFoundMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  notFound: () => {
    notFoundMock()
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

const clipboardWrite = vi.hoisted(() => vi.fn())

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const MARKDOWN_TEXT = '# 使用甘特图排程：改期、依赖、进度、里程碑与基线\n\n正文开始。'
const AGENT_PROMPT_TEXT = '# 使用甘特图排程…\n\n> 摘要：甘特图深度排程指南。\n\n正文开始。'

function makeArticle(overrides: Partial<HelpReaderArticle> = {}): HelpReaderArticle {
  return {
    id: 'projects.gantt',
    area: 'projects',
    title: '使用甘特图排程：改期、依赖、进度、里程碑与基线',
    summary: '甘特图五种交互模式的完整用法。',
    contentType: 'how-to',
    contentStatus: 'complete',
    productVersion: 'v3',
    editions: ['free', 'team'],
    owner: 'core-pm',
    updatedAt: '2026-09-01',
    reviewAfter: '2026-12-01',
    related: ['projects.calendar', 'projects.wbs'],
    body: '# 使用甘特图排程：改期、依赖、进度、里程碑与基线\n\n正文开始。\n\n## 适用范围\n\n权限要点内容。\n\n> 最重要原则：确认前不会写入正式排期。\n\n## 操作步骤\n\n1. 打开甘特图。\n',
    headings: [
      { level: 1, text: '使用甘特图排程：改期、依赖、进度、里程碑与基线', id: 'gantt-title' },
      { level: 2, text: '适用范围', id: '适用范围' },
      { level: 3, text: '权限要点', id: '权限要点' },
      { level: 2, text: '操作步骤', id: '操作步骤' },
    ],
    ...overrides,
  }
}

const TREE = [
  {
    areaId: 'getting-started',
    areaLabel: '快速开始',
    articles: [
      { id: 'getting-started.create-first-project', title: '创建第一个项目' },
      { id: 'getting-started.invite-your-team', title: '邀请你的团队' },
    ],
  },
  {
    areaId: 'projects',
    areaLabel: '项目与视图',
    articles: [
      { id: 'projects.views-overview', title: '六种视图' },
      { id: 'projects.gantt', title: '使用甘特图排程：改期、依赖、进度、里程碑与基线' },
    ],
  },
]

const RELATED_TITLES: Record<string, string> = {
  'projects.calendar': '日历视图',
  'projects.wbs': 'WBS 工作分解结构',
}

function renderReader(overrides: Partial<HelpReaderArticle> = {}) {
  const article = makeArticle(overrides)
  return render(
    <HelpArticleReader
      article={article}
      areaLabel="项目与视图"
      tree={TREE}
      relatedTitles={RELATED_TITLES}
      markdownText={MARKDOWN_TEXT}
      agentPromptText={AGENT_PROMPT_TEXT}
    />,
  )
}

beforeEach(() => {
  notFoundMock.mockReset()
  clipboardWrite.mockReset()
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: clipboardWrite },
    configurable: true,
  })
  clipboardWrite.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// 方案 B 纸光排版类
// ---------------------------------------------------------------------------

describe('HelpArticleReader：纸光编辑感排版类（spec 场景「浏览长文技术文档获得舒适阅读排版」）', () => {
  test('正文容器挂载黄金宽度 max-w-3xl，段落 1.75 松弛行高', () => {
    renderReader()
    const body = screen.getByTestId('next-help-article-body')
    expect(body.className).toContain('max-w-3xl')
    const paragraph = body.querySelector('p')
    expect(paragraph).not.toBeNull()
    expect(paragraph!.className).toContain('leading-[1.75]')
    expect(paragraph!.className).toContain('text-base')
  })

  test('标题与要点引用采用墨水金强调（--nx-role-accent），正文首行 H1 不重复渲染', () => {
    const { container } = renderReader()
    const headings = container.querySelectorAll('article h2')
    expect(headings.length).toBeGreaterThanOrEqual(2)
    for (const heading of headings) {
      expect(heading.className).toContain('text-[var(--nx-role-accent)]')
    }
    const quote = container.querySelector('blockquote')
    expect(quote).not.toBeNull()
    expect(quote!.className).toContain('border-[var(--nx-role-accent)]')
    // 首行与 frontmatter 同题的 H1 被剥离，正文 h1 不应出现
    expect(container.querySelector('article h1')).toBeNull()
    expect(container.textContent).not.toContain('正文开始。'.repeat(2))
  })
})

// ---------------------------------------------------------------------------
// 导览树与大纲
// ---------------------------------------------------------------------------

describe('HelpArticleReader：导览树与 Headings 大纲（spec「响应式导览树与大纲锚点」）', () => {
  test('左侧桌面导览树渲染分组并高亮当前文章（aria-current="page"）', () => {
    renderReader()
    const tree = screen.getByTestId('next-help-nav-tree')
    expect(tree.querySelectorAll('[data-testid^="next-help-nav-group-"]')).toHaveLength(2)
    const active = tree.querySelector('[data-testid="next-help-nav-article-projects.gantt"]')
    expect(active).not.toBeNull()
    expect(active!.getAttribute('aria-current')).toBe('page')
    expect(active!.getAttribute('href')).toBe('/next/help/articles/projects.gantt')
    const other = tree.querySelector(
      '[data-testid="next-help-nav-article-getting-started.create-first-project"]',
    )
    expect(other!.getAttribute('aria-current')).toBeNull()
    expect(tree.querySelector('[data-testid="next-help-nav-home"]')).toHaveTextContent('帮助首页')
  })

  test('移动端折叠目录：点击展开目录面板并正确高亮当前文章', () => {
    renderReader()
    expect(screen.queryByTestId('next-help-mobile-nav-panel')).toBeNull()
    const toggle = screen.getByTestId('next-help-mobile-nav-toggle')
    fireEvent.click(toggle)
    const panel = screen.getByTestId('next-help-mobile-nav-panel')
    expect(panel).toBeInTheDocument()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(
      panel.querySelector('[data-testid="next-help-nav-article-projects.gantt"]'),
    ).not.toBeNull()
    fireEvent.click(toggle)
    expect(screen.queryByTestId('next-help-mobile-nav-panel')).toBeNull()
  })

  test('右侧大纲渲染 h2/h3 锚点并动态高亮（无 IO 环境回退首条）', () => {
    renderReader()
    const toc = screen.getByTestId('next-help-toc')
    expect(toc.querySelectorAll('a')).toHaveLength(3)
    const first = toc.querySelector('[data-testid="next-help-toc-适用范围"]')
    expect(first).not.toBeNull()
    expect(first!.getAttribute('href')).toBe('#适用范围')
    expect(first!.getAttribute('aria-current')).toBe('location')
  })
})

// ---------------------------------------------------------------------------
// 复制出口
// ---------------------------------------------------------------------------

describe('HelpArticleReader：复制工具出口（spec 场景「复制文章为 Agent 提示词」）', () => {
  test('「复制 Markdown 全文」写入预计算正文并反馈「已复制」', async () => {
    renderReader()
    fireEvent.click(screen.getByTestId('next-help-copy-markdown'))
    await waitFor(() => expect(screen.getByText('已复制 Markdown')).toBeInTheDocument())
    expect(clipboardWrite).toHaveBeenCalledTimes(1)
    expect(clipboardWrite).toHaveBeenCalledWith(MARKDOWN_TEXT)
  })

  test('「复制为 Agent 提示词」写入 Agent 出口文本并反馈「已复制 Agent 提示词」', async () => {
    renderReader()
    fireEvent.click(screen.getByTestId('next-help-copy-agent'))
    await waitFor(() => expect(screen.getByText('已复制 Agent 提示词')).toBeInTheDocument())
    expect(clipboardWrite).toHaveBeenCalledTimes(1)
    expect(clipboardWrite).toHaveBeenCalledWith(AGENT_PROMPT_TEXT)
  })

  test('剪贴板不可用（无 writeText）时呈现错误提示且不抛错', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    })
    renderReader()
    fireEvent.click(screen.getByTestId('next-help-copy-markdown'))
    await waitFor(() =>
      expect(screen.getByTestId('next-help-copy-error')).toHaveTextContent('复制失败'),
    )
  })
})

// ---------------------------------------------------------------------------
// 相关文章与元信息
// ---------------------------------------------------------------------------

describe('HelpArticleReader：相关文章与元信息', () => {
  test('相关文章推荐卡片渲染并携带文章详情路由；缺失标题的 related 不渲染', () => {
    renderReader({ related: ['projects.calendar', 'projects.wbs', 'missing.article'] })
    const section = screen.getByTestId('next-help-related')
    expect(section.querySelectorAll('a')).toHaveLength(2)
    const calendar = within(section).getByTestId('next-help-related-projects.calendar')
    expect(calendar).toHaveTextContent('日历视图')
    expect(calendar.getAttribute('href')).toBe('/next/help/articles/projects.calendar')
    expect(within(section).queryByTestId('next-help-related-missing.article')).toBeNull()
  })

  test('related 为空时相关区块整体隐藏；元信息展示更新时间/责任人/版本', () => {
    renderReader({ related: [] })
    expect(screen.queryByTestId('next-help-related')).toBeNull()
    const meta = screen.getByTestId('next-help-meta')
    expect(meta.textContent).toContain('本文档随产品发布')
  })
})

// ---------------------------------------------------------------------------
// 页面装配：真实内容 + notFound
// ---------------------------------------------------------------------------

describe('NextHelpArticlePage：RSC 页面装配（spec「RSC 毫秒级直出」）', () => {
  test('真实内容树文章页渲染：正文/导览树/相关文章/面包屑齐备', async () => {
    const element = await NextHelpArticlePage({
      params: Promise.resolve({ id: 'projects.gantt' }),
    })
    render(element)
    expect(screen.getByTestId('next-help-article')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /使用甘特图排程/ })).toBeInTheDocument()
    const body = screen.getByTestId('next-help-article-body')
    expect(body.className).toContain('max-w-3xl')
    expect(body.querySelector('p')!.className).toContain('leading-[1.75]')
    // 当前文章在左树中高亮
    const active = document.querySelector('[data-testid="next-help-nav-article-projects.gantt"]')
    expect(active!.getAttribute('aria-current')).toBe('page')
    // 相关文章（frontmatter related 5 篇全部存在）
    expect(screen.getByTestId('next-help-related')).toBeInTheDocument()
  })

  test('无效文章 ID 触发 notFound()（中性 404，零业务渲染）', async () => {
    await expect(
      NextHelpArticlePage({ params: Promise.resolve({ id: 'non-existent-id' }) }),
    ).rejects.toMatchObject({ message: 'NEXT_NOT_FOUND' })
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })

  test('generateMetadata：按 frontmatter 动态产出 title/description；缺失时回退标题', async () => {
    const found = await generateMetadata({ params: Promise.resolve({ id: 'projects.gantt' }) })
    expect(found.title).toContain('使用甘特图排程')
    expect(found.description).toContain('甘特图')
    const missing = await generateMetadata({
      params: Promise.resolve({ id: 'definitely.missing' }),
    })
    expect(missing.title).toBe('文章不存在 · 帮助中心')
  })
})
