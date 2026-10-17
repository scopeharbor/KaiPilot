/**
 * v3-ui-next-org-portfolio-domains W5 · tasks 5.9 —— 需求预测工作台与 AI 咨询卡组件测试。
 *
 * 以真实 hooks + 全局 fetch 伪后端 + echarts 收敛底座桩驱动：
 * - 视图切换（曲线/缺口/驱动）与粒度/日期筛选重查（URL 写回 + restorable 恢复）；
 * - AI 咨询卡：初始零请求（断言 0）、显式点击后单次请求且回显 AIMarker（来源/置信度/
 *   理由）、生成中防抖（pending 无重复点击入口）、取消回空闲、失败可重试；
 * - 曲线图 option（series 数据映射）与缺口瀑布 option 断言；
 * - 驱动表受限维度中性化；全程零写请求（RL-01）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { DemandForecastWorkspace } from '@/components/next/org-demand/DemandForecastWorkspace'
import {
  buildCurveChartOption,
  buildGapWaterfallChartOption,
} from '@/components/next/org-demand/DemandForecastWorkspace'
import { ensureLazyEchartsMock } from './helpers/echarts-mock'
import type {
  ForecastAiAdvisory,
  ForecastDemandCurve,
  ForecastGapAnalysis,
  ForecastProjectDriver,
  ForecastSkillDriver,
  ForecastSummary,
} from '@aiproj/types'

// echarts 收敛底座测试桩（jsdom 无布局/Canvas，断言 setOption 收到的映射数据）。
// 工厂体不得同步引用导入绑定：init 在运行时（模块求值后）经 helpers 惰性单例派发。
vi.mock('@/lib/next/echarts-core', () => ({
  default: {
    init: (dom: HTMLElement) => {
      const bundle = ensureLazyEchartsMock()
      return (bundle.module.default as { init: (d: HTMLElement) => unknown }).init(dom)
    },
    use: () => undefined,
    registerTheme: () => undefined,
  },
}))

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
const searchParamsMock = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/organization/resource-demand-forecasting',
  useParams: () => ({}),
  useSearchParams: () => searchParamsMock.value,
}))

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------
function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations:
        organizationId === null
          ? []
          : [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
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

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------
const SOURCE_KEYS = [
  'project_plans',
  'task_resource_requirements',
  'resource_registry',
  'resource_allocations',
  'resource_availability',
  'working_calendar',
  'organization_resource_pool',
  'resource_skill_matrix',
  'resource_load_facts',
  'historical_snapshot',
] as const

function makeSummary(): ForecastSummary {
  return {
    window: {
      startDate: '2026-09-01',
      endDate: '2026-11-30',
      granularity: 'week',
      bucketCount: 13,
    },
    metrics: {
      forecast_total_demand_hours: 1200,
      forecast_total_allocated_hours: 800,
      forecast_total_available_hours: 1400,
      forecast_total_remaining_hours: 600,
      forecast_projected_gap_hours: 400,
      forecast_visible_project_count: 4,
      forecast_visible_resource_count: 12,
      forecast_skill_coverage_ratio: 0.86,
      forecast_shortage_count: 5,
      forecast_surplus_count: 2,
    },
    freshness: {
      sources: Object.fromEntries(
        SOURCE_KEYS.map((key) => [key, '2026-09-01T00:00:00.000Z']),
      ) as Record<(typeof SOURCE_KEYS)[number], string | null>,
      overallFreshness: '2026-09-01T00:00:00.000Z',
      isStale: false,
      staleSources: [],
      sourceCoverage: 1,
      freshnessHash: 'abc',
    },
    overallConfidence: 'medium',
    method: 'deterministic_bucket',
    warnings: ['STALE_SOURCE'],
    projectCoverage: 1,
    resourceCoverage: 1,
  }
}

function makeCurve(): ForecastDemandCurve {
  return {
    roleBuckets: [
      {
        bucketStart: '2026-09-07',
        bucketEnd: '2026-09-13',
        forecastDemand: 100,
        actualAllocation: 80,
        available: 120,
        remaining: 40,
        gap: 20,
        confidence: 'high',
        method: 'deterministic_bucket',
        sourceFreshness: null,
        warnings: [],
        evidenceRefs: [],
        role: '前端工程师',
      },
      {
        bucketStart: '2026-09-14',
        bucketEnd: '2026-09-20',
        forecastDemand: 90,
        actualAllocation: 70,
        available: 110,
        remaining: 40,
        gap: 20,
        confidence: 'medium',
        method: 'deterministic_bucket',
        sourceFreshness: null,
        warnings: [],
        evidenceRefs: [],
        role: '前端工程师',
      },
    ],
    skillBuckets: [
      {
        bucketStart: '2026-09-07',
        bucketEnd: '2026-09-13',
        forecastDemand: 60,
        actualAllocation: 40,
        available: 80,
        remaining: 40,
        gap: 20,
        confidence: 'high',
        method: 'deterministic_bucket',
        sourceFreshness: null,
        warnings: [],
        evidenceRefs: [],
        skill: 'react',
        originalLabel: 'React',
      },
    ],
    projectBuckets: [
      {
        bucketStart: '2026-09-07',
        bucketEnd: '2026-09-13',
        forecastDemand: 200,
        actualAllocation: 150,
        available: 240,
        remaining: 90,
        gap: 50,
        confidence: 'low',
        method: 'deterministic_bucket',
        sourceFreshness: null,
        warnings: [],
        evidenceRefs: [],
        projectId: '42',
        projectName: '商城重构',
      },
    ],
    warnings: [],
  }
}

function makeGapAnalysis(): ForecastGapAnalysis {
  return {
    gaps: [
      {
        gapType: 'shortage',
        description: '前端人力短缺',
        gapHours: 120,
        direction: 'shortage',
        role: '前端工程师',
        bucketStart: '2026-09-07',
        bucketEnd: '2026-09-13',
        confidence: 'medium',
        warnings: [],
        evidenceRefs: [],
      },
      {
        gapType: 'surplus',
        description: '后端容量富余',
        gapHours: 40,
        direction: 'surplus',
        role: '后端工程师',
        bucketStart: '2026-09-07',
        bucketEnd: '2026-09-13',
        confidence: 'high',
        warnings: [],
        evidenceRefs: [],
      },
    ],
    totalShortage: 120,
    totalSurplus: 40,
    netGap: 80,
    warnings: [],
  }
}

function makeProjectDrivers(): ForecastProjectDriver[] {
  return [
    {
      projectId: '42',
      projectName: '商城重构',
      totalDemand: 500,
      totalAllocated: 400,
      demandShare: 0.6,
      peakGap: 120,
      peakGapBucket: '2026-09-14',
      confidence: 'high',
      warnings: [],
    },
  ]
}

function makeSkillDrivers(): ForecastSkillDriver[] {
  return [
    {
      skill: 'react',
      originalLabel: undefined,
      totalDemand: 300,
      demandShare: 0.4,
      coveredHours: 200,
      gapHours: 100,
      projectCount: 3,
      confidence: 'medium',
      warnings: [],
      redaction: 'forbidden',
    },
  ]
}

function makeAdvisory(): ForecastAiAdvisory {
  return {
    advisoryOnly: true,
    writesApplied: false,
    narrative: '未来 12 周前端人力预计短缺 120 小时，建议提前启动招聘或调配窗口。',
    relatedGaps: [{ role: '前端工程师', gapHours: 120 }],
    suggestedActions: ['审查跨项目分配窗口', '联系资源负责人确认可用容量'],
    warnings: [],
    confidence: 'medium',
    model: 'codex-5',
  }
}

// ---------------------------------------------------------------------------
// 伪后端（带手动控制位）
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

interface RequestRecord {
  method: string
  url: string
}

interface BackendControls {
  /** ai-advisory 前 N 次返回 500。 */
  advisoryServerErrors?: number
  /** ai-advisory 手动延迟（挂起 promise，测试控制时序）。 */
  advisoryGate?: {
    pending: Promise<Response>
    release: (response?: Response) => void
  }
}

function createBackend(controls: BackendControls = {}) {
  const summaries = makeSummary()
  const curves = makeCurve()
  const gaps = makeGapAnalysis()
  const projectDrivers = makeProjectDrivers()
  const skillDrivers = makeSkillDrivers()
  let advisoryErrorsLeft = controls.advisoryServerErrors ?? 0
  return {
    route: (path: string, method: string): Response | Promise<Response> | null => {
      if (method !== 'GET') return null
      if (path.startsWith('/organizations/1/resource-demand-forecasting/summary')) {
        return jsonResponse(200, { data: summaries })
      }
      if (path.startsWith('/organizations/1/resource-demand-forecasting/demand-curves')) {
        return jsonResponse(200, { data: curves })
      }
      if (path.startsWith('/organizations/1/resource-demand-forecasting/gap-analysis')) {
        return jsonResponse(200, { data: gaps })
      }
      if (path.startsWith('/organizations/1/resource-demand-forecasting/project-drivers')) {
        return jsonResponse(200, {
          data: projectDrivers,
          meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
        })
      }
      if (path.startsWith('/organizations/1/resource-demand-forecasting/skill-drivers')) {
        return jsonResponse(200, {
          data: skillDrivers,
          meta: { total: 1, page: 1, perPage: 50, totalPages: 1 },
        })
      }
      if (path === '/organizations/1/resource-demand-forecasting/ai-advisory') {
        if (advisoryErrorsLeft > 0) {
          advisoryErrorsLeft -= 1
          return jsonResponse(500, { error: { code: 'INTERNAL_SERVER_ERROR', message: 'boom' } })
        }
        if (controls.advisoryGate) {
          return controls.advisoryGate.pending
        }
        return jsonResponse(200, { data: makeAdvisory() })
      }
      return null
    },
  }
}

function installFetchRouter(
  route: (path: string, method: string) => Response | Promise<Response> | null,
): RequestRecord[] {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })
    const matched = await route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return records
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function deferredGate(): { pending: Promise<Response>; release: () => void } {
  let release!: () => void
  const pending = new Promise<Response>((resolve) => {
    release = () => resolve(jsonResponse(200, { data: makeAdvisory() }))
  })
  return { pending, release }
}

function renderWorkspace(organizationId = 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DemandForecastWorkspace organizationId={organizationId} />
    </QueryClientProvider>,
  )
}

const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE']

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  searchParamsMock.value = new URLSearchParams()
  window.history.replaceState({}, '', '/next/organization/resource-demand-forecasting')
  ensureLazyEchartsMock().reset()
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------

describe('DemandForecastWorkspace：视图/筛选重查与图表映射（tasks 5.7/5.9）', () => {
  test('默认曲线视图：KPI 摘要 + 曲线图（option 数据映射） + 维度表；AI 卡初始零请求', async () => {
    setAuth(['resource:view'])
    const backend = createBackend()
    const records = installFetchRouter(backend.route)
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-demand-summary]')).not.toBeNull())
    expect(screen.getByText('预测总需求')).toBeInTheDocument()
    // KPI 数值（小时带千分位）
    expect(document.querySelectorAll('[data-demand-kpi-value]')[0]?.textContent).toBe('1,200h')
    // 曲线图容器已挂载（echarts 桩渲染）
    await waitFor(() => expect(document.querySelector('[data-demand-curves-chart]')).not.toBeNull())
    // option 映射：预测需求 160/90（前端工程师两期聚合）
    const bundle = ensureLazyEchartsMock()
    const lastOption = bundle.lastOption as { series?: Array<{ data: number[] }> }
    const demandSeries = lastOption?.series?.[0]?.data
    expect(demandSeries).toEqual([100, 90])
    // 维度聚合表
    await waitFor(() =>
      expect(document.querySelectorAll('[data-demand-dimension-row]')).toHaveLength(1),
    )
    expect(document.body.textContent).toContain('前端工程师')
    // AI 卡初始零请求（RL-01）
    expect(records.some((r) => r.url.includes('/ai-advisory'))).toBe(false)
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })

  test('缺口视图：切 view=gaps 重查并渲染缺口行与瀑布图；驱动视图渲染受限中性行', async () => {
    setAuth(['resource:view'])
    const backend = createBackend()
    const records = installFetchRouter(backend.route)
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-demand-summary]')).not.toBeNull())

    // 切缺口视图
    fireEvent.click(document.querySelector('[data-demand-view-tab="gaps"]') as Element)
    expect(navMock.push).toHaveBeenLastCalledWith(
      '/next/organization/resource-demand-forecasting?view=gaps',
    )
    await waitFor(() => expect(document.querySelector('[data-demand-gaps-view]')).not.toBeNull())
    await waitFor(() => expect(document.querySelectorAll('[data-demand-gap-row]')).toHaveLength(2))
    expect(document.body.textContent).toContain('短缺')
    expect(document.body.textContent).toContain('-120h')
    expect(document.body.textContent).toContain('+40h')
    expect(document.body.textContent).toContain('净缺口')
    await waitFor(() => expect(document.querySelector('[data-demand-gaps-chart]')).not.toBeNull())
    const bundle = ensureLazyEchartsMock()
    const option = bundle.lastOption as { series?: Array<{ data: number[] }> }
    // 瀑布：短缺为负值、盈余为正值（双通道对冲）
    expect(option?.series?.[0]?.data).toEqual([-120])
    expect(option?.series?.[1]?.data).toEqual([40])
    // 缺口表格按类型徽标双通道
    expect(document.body.textContent).toContain('前端人力短缺')

    // 切驱动视图
    fireEvent.click(document.querySelector('[data-demand-view-tab="drivers"]') as Element)
    await waitFor(() => expect(document.querySelector('[data-demand-drivers-view]')).not.toBeNull())
    await waitFor(() =>
      expect(document.querySelectorAll('[data-demand-driver-row]')).toHaveLength(2),
    )
    expect(document.body.textContent).toContain('商城重构')
    // 技能驱动受限 → 中性占位 + EyeOff 语义（数值为服务端授权聚合可回显）
    expect(document.body.textContent).toContain('不可见')
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })

  test('URL 状态恢复：?view=gaps 直达缺口视图；粒度/日期筛选写回 URL 且重查带参数', async () => {
    setAuth(['resource:view'])
    searchParamsMock.value = new URLSearchParams(
      'view=gaps&granularity=month&startDate=2026-09-01&endDate=2026-11-30',
    )
    window.history.replaceState(
      {},
      '',
      '/next/organization/resource-demand-forecasting?view=gaps&granularity=month&startDate=2026-09-01&endDate=2026-11-30',
    )
    const backend = createBackend()
    const records = installFetchRouter(backend.route)
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-demand-gaps-view]')).not.toBeNull())
    await waitFor(() => expect(document.querySelectorAll('[data-demand-gap-row]')).toHaveLength(2))
    expect(
      document.querySelector('[data-demand-view-tab="gaps"]')?.getAttribute('aria-checked'),
    ).toBe('true')
    expect(records.some((r) => r.url.includes('granularity=month'))).toBe(true)

    // 改粒度 → URL 写回并重查
    const granularitySelect = document.querySelector(
      '[data-demand-granularity]',
    ) as HTMLSelectElement
    fireEvent.change(granularitySelect, { target: { value: 'week' } })
    await waitFor(() => expect(records.some((r) => r.url.includes('granularity=week'))).toBe(true))
    expect(navMock.push).toHaveBeenLastCalledWith(
      '/next/organization/resource-demand-forecasting?view=gaps&startDate=2026-09-01&endDate=2026-11-30',
    )
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })

  test('5xx 主导查询失败：错误卡可重试恢复', async () => {
    setAuth(['resource:view'])
    const backend = createBackend()
    let failAllGaps = true
    const records = installFetchRouter((path, method) => {
      if (path.includes('/gap-analysis') && failAllGaps) {
        return jsonResponse(500, { error: { code: 'INTERNAL_SERVER_ERROR', message: 'boom' } })
      }
      return backend.route(path, method)
    })
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-demand-summary]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-demand-view-tab="gaps"]') as Element)
    // 既有 hooks 自带 retry:2（指数退避），等待重试耗尽后进入错误态
    await waitFor(() => expect(document.querySelector('[data-demand-gaps-error]')).not.toBeNull(), {
      timeout: 6000,
    })
    failAllGaps = false
    fireEvent.click(document.querySelector('[data-demand-gaps-retry]') as Element)
    await waitFor(() => expect(document.querySelector('[data-demand-gaps-view]')).not.toBeNull())
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })
})

describe('DemandAiAdvisoryCard：显式触发 / AIMarker / 防抖取消 / 重试（tasks 5.8/5.9）', () => {
  test('初始零请求；点击生成 → 单次请求 + AIMarker 回显（来源/置信度/理由）', async () => {
    setAuth(['resource:view'])
    const backend = createBackend()
    const records = installFetchRouter(backend.route)
    renderWorkspace()
    await waitFor(() =>
      expect(document.querySelector('[data-demand-ai-advisory-card]')).not.toBeNull(),
    )
    // 初始：无请求、显示空闲态与生成按钮
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records.filter((r) => r.url.includes('/ai-advisory'))).toHaveLength(0)
    expect(document.querySelector('[data-demand-ai-idle]')).not.toBeNull()
    expect(document.querySelector('[data-demand-ai-generate]')).not.toBeNull()

    // 显式点击 → 单次请求
    fireEvent.click(document.querySelector('[data-demand-ai-generate]') as Element)
    await waitFor(() =>
      expect(records.filter((r) => r.url.includes('/ai-advisory'))).toHaveLength(1),
    )
    await waitFor(() => expect(document.querySelector('[data-demand-ai-narrative]')).not.toBeNull())
    // AIMarker 三要素
    expect(document.querySelector('[data-ai-marker]')).not.toBeNull()
    expect(screen.getByText(/来源：codex-5/)).toBeInTheDocument()
    expect(document.body.textContent).toContain('置信度 中')
    expect(document.body.textContent).toContain('advisoryOnly')
    // 建议动作与叙述
    expect(document.body.textContent).toContain('前端人力预计短缺')
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })

  test('生成中防抖：pending 期间无重复生成入口且请求唯一；取消回空闲态', async () => {
    setAuth(['resource:view'])
    const gate = deferredGate()
    const backend = createBackend({ advisoryGate: gate })
    const records = installFetchRouter(backend.route)
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-demand-ai-generate]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-demand-ai-generate]') as Element)
    await waitFor(() => expect(document.querySelector('[data-demand-ai-pending]')).not.toBeNull())
    // 防抖：生成按钮已不存在（pending 态无重复触发入口）
    expect(document.querySelector('[data-demand-ai-generate]')).toBeNull()
    // 取消 → 回空闲态
    fireEvent.click(document.querySelector('[data-demand-ai-cancel]') as Element)
    await waitFor(() => expect(document.querySelector('[data-demand-ai-idle]')).not.toBeNull())
    expect(records.filter((r) => r.url.includes('/ai-advisory'))).toHaveLength(1)
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })

  test('失败可重试：5xx 错误态 → 重试成功并回显洞察', async () => {
    setAuth(['resource:view'])
    const backend = createBackend()
    let failAllAdvisory = true
    const records = installFetchRouter((path, method) => {
      if (path === '/organizations/1/resource-demand-forecasting/ai-advisory' && failAllAdvisory) {
        return jsonResponse(500, { error: { code: 'INTERNAL_SERVER_ERROR', message: 'boom' } })
      }
      return backend.route(path, method)
    })
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-demand-ai-generate]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-demand-ai-generate]') as Element)
    // 既有 hook 自带 retry:1（指数退避），等待重试耗尽后进入错误态
    await waitFor(() => expect(document.querySelector('[data-demand-ai-error]')).not.toBeNull(), {
      timeout: 6000,
    })
    failAllAdvisory = false
    fireEvent.click(document.querySelector('[data-demand-ai-retry]') as Element)
    await waitFor(() => expect(document.querySelector('[data-demand-ai-narrative]')).not.toBeNull())
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })
})

describe('图表 option 纯函数（tasks 5.9 冒烟）', () => {
  test('曲线 option：三类 series 数据与轴类别映射', () => {
    const option = buildCurveChartOption(
      {
        categories: ['2026-09-07', '2026-09-14'],
        forecastDemand: [100, 90],
        actualAllocation: [80, 70],
        available: [120, 110],
        remaining: [40, 40],
        gap: [20, 20],
        bucketRows: 2,
      },
      false,
    ) as { series: Array<{ name: string; data: number[]; type: string }> }
    expect(option.series.map((s) => s.name)).toEqual(['预测需求', '当前分配', '缺口'])
    expect(option.series[0]!.data).toEqual([100, 90])
    expect(option.series[2]!.data).toEqual([20, 20])
  })

  test('瀑布 option：短缺负值 / 盈余正值双通道', () => {
    const option = buildGapWaterfallChartOption(
      [
        {
          bucketStart: '2026-09-07',
          bucketEnd: '2026-09-13',
          shortageHours: 120,
          surplusHours: 40,
        },
      ],
      false,
    ) as { series: Array<{ name: string; data: number[] }> }
    expect(option.series[0]!.data).toEqual([-120])
    expect(option.series[1]!.data).toEqual([40])
  })
})
