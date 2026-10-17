/**
 * v3-ui-next-help-knowledge-domain W1 · tasks 1.8 —— 帮助实时搜索工作区与页面参数重载测试
 * （spec「帮助中心实时搜索与关键词过滤」场景）。
 *
 * 覆盖：输入词即时收敛、标题/摘要关键词高亮包裹（--nx-role-accent 微光）、
 * `key={q}` 重挂载保证 URL 参数与输入/结果同步、回车提交 ?q=、空词引导 +
 * 热门词条、无匹配语义化空态 + 浏览模块返回，以及真实内容搜索页装配冒烟。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { HelpSearchWorkspace } from '@/components/next/help/HelpSearchWorkspace'
import NextHelpSearchPage from '@/app/(next)/next/help/search/page'
import type { HelpSearchDocument } from '@/lib/help/types'

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

function makeDoc(overrides: Partial<HelpSearchDocument> = {}): HelpSearchDocument {
  return {
    id: 'projects.gantt',
    title: '使用甘特图排程：改期、依赖、进度、里程碑与基线',
    summary: '甘特图五种交互模式的完整用法与预览确认流程。',
    contentType: 'how-to',
    area: 'projects',
    roles: ['project_manager'],
    updatedAt: '2026-09-01',
    headings: ['# 使用甘特图排程', '## 操作步骤'],
    keywords: ['甘特'],
    body: '正文：甘特图改期、依赖、里程碑与基线。',
    ...overrides,
  }
}

const DOCUMENTS: HelpSearchDocument[] = [
  makeDoc(),
  makeDoc({
    id: 'getting-started.create-first-project',
    title: '创建第一个项目：从一句话到正式项目',
    summary: '用一句话启动项目，AI 生成完整计划。',
    contentType: 'getting-started',
    area: 'getting-started',
    updatedAt: '2026-08-30',
    headings: ['# 创建第一个项目', '## 项目评审'],
    keywords: ['创建'],
    body: '创建项目流程与评审确认步骤。',
  }),
  makeDoc({
    id: 'deployment.docker-compose',
    title: 'Docker Compose 部署',
    summary: '单机容器化部署与常用运维命令。',
    contentType: 'how-to',
    area: 'deployment',
    updatedAt: '2026-08-28',
    headings: ['# Docker Compose 部署', '## 常用运维命令'],
    keywords: ['docker'],
    body: '部署步骤与备份升级说明。',
  }),
  makeDoc({
    id: 'management.reports',
    title: '报表中心与导出',
    summary: '预设报表模板与导出格式。',
    contentType: 'reference',
    area: 'management',
    updatedAt: '2026-08-25',
    headings: ['# 报表中心与导出'],
    keywords: [],
    body: '报表内容与权限说明。',
  }),
]

const AREAS = [
  { id: 'projects', label: '项目与视图' },
  { id: 'getting-started', label: '快速开始' },
  { id: 'deployment', label: '部署与运维' },
  { id: 'management', label: '项目执行' },
]

function renderSearch(initialQuery = '', documents = DOCUMENTS) {
  return render(
    <HelpSearchWorkspace initialQuery={initialQuery} documents={documents} areas={AREAS} />,
  )
}

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
})

// ---------------------------------------------------------------------------
// 即时检索与高亮
// ---------------------------------------------------------------------------

describe('HelpSearchWorkspace：即时检索（spec 场景「输入关键词即时查看高亮匹配结果」）', () => {
  test('输入搜索词后结果列表即时收敛', async () => {
    renderSearch()
    const input = screen.getByTestId('next-help-search-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '甘特图' } })
    await waitFor(() => expect(screen.getByTestId('next-help-search-results')).toBeInTheDocument())
    expect(screen.getByTestId('next-help-search-result-projects.gantt')).toBeInTheDocument()
    expect(screen.queryByTestId('next-help-search-result-deployment.docker-compose')).toBeNull()

    // 切换为无关词条 → 列表即时收敛为空态
    fireEvent.change(input, { target: { value: '量子物理' } })
    await waitFor(() =>
      expect(screen.getByTestId('next-help-search-no-result')).toBeInTheDocument(),
    )
  })

  test('命中关键词在标题与摘要中高亮包裹（墨水金 mark 微光）', async () => {
    renderSearch('甘特图')
    await waitFor(() =>
      expect(screen.getByTestId('next-help-search-result-projects.gantt')).toBeInTheDocument(),
    )
    const card = screen.getByTestId('next-help-search-result-projects.gantt')
    const title = within(card).getByTestId('next-help-search-hit-title')
    const titleMarks = title.querySelectorAll('mark[data-testid="next-help-search-mark"]')
    expect(titleMarks.length).toBeGreaterThan(0)
    expect(titleMarks[0]!.textContent).toBe('甘特图')
    expect(titleMarks[0]!.className).toContain('text-[var(--nx-role-accent)]')

    const summary = within(card).getByTestId('next-help-search-hit-summary')
    const summaryMarks = summary.querySelectorAll('mark[data-testid="next-help-search-mark"]')
    expect(summaryMarks.length).toBeGreaterThan(0)
    expect(summaryMarks[0]!.textContent).toBe('甘特图')
  })

  test('结果卡片携带模块微标与更新时间，点击直达文章详情路由', async () => {
    renderSearch('部署')
    await waitFor(() =>
      expect(
        screen.getByTestId('next-help-search-result-deployment.docker-compose'),
      ).toBeInTheDocument(),
    )
    const card = screen.getByTestId('next-help-search-result-deployment.docker-compose')
    expect(card.textContent).toContain('部署与运维')
    expect(card.textContent).toContain('更新于 2026-08-28')
    expect(card.getAttribute('href')).toBe('/next/help/articles/deployment.docker-compose')
  })
})

// ---------------------------------------------------------------------------
// URL 参数与 key={q} 同步
// ---------------------------------------------------------------------------

describe('HelpSearchWorkspace：URL 参数与重挂载（spec「URL 为单一事实来源」）', () => {
  test('回车与搜索按钮提交 ?q= 客户端导航', () => {
    renderSearch()
    const input = screen.getByTestId('next-help-search-input')
    fireEvent.change(input, { target: { value: '报表' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(navMock.push).toHaveBeenCalledWith('/next/help/search?q=%E6%8A%A5%E8%A1%A8')

    navMock.push.mockClear()
    fireEvent.change(input, { target: { value: '权限' } })
    fireEvent.click(screen.getByTestId('next-help-search-submit'))
    expect(navMock.push).toHaveBeenCalledWith('/next/help/search?q=%E6%9D%83%E9%99%90')

    navMock.push.mockClear()
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(navMock.push).not.toHaveBeenCalled()
  })

  test('key={q} 重挂载：新 URL 参数经 key 变化重建组件，输入与结果同步到最新词条', async () => {
    const first = renderSearch('甘特图')
    const firstInput = first.getByTestId('next-help-search-input') as HTMLInputElement
    expect(firstInput.value).toBe('甘特图')
    await waitFor(() =>
      expect(first.getByTestId('next-help-search-result-projects.gantt')).toBeInTheDocument(),
    )
    first.unmount()

    // 模拟软导航 ?q=甘特图 → ?q=部署：页面以新 key 重挂载工作区
    const second = renderSearch('部署')
    const secondInput = second.getByTestId('next-help-search-input') as HTMLInputElement
    expect(secondInput.value).toBe('部署')
    await waitFor(() =>
      expect(
        second.getByTestId('next-help-search-result-deployment.docker-compose'),
      ).toBeInTheDocument(),
    )
    expect(second.queryByTestId('next-help-search-result-projects.gantt')).toBeNull()
    second.unmount()
  })
})

// ---------------------------------------------------------------------------
// 空词引导与无结果空态
// ---------------------------------------------------------------------------

describe('HelpSearchWorkspace：状态完备性（spec「语义化空态引导」）', () => {
  test('空搜索词：呈现输入引导与热门词条，点击热词即时检索并提交 URL', async () => {
    renderSearch()
    expect(screen.getByTestId('next-help-search-empty')).toBeInTheDocument()
    expect(screen.getByText('请输入关键词开始搜索')).toBeInTheDocument()
    const hot = screen.getByTestId('next-help-search-hot-甘特图')
    expect(hot).toBeInTheDocument()
    fireEvent.click(hot)
    expect(navMock.push).toHaveBeenCalledWith('/next/help/search?q=%E7%94%98%E7%89%B9%E5%9B%BE')
    expect((screen.getByTestId('next-help-search-input') as HTMLInputElement).value).toBe('甘特图')
    await waitFor(() =>
      expect(screen.getByTestId('next-help-search-result-projects.gantt')).toBeInTheDocument(),
    )
  })

  test('无匹配词条：渲染「未找到相关文档」空态、建议与浏览产品模块返回按钮', () => {
    renderSearch('xyz-unmatched-term')
    expect(screen.getByTestId('next-help-search-no-result')).toBeInTheDocument()
    expect(screen.getByText('未找到相关文档')).toBeInTheDocument()
    expect(screen.getByText(/没有找到匹配「xyz-unmatched-term」的文档/)).toBeInTheDocument()
    const back = screen.getByTestId('next-help-search-browse-modules')
    expect(back.textContent).toContain('浏览产品模块')
    expect(back.getAttribute('href')).toBe('/next/help')
  })
})

// ---------------------------------------------------------------------------
// 真实内容搜索页装配
// ---------------------------------------------------------------------------

describe('NextHelpSearchPage：RSC 直出装配（spec「?q= 单一事实来源」）', () => {
  test('真实内容树：q=甘特图 命中甘特图排程指南并高亮', async () => {
    const element = await NextHelpSearchPage({
      searchParams: Promise.resolve({ q: '甘特图' }),
    })
    render(element)
    const input = screen.getByTestId('next-help-search-input') as HTMLInputElement
    expect(input.value).toBe('甘特图')
    await waitFor(() =>
      expect(screen.getByTestId('next-help-search-result-projects.gantt')).toBeInTheDocument(),
    )
    const title = within(screen.getByTestId('next-help-search-result-projects.gantt')).getByTestId(
      'next-help-search-hit-title',
    )
    expect(
      title.querySelectorAll('mark[data-testid="next-help-search-mark"]').length,
    ).toBeGreaterThan(0)
  })

  test('真实内容树：无 q 参数时呈现空词引导（含热门词条）', async () => {
    const element = await NextHelpSearchPage({ searchParams: Promise.resolve({}) })
    render(element)
    expect((screen.getByTestId('next-help-search-input') as HTMLInputElement).value).toBe('')
    expect(screen.getByTestId('next-help-search-empty')).toBeInTheDocument()
    expect(screen.getByText('请输入关键词开始搜索')).toBeInTheDocument()
  })
})
