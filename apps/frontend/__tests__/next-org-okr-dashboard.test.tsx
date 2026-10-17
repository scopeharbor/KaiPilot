/**
 * v3-ui-next-org-portfolio-domains W2 · tasks 2.7 —— OKR 仪表盘页面装配与幽灵守卫
 * 修复回归测试（spec「OKR 层级管理与达成仪表盘（幽灵守卫修复）」场景 +
 * OkrDashboardWorkspace/OkrDashboardSections 呈现）。
 *
 * 覆盖：
 * - 具备 org:view：GET /okrs/dashboard 查询 enabled 并发起，分区矩阵渲染，全程
 *   零写请求；不具备 `okr:view`（幽灵权限）不再抑制任何查询（旧轨守卫恒拒回归
 *   锁定——permission 声明中从未包含 okr:view）；
 * - 仅 portfolio:view 的 PM 任一集合兜底准入；
 * - 无 org:view/portfolio:view：受限横幅且 /okrs/dashboard 零请求；未选择组织
 *   引导态零请求；
 * - KPI 受限指标卡（forbidden）中性「不可见」且无任何数值文本（RL-05 脱敏）；
 * - 周期联动：切换周期后 summary 查询带 cycleId=2 重查（只读）；
 * - 三态：骨架 → 内容；500 错误卡 → 重试成功；空态（无可见目标/KR）；
 * - 面包屑回显：坐标探针 `/next/organization/okrs/dashboard ·`（精确标签随 W10
 *   坐标注册定案，页面内标题同源锁定「OKR 仪表盘」）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import OrganizationOkrsDashboardPage from '@/app/(next)/next/organization/okrs/dashboard/page'
import { OkrDashboardWorkspace } from '@/components/next/org-okr/OkrDashboardWorkspace'
import { resolveSpaceBreadcrumb } from '@/lib/next/space-breadcrumbs'
import { makeOkrCycle } from '@aiproj/types'
import type {
  OkrCycle,
  OkrDashboardAlignmentHealth,
  OkrDashboardBackflowSummary,
  OkrDashboardCycleContext,
  OkrDashboardEvidenceFreshness,
  OkrDashboardMeta,
  OkrDashboardMetric,
  OkrDashboardSummary,
} from '@aiproj/types'
import {
  OKR_DASHBOARD_ATTENTION_REASONS,
  OKR_DASHBOARD_METRIC_KEYS,
  OKR_DASHBOARD_WARNING_CODES,
} from '@aiproj/types'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// 会话 & 伪后端
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'member@example.com',
      fullName: '组织成员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'member' }],
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

function installFetchRouter(route: (path: string, method: string) => Response | null): {
  records: RequestRecord[]
} {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path })
    const matched = route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

// ---------------------------------------------------------------------------
// OkrDashboardSummary 夹具（与 @aiproj/types 契约全字段）
// ---------------------------------------------------------------------------
function metric(
  key: OkrDashboardMetric['key'],
  value: number | null,
  unit: OkrDashboardMetric['unit'] = 'count',
  status: OkrDashboardMetric['status'] = 'ok',
): OkrDashboardMetric {
  return { key, value, unit, source: 'computed', status }
}

const META_BASE: OkrDashboardMeta = {
  calculatedAt: '2026-09-10T12:00:00.000Z',
  metricVersion: 'okr-dashboard.1.0.0',
  organizationId: 1,
  actorId: 1,
  cycleId: 1,
  visibleObjectiveCount: 3,
  visibleKeyResultCount: 4,
  restrictedObjectiveCount: 0,
  restrictedKeyResultCount: 0,
  sections: [
    'cycle_context',
    'kpi',
    'progress_distribution',
    'attention',
    'alignment_health',
    'evidence_freshness',
    'backflow',
  ],
  attentionLimit: 8,
  staleThresholdMinutes: 4320,
  inputSignatureHash: 'fixture',
}

const CYCLE_CONTEXT: OkrDashboardCycleContext = {
  cycleId: 1,
  title: 'Q3 2026',
  status: 'active',
  startDate: '2026-06-01T00:00:00.000Z',
  endDate: '2026-09-30T00:00:00.000Z',
  elapsedPercent: 60,
  daysRemaining: 20,
}

const ALIGNMENT_HEALTH: OkrDashboardAlignmentHealth = {
  available: true,
  forbidden: false,
  healthScore: 82,
  orphanObjectiveCount: 1,
  weakAlignmentCount: 0,
  disabledScopeReferences: 0,
  maxDepth: 2,
  warnings: [],
}

const EVIDENCE_FRESHNESS: OkrDashboardEvidenceFreshness = {
  available: true,
  forbidden: false,
  totalEvidence: 12,
  staleEvidence: 2,
  restrictedEvidence: 1,
  freshestAt: '2026-09-10T10:00:00.000Z',
  stalestAt: '2026-09-01T00:00:00.000Z',
  warnings: [],
}

const BACKFLOW: OkrDashboardBackflowSummary = {
  available: true,
  forbidden: false,
  candidateCount: 2,
  conflictCount: 1,
  staleCount: 0,
  lastRefreshedAt: null,
  targets: [],
  warnings: [],
}

function makeSummary(overrides: { empty?: boolean } = {}): OkrDashboardSummary {
  const empty = overrides.empty ?? false
  return {
    meta: {
      ...META_BASE,
      visibleObjectiveCount: empty ? 0 : 3,
      visibleKeyResultCount: empty ? 0 : 4,
    },
    cycleContext: CYCLE_CONTEXT,
    kpis: [
      metric(OKR_DASHBOARD_METRIC_KEYS.TOTAL_OBJECTIVES, empty ? 0 : 3),
      metric(OKR_DASHBOARD_METRIC_KEYS.ACTIVE_OBJECTIVES, empty ? 0 : 3),
      metric(OKR_DASHBOARD_METRIC_KEYS.AT_RISK_OBJECTIVES, null, 'count', 'forbidden'),
      metric(OKR_DASHBOARD_METRIC_KEYS.BEHIND_KEY_RESULTS, empty ? 0 : 2),
      metric(OKR_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG, empty ? 0 : 58, 'percent'),
      metric(OKR_DASHBOARD_METRIC_KEYS.STALE_KEY_RESULTS, empty ? 0 : 1),
    ],
    progressDistribution: [
      { key: 'lt25', label: '<25%', count: 0, percent: 0 },
      { key: 'lt50', label: '25-49%', count: 0, percent: 0 },
      { key: 'lt75', label: '50-74%', count: 2, percent: 67 },
      { key: 'lt100', label: '75-99%', count: 1, percent: 33 },
      { key: 'done', label: '100%', count: 0, percent: 0 },
    ],
    statusDistribution: [
      { key: 'draft', label: '草稿', count: 0, percent: 0 },
      { key: 'active', label: '进行中', count: 3, percent: 100 },
      { key: 'paused', label: '暂停', count: 0, percent: 0 },
      { key: 'completed', label: '已完成', count: 0, percent: 0 },
      { key: 'archived', label: '已归档', count: 0, percent: 0 },
    ],
    attention: [
      {
        kind: 'key_result',
        entityId: 21,
        title: '核心模块交付进度落后',
        scope: null,
        status: 'active',
        progress: 32,
        confidence: 'low',
        ownerId: null,
        riskScore: 78,
        reasons: [
          OKR_DASHBOARD_ATTENTION_REASONS.BEHIND_TARGET,
          OKR_DASHBOARD_ATTENTION_REASONS.LOW_CONFIDENCE,
        ],
        freshness: null,
        target: null,
        warnings: [],
      },
    ],
    alignmentHealth: ALIGNMENT_HEALTH,
    evidenceFreshness: EVIDENCE_FRESHNESS,
    backflow: BACKFLOW,
    sourceFreshness: [
      {
        source: 'okr_key_result',
        lastUpdatedAt: '2026-09-05T00:00:00.000Z',
        isStale: true,
        staleThresholdMinutes: 4320,
        status: 'stale',
      },
      {
        source: 'computed',
        lastUpdatedAt: '2026-09-10T12:00:00.000Z',
        isStale: false,
        staleThresholdMinutes: 4320,
        status: 'ok',
      },
    ],
    warnings: [
      {
        code: OKR_DASHBOARD_WARNING_CODES.SOURCE_STALE,
        message: '关键结果数据源已过期',
        source: 'okr_key_result',
      },
    ],
  }
}

const cycles: OkrCycle[] = [
  makeOkrCycle({ id: 1, title: 'Q3 2026' }),
  makeOkrCycle({ id: 2, title: 'Q4 2026', status: 'draft' }),
]

function createBackend(options: { summaryFailures?: number } = {}) {
  let summaryFailures = options.summaryFailures ?? 0
  const route = (path: string, method: string): Response | null => {
    if (path === '/organizations/1/okrs/cycles' && method === 'GET') {
      return jsonResponse(200, {
        data: cycles,
        meta: { total: 2, page: 1, perPage: 25, totalPages: 1 },
      })
    }
    if (path.startsWith('/organizations/1/okrs/dashboard') && method === 'GET') {
      if (summaryFailures > 0) {
        summaryFailures -= 1
        return jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } })
      }
      const qs = path.includes('?') ? new URLSearchParams(path.slice(path.indexOf('?') + 1)) : null
      const cycleId = qs?.get('cycleId')
      const summary = makeSummary()
      if (cycleId === '2') {
        summary.cycleContext = { ...CYCLE_CONTEXT, cycleId: 2, title: 'Q4 2026', status: 'draft' }
        summary.meta = { ...summary.meta, cycleId: 2 }
      }
      return jsonResponse(200, { data: summary })
    }
    return null
  }
  return { route }
}

/** 顶栏坐标回显探针（镜像 NextAppShell 消费公式）。 */
function BreadcrumbEchoProbe({ pathname }: { pathname: string }) {
  return <span data-coordinate-echo>{resolveSpaceBreadcrumb(pathname)}</span>
}

function renderPage(node: React.ReactNode) {
  // retryDelay 0：让 hook 级 queryRetry（500 重试两次）在测试中瞬时耗尽
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function settle(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeEach(() => {
  setAuth(['org:view'])
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------
// 幽灵守卫修复回归 + RBAC（spec 场景）
// ---------------------------------------------------------------------------
describe('OkrDashboardPage：幽灵守卫修复与 RBAC（spec「具备 org:view 正常加载」）', () => {
  test('具备 org:view（无 okr:view 声明）：/okrs/dashboard 查询 enabled 并发起，分区矩阵渲染', async () => {
    // 权限声明从不含幽灵权限 okr:view（后端注册表不存在）——旧轨此场景恒拒 + 查询被抑制
    expect(['org:view']).not.toContain('okr:view')
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<OrganizationOkrsDashboardPage />)

    // 骨架 → 工作台
    expect(document.querySelector('[data-okr-dash-skeleton]')).not.toBeNull()
    await waitFor(() => expect(document.querySelector('[data-okr-dash-workspace]')).not.toBeNull())
    expect(screen.getByRole('heading', { name: 'OKR 仪表盘' })).toBeInTheDocument()
    // KPI 选区 4 卡（活跃目标/风险目标/落后 KR/平均进度）+ 分区矩阵
    expect(document.querySelectorAll('[data-okr-dash-kpi]')).toHaveLength(4)
    expect(document.querySelector('[data-okr-dash-section="attention"]')).not.toBeNull()
    expect(document.querySelector('[data-okr-dash-attention-list]')).not.toBeNull()
    // 警告 rail 与 stale 数据源
    expect(document.querySelector('[data-okr-dash-warning-rail]')).not.toBeNull()
    expect(document.querySelector('[data-okr-dash-stale-rail]')).not.toBeNull()

    await waitFor(() => {
      const summaryGets = records.filter((record) =>
        record.url.startsWith('/organizations/1/okrs/dashboard'),
      )
      expect(summaryGets.length).toBeGreaterThanOrEqual(1)
    })
    expect(records.some((record) => record.method !== 'GET')).toBe(false)
  })

  test('受限 KPI 卡（forbidden）中性「不可见」且不出现任何数值文本（RL-05）', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPage(<OrganizationOkrsDashboardPage />)
    await waitFor(() => expect(document.querySelector('[data-okr-dash-workspace]')).not.toBeNull())
    const redactedCard = document.querySelector('[data-okr-dash-kpi="okr_at_risk_objectives"]')
    expect(redactedCard?.getAttribute('data-okr-dash-kpi-redacted')).toBeDefined()
    expect(redactedCard?.textContent).toContain('不可见')
    expect(redactedCard?.textContent).not.toMatch(/\d/)
    // 授权卡数值正常回显
    const activeCard = document.querySelector('[data-okr-dash-kpi="okr_active_objectives"]')
    expect(activeCard?.textContent).toContain('3')
    expect(activeCard?.textContent).not.toContain('不可见')
  })

  test('仅 portfolio:view 的 PM：任一集合兜底准入（旧轨 okr:view 恒拒回归锁定）', async () => {
    setAuth(['portfolio:view'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<OrganizationOkrsDashboardPage />)

    await waitFor(() => expect(document.querySelector('[data-okr-dash-workspace]')).not.toBeNull())
    expect(document.querySelector('[data-permission-fallback]')).toBeNull()
    await waitFor(() =>
      expect(
        records.some((record) => record.url.startsWith('/organizations/1/okrs/dashboard')),
      ).toBe(true),
    )
  })

  test('无 org:view 与 portfolio:view：受限横幅渲染且 /okrs/dashboard 零请求（RL-06）', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    renderPage(<OrganizationOkrsDashboardPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看 OKR 仪表盘的权限')).toBeInTheDocument()
    expect(document.querySelector('[data-okr-dash-workspace]')).toBeNull()
    await settle()
    expect(records).toHaveLength(0)
  })

  test('未选择组织：中性引导态渲染且零请求', async () => {
    useAuthStore.setState({
      user: { id: 9, email: 'solo@example.com', fullName: '未入组成员', organizations: [] },
      currentOrganizationId: null,
      permissions: ['org:view'],
    })
    const { records } = installFetchRouter(() => null)
    renderPage(<OrganizationOkrsDashboardPage />)

    expect(document.querySelector('[data-org-no-organization]')).not.toBeNull()
    expect(screen.getByText('请先选择组织')).toBeInTheDocument()
    await settle()
    expect(records).toHaveLength(0)
  })

  test('面包屑回显：坐标探针 /next/organization/okrs/dashboard ·（标签随坐标注册定案）', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPage(
      <>
        <OrganizationOkrsDashboardPage />
        <BreadcrumbEchoProbe pathname="/next/organization/okrs/dashboard" />
      </>,
    )
    await waitFor(() => expect(document.querySelector('[data-okr-dash-workspace]')).not.toBeNull())
    const echo = document.querySelector('[data-coordinate-echo]')
    expect(echo?.textContent).toMatch(/^\/next\/organization\/okrs\/dashboard ·/)
    // 页面内标题与坐标标签语义同源锁定「OKR 仪表盘」
    expect(document.querySelector('[data-okr-dash-title]')?.textContent).toBe('OKR 仪表盘')
  })
})

// ---------------------------------------------------------------------------
// 工作台：周期联动 / 三态 / 只读（spec「浏览 OKR 目标树」同款交互纪律）
// ---------------------------------------------------------------------------
describe('OkrDashboardWorkspace：周期联动与三态（tasks 2.6/2.7）', () => {
  test('切换周期：summary 查询带 cycleId=2 重查且周期上下文联动；全程零写', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<OkrDashboardWorkspace organizationId={1} />)

    await waitFor(() => expect(document.querySelector('[data-okr-dash-workspace]')).not.toBeNull())
    const picker = document.querySelector('[data-okr-cycle-picker]') as HTMLSelectElement
    fireEvent.change(picker, { target: { value: '2' } })

    await waitFor(() => {
      const cycle2Gets = records.filter(
        (record) =>
          record.url.startsWith('/organizations/1/okrs/dashboard') &&
          record.url.includes('cycleId=2'),
      )
      expect(cycle2Gets.length).toBeGreaterThanOrEqual(1)
    })
    // 周期上下文标题联动 Q4 2026
    await waitFor(() =>
      expect(document.querySelector('[data-okr-dash-cycle-context]')?.textContent).toContain(
        'Q4 2026',
      ),
    )
    expect(records.some((record) => record.method !== 'GET')).toBe(false)
  })

  test('错误态（500）→ 错误卡重试 refetch 成功闭环；可重试与受限态区分', async () => {
    // 先失败 3 次（首请求 + hook 级 queryRetry 两次瞬时重试），之后成功供重试按钮闭环
    const backend = createBackend({ summaryFailures: 3 })
    const { records } = installFetchRouter(backend.route)
    renderPage(<OkrDashboardWorkspace organizationId={1} />)

    await waitFor(() => expect(document.querySelector('[data-okr-dash-error]')).not.toBeNull())
    expect(document.querySelector('[data-okr-dash-restricted]')).toBeNull()
    fireEvent.click(document.querySelector('[data-okr-dash-retry]') as Element)
    await waitFor(() => expect(document.querySelector('[data-okr-dash-workspace]')).not.toBeNull())
    const summaryGets = records.filter((record) =>
      record.url.startsWith('/organizations/1/okrs/dashboard'),
    )
    expect(summaryGets.length).toBeGreaterThanOrEqual(4)
  })

  test('空态：无可见目标与 KR 时渲染语义空态', async () => {
    const route = (path: string, method: string): Response | null => {
      if (path === '/organizations/1/okrs/cycles' && method === 'GET') {
        return jsonResponse(200, {
          data: cycles,
          meta: { total: 2, page: 1, perPage: 25, totalPages: 1 },
        })
      }
      if (path.startsWith('/organizations/1/okrs/dashboard') && method === 'GET') {
        return jsonResponse(200, { data: makeSummary({ empty: true }) })
      }
      return null
    }
    installFetchRouter(route)
    renderPage(<OkrDashboardWorkspace organizationId={1} />)

    await waitFor(() => expect(document.querySelector('[data-okr-dash-empty]')).not.toBeNull())
    expect(document.body.textContent).toContain('当前周期暂无可见 OKR 数据')
    expect(document.querySelector('[data-okr-dash-sections]')).toBeNull()
  })

  test('只读铁律：加载与周期切换期间 fetch 全为 GET（RL-01）', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<OkrDashboardWorkspace organizationId={1} />)
    await waitFor(() => expect(document.querySelector('[data-okr-dash-workspace]')).not.toBeNull())
    const picker = document.querySelector('[data-okr-cycle-picker]') as HTMLSelectElement
    fireEvent.change(picker, { target: { value: '1' } })
    await settle(40)
    expect(records.length).toBeGreaterThanOrEqual(2)
    expect(records.every((record) => record.method === 'GET')).toBe(true)
  })
})
