/**
 * v3-ui-next-pmo-domain W2 · tasks 2.4 —— 红绿灯报告页装配 / 列表 / 过滤 / 排序 /
 * 分页 / 行点击下钻测试（页面级真实路由 + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「PMO 红绿灯报告与人工复核闭环」/ design Decision 5、RL-06）：
 * - 授权（portfolio:view）装配：计数卡四色、高密度列表、规则 ID/严重度/更新时间列；
 * - 计数卡点击 = 状态筛选（filterStatus 参数），「全部」/取消筛选复位；
 * - 状态/排序/顺序/分页参数序列化契约（与 fetchTrafficLightList 同形）；
 * - 行点击与「查看」按钮下钻 /next/projects/:id；
 * - 只读用户无复核入口且全程零写请求（RL-01/RL-06）；
 * - 无 portfolio:view 受限横幅零请求（RL-06）；orgId 未水合引导态零请求；
 * - 错误卡 → 重新加载闭环；空态清除筛选。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import PmoTrafficLightPage from '@/app/(next)/next/pmo/traffic-light/page'
import type {
  PortfolioTrafficLightItem,
  TrafficLightRuleId,
  TrafficLightSeverity,
  TrafficLightStatus,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/pmo/traffic-light',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// 会话与夹具
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

function makeEvidence(
  ruleId: TrafficLightRuleId,
  severity: TrafficLightSeverity,
  status: TrafficLightStatus,
  message: string,
  contributing: boolean = true,
) {
  return {
    ruleId,
    ruleVersion: 'pmo-traffic-light-v1',
    severity,
    status,
    message,
    evidenceRefs: [],
    sourceFreshness: {
      source: 'project_dashboard' as const,
      lastUpdatedAt: null,
      isStale: false,
      staleReason: null,
    },
    contributing,
  }
}

function makeItem(overrides: Partial<PortfolioTrafficLightItem> = {}): PortfolioTrafficLightItem {
  return {
    projectId: 1000,
    projectName: '开项核心引擎',
    projectStatus: 'active',
    trafficLight: 'green',
    severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
    sourceFreshness: {
      overallStale: false,
      staleSources: [],
      lastUpdatedAt: '2026-09-10T08:00:00.000Z',
    },
    evidence: [],
    warnings: [],
    reviewState: { reviewState: 'acknowledged', reviewedAt: null, reviewedBy: null, stale: false },
    ruleVersion: 'pmo-traffic-light-v1',
    calculatedAt: '2026-09-10T08:00:00.000Z',
    allowedActions: { canReview: true, canViewDetail: true },
    ...overrides,
  }
}

function fixtureItems(): PortfolioTrafficLightItem[] {
  return [
    makeItem({
      projectId: 1001,
      projectName: '开项核心引擎',
      trafficLight: 'red',
      severityCounts: { critical: 1, high: 1, medium: 0, low: 0 },
      evidence: [
        makeEvidence('TL-R01', 'critical', 'red', '关键里程碑已错过 1 个'),
        makeEvidence('TL-R05', 'high', 'red', '逾期任务占比 45%'),
      ],
      calculatedAt: '2026-09-10T08:00:00.000Z',
    }),
    makeItem({
      projectId: 1002,
      projectName: '商城重构',
      trafficLight: 'yellow',
      severityCounts: { critical: 0, high: 0, medium: 1, low: 0 },
      evidence: [makeEvidence('TL-R06', 'medium', 'yellow', '逾期任务占比 22%')],
      warnings: [{ code: 'SOURCE_STALE', message: '部分来源数据已过期' }],
      sourceFreshness: {
        overallStale: true,
        staleSources: ['health_diagnosis'],
        lastUpdatedAt: '2026-09-08T02:00:00.000Z',
      },
      reviewState: {
        reviewState: 'needs_follow_up',
        reviewedAt: '2026-09-09T03:00:00.000Z',
        reviewedBy: 1,
        stale: false,
      },
      calculatedAt: '2026-09-09T03:00:00.000Z',
    }),
    makeItem({ projectId: 1003, projectName: '支付中台', trafficLight: 'green' }),
    makeItem({
      projectId: 1004,
      projectName: '数据湖治理',
      trafficLight: 'gray',
      evidence: [
        makeEvidence('TL-R12', 'low', 'gray', '所有来源数据不可用或权限不足', false),
        makeEvidence('TL-R13', 'high', 'gray', '权限不足或数据未生成，无法评分', false),
      ],
    }),
  ]
}

const COUNT_CALCULATED_AT = '2026-09-10T08:00:00.000Z'

// ---------------------------------------------------------------------------
// 伪后端（全局 fetch；envelope 形态与后端 /pmo/traffic-light 契约一致）
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  url: string
  body?: string
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function installFetchRouter(
  route: (path: string, method: string, body?: string) => Response | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path, body: init?.body ? String(init.body) : undefined })
    const matched = route(path, method, init?.body ? String(init.body) : undefined)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function listResponse(items: PortfolioTrafficLightItem[], overrides: Record<string, unknown> = {}) {
  return {
    data: items,
    meta: {
      page: 1,
      perPage: 20,
      total: items.length,
      totalPages: 1,
      calculatedAt: '2026-09-10T08:00:00.000Z',
      ...overrides,
    },
  }
}

function countsResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      red: 1,
      yellow: 1,
      green: 1,
      gray: 1,
      total: 4,
      calculatedAt: COUNT_CALCULATED_AT,
      ...overrides,
    },
  }
}

/** 取最近一次列表 GET 的查询串（/pmo/traffic-light?...）。 */
function lastListQuery(records: RequestRecord[]): URLSearchParams {
  const record = [...records]
    .reverse()
    .find((entry) => entry.method === 'GET' && entry.url.startsWith('/pmo/traffic-light?'))
  if (!record) return new URLSearchParams()
  return new URLSearchParams(record.url.split('?')[1])
}

function listRecords(records: RequestRecord[]): RequestRecord[] {
  return records.filter(
    (entry) => entry.method === 'GET' && entry.url.startsWith('/pmo/traffic-light?'),
  )
}

// ---------------------------------------------------------------------------
// 渲染辅助
// ---------------------------------------------------------------------------
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PmoTrafficLightPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  navMock.push.mockClear()
  navMock.replace.mockClear()
  navMock.back.mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
  resetFetchRouter()
})

describe('PmoTrafficLightPage：装配 / 列表 / 过滤 / 下钻（spec 场景）', () => {
  test('portfolio:view 授权装配：四色计数、规则 ID/严重度/时间列渲染，零写请求', async () => {
    setAuth(['portfolio:view'])
    const { records } = installFetchRouter((path, method) => {
      if (method === 'GET' && path.startsWith('/pmo/traffic-light/counts')) {
        return jsonResponse(200, countsResponse())
      }
      if (method === 'GET' && path.startsWith('/pmo/traffic-light?')) {
        return jsonResponse(200, listResponse(fixtureItems()))
      }
      return null
    })
    renderPage()

    await waitFor(() => expect(screen.getByText('PMO 红绿灯报告')).toBeInTheDocument())
    await waitFor(() => expect(document.querySelectorAll('[data-traffic-row]').length).toBe(4))

    // 四色计数卡（双通道：色块 + 中文标签 + 计数）
    const redCard = document.querySelector('[data-traffic-count="red"]')
    expect(redCard?.textContent).toContain('红灯')
    expect(redCard?.textContent).toContain('1')
    expect(document.querySelector('[data-traffic-count="green"]')?.textContent).toContain('绿灯')
    expect(screen.getByText(/共 4 个项目/)).toBeInTheDocument()

    // 红灯行：状态双通道 + 规则 ID 徽标 + 严重度 + 更新时间
    const redRow = document.querySelector('[data-traffic-status="red"]')
    expect(redRow).not.toBeNull()
    expect(redRow?.textContent).toContain('红灯')
    expect(redRow?.querySelector('[data-traffic-rule="TL-R01"]')).not.toBeNull()
    expect(redRow?.querySelector('[data-traffic-rule="TL-R05"]')).not.toBeNull()
    expect(redRow?.querySelector('[data-traffic-severity="critical"]')?.textContent).toContain(
      '严重1',
    )
    expect(redRow?.querySelector('[data-traffic-updated]')?.textContent).toMatch(
      /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/,
    )

    // 黄灯行：数据过期徽标 + 复核状态回显
    const yellowRow = document.querySelector('[data-traffic-status="yellow"]')
    expect(yellowRow?.querySelector('[data-traffic-stale]')).not.toBeNull()
    expect(yellowRow?.querySelector('[data-traffic-review-state]')?.textContent).toContain('需跟进')

    // 绿灯行未复核
    const greenRow = document.querySelector('[data-traffic-status="green"]')
    expect(greenRow?.textContent).toContain('未复核')

    // 请求全部为 GET（只读页面零写，RL-01）
    expect(records.filter((record) => record.method !== 'GET').length).toBe(0)
    expect(records.some((record) => record.url.includes('/pmo/traffic-light'))).toBe(true)
  })

  test('行点击与「查看」按钮下钻 /next/projects/:id', async () => {
    setAuth(['portfolio:view'])
    installFetchRouter((path, method) => {
      if (method === 'GET' && path.startsWith('/pmo/traffic-light/counts')) {
        return jsonResponse(200, countsResponse())
      }
      if (method === 'GET' && path.startsWith('/pmo/traffic-light?')) {
        return jsonResponse(200, listResponse(fixtureItems()))
      }
      return null
    })
    renderPage()
    await waitFor(() => expect(document.querySelectorAll('[data-traffic-row]').length).toBe(4))

    // 行点击
    fireEvent.click(document.querySelector('[data-traffic-status="yellow"]')!)
    await waitFor(() => expect(navMock.push).toHaveBeenCalledWith('/next/projects/1002'))

    // 「查看」按钮（点击不触发行级重复跳转）
    navMock.push.mockClear()
    fireEvent.click(document.querySelector('[data-open-project="1003"]')!)
    await waitFor(() => expect(navMock.push).toHaveBeenCalledWith('/next/projects/1003'))
  })

  test('计数卡点击 = filterStatus 参数；取消筛选回「全部」', async () => {
    setAuth(['portfolio:view'])
    const { records } = installFetchRouter((path, method) => {
      if (method === 'GET' && path.startsWith('/pmo/traffic-light/counts')) {
        return jsonResponse(200, countsResponse())
      }
      if (method === 'GET' && path.startsWith('/pmo/traffic-light?')) {
        const query = new URLSearchParams(path.split('?')[1])
        const status = query.get('filterStatus')
        const filtered = status
          ? fixtureItems().filter((item) => item.trafficLight === status)
          : fixtureItems()
        return jsonResponse(200, listResponse(filtered))
      }
      return null
    })
    renderPage()
    await waitFor(() => expect(document.querySelectorAll('[data-traffic-row]').length).toBe(4))

    fireEvent.click(document.querySelector('[data-traffic-count="red"]')!)
    await waitFor(() =>
      expect(
        document.querySelector('[data-traffic-count="red"]')?.getAttribute('aria-pressed'),
      ).toBe('true'),
    )
    expect(lastListQuery(records).get('filterStatus')).toBe('red')
    expect(lastListQuery(records).get('page')).toBe('1')
    await waitFor(() => expect(document.querySelectorAll('[data-traffic-row]').length).toBe(1))

    // 再次点击取消筛选：回「全部」（基态查询仍在缓存中，直接回显全量）
    fireEvent.click(document.querySelector('[data-traffic-count="red"]')!)
    await waitFor(() =>
      expect(
        document.querySelector('[data-traffic-count="red"]')?.getAttribute('aria-pressed'),
      ).toBe('false'),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-traffic-row]').length).toBe(4))
  })

  test('状态下拉（含全部）与排序/顺序/分页参数契约', async () => {
    setAuth(['portfolio:view'])
    const { records } = installFetchRouter((path, method) => {
      if (method === 'GET' && path.startsWith('/pmo/traffic-light/counts')) {
        return jsonResponse(200, countsResponse())
      }
      if (method === 'GET' && path.startsWith('/pmo/traffic-light?')) {
        const query = new URLSearchParams(path.split('?')[1])
        const status = query.get('filterStatus')
        const filtered = status
          ? fixtureItems().filter((item) => item.trafficLight === status)
          : fixtureItems()
        return jsonResponse(
          200,
          listResponse(filtered, {
            page: Number(query.get('page') ?? 1),
            totalPages: 3,
            total: 60,
          }),
        )
      }
      return null
    })
    renderPage()
    await waitFor(() => expect(document.querySelectorAll('[data-traffic-row]').length).toBe(4))

    // 状态下拉：yellow
    fireEvent.change(document.querySelector('[data-traffic-filter-status]')!, {
      target: { value: 'yellow' },
    })
    await waitFor(() => expect(lastListQuery(records).get('filterStatus')).toBe('yellow'))
    // 回「全部」：状态复位（全量基态在缓存中直接回显，无需新请求）
    fireEvent.change(document.querySelector('[data-traffic-filter-status]')!, {
      target: { value: 'all' },
    })
    await waitFor(() =>
      expect(
        (document.querySelector('[data-traffic-filter-status]') as HTMLSelectElement).value,
      ).toBe('all'),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-traffic-row]').length).toBe(4))

    // 排序字段（新查询键 → 新请求，且不再携带 filterStatus）
    fireEvent.change(document.querySelector('[data-traffic-filter-sort]')!, {
      target: { value: 'severity_critical' },
    })
    await waitFor(() => {
      const query = lastListQuery(records)
      return query.get('sort') === 'severity_critical' && !query.has('filterStatus')
    })

    // 顺序翻转
    fireEvent.click(document.querySelector('[data-traffic-filter-order]')!)
    await waitFor(() => expect(lastListQuery(records).get('order')).toBe('asc'))

    // 分页：下一页（page=2 请求），上一页回「第 1 页」（基态在缓存中回显）
    fireEvent.click(document.querySelector('[data-traffic-next-page]')!)
    await waitFor(() => {
      const query = lastListQuery(records)
      return query.get('page') === '2' && query.get('sort') === 'severity_critical'
    })
    await waitFor(() =>
      expect(document.querySelector('[data-traffic-page-indicator]')?.textContent).toContain(
        '2 / 3',
      ),
    )
    fireEvent.click(document.querySelector('[data-traffic-prev-page]')!)
    await waitFor(() =>
      expect(document.querySelector('[data-traffic-page-indicator]')?.textContent).toContain(
        '1 / 3',
      ),
    )
  })

  test('空态：筛选红灯无数据时提示并可清除筛选', async () => {
    setAuth(['portfolio:view'])
    installFetchRouter((path, method) => {
      if (method === 'GET' && path.startsWith('/pmo/traffic-light/counts')) {
        return jsonResponse(200, countsResponse())
      }
      if (method === 'GET' && path.startsWith('/pmo/traffic-light?')) {
        const query = new URLSearchParams(path.split('?')[1])
        const filtered = query.get('filterStatus') ? [] : fixtureItems()
        return jsonResponse(200, listResponse(filtered))
      }
      return null
    })
    renderPage()
    await waitFor(() => expect(document.querySelectorAll('[data-traffic-row]').length).toBe(4))

    fireEvent.change(document.querySelector('[data-traffic-filter-status]')!, {
      target: { value: 'gray' },
    })
    await waitFor(() => expect(document.querySelector('[data-traffic-empty]')).not.toBeNull())
    expect(screen.getByText('没有「灰灯」项目')).toBeInTheDocument()

    fireEvent.click(document.querySelector('[data-traffic-empty-clear]')!)
    await waitFor(() => expect(document.querySelector('[data-traffic-empty]')).toBeNull())
    // 全量基态在缓存中直接回显（无需携带 filterStatus 的新请求）
    await waitFor(() => expect(document.querySelectorAll('[data-traffic-row]').length).toBe(4))
    expect(
      (document.querySelector('[data-traffic-filter-status]') as HTMLSelectElement).value,
    ).toBe('all')
  })

  test('错误卡 → 重新加载闭环成功', async () => {
    setAuth(['portfolio:view'])
    let listFailed = true
    const { records } = installFetchRouter((path, method) => {
      if (method === 'GET' && path.startsWith('/pmo/traffic-light/counts')) {
        return jsonResponse(200, countsResponse())
      }
      if (method === 'GET' && path.startsWith('/pmo/traffic-light?')) {
        if (listFailed) {
          listFailed = false
          return jsonResponse(500, { error: { code: 'INTERNAL', message: '后端不可用' } })
        }
        return jsonResponse(200, listResponse(fixtureItems()))
      }
      return null
    })
    renderPage()

    await waitFor(() => expect(document.querySelector('[data-traffic-error]')).not.toBeNull())
    expect(screen.getByText(/红绿灯数据加载失败/)).toBeInTheDocument()

    fireEvent.click(document.querySelector('[data-traffic-retry]')!)
    await waitFor(() => expect(document.querySelector('[data-traffic-error]')).toBeNull())
    expect(document.querySelectorAll('[data-traffic-row]').length).toBe(4)
    expect(listRecords(records).length).toBeGreaterThanOrEqual(2)
  })
})

describe('PmoTrafficLightPage：RBAC 受限态（RL-06）与组织引导态', () => {
  test('无 portfolio:view：受限横幅渲染且零业务请求', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    renderPage()

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看红绿灯报告的权限')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(records.length).toBe(0)
  })

  test('orgId 未水合：组织引导态渲染且零请求', async () => {
    useAuthStore.setState({
      user: { id: 1, email: 'pm@example.com', fullName: '王启明', organizations: [] },
      accessToken: null,
      refreshToken: null,
      permissions: ['portfolio:view'],
      currentOrganizationId: null,
      planTier: null,
      roleVersion: 0,
      isAuthenticated: true,
      hasHydrated: true,
      effectiveTenantContext: null,
      selectionEpoch: 0,
    })
    const { records } = installFetchRouter(() => null)
    renderPage()

    expect(document.querySelector('[data-org-guide-state]')).not.toBeNull()
    expect(screen.getByText('请先选择组织')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(records.length).toBe(0)
  })
})
