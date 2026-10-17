/**
 * v3-ui-next-chart-gallery W5 · tasks 5.5 —— 精确档（precise）视觉降级与环境一致性
 * 集成测试。
 *
 * 覆盖（spec「精确档视觉降级与环境一致性」）：
 * - 沉浸阶梯状态底座：manualTier → `<html data-immersion>` 同步；项目级图表容器
 *   在 immersive 消费 `.nx-space-atmosphere` 深空氛围，precise 切换纯色仪器面板
 *   （bg token 类，无 atmosphere 类）；
 * - ECharts 统计镜头（资源负荷）：precise 档 option.animation=false 数据即时定格，
 *   immersive 档 animation=true；
 * - 里程碑泳道：at_risk 呼吸脉冲（data-milestone-pulse）仅在非 precise 渲染；
 * - AON 拓扑：连线为确定性静态图元（不注入 animated 流光），两档渲染结构一致；
 * - 导出几何恒等：同一镜头 DOM 在 immersive / precise 两档经统一引擎导出，
 *   toSvg 捕获序列化结构与选项完全一致；沉浸档含 `.nx-space-atmosphere` 的捕获
 *   根会临时注入光晕平整化规则（导出后即移除），precise 档（data-immersion）
 *   不注入（全局 CSS 原生停用）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useNextTrackStore } from '@/stores/next-track-store'
import ProjectChartLensPage from '@/app/(next)/next/projects/[id]/charts/[chartId]/page'
import { MilestoneTimelineChartLens } from '@/components/next/charts/lenses/MilestoneTimelineChartLens'
import { AonNetworkChartLens } from '@/components/next/charts/lenses/AonNetworkChartLens'
import { exportNodeToSvg } from '@/lib/next/chart-export'
import { toSvg } from 'html-to-image'
import { ensureLazyEchartsMock, FakeEChartsInstance } from './helpers/echarts-mock'
import {
  installFetchRouter,
  jsonResponse,
  makeProject,
  resetFetchRouter,
} from './helpers/chart-gallery-network'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

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

// 汇出引擎：真实 chart-export，仅 mock html-to-image 出口与下载副作用
vi.mock('html-to-image', () => ({
  toSvg: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>'),
  toPng: vi.fn(async () => 'data:image/png;base64,'),
  toJpeg: vi.fn(async () => 'data:image/jpeg;base64,'),
  toBlob: vi.fn(async () => new Blob(['x'], { type: 'image/png' })),
}))

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

// ---------------------------------------------------------------------------
// 会话 / 后端 / 渲染
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

function envelope<T>(data: T) {
  return {
    data,
    meta: { total: Array.isArray(data) ? data.length : 1, page: 1, perPage: 100, totalPages: 1 },
  }
}

/** 资源负荷趋势数据（超载日触发 100% 警戒线渲染路径）。 */
const trendPayload = {
  from: '2026-09-01',
  to: '2026-09-30',
  totalResources: 1,
  days: [
    { date: '2026-09-01', capacityHours: 24, totalHours: 20, utilizationPercent: 83.3 },
    { date: '2026-09-02', capacityHours: 24, totalHours: 30, utilizationPercent: 125 },
  ],
}

function lensBackend(path: string, method: string): Response | null {
  if (method !== 'GET') return null
  if (path === '/projects/42' && method === 'GET') return jsonResponse(200, { data: makeProject() })
  if (path.startsWith('/projects/42/resources/load')) return jsonResponse(200, trendPayload)
  if (path.startsWith('/projects/42/milestones')) {
    return jsonResponse(
      200,
      envelope([
        { id: 1, projectId: 42, name: '联调通过', status: 'at_risk', plannedDate: '2026-10-05' },
        { id: 2, projectId: 42, name: '验收发布', status: 'planned', plannedDate: '2026-10-25' },
      ]),
    )
  }
  if (path.startsWith('/projects/42/tasks')) {
    return jsonResponse(
      200,
      envelope([
        {
          id: 1,
          projectId: 42,
          name: '需求分析',
          status: 'not_started',
          priority: 'medium',
          taskType: 'task',
          startDate: '2026-09-01',
          endDate: '2026-09-03',
          durationDays: 3,
          estimatedHours: 24,
        },
        {
          id: 2,
          projectId: 42,
          name: '原型设计',
          status: 'not_started',
          priority: 'medium',
          taskType: 'task',
          startDate: '2026-09-04',
          endDate: '2026-09-05',
          durationDays: 2,
          estimatedHours: 16,
        },
      ]),
    )
  }
  if (path.startsWith('/projects/42/dependencies')) {
    return jsonResponse(200, [
      {
        id: 11,
        predecessorId: 1,
        successorId: 2,
        type: 'fs',
        lagDays: 0,
        predecessor: {
          id: 1,
          name: '需求分析',
          status: 'not_started',
          startDate: '2026-09-01',
          endDate: '2026-09-03',
        },
        successor: {
          id: 2,
          name: '原型设计',
          status: 'not_started',
          startDate: '2026-09-04',
          endDate: '2026-09-05',
        },
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: null,
      },
    ])
  }
  return null
}

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

/** 确定性镜头 DOM 夹具（几何恒等导出的捕获对象）。 */
function buildLensMarkup(): string {
  return [
    '<div data-chart-viewport-slot>',
    '  <div data-mock-lens>',
    '    <div class="mock-axis" style="width:640px;height:24px"><span>01</span><span>15</span></div>',
    '    <svg data-mock-svg width="640" height="160"><rect x="10" y="10" width="20" height="20"/></svg>',
    '  </div>',
    '</div>',
  ].join('')
}

beforeEach(() => {
  paramsMock.value = { id: '42' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  ensureLazyEchartsMock().reset()
  vi.mocked(toSvg).mockClear()
  vi.mocked(toSvg).mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>')
  document.documentElement.removeAttribute('data-immersion')
  useNextTrackStore.setState({ immersionTier: null })
  setAuth(['project:view'])
  // 下载副作用桩（模块级常驻：jsdom 无原生实现，避免 revoke 定时器在恢复后触发）
  URL.createObjectURL = vi.fn(() => 'blob:immersion-mock') as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
  HTMLAnchorElement.prototype.click = function clickCapture(this: HTMLAnchorElement) {
    // 捕获下载；不触发 jsdom 导航
  }
})

afterEach(() => {
  useNextTrackStore.setState({ immersionTier: null })
  document.documentElement.removeAttribute('data-immersion')
  resetFetchRouter()
})

describe('精确档视觉降级（spec「precise」场景）', () => {
  test('沉浸档：html[data-immersion=immersive]，图表容器消费 nx-space-atmosphere', async () => {
    paramsMock.value = { id: '42', chartId: 'resource-load' }
    useNextTrackStore.setState({ immersionTier: 'immersive' })
    installFetchRouter(lensBackend)
    renderPage(<ProjectChartLensPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-project-charts-space]')).not.toBeNull(),
    )
    expect(document.documentElement.getAttribute('data-immersion')).toBe('immersive')
    const container = document.querySelector('[data-project-charts-space]')!
    expect(container.className).toContain('nx-space-atmosphere')
    // ECharts 动画开启（非精确档）
    await waitFor(() => expect(ensureLazyEchartsMock().lastOption).toBeDefined())
    expect((ensureLazyEchartsMock().lastOption as { animation: boolean }).animation).toBe(true)
  })

  test('精确档：html[data-immersion=precise]，容器剥离氛围层 + ECharts animation=false', async () => {
    paramsMock.value = { id: '42', chartId: 'resource-load' }
    useNextTrackStore.setState({ immersionTier: 'precise' })
    installFetchRouter(lensBackend)
    renderPage(<ProjectChartLensPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-project-charts-space]')).not.toBeNull(),
    )
    expect(document.documentElement.getAttribute('data-immersion')).toBe('precise')
    const container = document.querySelector('[data-project-charts-space]')!
    expect(container.className).not.toContain('nx-space-atmosphere')
    expect(container.className).toContain('bg-[var(--nx-workspace-bg)]')
    // 数据即时定格：ECharts animation 关闭
    await waitFor(() => expect(ensureLazyEchartsMock().lastOption).toBeDefined())
    expect((ensureLazyEchartsMock().lastOption as { animation: boolean }).animation).toBe(false)
  })

  test('里程碑：at_risk 呼吸脉冲仅非精确档渲染，精确档彻底停用', async () => {
    // 沉浸档：pulse 存在
    useNextTrackStore.setState({ immersionTier: 'immersive' })
    installFetchRouter(lensBackend)
    const immersive = renderPage(
      <div style={{ width: 1200 }}>
        <MilestoneTimelineChartLens projectId={42} />
      </div>,
    )
    await waitFor(() => expect(document.querySelector('[data-milestone-pulse]')).not.toBeNull())
    immersive.unmount()

    // 精确档：pulse 不存在（静态旗帜）
    useNextTrackStore.setState({ immersionTier: 'precise' })
    resetFetchRouter()
    installFetchRouter(lensBackend)
    renderPage(
      <div style={{ width: 1200 }}>
        <MilestoneTimelineChartLens projectId={42} />
      </div>,
    )
    await waitFor(() => expect(document.querySelector('[data-milestone-node]')).not.toBeNull())
    expect(document.querySelector('[data-milestone-pulse]')).toBeNull()
  })

  test('AON：连线为确定性静态图元（无 animated 流光），两档结构一致', async () => {
    for (const tier of ['immersive', 'precise'] as const) {
      useNextTrackStore.setState({ immersionTier: tier })
      resetFetchRouter()
      installFetchRouter(lensBackend)
      const view = renderPage(
        <div style={{ width: 1200, height: 720 }}>
          <AonNetworkChartLens projectId={42} />
        </div>,
      )
      await waitFor(() => expect(document.querySelector('[data-aon-lens]')).not.toBeNull())
      // 画布就绪：至少一条确定性连线，且两档均无 animated 流光类
      await waitFor(() =>
        expect(document.querySelectorAll('.react-flow__edge').length).toBeGreaterThan(0),
      )
      expect(document.querySelectorAll('.react-flow__edge.animated')).toHaveLength(0)
      view.unmount()
    }
  })
})

describe('沉浸/精确档导出几何恒等（spec「沉浸档位导出表现一致性」）', () => {
  function buildAtmosphereRig(className: string): HTMLElement {
    const root = document.createElement('div')
    root.className = className
    root.innerHTML = buildLensMarkup()
    return root
  }

  test('捕获同一镜头 DOM：两档 toSvg 接收的节点结构与选项完全一致', async () => {
    // 精确档（html[data-immersion=precise] 由 useImmersionTier 写入；此处直接模拟渲染环境）
    document.documentElement.setAttribute('data-immersion', 'precise')
    const preciseNode = buildAtmosphereRig('bg-[var(--nx-workspace-bg)]')
    document.body.appendChild(preciseNode)
    const preciseTarget = preciseNode.querySelector<HTMLElement>('[data-chart-viewport-slot]')!
    await exportNodeToSvg(preciseTarget, {
      entityName: '开项核心引擎',
      viewType: '里程碑时间轴泳道',
    })
    preciseNode.remove()

    document.documentElement.setAttribute('data-immersion', 'immersive')
    const immersiveNode = buildAtmosphereRig('nx-space-atmosphere')
    document.body.appendChild(immersiveNode)
    const immersiveTarget = immersiveNode.querySelector<HTMLElement>('[data-chart-viewport-slot]')!
    await exportNodeToSvg(immersiveTarget, {
      entityName: '开项核心引擎',
      viewType: '里程碑时间轴泳道',
    })
    immersiveNode.remove()

    expect(toSvg).toHaveBeenCalledTimes(2)
    const calls = vi.mocked(toSvg).mock.calls as unknown as Array<
      [HTMLElement, Record<string, unknown>]
    >
    const [nodePrecise, optionsPrecise] = calls[0]!
    const [nodeImmersive, optionsImmersive] = calls[1]!
    // 几何恒等：捕获节点序列化结构逐字节一致（精确档与沉浸档镜头内容零差异）
    expect(nodePrecise.outerHTML).toBe(nodeImmersive.outerHTML)
    // 引擎选项一致：确定性字段（skipFonts/cacheBust/字体栈）逐值相等；
    // filter 为每次新建的函数（引擎内部闭包），仅断言同为函数
    expect(optionsPrecise.skipFonts).toBe(true)
    expect(optionsPrecise.cacheBust).toBe(false)
    expect(optionsImmersive.skipFonts).toBe(true)
    expect(optionsImmersive.cacheBust).toBe(false)
    expect(optionsPrecise.style).toEqual(optionsImmersive.style)
    expect(typeof optionsPrecise.filter).toBe('function')
    expect(typeof optionsImmersive.filter).toBe('function')
  })

  test('沉浸档含氛围层的捕获根注入光晕平整化规则，导出后即移除；精确档零注入', async () => {
    // 沉浸档：捕获根含 .nx-space-atmosphere → 临时平整化规则注入并在导出后移除
    document.documentElement.setAttribute('data-immersion', 'immersive')
    const immersiveNode = buildAtmosphereRig('nx-space-atmosphere')
    document.body.appendChild(immersiveNode)
    const exportPromise = exportNodeToSvg(immersiveNode, {
      entityName: '开项核心引擎',
      viewType: '里程碑时间轴泳道',
    })
    // html-to-image mock 同步返回 → 捕获期间样式已注入
    const during = document.head.querySelector('[data-export-atmosphere-flatten]')
    expect(during).not.toBeNull()
    expect(during?.textContent).toContain('content: none')
    await exportPromise
    expect(document.head.querySelector('[data-export-atmosphere-flatten]')).toBeNull()
    immersiveNode.remove()

    // 精确档：全局 CSS 原生停用光晕，导出不再注入平整化样式
    document.documentElement.setAttribute('data-immersion', 'precise')
    const preciseNode = buildAtmosphereRig('bg-[var(--nx-workspace-bg)]')
    document.body.appendChild(preciseNode)
    await exportNodeToSvg(preciseNode, {
      entityName: '开项核心引擎',
      viewType: '里程碑时间轴泳道',
    })
    expect(document.head.querySelector('[data-export-atmosphere-flatten]')).toBeNull()
    preciseNode.remove()
  })
})
