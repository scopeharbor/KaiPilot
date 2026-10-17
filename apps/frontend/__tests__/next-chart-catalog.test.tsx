/**
 * v3-ui-next-chart-gallery W1 · tasks 1.9 —— 图表馆目录页 / 全景卡片网格 / 分类过滤 /
 * 即时检索 / 预告抽屉 / LensSwitcher 解耦测试。
 *
 * 覆盖：
 * - 目录页准入门禁（project:view）与项目加载（合法/404/跨组织中性空态）骨架；
 * - 24 项卡片全景：批 G4（v3-chart-gallery-tier2-org-contract-plans）收口后全量 24 项
 *   已就绪（可点击直达深层路由），「即将上线」分组归零（20 经典 + 4 TRIZ 分馆）；
 * - 看板卡片点击直达 `/next/projects/:id?lens=kanban`；
 * - 知识领域 Tab 过滤与多词模糊搜索即时收敛 + 空态复位；
 * - ChartUpcomingDrawer 组件独立渲染断言（chart=null 关闭态零 DOM），全量上线后不再被
 *   目录卡片点击触发；
 * - 主工作面 LensSwitcher 解耦：不混入图表馆镜头。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Project } from '@/lib/api/projects'
import { LENS_SWITCHER_OPTIONS } from '@/components/next/project-space/LensSwitcher'
import { ChartUpcomingDrawer } from '@/components/next/charts/ChartUpcomingDrawer'
import { PM_CHART_DEFINITIONS } from '@/lib/next/charts/chart-catalog-metadata'
import { useAuthStore } from '@/stores/auth-store'
import { ensureLazyEchartsMock, FakeEChartsInstance } from './helpers/echarts-mock'
import ProjectChartsGalleryPage from '@/app/(next)/next/projects/[id]/charts/page'
import ProjectChartLensPage from '@/app/(next)/next/projects/[id]/charts/[chartId]/page'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const apiMock = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/lib/api/projects', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/projects')>()
  return { ...original, projectsApi: { ...original.projectsApi, get: apiMock.get } }
})

// W5 总装后镜头路由渲染真实镜头：ECharts jsdom 桩（TDZ 安全写法，见 helpers 说明）
vi.mock('@/lib/next/echarts-core', () => ({
  default: {
    init: (dom: HTMLElement) => {
      const bundle = ensureLazyEchartsMock()
      const instance = new FakeEChartsInstance(dom)
      bundle.instances.push(instance)
      bundle.lastDom = dom
      return instance
    },
    use: () => undefined,
    registerTheme: () => undefined,
  },
}))

const diagramListMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/diagrams', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/diagrams')>()
  return { ...original, listDiagrams: diagramListMock }
})

const resourceLoadMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/resources', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/resources')>()
  return { ...original, resourcesApi: { ...original.resourcesApi, load: resourceLoadMock } }
})

const projectMetricsMock = vi.hoisted(() => ({
  evm: vi.fn(),
  evmSCurve: vi.fn(),
  burndown: vi.fn(),
  controlChart: vi.fn(),
  pareto: vi.fn(),
  lob: vi.fn(),
}))
vi.mock('@/lib/api/project-metrics', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/project-metrics')>()
  return {
    ...original,
    projectMetricsApi: {
      ...original.projectMetricsApi,
      evm: projectMetricsMock.evm,
      evmSCurve: projectMetricsMock.evmSCurve,
      burndown: projectMetricsMock.burndown,
      controlChart: projectMetricsMock.controlChart,
      pareto: projectMetricsMock.pareto,
      lob: projectMetricsMock.lob,
    },
  }
})

const charterGetMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/charter', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/charter')>()
  return { ...original, charterApi: { ...original.charterApi, get: charterGetMock } }
})

const paramsMock = vi.hoisted(() => ({
  value: { id: '42' } as { id: string; chartId?: string },
}))

const navMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/charts',
  useParams: () => paramsMock.value,
  useSearchParams: () => new URLSearchParams(),
}))

function emptyDiagramEnvelope() {
  return { data: [], meta: { total: 0, page: 1, perPage: 100, totalPages: 0 } }
}

function emptyTrendResult() {
  return { from: '2026-09-01', to: '2026-09-30', totalResources: 0, days: [] }
}

function emptyEvmIndicators() {
  return {
    projectId: 42,
    asOfDate: '2026-09-13',
    hasBaseline: false,
    bac: 0,
    pv: 0,
    ev: 0,
    ac: 0,
    cv: 0,
    sv: 0,
    cpi: 1,
    spi: 1,
    etc: 0,
    eac: 0,
    vac: 0,
    tcpi: 1,
    scheduleStatus: 'on_track' as const,
    costStatus: 'on_track' as const,
  }
}

function emptyEvmSCurve() {
  return {
    projectId: 42,
    asOfDate: '2026-09-13',
    startDate: '2026-09-13',
    endDate: '2026-09-13',
    hasBaseline: false,
    points: [],
  }
}

function emptyBurndownResult() {
  return {
    projectId: 42,
    startDate: '',
    endDate: '',
    granularity: 'day' as const,
    metric: 'task' as const,
    initialScopeTasks: 0,
    initialScopeHours: 0,
    points: [],
  }
}

function emptySpcResult() {
  return {
    summary: {
      metric: 'cycle_time' as const,
      sampleCount: 0,
      mean: null,
      sigma: null,
      ucl: null,
      lcl: null,
      uwl: null,
      lwl: null,
    },
    samples: [],
    warning: null,
  }
}

function emptyParetoResult() {
  return {
    dimension: 'issue_type' as const,
    totalCount: 0,
    items: [],
  }
}

function emptyLobMetrics() {
  return {
    units: [],
    stages: [],
    activities: [],
    rhythmSummary: [],
  }
}

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 42,
    organizationId: 1,
    name: '开项核心引擎',
    code: 'PROJ-042',
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

function resetAuthState() {
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    permissions: [],
    currentOrganizationId: null,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: false,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function renderPage(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ProjectChartsGalleryPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  paramsMock.value = { id: '42' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  apiMock.get.mockReset()
  diagramListMock.mockReset()
  resourceLoadMock.mockReset()
  projectMetricsMock.evm.mockReset()
  projectMetricsMock.evmSCurve.mockReset()
  projectMetricsMock.burndown.mockReset()
  projectMetricsMock.controlChart.mockReset()
  projectMetricsMock.pareto.mockReset()
  projectMetricsMock.lob.mockReset()
  charterGetMock.mockReset()
  ensureLazyEchartsMock().reset()
  // 镜头路由测试缺省值：空数据（真实镜头加载成功路径）
  diagramListMock.mockResolvedValue(emptyDiagramEnvelope())
  resourceLoadMock.mockResolvedValue(emptyTrendResult())
  projectMetricsMock.evm.mockResolvedValue(emptyEvmIndicators())
  projectMetricsMock.evmSCurve.mockResolvedValue(emptyEvmSCurve())
  projectMetricsMock.burndown.mockResolvedValue(emptyBurndownResult())
  projectMetricsMock.controlChart.mockResolvedValue(emptySpcResult())
  projectMetricsMock.pareto.mockResolvedValue(emptyParetoResult())
  projectMetricsMock.lob.mockResolvedValue(emptyLobMetrics())
  charterGetMock.mockResolvedValue(null)
  resetAuthState()
})

describe('项目级图表馆目录路由 /next/projects/[id]/charts', () => {
  test('合法项目：加载后渲染标题与 24 项全景卡片（24 已就绪，即将上线归零）', async () => {
    setAuth(['project:view'])
    apiMock.get.mockResolvedValueOnce(makeProject())
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderPage(client)

    // 加载期骨架（aria-busy），禁止空态误报
    expect(document.querySelector('[data-chart-space-skeleton]')).not.toBeNull()
    expect(screen.queryByText('项目不存在或已被移除')).toBeNull()

    await screen.findByText('开项核心引擎 · 图表馆')
    expect(document.querySelector('[data-project-charts-title]')?.textContent).toBe(
      '开项核心引擎 · 图表馆',
    )
    expect(apiMock.get).toHaveBeenCalledWith(42)

    const cards = document.querySelectorAll('[data-chart-card]')
    expect(cards).toHaveLength(24)
    expect(document.querySelectorAll('[data-chart-status="available"]')).toHaveLength(24)
    expect(document.querySelectorAll('[data-chart-status="coming-soon"]')).toHaveLength(0)
    // 24 项元数据与静态定义一一对应（RL-14 确定性渲染；20 经典 + 4 TRIZ 分馆）
    expect(PM_CHART_DEFINITIONS).toHaveLength(24)
  })

  test('缺少 project:view 权限：受限横幅阻断，项目请求零发出', () => {
    setAuth(['task:view'])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderPage(client)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看该项目图表馆的权限')).toBeInTheDocument()
    expect(apiMock.get).not.toHaveBeenCalled()
  })

  test('HTTP 404 / 跨组织：中性 404 空态「项目不存在或已被移除」，不泄露项目名', async () => {
    setAuth(['project:view'], 1)
    apiMock.get.mockRejectedValueOnce({ status: 404, code: 'RESOURCE_NOT_FOUND', message: '' })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = renderPage(client)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(document.body.textContent).not.toContain('开项核心引擎')
    view.unmount()

    // 跨组织（organizationId 失配）同样中性处理
    apiMock.get.mockResolvedValueOnce(makeProject({ organizationId: 2 }))
    const client2 = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderPage(client2)
    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(document.body.textContent).not.toContain('开项核心引擎')
  })

  test('非数字路径 id：直接中性 404 空态，零网络请求', async () => {
    setAuth(['project:view'])
    paramsMock.value = { id: 'abc' }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderPage(client)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(apiMock.get).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '返回角色首页' }))
    expect(navMock.push).toHaveBeenCalledWith('/next')
  })

  test('非 404 错误：错误卡 + 重新载入恢复', async () => {
    setAuth(['project:view'])
    apiMock.get
      .mockRejectedValueOnce({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: '' })
      .mockResolvedValueOnce(makeProject())
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderPage(client)

    await screen.findByRole('alert', { name: '图表馆加载错误' })
    fireEvent.click(screen.getByRole('button', { name: '重新载入' }))
    await screen.findByText('开项核心引擎 · 图表馆')
    expect(apiMock.get).toHaveBeenCalledTimes(2)
  })
})

describe('ChartGalleryCatalog 全景卡片（spec「20 项全景目录」场景）', () => {
  async function renderCatalog() {
    setAuth(['project:view'])
    apiMock.get.mockResolvedValueOnce(makeProject())
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = renderPage(client)
    await screen.findByText('开项核心引擎 · 图表馆')
    return view
  }

  test('每张已就绪卡片带「已就绪」徽标与可点击直达入口', async () => {
    await renderCatalog()
    expect(screen.getAllByText('已就绪')).toHaveLength(24)
    expect(screen.queryAllByText('即将上线')).toHaveLength(0)

    // AON 网络图 → 图表馆深层路由
    fireEvent.click(screen.getByRole('button', { name: /AON 紧前节点网络图（已就绪）/ }))
    expect(navMock.push).toHaveBeenCalledTimes(1)
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/aon-network')

    // 鱼骨图 → 深层路由
    fireEvent.click(screen.getByRole('button', { name: /鱼骨图 \/ 因果分析（已就绪）/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/fishbone')

    // 批 G1 新上线 3 项 → 深层路由（v3-chart-gallery-tier2-timeseries-metrics）
    fireEvent.click(screen.getByRole('button', { name: /实值管理 EVM（已就绪）/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/evm')

    fireEvent.click(screen.getByRole('button', { name: /燃尽 \/ 燃起图（已就绪）/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/burndown')

    fireEvent.click(screen.getByRole('button', { name: /控制图 SPC（已就绪）/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/control-chart')

    // 批 G2 新上线 2 项 → 深层路由（v3-chart-gallery-tier2-pareto-lob）
    fireEvent.click(screen.getByRole('button', { name: /柏拉图（已就绪）/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/pareto')

    fireEvent.click(screen.getByRole('button', { name: /线条平衡图 LOB（已就绪）/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/lob')

    // 批 G3 新上线 4 项 → 深层路由（v3-chart-gallery-tier2-governance-matrices）
    fireEvent.click(screen.getByRole('button', { name: /RACI 责任分配矩阵（已就绪）/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/raci')

    fireEvent.click(screen.getByRole('button', { name: /需求追踪矩阵 RTM（已就绪）/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/rtm')

    fireEvent.click(screen.getByRole('button', { name: /利害关系人登记表（已就绪）/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/stakeholder')

    fireEvent.click(screen.getByRole('button', { name: /议题与变更追踪（已就绪）/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/issues')

    // 批 G4 收口新上线 3 项 → 深层路由（v3-chart-gallery-tier2-org-contract-plans）
    fireEvent.click(screen.getByRole('button', { name: /组织分解结构 OBS（已就绪）/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/obs')

    fireEvent.click(screen.getByRole('button', { name: /项目章程（已就绪）/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/charter')

    fireEvent.click(screen.getByRole('button', { name: /沟通管理计划（已就绪）/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/communication')
  })

  test('看板卡片平滑直达主工作面 /next/projects/:id?lens=kanban（spec 直达入口）', async () => {
    await renderCatalog()
    fireEvent.click(screen.getByRole('button', { name: /看板（已就绪）/ }))
    expect(navMock.push).toHaveBeenCalledTimes(1)
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42?lens=kanban')
  })

  test('知识领域 Tab 过滤：进度网络仅展示 5 项（AON/里程碑/看板 + LOB/燃尽）', async () => {
    await renderCatalog()
    fireEvent.click(screen.getByRole('tab', { name: /进度网络/ }))
    const cards = document.querySelectorAll('[data-chart-card]')
    expect(cards).toHaveLength(5)
    expect(document.querySelector('[data-chart-card="aon-network"]')).not.toBeNull()
    expect(document.querySelector('[data-chart-card="milestone-timeline"]')).not.toBeNull()
    expect(document.querySelector('[data-chart-card="kanban"]')).not.toBeNull()
    expect(document.querySelector('[data-chart-card="lob"]')).not.toBeNull()
    expect(document.querySelector('[data-chart-card="burndown"]')).not.toBeNull()
    // 其他领域被过滤
    expect(document.querySelector('[data-chart-card="resource-load"]')).toBeNull()

    // 切回全部
    fireEvent.click(screen.getByRole('tab', { name: /^全部/ }))
    expect(document.querySelectorAll('[data-chart-card]')).toHaveLength(24)
  })

  test('立项治理 Tab 覆盖全量已就绪治理卡片（章程/RTM/RACI/议题/干系人/沟通 + 风险矩阵）', async () => {
    await renderCatalog()
    fireEvent.click(screen.getByRole('tab', { name: /立项治理/ }))
    const cards = document.querySelectorAll('[data-chart-card]')
    expect(cards).toHaveLength(7)
    for (const id of ['charter', 'rtm', 'raci', 'issues', 'stakeholder', 'communication']) {
      expect(document.querySelector(`[data-chart-card="${id}"]`)).not.toBeNull()
    }
  })

  test('关键词即时模糊检索：中文/英文缩写命中，多词 AND 收敛，空态一键复位', async () => {
    await renderCatalog()
    const input = screen.getByRole('searchbox', { name: '搜索图表' })

    // 中文关键词（spec 场景：输入「网络」→ 进度网络分析卡片即时收敛，含 AON 网络图）
    fireEvent.change(input, { target: { value: '网络' } })
    expect(document.querySelectorAll('[data-chart-card]')).toHaveLength(5)
    expect(document.querySelector('[data-chart-card="aon-network"]')).not.toBeNull()
    expect(document.querySelector('[data-chart-card="resource-load"]')).toBeNull()

    // 英文缩写
    fireEvent.change(input, { target: { value: 'rbs' } })
    expect(document.querySelectorAll('[data-chart-card]')).toHaveLength(1)
    expect(document.querySelector('[data-chart-card="rbs"]')).not.toBeNull()

    // 多词 AND 语义（spec 场景：输入「网络」仅剩进度相关卡片）
    fireEvent.change(input, { target: { value: 'chart 控制' } })
    expect(document.querySelectorAll('[data-chart-card]')).toHaveLength(1)
    expect(document.querySelector('[data-chart-card="control-chart"]')).not.toBeNull()

    // 无匹配 → 空态提示 + 清除筛选复位
    fireEvent.change(input, { target: { value: '不存在的图表xyz' } })
    expect(screen.getByText('未找到匹配的图表')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-chart-card]')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '清除筛选条件' }))
    expect(document.querySelectorAll('[data-chart-card]')).toHaveLength(24)
  })

  test('批 G4 收口后「即将上线」预告抽屉不再被任何卡片点击触发（24 项全量就绪）', async () => {
    await renderCatalog()
    expect(document.querySelector('[data-chart-upcoming-drawer]')).toBeNull()

    // 全量收口后，标题行「即将上线」计数徽标平稳隐藏，改为全量就绪标注
    expect(screen.getByText('已就绪 24 · 全量上线')).toBeInTheDocument()
    expect(screen.queryByText(/即将上线 \d/)).toBeNull()

    // 曾经的第二层收口卡片（章程）现为已就绪，点击直达深层路由而非弹出预告抽屉
    fireEvent.click(screen.getByRole('button', { name: /项目章程（已就绪）/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/charts/charter')
    expect(document.querySelector('[data-chart-upcoming-drawer]')).toBeNull()
  })

  test('ChartUpcomingDrawer 组件独立渲染：chart=null 关闭态零 DOM（边界空态断言）', () => {
    render(<ChartUpcomingDrawer chart={null} onClose={() => undefined} />)
    expect(document.querySelector('[data-chart-upcoming-drawer]')).toBeNull()
  })

  test('主工作面 LensSwitcher 解耦：六镜头白名单不含图表馆（spec「导航解耦契约」）', async () => {
    await renderCatalog()
    expect(LENS_SWITCHER_OPTIONS).toHaveLength(6)
    const lensIds = LENS_SWITCHER_OPTIONS.map((option) => option.id)
    expect(lensIds).toEqual(['kanban', 'gantt', 'wbs', 'list', 'calendar', 'timeline'])
    expect(lensIds).not.toContain('charts')
    // 目录页自身不渲染 LensSwitcher（深层分析空间与主工作面解耦）
    expect(document.querySelector('[data-lens-switcher]')).toBeNull()
  })
})

describe('具体图表镜头路由 /next/projects/:id/charts/:chartId（W5 总装后真实镜头）', () => {
  async function renderLens(chartId: string, permissions: string[] = ['project:view']) {
    setAuth(permissions)
    paramsMock.value = { id: '42', chartId }
    apiMock.get.mockResolvedValueOnce(makeProject())
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <QueryClientProvider client={client}>
        <ProjectChartLensPage />
      </QueryClientProvider>,
    )
    // 等待项目数据加载成功、容器就位（目录/镜头/回退共用成功态容器）
    await waitFor(() =>
      expect(document.querySelector('[data-project-charts-space]')).not.toBeNull(),
    )
    return view
  }

  test('fishbone：统一顶栏（返回目录/名称/领域/编辑边界）+ 汇出菜单 + 真实镜头 6M 骨架', async () => {
    await renderLens('fishbone', ['project:view', 'diagram:view', 'diagram:manage'])

    const toolbar = document.querySelector('[data-chart-lens-toolbar]')
    expect(toolbar).not.toBeNull()
    expect(toolbar?.getAttribute('data-chart-id')).toBe('fishbone')
    expect(screen.getByText('鱼骨图 / 因果分析')).toBeInTheDocument()
    // 鱼骨图为受控手动编辑项（与 registry 契约一致）
    expect(screen.getByText('受控手动编辑')).toBeInTheDocument()
    // 返回图表馆目录链接（历史保留）
    const back = screen.getByRole('link', { name: '返回图表馆目录' })
    expect(back).toHaveAttribute('href', '/next/projects/42/charts')
    // W5 总装：汇出菜单挂载点就位且 ChartExportMenu 已注入
    expect(document.querySelector('[data-chart-export-mount]')).not.toBeNull()
    expect(document.querySelector('[data-chart-export-menu]')).not.toBeNull()

    const viewport = document.querySelector('[data-chart-viewport-slot]')
    expect(viewport).not.toBeNull()
    expect(viewport?.getAttribute('data-chart-viewport')).toBe('fishbone')
    // 真实镜头（W3）替换建设中占位：默认 6M 因果骨架画布渲染
    await waitFor(() => expect(document.querySelector('[data-fishbone-canvas]')).not.toBeNull())
    expect(document.querySelector('[data-chart-lens-placeholder]')).toBeNull()
    expect(viewport?.querySelector('[data-fishbone-lens]')).not.toBeNull()
  })

  test('resource-load：纯只读分析微标 + 汇出菜单 + 真实镜头挂载', async () => {
    await renderLens('resource-load')
    expect(document.querySelector('[data-chart-lens-toolbar]')?.getAttribute('data-chart-id')).toBe(
      'resource-load',
    )
    expect(screen.getByText('纯只读分析')).toBeInTheDocument()
    expect(document.querySelector('[data-chart-export-menu]')).not.toBeNull()
    // 真实镜头（W2）替换建设中占位
    await waitFor(() =>
      expect(document.querySelector('[data-chart-lens-root="resource-load"]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-chart-lens-placeholder]')).toBeNull()
  })

  test('evm：纯只读分析微标 + 汇出菜单 + 真实镜头挂载（批 G1）', async () => {
    await renderLens('evm')
    expect(document.querySelector('[data-chart-lens-toolbar]')?.getAttribute('data-chart-id')).toBe(
      'evm',
    )
    expect(screen.getByText('纯只读分析')).toBeInTheDocument()
    expect(document.querySelector('[data-chart-export-menu]')).not.toBeNull()
    await waitFor(() =>
      expect(document.querySelector('[data-chart-lens-root="evm"]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-chart-lens-placeholder]')).toBeNull()
  })

  test('burndown：纯只读分析微标 + 汇出菜单 + 真实镜头挂载（批 G1）', async () => {
    await renderLens('burndown')
    expect(document.querySelector('[data-chart-lens-toolbar]')?.getAttribute('data-chart-id')).toBe(
      'burndown',
    )
    expect(screen.getByText('纯只读分析')).toBeInTheDocument()
    expect(document.querySelector('[data-chart-export-menu]')).not.toBeNull()
    await waitFor(() =>
      expect(document.querySelector('[data-chart-lens-root="burndown"]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-chart-lens-placeholder]')).toBeNull()
  })

  test('control-chart：纯只读分析微标 + 汇出菜单 + 真实镜头挂载（批 G1）', async () => {
    await renderLens('control-chart')
    expect(document.querySelector('[data-chart-lens-toolbar]')?.getAttribute('data-chart-id')).toBe(
      'control-chart',
    )
    expect(screen.getByText('纯只读分析')).toBeInTheDocument()
    expect(document.querySelector('[data-chart-export-menu]')).not.toBeNull()
    await waitFor(() =>
      expect(document.querySelector('[data-chart-lens-root="control-chart"]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-chart-lens-placeholder]')).toBeNull()
  })

  test('pareto：纯只读分析微标 + 汇出菜单 + 真实镜头挂载（批 G2）', async () => {
    await renderLens('pareto')
    expect(document.querySelector('[data-chart-lens-toolbar]')?.getAttribute('data-chart-id')).toBe(
      'pareto',
    )
    expect(screen.getByText('纯只读分析')).toBeInTheDocument()
    expect(document.querySelector('[data-chart-export-menu]')).not.toBeNull()
    await waitFor(() =>
      expect(document.querySelector('[data-chart-lens-root="pareto"]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-chart-lens-placeholder]')).toBeNull()
  })

  test('lob：纯只读分析微标 + 汇出菜单 + 真实镜头挂载（批 G2）', async () => {
    await renderLens('lob')
    expect(document.querySelector('[data-chart-lens-toolbar]')?.getAttribute('data-chart-id')).toBe(
      'lob',
    )
    expect(screen.getByText('纯只读分析')).toBeInTheDocument()
    expect(document.querySelector('[data-chart-export-menu]')).not.toBeNull()
    await waitFor(() =>
      expect(document.querySelector('[data-chart-lens-root="lob"]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-chart-lens-placeholder]')).toBeNull()
  })

  test('kanban：平滑重定向至项目看板主工作面（?lens=kanban），保留目录来源可返回', async () => {
    setAuth(['project:view'])
    paramsMock.value = { id: '42', chartId: 'kanban' }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ProjectChartLensPage />
      </QueryClientProvider>,
    )

    expect(screen.getByText('正在跳转看板工作面…')).toBeInTheDocument()
    await waitFor(() => {
      expect(navMock.replace).toHaveBeenCalledWith('/next/projects/42?lens=kanban')
    })
    // 不加载项目数据（目标页自行校验），零多余请求
    expect(apiMock.get).not.toHaveBeenCalled()
  })

  test('charter：批 G4 收口后已就绪，纯只读分析微标 + 汇出菜单 + 真实镜头挂载', async () => {
    await renderLens('charter')
    expect(document.querySelector('[data-chart-lens-toolbar]')?.getAttribute('data-chart-id')).toBe(
      'charter',
    )
    expect(screen.getByText('纯只读分析')).toBeInTheDocument()
    expect(document.querySelector('[data-chart-export-menu]')).not.toBeNull()
    await waitFor(() =>
      expect(document.querySelector('[data-chart-lens-root="charter"]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-chart-lens-placeholder]')).toBeNull()
    // 空态承接防白屏：夹具无章程数据
    await screen.findByRole('status', { name: '项目章程为空' })
  })

  test('未知 chartId：回退目录页，零报错零路由副作用', async () => {
    await renderLens('quantum-matrix')
    expect(document.querySelectorAll('[data-chart-card]')).toHaveLength(24)
    expect(document.querySelector('[data-chart-upcoming-drawer]')).toBeNull()
    expect(navMock.push).not.toHaveBeenCalled()
  })
})
