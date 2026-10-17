/**
 * v3-ui-next-pmo-domain W1 · tasks 1.5 —— KPI 卡/交通灯摘要/告警/投入分布渲染
 * 测试（spec「PMO 组合仪表盘新轨主页与组织层信息架构」组件场景）。
 *
 * 覆盖：
 * - KPI 卡：数值渲染、percent 单位拼 %、null → —、forbidden 降透明与「受限」
 *   双通道标记、告警行回显；
 * - 交通灯摘要：四色计数渲染；available=false 时展示后端 warnings 文案；
 * - 告警与新鲜度：warnings 条目（code + 文案）、freshness 过期双通道状态；
 *   两者皆空渲染空态；
 * - 投入分布区块：catalogue 驱动选项、summary 桶（占比文本 + 已脱敏诚实
 *   呈现）、趋势窗摘要、桶 drill-down 明细、口径切换参数重查、财务不可用
 *   文案、错误卡重试、空态；
 * - 全程（口径切换/下钻/重试）网络写请求严格为 0（RL-01）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { PmoKpiCardGrid } from '@/components/next/pmo/PmoKpiCardGrid'
import { PmoTrafficSummaryCard } from '@/components/next/pmo/PmoTrafficSummaryCard'
import { PmoPortfolioAlertsCard } from '@/components/next/pmo/PmoPortfolioAlertsCard'
import { PmoInvestmentDistributionSection } from '@/components/next/pmo/PmoInvestmentDistributionSection'
import type {
  PortfolioDashboardMetric,
  PortfolioSourceFreshness,
  PortfolioTrafficLightBlock,
  PortfolioDashboardWarning,
} from '@aiproj/types'
import { PORTFOLIO_DASHBOARD_METRIC_STATUSES, PORTFOLIO_DASHBOARD_SOURCES } from '@aiproj/types'

const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/pmo',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// 会话 & 伪后端
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

function makeMetric(
  key: string,
  value: number | null,
  unit: PortfolioDashboardMetric['unit'] = 'count',
  status: PortfolioDashboardMetric['status'] = PORTFOLIO_DASHBOARD_METRIC_STATUSES.OK,
  warnings: PortfolioDashboardMetric['warnings'] = [],
): PortfolioDashboardMetric {
  return {
    key: key as PortfolioDashboardMetric['key'],
    value,
    unit,
    source: PORTFOLIO_DASHBOARD_SOURCES.COMPUTED,
    status,
    warnings,
  }
}

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

function installFetchRouter(
  route: (path: string, method: string) => Response | Promise<Response> | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    records.push({ method, url: rawUrl })
    const path = rawUrl.replace(API_PREFIX, '')
    const matched = await route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
  navMock.push.mockClear()
}

function writeMethods(records: RequestRecord[]): string[] {
  return records.filter((record) => record.method !== 'GET').map((record) => record.method)
}

function renderNode(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------
// KPI 统计卡（纯展示 props 直接渲染）
// ---------------------------------------------------------------------------
describe('PmoKpiCardGrid：数值/单位/受限渲染', () => {
  test('percent 单位拼 %、count 原样、null 显示 —、forbidden 项带受限标记并降透明', () => {
    const kpis: PortfolioDashboardMetric[] = [
      makeMetric('total_projects', 8),
      makeMetric('delivery_on_track_percent', 88, 'percent'),
      makeMetric('overall_progress_avg', 61, 'percent'),
      makeMetric('overdue_project_percent', null, 'percent'),
      makeMetric(
        'metric_unavailable_count',
        null,
        'count',
        PORTFOLIO_DASHBOARD_METRIC_STATUSES.FORBIDDEN,
        [
          {
            code: 'METRIC_FORBIDDEN',
            message: '指标因权限不足已脱敏',
            metricKey: 'metric_unavailable_count',
          },
        ],
      ),
    ]
    render(<PmoKpiCardGrid kpis={kpis} />)

    const values = Array.from(document.querySelectorAll('[data-pmo-kpi-value]')).map(
      (node) => node.textContent,
    )
    expect(values).toContain('8')
    expect(values).toContain('88%')
    expect(values).toContain('61%')
    expect(values).toContain('—')

    const forbiddenCard = document.querySelector('[data-pmo-kpi="metric_unavailable_count"]')
    expect(forbiddenCard).not.toBeNull()
    expect(forbiddenCard?.querySelector('[data-pmo-kpi-forbidden]')).not.toBeNull()
    expect(forbiddenCard?.className).toContain('opacity-45')
    expect(forbiddenCard?.querySelector('[data-pmo-kpi-warning]')?.textContent).toContain(
      '指标因权限不足已脱敏',
    )
    expect(screen.getByText('项目总数')).toBeInTheDocument()
    expect(screen.getByText('按期交付')).toBeInTheDocument()
    expect(screen.getByText('平均进度')).toBeInTheDocument()
    expect(screen.getByText('延期项目')).toBeInTheDocument()
  })

  test('空 KPI 列表渲染空态而非空白', () => {
    render(<PmoKpiCardGrid kpis={[]} />)
    expect(document.querySelector('[data-pmo-kpi-empty]')).not.toBeNull()
    expect(document.querySelector('[data-pmo-kpi-grid]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 交通灯摘要卡（纯展示 props 直接渲染）
// ---------------------------------------------------------------------------
describe('PmoTrafficSummaryCard：四色计数与不可用文案', () => {
  test('可用态渲染四色计数（色点 + 中文标签双通道）', () => {
    const trafficLight: PortfolioTrafficLightBlock = {
      available: true,
      forbidden: false,
      redCount: 2,
      yellowCount: 1,
      greenCount: 3,
      grayCount: 0,
      warnings: [],
    }
    render(<PmoTrafficSummaryCard trafficLight={trafficLight} />)

    expect(document.querySelector('[data-pmo-traffic-count="red"]')?.textContent).toContain('红灯')
    expect(document.querySelector('[data-pmo-traffic-count="red"]')?.textContent).toContain('2')
    expect(document.querySelector('[data-pmo-traffic-count="yellow"]')?.textContent).toContain('1')
    expect(document.querySelector('[data-pmo-traffic-count="green"]')?.textContent).toContain('3')
    expect(document.querySelector('[data-pmo-traffic-count="gray"]')?.textContent).toContain('0')
    expect(document.querySelector('[data-pmo-traffic-unavailable]')).toBeNull()
  })

  test('不可用态展示后端 warnings 文案而非空白', () => {
    const trafficLight: PortfolioTrafficLightBlock = {
      available: false,
      forbidden: false,
      redCount: 0,
      yellowCount: 0,
      greenCount: 0,
      grayCount: 0,
      warnings: [
        {
          code: 'TRAFFIC_LIGHT_UNAVAILABLE',
          message: 'PMO 交通灯能力未启用或尚未实现',
        },
      ],
    }
    render(<PmoTrafficSummaryCard trafficLight={trafficLight} />)

    const unavailable = document.querySelector('[data-pmo-traffic-unavailable]')
    expect(unavailable).not.toBeNull()
    expect(unavailable?.textContent).toContain('PMO 交通灯能力未启用或尚未实现')
    expect(document.querySelector('[data-pmo-traffic-count="red"]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 告警与数据新鲜度卡（纯展示 props 直接渲染）
// ---------------------------------------------------------------------------
describe('PmoPortfolioAlertsCard：告警条目与新鲜度双通道', () => {
  test('warnings 条目渲染 code + 文案；stale 源带「已过期」状态字', () => {
    const warnings: PortfolioDashboardWarning[] = [
      { code: 'SOURCE_STALE', message: '预测数据源已过期' },
      { code: 'TRAFFIC_LIGHT_UNAVAILABLE', message: 'PMO 交通灯能力未启用' },
    ]
    const freshness: PortfolioSourceFreshness[] = [
      {
        source: PORTFOLIO_DASHBOARD_SOURCES.PROJECT_DASHBOARD,
        lastUpdatedAt: '2026-09-01T07:30:00.000Z',
        isStale: false,
        staleThresholdMinutes: 60,
      },
      {
        source: PORTFOLIO_DASHBOARD_SOURCES.PREDICTION,
        lastUpdatedAt: '2026-08-30T00:00:00.000Z',
        isStale: true,
        staleThresholdMinutes: 60,
      },
    ]
    render(<PmoPortfolioAlertsCard warnings={warnings} freshness={freshness} />)

    const alertItems = Array.from(document.querySelectorAll('[data-pmo-alert-item]'))
    expect(alertItems).toHaveLength(2)
    expect(document.querySelector('[data-pmo-alert-code="SOURCE_STALE"]')?.textContent).toContain(
      '预测数据源已过期',
    )
    const staleItem = document.querySelector('[data-pmo-freshness-source="prediction"]')
    expect(staleItem?.textContent).toContain('已过期')
    expect(staleItem?.textContent).toContain('2026-08-30 00:00')
    const freshItem = document.querySelector('[data-pmo-freshness-source="project_dashboard"]')
    expect(freshItem?.textContent).not.toContain('已过期')
    expect(document.querySelector('[data-pmo-alerts-empty]')).toBeNull()
  })

  test('两者皆空渲染语义空态', () => {
    render(<PmoPortfolioAlertsCard warnings={[]} freshness={[]} />)
    expect(document.querySelector('[data-pmo-alerts-empty]')).not.toBeNull()
    expect(screen.getByText('当前没有组合提示')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 投入分布区块（真实数据链：hooks + 全局 fetch 伪后端）
// ---------------------------------------------------------------------------
function makeInvestMeta(overrides: Record<string, unknown> = {}) {
  return {
    calculatedAt: '2026-09-01T08:00:00.000Z',
    metricVersion: 'pmo-investment-distribution.v1',
    organizationId: 1,
    actorId: 10,
    visibleProjectCount: 6,
    basis: 'project_count',
    dimension: 'project_type',
    displayMode: 'donut',
    totalBasisValue: 6,
    sourceFreshness: [
      {
        source: 'project',
        lastUpdatedAt: '2026-09-01T07:00:00.000Z',
        isStale: false,
        staleThresholdMinutes: 60,
      },
    ],
    ...overrides,
  }
}

const CATALOGUE_BODY = {
  data: {
    nonFinancialBasis: ['project_count', 'planned_effort_hours'],
    unsupportedFinancialBasis: ['budget_amount'],
    dimensions: ['project_type', 'status'],
    displayModes: ['donut', 'horizontal_bar'],
    topN: { default: 10, max: 20 },
    trendWindows: ['last_30_days', 'last_90_days'],
    metricVersion: 'pmo-investment-distribution.v1',
  },
}

function makeDistributionBody(overrides: { warnings?: unknown[]; buckets?: unknown[] } = {}) {
  return {
    data: {
      meta: makeInvestMeta(),
      buckets: [
        {
          key: 'delivery',
          label: '交付项目',
          total: 3,
          percent: 50,
          projectCount: 3,
          status: 'ok',
          evidenceRefs: [],
          warnings: [],
        },
        {
          key: 'research',
          label: '研究项目',
          total: 2,
          percent: 33.33,
          projectCount: 2,
          status: 'ok',
          evidenceRefs: [],
          warnings: [],
        },
        {
          key: 'classified',
          label: '涉密项目组',
          total: 1,
          percent: 16.67,
          projectCount: null,
          status: 'redacted',
          evidenceRefs: [],
          warnings: [],
        },
      ],
      warnings: [],
      ...overrides,
    },
  }
}

function createInvestBackend() {
  const route = (path: string, method: string): Response | null => {
    if (method !== 'GET') return null
    if (path.startsWith('/pmo/investment-distribution/catalogue')) {
      return jsonResponse(200, CATALOGUE_BODY)
    }
    if (path.startsWith('/pmo/investment-distribution/trends')) {
      return jsonResponse(200, {
        meta: makeInvestMeta(),
        data: [
          {
            label: '最近 30 天',
            startDate: '2026-08-02',
            endDate: '2026-09-01',
            buckets: [
              {
                key: 'delivery',
                label: '交付项目',
                total: 3,
                percent: 50,
                projectCount: 3,
                status: 'ok',
                evidenceRefs: [],
                warnings: [],
              },
            ],
            totalBasisValue: 6,
            warnings: [],
          },
        ],
        warnings: [],
      })
    }
    if (path.includes('/buckets/')) {
      return jsonResponse(200, {
        meta: makeInvestMeta(),
        data: [
          {
            projectId: 11,
            projectName: '交付平台改造',
            bucketKey: 'delivery',
            basisValue: 1,
            status: 'ok',
            evidenceRefs: [],
            warnings: [],
          },
        ],
        warnings: [],
      })
    }
    if (path.startsWith('/pmo/investment-distribution')) {
      return jsonResponse(200, makeDistributionBody())
    }
    return null
  }
  return { route }
}

describe('PmoInvestmentDistributionSection：summary/trends 只读呈现', () => {
  test('桶列表（占比 + 脱敏诚实呈现）、meta 口径行与趋势摘要渲染，全程零写', async () => {
    const backend = createInvestBackend()
    const { records } = installFetchRouter(backend.route)
    renderNode(<PmoInvestmentDistributionSection />)

    await waitFor(() => expect(document.querySelector('[data-pmo-invest-section]')).not.toBeNull())
    expect(document.querySelector('[data-pmo-invest-meta]')?.textContent).toContain('项目数')
    expect(document.querySelector('[data-pmo-invest-meta]')?.textContent).toContain('项目类型')
    expect(document.querySelector('[data-pmo-invest-meta]')?.textContent).toContain('6 个可见项目')

    const deliveryRow = document.querySelector('[data-pmo-invest-bucket="delivery"]')
    expect(deliveryRow?.textContent).toContain('交付项目')
    expect(deliveryRow?.textContent).toContain('50%')
    expect(deliveryRow?.textContent).toContain('3 个项目')

    // 脱敏桶：不泄露隐藏数量，以「已脱敏/不可用」诚实呈现
    const redactedRow = document.querySelector('[data-pmo-invest-bucket="classified"]')
    expect(redactedRow?.textContent).toContain('已脱敏')
    expect(redactedRow?.textContent).toContain('不可用')
    expect(redactedRow?.textContent).not.toContain('个项目')
    expect(redactedRow?.querySelector('[data-pmo-invest-redacted="classified"]')).not.toBeNull()

    // 趋势窗摘要
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-invest-trend="最近 30 天"]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-pmo-invest-trend="最近 30 天"]')?.textContent).toContain(
      '总投入 6',
    )
    expect(document.querySelector('[data-pmo-invest-trend="最近 30 天"]')?.textContent).toContain(
      '主要分布：交付项目 50%',
    )

    // 口径选择器来自 catalogue
    expect(
      document.querySelectorAll('[data-pmo-invest-basis] option').length,
    ).toBeGreaterThanOrEqual(3)
    await waitFor(() => expect(writeMethods(records)).toHaveLength(0))
  })

  test('口径切换以新参数重查；drill-down 只读展开与收起', async () => {
    const backend = createInvestBackend()
    const { records } = installFetchRouter(backend.route)
    renderNode(<PmoInvestmentDistributionSection />)

    await waitFor(() =>
      expect(document.querySelector('[data-pmo-invest-bucket="delivery"]')).not.toBeNull(),
    )

    // 切口径 → 摘要带 basis=planned_effort_hours 重查
    fireEvent.change(screen.getByLabelText('投入口径'), {
      target: { value: 'planned_effort_hours' },
    })
    await waitFor(() =>
      expect(records.some((record) => record.url.includes('basis=planned_effort_hours'))).toBe(
        true,
      ),
    )
    expect(document.querySelector('[data-pmo-invest-drilldown]')).toBeNull()

    // 点击桶行 → drill-down GET 只读明细
    fireEvent.click(screen.getByRole('button', { name: /交付项目/ }))
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-invest-drilldown]')).not.toBeNull(),
    )
    await waitFor(() =>
      expect(records.some((record) => record.url.includes('/buckets/delivery'))).toBe(true),
    )
    await waitFor(() =>
      expect(
        document.querySelector('[data-pmo-invest-drilldown-item="11"]')?.textContent,
      ).toContain('交付平台改造'),
    )

    // 收起 → 明细清空
    fireEvent.click(screen.getByRole('button', { name: '收起项目明细' }))
    await waitFor(() => expect(document.querySelector('[data-pmo-invest-drilldown]')).toBeNull())
    expect(writeMethods(records)).toHaveLength(0)
  })

  test('摘要 500：错误卡 → 重新载入重试成功闭环', async () => {
    let failed = true
    const backend = createInvestBackend()
    const { records } = installFetchRouter((path, method) => {
      if (
        failed &&
        path.startsWith('/pmo/investment-distribution') &&
        !path.includes('/trends') &&
        !path.includes('/catalogue')
      ) {
        failed = false
        return jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom' } })
      }
      return backend.route(path, method)
    })
    renderNode(<PmoInvestmentDistributionSection />)

    await waitFor(() => expect(document.querySelector('[data-pmo-invest-error]')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '重新载入' }))
    await waitFor(() => expect(document.querySelector('[data-pmo-invest-error]')).toBeNull())
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-invest-bucket="delivery"]')).not.toBeNull(),
    )
    expect(writeMethods(records)).toHaveLength(0)
  })

  test('空摘要：语义空态；财务不可用 warnings：不可用文案而非 0 值图表', async () => {
    const route = (path: string, method: string): Response | null => {
      if (method !== 'GET') return null
      if (path.startsWith('/pmo/investment-distribution/catalogue')) {
        return jsonResponse(200, CATALOGUE_BODY)
      }
      if (path.startsWith('/pmo/investment-distribution')) {
        return jsonResponse(200, {
          data: {
            meta: makeInvestMeta(),
            buckets: [],
            warnings: [
              {
                code: 'FINANCIAL_BASIS_UNSUPPORTED',
                message: '财务、预算、成本、收益和 ROI 口径不在当前 PMO 投入分布范围内',
              },
            ],
          },
        })
      }
      return null
    }
    installFetchRouter(route)
    renderNode(<PmoInvestmentDistributionSection />)

    await waitFor(() =>
      expect(document.querySelector('[data-pmo-invest-unsupported]')).not.toBeNull(),
    )
    expect(screen.getByText('该财务口径当前不可用')).toBeInTheDocument()
    expect(document.querySelector('[data-pmo-invest-bucket="delivery"]')).toBeNull()
  })

  test('空组合（buckets + warnings 皆空）渲染空态', async () => {
    const route = (path: string, method: string): Response | null => {
      if (method !== 'GET') return null
      if (path.startsWith('/pmo/investment-distribution/catalogue')) {
        return jsonResponse(200, CATALOGUE_BODY)
      }
      if (path.startsWith('/pmo/investment-distribution/trends')) {
        return jsonResponse(200, { meta: makeInvestMeta(), data: [], warnings: [] })
      }
      if (path.startsWith('/pmo/investment-distribution')) {
        return jsonResponse(200, { data: { meta: makeInvestMeta(), buckets: [], warnings: [] } })
      }
      return null
    }
    installFetchRouter(route)
    renderNode(<PmoInvestmentDistributionSection />)

    await waitFor(() => expect(document.querySelector('[data-pmo-invest-empty]')).not.toBeNull())
    expect(screen.getByText('暂无可展示的投入分布')).toBeInTheDocument()
  })
})
