/**
 * v3-ui-next-chart-gallery W5 · tasks 5.2 —— 空间地图点亮与 AI 同事三通道导航闭环
 * 端到端集成测试。
 *
 * 通道一（独立深层路由）：`/next/projects/:id/charts`（目录页）与
 * `/next/projects/:id/charts/:chartId`（镜头页）URL 直入即正确渲染；
 * 通道二（空间地图点亮）：SpaceMapOverlay 中「图表馆」卡片 available/已就绪，
 * 点击直达 `/next/charts`；
 * 通道三（AI 同事）：泛化「去图表馆」与具体图表指令（「查看资源负荷」「打开风险
 * 矩阵」等）→ parseColleagueIntent 精准识别 lens=charts + chart 参数；导航执行
 * 结果消息驱动前端路由直达（AiColleagueMessageList push data.path）；反馈卡片
 * NavigationResultCard 呈现「图表馆」中文镜头标签与深层回跳链接。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SpaceMapOverlay } from '@/components/next/navigation/SpaceMapOverlay'
import { AiColleagueMessageList } from '@/components/next/ai/AiColleagueMessageList'
import { NavigationResultCard } from '@/components/next/ai/cards/NavigationResultCard'
import ProjectChartsGalleryPage from '@/app/(next)/next/projects/[id]/charts/page'
import ProjectChartLensPage from '@/app/(next)/next/projects/[id]/charts/[chartId]/page'
import { parseColleagueIntent } from '@/lib/next/ai-colleague-intent'
import { useAuthStore } from '@/stores/auth-store'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'
import {
  installFetchRouter,
  jsonResponse,
  makeProject,
  resetFetchRouter,
} from './helpers/chart-gallery-network'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------

const paramsMock = vi.hoisted(() => ({
  value: { id: '42' } as { id: string; chartId?: string },
}))
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/charts',
  useParams: () => paramsMock.value,
  useSearchParams: () => new URLSearchParams(),
}))

// next/link → 纯 <a>，避免依赖 App Router context（NavigationResultCard 回跳链接）
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 会话与渲染辅助
// ---------------------------------------------------------------------------

function setAuth(permissions: string[], organizationId: number | null = 1) {
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
    currentOrganizationId: organizationId,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

/** 项目级图表馆数据后端：目录页（项目）+ 镜头页（空 fishbone 图列表）。 */
function chartsBackend(path: string, method: string): Response | null {
  if (path === '/projects/42' && method === 'GET') {
    return jsonResponse(200, { data: makeProject() })
  }
  if (path.startsWith('/projects/42/diagrams') && method === 'GET') {
    return jsonResponse(200, { data: [], meta: { total: 0, page: 1, perPage: 100, totalPages: 0 } })
  }
  return null
}

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

beforeEach(() => {
  paramsMock.value = { id: '42' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  setAuth(['project:view', 'diagram:view', 'diagram:manage'])
  useNextAiColleagueStore.setState({ messages: [] })
})

afterEach(() => {
  resetFetchRouter()
})

describe('通道一：独立深层路由直达（spec「通道一」）', () => {
  test('URL 直入目录页 /next/projects/42/charts：项目上下文 + 24 项全景（20 经典 + 4 TRIZ）', async () => {
    const router = installFetchRouter(chartsBackend)
    renderPage(<ProjectChartsGalleryPage />)

    await screen.findByText('开项核心引擎 · 图表馆')
    expect(document.querySelectorAll('[data-chart-card]')).toHaveLength(24)
    expect(router.records.some((record) => record.url.includes('/projects/42'))).toBe(true)
  })

  test('URL 直入镜头页 /next/projects/42/charts/fishbone：真实镜头渲染', async () => {
    paramsMock.value = { id: '42', chartId: 'fishbone' }
    installFetchRouter(chartsBackend)
    renderPage(<ProjectChartLensPage />)

    await screen.findByText('鱼骨图 / 因果分析')
    await waitFor(() => expect(document.querySelector('[data-fishbone-canvas]')).not.toBeNull())
    expect(document.querySelector('[data-chart-viewport-slot]')).not.toBeNull()
  })
})

describe('通道二：空间地图点亮直达（spec「通道二」）', () => {
  function OverlayHarness() {
    const [open, setOpen] = React.useState(true)
    return <SpaceMapOverlay open={open} onOpenChange={setOpen} />
  }

  test('图表馆卡片显示「已就绪」可点击，点击直达 /next/charts', async () => {
    render(<OverlayHarness />)
    const card = screen.getByRole('button', { name: /图表馆/ })
    expect(card).toBeEnabled()
    expect(card).toHaveAttribute('data-status', 'available')
    expect(within(card).getByText('已就绪')).toBeInTheDocument()

    fireEvent.click(card)
    expect(navMock.push).toHaveBeenCalledTimes(1)
    expect(navMock.push).toHaveBeenCalledWith('/next/charts')
  })
})

describe('通道三：AI 同事意图直达（spec「通道三」）', () => {
  const projectCtx = {
    contextType: 'project_space' as const,
    currentProjectId: 42,
    pathname: '/next/projects/42',
  }

  test('泛化指令「去图表馆」→ navigate lens=charts', () => {
    const intent = parseColleagueIntent('去图表馆', projectCtx)
    expect(intent.toolName).toBe('navigate_to_space')
    expect(intent.parameters).toEqual({ lens: 'charts', depth: 'workbench', projectId: 42 })
    expect(intent.confidence).toBe(1)
  })

  test('具体图表指令精准提取 chart 参数（8 项直达）', () => {
    const cases: Array<[string, string]> = [
      ['查看资源负荷', 'resource-load'],
      ['打开风险矩阵', 'risk-register'],
      ['帮我打开 AON 紧前网络图', 'aon-network'],
      ['查看里程碑', 'milestone-timeline'],
      ['打开鱼骨图', 'fishbone'],
      ['看资源分解结构', 'rbs'],
      ['查看工时散布图', 'scatter-plot'],
    ]
    for (const [prompt, chart] of cases) {
      const intent = parseColleagueIntent(prompt, projectCtx)
      expect(intent.toolName, prompt).toBe('navigate_to_space')
      expect(intent.parameters, prompt).toMatchObject({ lens: 'charts', chart })
    }
    // 看板直达沿用 kanban 镜头语义
    expect(parseColleagueIntent('打开看板', projectCtx).parameters.lens).toBe('kanban')
  })

  test('导航执行结果消息驱动前端路由深层直达（AiColleagueMessageList push data.path）', async () => {
    useNextAiColleagueStore.setState({
      messages: [
        {
          id: 'msg-nav-aon',
          sender: 'user',
          content: '帮我打开 AON 紧前网络图',
          timestamp: 1,
        },
      ],
    })
    renderPage(<AiColleagueMessageList onQuickAction={() => undefined} />)
    // 执行结果在面板打开后到达才触发跳转（切换分页/刷新恢复的历史跳转不重放）
    act(() => {
      useNextAiColleagueStore.setState((state) => ({
        messages: [
          ...state.messages,
          {
            id: 'msg-nav-aon-result',
            sender: 'assistant',
            content: undefined,
            timestamp: 2,
            toolExecution: {
              toolName: 'navigate_to_space',
              intentSource: 'rule_preset',
              status: 'success',
              parameters: {
                lens: 'charts',
                chart: 'aon-network',
                depth: 'workbench',
                projectId: 42,
              },
              data: {
                projectId: 42,
                lens: 'charts',
                depth: 'workbench',
                targetId: null,
                path: '/next/projects/42/charts/aon-network',
              },
            },
          },
        ],
      }))
    })

    await waitFor(() => {
      expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/aon-network')
    })
    // 反馈卡片呈现「图表馆」镜头中文标签（W5 · W1 遗留项）
    await screen.findByText(/已为你导航至项目 42 的图表馆镜头/)
    expect(screen.getByText('图表馆')).toBeInTheDocument()
  })

  test('NavigationResultCard：charts 镜头标签与深层回跳链接', () => {
    render(
      <NavigationResultCard
        data={{
          projectId: 42,
          lens: 'charts',
          depth: 'workbench',
          targetId: null,
          path: '/next/projects/42/charts/fishbone',
        }}
      />,
    )
    expect(screen.getByText('图表馆')).toBeInTheDocument()
    const again = screen.getByRole('link', { name: /再次前往/ })
    expect(again).toHaveAttribute('href', '/next/projects/42/charts/fishbone')
  })
})
