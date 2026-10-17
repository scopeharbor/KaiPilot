/**
 * 帮助中心组件测试（v3-help-and-operational-issues-center 1.2）。
 *
 * 覆盖：搜索框 loading/empty/error/no-result、键盘导航（↑/↓/Enter/Esc）、
 * 复制 Markdown（与 Agent 出口同源）、skeleton 徽标、目录、反馈、
 * readiness 横幅（planned 替代路径与帮助链接）。
 */
import { QueryClient, QueryClientProvider, type QueryClientConfig } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HelpSearchBox } from '@/components/help/HelpSearchBox'
import { HelpArticleView, type HelpArticleViewArticle } from '@/components/help/HelpArticleView'
import { PageReadinessBanner } from '@/components/help/PageReadinessBanner'
import { canAccessArticle, type HelpActor } from '@/lib/help/agent-auth'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

const fetchHelpIndexMock = vi.fn()
vi.mock('@/lib/help/query-keys', () => ({
  helpKeys: { all: ['help'], index: () => ['help', 'index'] },
  fetchHelpIndex: (...args: unknown[]) => fetchHelpIndexMock(...args),
}))

const indexData = {
  locale: 'zh-CN',
  productVersion: 'v3',
  documents: [
    {
      id: 'demo.create',
      title: '创建项目',
      summary: '从一句话到正式项目。',
      contentType: 'how-to',
      area: 'demo',
      roles: ['member'],
      updatedAt: '2026-08-30',
      headings: ['# 创建项目', '## 操作步骤'],
      keywords: [],
      body: '正文：创建项目流程……',
    },
    {
      id: 'demo.deploy',
      title: 'Docker 部署',
      summary: '容器化部署。',
      contentType: 'reference',
      area: 'demo',
      roles: ['org_admin'],
      updatedAt: '2026-08-30',
      headings: ['# Docker 部署'],
      keywords: ['docker'],
      body: '正文……',
    },
  ],
  learningPaths: [],
  areas: [{ id: 'demo', label: '演示' }],
  staleUpdatedAtDays: 200,
}

const demoArticle: HelpArticleViewArticle = {
  id: 'demo.create',
  area: 'demo',
  title: '创建项目',
  summary: '从一句话到正式项目。',
  contentType: 'how-to',
  roles: ['member'],
  editions: ['free'],
  productVersion: 'v3',
  featureFlags: [],
  owner: 'test',
  updatedAt: '2026-08-30',
  reviewAfter: '2026-11-30',
  related: ['demo.deploy'],
  screenshots: [],
  contentStatus: 'skeleton',
  body: '# 创建项目\n\n正文。\n\n## 操作步骤\n\n1. 第一步。\n\n## 验证结果\n\n完成。',
  headings: [
    { level: 1, text: '创建项目', id: '创建项目' },
    { level: 2, text: '操作步骤', id: '操作步骤' },
    { level: 2, text: '验证结果', id: '验证结果' },
  ],
}

function renderWithQuery(ui: React.ReactNode, config?: QueryClientConfig) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    ...config,
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchHelpIndexMock.mockResolvedValue(indexData)
})

describe('HelpSearchBox', () => {
  it('输入关键词后展示结果下拉，标题匹配置顶', async () => {
    renderWithQuery(<HelpSearchBox />)
    const input = screen.getByTestId('help-search-input')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Docker' } })
    await waitFor(() => {
      expect(screen.getByTestId('help-search-hit-0')).toBeInTheDocument()
    })
    expect(screen.getAllByTestId(/help-search-hit-/)).toHaveLength(1)
    expect(screen.getByText('Docker 部署')).toBeInTheDocument()
  })

  it('loading 状态可见（索引未返回时）', async () => {
    let resolveFn: (v: unknown) => void
    fetchHelpIndexMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFn = resolve
      }),
    )
    renderWithQuery(<HelpSearchBox />)
    fireEvent.focus(screen.getByTestId('help-search-input'))
    fireEvent.change(screen.getByTestId('help-search-input'), { target: { value: 'x' } })
    await waitFor(() => {
      expect(screen.getByTestId('help-search-loading')).toBeInTheDocument()
    })
    await act(async () => resolveFn!(indexData))
  })

  it('error 状态展示并可重试', async () => {
    fetchHelpIndexMock.mockRejectedValueOnce(new Error('HELP_INDEX_500'))
    renderWithQuery(<HelpSearchBox />)
    fireEvent.focus(screen.getByTestId('help-search-input'))
    await waitFor(() => {
      expect(screen.getByTestId('help-search-error')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('重试'))
    await waitFor(() => {
      expect(fetchHelpIndexMock).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(screen.getByTestId('help-search-empty')).toBeInTheDocument()
    })
  })

  it('空查询提示输入关键词', async () => {
    renderWithQuery(<HelpSearchBox />)
    fireEvent.focus(screen.getByTestId('help-search-input'))
    await waitFor(() => {
      expect(screen.getByTestId('help-search-empty')).toBeInTheDocument()
    })
  })

  it('no-result 给出建议而非空白', async () => {
    renderWithQuery(<HelpSearchBox />)
    const input = screen.getByTestId('help-search-input')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '不存在的内容词' } })
    await waitFor(() => {
      expect(screen.getByTestId('help-search-no-result')).toBeInTheDocument()
    })
    expect(screen.getAllByText(/没有找到匹配文章/).length).toBeGreaterThan(0)
  })

  it('键盘 ↓/Enter 打开文章，Esc 关闭下拉', async () => {
    renderWithQuery(<HelpSearchBox />)
    const input = screen.getByTestId('help-search-input')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Docker' } })
    await waitFor(() => {
      expect(screen.getByTestId('help-search-results')).toBeInTheDocument()
    })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(pushMock).toHaveBeenCalledWith('/help/articles/demo.deploy')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('help-search-dropdown')).not.toBeInTheDocument()
  })

  it('点击命中进入文章页（移动端友好路径）', async () => {
    renderWithQuery(<HelpSearchBox />)
    const input = screen.getByTestId('help-search-input')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Docker' } })
    await waitFor(() => {
      expect(screen.getByTestId('help-search-hit-0')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('help-search-hit-0'))
    expect(pushMock).toHaveBeenCalledWith('/help/articles/demo.deploy')
  })
})

describe('HelpArticleView', () => {
  it('渲染标题/摘要/正文/目录与 skeleton 徽标', async () => {
    render(
      <HelpArticleView
        article={demoArticle}
        areaLabel="演示"
        relatedTitles={{ 'demo.deploy': 'Docker 部署' }}
      />,
    )
    expect(screen.getAllByText('创建项目').length).toBeGreaterThan(0)
    expect(screen.getByText('从一句话到正式项目。')).toBeInTheDocument()
    expect(screen.getByTestId('help-skeleton-badge')).toBeInTheDocument()
    expect(screen.getByTestId('help-toc')).toBeInTheDocument()
    expect(screen.getByTestId('help-related')).toBeInTheDocument()
    expect(screen.getByText('Docker 部署')).toBeInTheDocument()
  })

  it('复制 Markdown 走同一 Agent 出口并反馈成功', async () => {
    const markdown = '# 创建项目\n\n> 更新时间：2026-08-30\n\n正文。'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => markdown })
    vi.stubGlobal('fetch', fetchMock)
    const clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWrite },
      configurable: true,
    })
    render(<HelpArticleView article={demoArticle} areaLabel="演示" relatedTitles={{}} />)
    fireEvent.click(screen.getByTestId('help-copy-markdown'))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/help/articles/demo.create',
        expect.objectContaining({ headers: expect.anything() }),
      )
      expect(screen.getByText('已复制 Markdown')).toBeInTheDocument()
    })
    expect(clipboardWrite).toHaveBeenCalledWith(markdown)
    vi.unstubAllGlobals()
  })

  it('反馈是否有帮助（localStorage）', () => {
    render(<HelpArticleView article={demoArticle} areaLabel="演示" relatedTitles={{}} />)
    fireEvent.click(screen.getByTestId('help-feedback-helpful'))
    expect(screen.getByTestId('help-feedback-result')).toHaveTextContent('有帮助')
  })

  it('复制失败给出错误提示（不静默）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    render(<HelpArticleView article={demoArticle} areaLabel="演示" relatedTitles={{}} />)
    fireEvent.click(screen.getByTestId('help-copy-markdown'))
    await waitFor(() => {
      expect(screen.getByTestId('help-copy-error')).toBeInTheDocument()
    })
    vi.unstubAllGlobals()
  })
})

describe('PageReadinessBanner', () => {
  it('planned 页显示状态、替代路径与帮助链接', () => {
    render(
      <PageReadinessBanner
        readiness={{
          routePattern: '/tasks',
          status: 'planned',
          helpArticleId: 'projects.views-overview',
          alternativeRoute: '/projects',
          note: '跨项目任务视图尚未实现。',
        }}
        helpArticleTitle="项目视图总览"
      />,
    )
    expect(screen.getByTestId('page-readiness-banner')).toHaveAttribute(
      'data-readiness-status',
      'planned',
    )
    expect(screen.getByText('规划中')).toBeInTheDocument()
    expect(screen.getByText('使用替代路径').closest('a')).toHaveAttribute('href', '/projects')
    expect(screen.getByText(/查看帮助/).closest('a')).toHaveAttribute(
      'href',
      '/help/articles/projects.views-overview',
    )
  })

  it('degraded 页显示降级状态（API 故障时的真实现状）', () => {
    render(
      <PageReadinessBanner
        readiness={{
          routePattern: '/projects',
          status: 'degraded',
          helpArticleId: 'troubleshooting.project-loading',
          alternativeRoute: '/dashboard',
          note: '服务暂时降级，请重试或查看帮助。',
        }}
        helpArticleTitle="项目加载失败"
      />,
    )
    expect(screen.getByTestId('page-readiness-banner')).toHaveAttribute(
      'data-readiness-status',
      'degraded',
    )
    expect(screen.getByText('降级')).toBeInTheDocument()
  })
})

describe('agent-auth 权限过滤（route handler 共用逻辑）', () => {
  const actor: HelpActor = { userId: 1, permissions: ['project:create', 'recommendation:view'] }
  it('无权限要求的文章放行', () => {
    expect(canAccessArticle([], actor)).toBe(true)
  })
  it('权限命中放行', () => {
    expect(canAccessArticle(['project:create'], actor)).toBe(true)
  })
  it('权限未命中拒绝', () => {
    expect(canAccessArticle(['ai:connection:manage'], actor)).toBe(false)
  })
})
