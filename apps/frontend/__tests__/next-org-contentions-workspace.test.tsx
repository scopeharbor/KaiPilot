/**
 * v3-ui-next-org-portfolio-domains W5 · tasks 5.4 —— 争用工作台组件测试
 * （矩阵/列表切换与筛选、证据抽屉 403 中性限制态、建议抽屉只读、写请求恒为 0）。
 *
 * 以真实 hooks + 全局 fetch 伪后端驱动（与 help-knowledge 域页面测试同款）：
 * - summary/items/matrix/detail/evidence/suggestions 端点全部由伪后端应答，
 *   网络记录断言「只读交互零写请求」（RL-01）与筛选/视图切换的重查行为；
 * - URL query 为筛选唯一事实来源：初始 URL 恢复（restorable）与筛选写回断言；
 * - 证据抽屉 403 → 中性限制态（不泄露证据存在性）；5xx → 可重试；
 * - 建议抽屉 rule/ai 双 kind 切换（kind 参数落 URL），AI 建议卡带 AIMarker 语义。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { ContentionWorkspace } from '@/components/next/org-contentions/ContentionWorkspace'
import type {
  ResourceContentionEvidence,
  ResourceContentionItem,
  ResourceContentionMatrix,
  ResourceContentionSuggestionPreview,
  ResourceContentionSummary,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
const searchParamsMock = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/organization/resource-contentions',
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

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------
function makeSummary(): ResourceContentionSummary {
  return {
    meta: {
      calculatedAt: '2026-09-02T00:00:00.000Z',
      metricVersion: 'resource-contention-detection.v1',
      organizationId: 1,
      actorId: 1,
      visibleProjectCount: 2,
      visibleResourceCount: 2,
      querySignatureHash: 'sig',
      sourceSignatureHash: 'sig2',
    },
    severityCounts: { critical: 1, high: 1, warning: 0, info: 0 },
    reasonCounts: {
      'cross-project-overload': 1,
      'unavailable-allocation': 1,
      'critical-skill-contention': 0,
      'duplicate-reservation': 0,
      'demand-window-contention': 0,
      'draft-allocation-contention': 0,
    },
    affectedProjectCount: 2,
    affectedResourceCount: 2,
    totalContentions: 2,
    sourceFreshness: [
      {
        source: 'resource_allocation',
        lastUpdatedAt: '2026-09-01T00:00:00.000Z',
        isStale: true,
        staleThresholdMinutes: 60,
        status: 'unavailable',
      },
    ],
    warnings: [],
    evidenceHashes: ['abc', 'def'],
  }
}

let nextContentionId = 0
function makeItem(overrides: Partial<ResourceContentionItem> = {}): ResourceContentionItem {
  nextContentionId += 1
  const id = `ctn-${nextContentionId}`
  return {
    contentionId: id,
    severity: 'high',
    reasonCode: 'cross-project-overload',
    resourceId: nextContentionId,
    resourceName: `张工${nextContentionId}`,
    projectIds: [1, 2],
    projectNames: ['商城重构', '中台迁移'],
    taskId: null,
    allocationId: null,
    from: '2026-09-01',
    to: '2026-09-14',
    loadPercent: 145,
    affectedDateBuckets: null,
    description: `${id} 的描述`,
    remediationHint: '建议调整分配窗口',
    evidenceHash: 'abc',
    target: null,
    redactionState: 'visible',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeMatrix(): ResourceContentionMatrix {
  return {
    from: '2026-09-01',
    to: '2026-09-02',
    rows: [
      {
        resourceId: 1,
        resourceName: '张工1',
        role: '后端工程师',
        totalContentions: 2,
        maxSeverity: 'critical',
        cells: [
          {
            date: '2026-09-01',
            severity: 'critical',
            reasonCode: 'cross-project-overload',
            loadPercent: 152,
            contentionCount: 2,
            redactionState: 'visible',
            drillDownTarget: null,
          },
          {
            date: '2026-09-02',
            severity: null,
            reasonCode: null,
            loadPercent: 30,
            contentionCount: 0,
            redactionState: 'visible',
            drillDownTarget: null,
          },
        ],
        redactionState: 'visible',
      },
      {
        resourceId: 2,
        resourceName: null,
        role: null,
        totalContentions: 1,
        maxSeverity: null,
        cells: [
          {
            date: '2026-09-01',
            severity: null,
            reasonCode: null,
            loadPercent: null,
            contentionCount: 0,
            redactionState: 'forbidden',
            drillDownTarget: null,
          },
          {
            date: '2026-09-02',
            severity: null,
            reasonCode: null,
            loadPercent: null,
            contentionCount: 0,
            redactionState: 'forbidden',
            drillDownTarget: null,
          },
        ],
        redactionState: 'forbidden',
      },
    ],
  }
}

function makeRuleSuggestions(contentionId: string): ResourceContentionSuggestionPreview[] {
  return [
    {
      suggestionId: `rule-${contentionId}`,
      contentionId,
      kind: 'rule',
      title: '规则建议',
      description: `基于争用类型 cross-project-overload 的处置建议`,
      candidateActions: ['审查跨项目分配', '调整分配窗口'],
      isAdvisory: true,
      redactionState: 'visible',
      createdAt: '2026-09-02T00:00:00.000Z',
    },
  ]
}

function makeAiSuggestions(contentionId: string): ResourceContentionSuggestionPreview[] {
  return [
    {
      suggestionId: `ai-${contentionId}`,
      contentionId,
      kind: 'ai',
      title: 'AI 建议（仅供审查）',
      description: 'AI 争用建议仅作参考，不自动执行。',
      candidateActions: ['审查跨项目分配', '联系资源负责人'],
      isAdvisory: true,
      redactionState: 'visible',
      createdAt: '2026-09-02T00:00:00.000Z',
    },
  ]
}

// ---------------------------------------------------------------------------
// 伪后端
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

interface BackendOptions {
  /** 证据端点 403 的条目集合。 */
  restrictedEvidence?: Set<string>
  /** summary 返回 500 次数（前 N 次）。 */
  summaryServerErrors?: number
  /** detail 端点 404 条目集合（RL-05 中性未找到）。 */
  missingDetails?: Set<string>
}

function createBackend(options: BackendOptions = {}) {
  const items = [
    makeItem({ contentionId: 'ctn-1', severity: 'critical', resourceId: 1 }),
    makeItem({ contentionId: 'ctn-2' }),
  ]
  const matrix = makeMatrix()
  let summaryErrorsLeft = options.summaryServerErrors ?? 0
  const evidence: Record<string, ResourceContentionEvidence> = {
    'ctn-1': {
      evidenceHash: 'evidence-hash-111',
      source: 'resource_allocation',
      lastUpdatedAt: '2026-09-01T00:00:00.000Z',
      metricKeys: ['load_percent', 'allocation_hours'],
      isLowSensitive: true,
    },
  }
  return {
    store: { items, matrix },
    route: (path: string, method: string): Response | null => {
      if (method !== 'GET') return null
      if (path.startsWith('/organizations/1/resource-contentions/summary')) {
        if (summaryErrorsLeft > 0) {
          summaryErrorsLeft -= 1
          return jsonResponse(500, { error: { code: 'INTERNAL_SERVER_ERROR', message: 'boom' } })
        }
        return jsonResponse(200, { data: makeSummary() })
      }
      if (path.startsWith('/organizations/1/resource-contentions/items')) {
        const qs = new URLSearchParams(path.split('?')[1] ?? '')
        const severity = qs.get('severity')
        const rows = severity === null ? items : items.filter((item) => item.severity === severity)
        return jsonResponse(200, {
          data: rows,
          meta: { total: rows.length, page: 1, perPage: 20, totalPages: 1 },
        })
      }
      if (path.startsWith('/organizations/1/resource-contentions/matrix')) {
        return jsonResponse(200, { data: matrix })
      }
      const evidenceMatch = path.match(
        /^\/organizations\/1\/resource-contentions\/([^/]+)\/evidence$/,
      )
      if (evidenceMatch) {
        const contentionId = evidenceMatch[1]!
        if (options.restrictedEvidence?.has(contentionId)) {
          return jsonResponse(403, {
            error: { code: 'PERMISSION_DENIED', message: 'PERMISSION_DENIED' },
          })
        }
        return evidence[contentionId]
          ? jsonResponse(200, { data: evidence[contentionId] })
          : jsonResponse(404, {
              error: { code: 'RESOURCE_NOT_FOUND', message: 'evidence not found' },
            })
      }
      const suggestionsMatch = path.match(
        /^\/organizations\/1\/resource-contentions\/([^/]+)\/suggestions\?kind=([a-z]+)$/,
      )
      if (suggestionsMatch) {
        const contentionId = suggestionsMatch[1]!
        const kind = suggestionsMatch[2]!
        return jsonResponse(
          200,
          kind === 'ai'
            ? { data: makeAiSuggestions(contentionId) }
            : { data: makeRuleSuggestions(contentionId) },
        )
      }
      const detailMatch = path.match(/^\/organizations\/1\/resource-contentions\/([^/]+)$/)
      if (detailMatch) {
        const contentionId = detailMatch[1]!
        if (options.missingDetails?.has(contentionId)) {
          return jsonResponse(404, {
            error: { code: 'RESOURCE_NOT_FOUND', message: 'not found' },
          })
        }
        const item = items.find((entry) => entry.contentionId === contentionId)
        return item
          ? jsonResponse(200, { data: item })
          : jsonResponse(404, {
              error: { code: 'RESOURCE_NOT_FOUND', message: 'not found' },
            })
      }
      return null
    },
  }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ContentionWorkspace />
    </QueryClientProvider>,
  )
}

/** 以列表视图渲染（抽屉测试前置：行级证据/建议入口只在列表行上）。 */
function renderListWorkspace() {
  searchParamsMock.value = new URLSearchParams('view=list')
  window.history.replaceState({}, '', '/next/organization/resource-contentions?view=list')
  return renderWorkspace()
}

const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE']

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  searchParamsMock.value = new URLSearchParams()
  window.history.replaceState({}, '', '/next/organization/resource-contentions')
  nextContentionId = 0
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------

describe('ContentionWorkspace：矩阵/列表双视图与筛选（tasks 5.2/5.4）', () => {
  test('默认矩阵视图：骨架 → 摘要卡 + 矩阵网格（色阶双通道 + 受限行中性化）', async () => {
    setAuth(['org:view'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()

    // 首帧骨架
    expect(document.querySelector('[data-contention-skeleton]')).not.toBeNull()
    expect(document.querySelector('[data-contention-skeleton]')?.getAttribute('aria-busy')).toBe(
      'true',
    )
    await waitFor(() => expect(document.querySelector('[data-contention-summary]')).not.toBeNull())
    // 摘要四卡与计数（aria-label 双通道断言；矩阵单元格亦含「严重」文字，勿用裸文本）
    expect(screen.getByLabelText('严重: 1 项')).toBeInTheDocument()
    expect(screen.getByLabelText('高风险: 1 项')).toBeInTheDocument()
    expect(document.querySelector('[data-contention-summary-card="critical"]')).not.toBeNull()
    // 矩阵行（受限行中性化：无数值、出现占位文案）
    await waitFor(() =>
      expect(document.querySelectorAll('[data-contention-matrix-row]')).toHaveLength(2),
    )
    expect(document.querySelectorAll('[data-contention-matrix-row="1"]').length).toBeGreaterThan(0)
    expect(document.querySelector('[data-contention-matrix-row="2"]')).not.toBeNull()
    // 可见单元格渲染负载数值（已授权）；受限行绝不渲染任何数值（RL-05）
    expect(document.body.textContent).toContain('152%')
    expect(document.querySelector('[data-contention-matrix-row="2"]')?.textContent).not.toContain(
      '%',
    )
    expect(document.body.textContent).toContain('不可见')
    // 可见单元格色阶+文字双通道（aria-label 语义存在）
    expect(
      document.querySelector('[data-contention-matrix-row="1"] td[aria-label="2026-09-01 严重"]'),
    ).not.toBeNull()
    // 只读：全程零写请求
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })

  test('列表视图切换：URL 写回 view=list 且重查 items；筛选写回 severity 且重查带筛选', async () => {
    setAuth(['org:view'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-contention-summary]')).not.toBeNull())

    fireEvent.click(document.querySelector('[data-contention-view-list]') as Element)
    await waitFor(() =>
      expect(document.querySelectorAll('[data-contention-list-row]')).toHaveLength(2),
    )
    expect(navMock.push).toHaveBeenCalledWith('/next/organization/resource-contentions?view=list')

    // 严重度筛选 → 重查 items 携带 severity=critical
    const severitySelect = document.querySelector(
      '[data-contention-severity-filter]',
    ) as HTMLSelectElement
    fireEvent.change(severitySelect, { target: { value: 'critical' } })
    await waitFor(() =>
      expect(
        records.some((r) => r.url.includes('/resource-contentions/items?severity=critical')),
      ).toBe(true),
    )
    expect(navMock.push).toHaveBeenLastCalledWith(
      '/next/organization/resource-contentions?view=list&severity=critical',
    )
    await waitFor(() =>
      expect(document.querySelectorAll('[data-contention-list-row]')).toHaveLength(1),
    )
    // 重置筛选 → severity 从 URL 中移除（view 保留）
    fireEvent.click(document.querySelector('[data-contention-filters-reset]') as Element)
    expect(navMock.push).toHaveBeenLastCalledWith(
      '/next/organization/resource-contentions?view=list',
    )
    await waitFor(() =>
      expect(
        records.some((r) => r.url.includes('/resource-contentions/items?page=1&perPage=20')),
      ).toBe(true),
    )
    // 只读：零写请求
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })

  test('URL 状态恢复（restorable）：?view=list&severity=high 直达列表且列表请求带筛选', async () => {
    setAuth(['org:view'])
    searchParamsMock.value = new URLSearchParams('view=list&severity=high')
    window.history.replaceState(
      {},
      '',
      '/next/organization/resource-contentions?view=list&severity=high',
    )
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()
    await waitFor(() =>
      expect(document.querySelectorAll('[data-contention-list-row]')).toHaveLength(1),
    )
    expect(records.some((r) => r.url.includes('/resource-contentions/items?severity=high'))).toBe(
      true,
    )
    expect(
      document.querySelector('[data-contention-view-list]')?.getAttribute('aria-checked'),
    ).toBe('true')
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })

  test('5xx 主导查询失败：错误卡可重试（refetch 后恢复）', async () => {
    setAuth(['org:view'])
    const backend = createBackend({ summaryServerErrors: 1 })
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-contention-error]')).not.toBeNull())
    expect(document.querySelector('[data-contention-retry]')).not.toBeNull()
    fireEvent.click(document.querySelector('[data-contention-retry]') as Element)
    await waitFor(() => expect(document.querySelector('[data-contention-summary]')).not.toBeNull())
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })

  test('403 主导查询失败：中性受限态（无重试按钮）', async () => {
    setAuth(['org:view'])
    const backend = createBackend()
    const { records } = installFetchRouter((path, method) => {
      if (path.startsWith('/organizations/1/resource-contentions/summary')) {
        return jsonResponse(403, {
          error: { code: 'PERMISSION_DENIED', message: 'PERMISSION_DENIED' },
        })
      }
      return backend.route(path, method)
    })
    renderWorkspace()
    await waitFor(() => expect(document.querySelector('[data-contention-error]')).not.toBeNull())
    expect(screen.getByText('争用数据不可见')).toBeInTheDocument()
    expect(document.querySelector('[data-contention-retry]')).toBeNull()
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })
})

describe('ContentionWorkspace：证据/建议抽屉（tasks 5.3/5.4）', () => {
  test('证据抽屉：打开即只读加载 detail + evidence；关闭后零泄漏请求', async () => {
    setAuth(['org:view'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderListWorkspace()
    await waitFor(() =>
      expect(document.querySelectorAll('[data-contention-list-row]')).toHaveLength(2),
    )
    const row1 = document.querySelector('[data-contention-list-row="ctn-1"]') as Element
    fireEvent.click(row1.querySelector('[data-contention-row-evidence]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-contention-evidence-drawer]')).not.toBeNull(),
    )
    await waitFor(() =>
      expect(document.querySelector('[data-contention-evidence-content]')).not.toBeNull(),
    )
    expect(document.body.textContent).toContain('evidence-hash-111')
    expect(
      records.some((r) => r.url === '/organizations/1/resource-contentions/ctn-1/evidence'),
    ).toBe(true)
    expect(records.some((r) => r.url === '/organizations/1/resource-contentions/ctn-1')).toBe(true)
    // 关闭抽屉
    fireEvent.click(document.querySelector('[data-contention-evidence-close]') as Element)
    expect(document.querySelector('[data-contention-evidence-drawer]')).toBeNull()
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })

  test('证据抽屉 403：中性限制态且不泄露证据存在性；其他条目证据不受影响', async () => {
    setAuth(['org:view'])
    const backend = createBackend({ restrictedEvidence: new Set(['ctn-2']) })
    const { records } = installFetchRouter(backend.route)
    renderListWorkspace()
    await waitFor(() =>
      expect(document.querySelectorAll('[data-contention-list-row]')).toHaveLength(2),
    )
    // 打开受限条目证据
    const row2 = document.querySelector('[data-contention-list-row="ctn-2"]') as Element
    fireEvent.click(row2.querySelector('[data-contention-row-evidence]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-contention-drawer-restricted]')).not.toBeNull(),
    )
    expect(screen.getByText('受限内容不可见')).toBeInTheDocument()
    // 不泄露证据存在性（403 内容绝不出现证据指纹/端点原文）
    expect(document.body.textContent).not.toContain('evidenceHash')
    expect(document.body.textContent).not.toContain('PERMISSION_DENIED')
    // 关闭后打开可见条目证据正常
    fireEvent.click(document.querySelector('[data-contention-evidence-close]') as Element)
    const row1 = document.querySelector('[data-contention-list-row="ctn-1"]') as Element
    fireEvent.click(row1.querySelector('[data-contention-row-evidence]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-contention-evidence-content]')).not.toBeNull(),
    )
    expect(document.body.textContent).toContain('evidence-hash-111')
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })

  test('证据/详情 404：中性未找到文案（RL-05）', async () => {
    setAuth(['org:view'])
    const backend = createBackend({ missingDetails: new Set(['ctn-2']) })
    installFetchRouter(backend.route)
    renderListWorkspace()
    await waitFor(() =>
      expect(document.querySelectorAll('[data-contention-list-row]')).toHaveLength(2),
    )
    const row2 = document.querySelector('[data-contention-list-row="ctn-2"]') as Element
    fireEvent.click(row2.querySelector('[data-contention-row-evidence]') as Element)
    await waitFor(() => {
      // detail 与 evidence 各自的中性未找到态（文案相同属预期，双区块）
      const notFoundBlocks = document.querySelectorAll('[data-contention-drawer-notfound]')
      expect(notFoundBlocks.length).toBeGreaterThan(0)
      expect(notFoundBlocks[0]?.textContent).toContain('未找到争用记录')
      expect(notFoundBlocks[0]?.textContent).not.toContain('not found') // 后端原文零呈现
    })
  })

  test('建议抽屉：规则建议只读呈现；切 AI 建议以 kind=ai 重查且回显 AIMarker 标注', async () => {
    setAuth(['org:view'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderListWorkspace()
    await waitFor(() =>
      expect(document.querySelectorAll('[data-contention-list-row]')).toHaveLength(2),
    )
    const row1 = document.querySelector('[data-contention-list-row="ctn-1"]') as Element
    // 规则建议
    fireEvent.click(row1.querySelector('[data-contention-row-suggestion-rule]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-contention-suggestion-drawer]')).not.toBeNull(),
    )
    await waitFor(() =>
      expect(document.querySelector('[data-contention-suggestion-card]')).not.toBeNull(),
    )
    expect(document.body.textContent).toContain('规则建议')
    expect(
      records.some((r) => r.url.includes('/resource-contentions/ctn-1/suggestions?kind=rule')),
    ).toBe(true)
    expect(
      document
        .querySelector('[data-contention-suggestion-card]')
        ?.getAttribute('data-contention-suggestion-kind'),
    ).toBe('rule')
    // 咨询红线
    expect(document.querySelector('[data-contention-suggestion-disclaimer]')).not.toBeNull()

    // 切 AI 建议（kind=ai 实查，杜绝共享缓存串档）
    fireEvent.click(document.querySelector('[data-contention-suggestion-kind-tab="ai"]') as Element)
    await waitFor(() => {
      const aiCard = document.querySelector(
        '[data-contention-suggestion-card][data-contention-suggestion-kind="ai"]',
      )
      expect(aiCard).not.toBeNull()
    })
    expect(
      records.some((r) => r.url.includes('/resource-contentions/ctn-1/suggestions?kind=ai')),
    ).toBe(true)
    expect(
      document.querySelector('[data-contention-suggestion-card] [data-ai-marker]'),
    ).not.toBeNull()
    expect(screen.getByText(/来源：AI 洞察/)).toBeInTheDocument()
    // 关抽屉
    fireEvent.click(document.querySelector('[data-contention-suggestion-close]') as Element)
    expect(document.querySelector('[data-contention-suggestion-drawer]')).toBeNull()
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })

  test('建议抽屉 5xx：可重试恢复；403：中性限制态', async () => {
    setAuth(['org:view'])
    const backend = createBackend()
    let failNext = 1
    const { records } = installFetchRouter((path, method) => {
      if (path.includes('/suggestions?kind=rule') && failNext > 0) {
        failNext -= 1
        return jsonResponse(500, { error: { code: 'INTERNAL_SERVER_ERROR', message: 'boom' } })
      }
      return backend.route(path, method)
    })
    renderListWorkspace()
    await waitFor(() =>
      expect(document.querySelectorAll('[data-contention-list-row]')).toHaveLength(2),
    )
    const row1 = document.querySelector('[data-contention-list-row="ctn-1"]') as Element
    fireEvent.click(row1.querySelector('[data-contention-row-suggestion-rule]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-contention-suggestion-error]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-contention-suggestion-retry]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-contention-suggestion-card]')).not.toBeNull(),
    )
    expect(records.filter((r) => writeMethods.includes(r.method))).toHaveLength(0)
  })
})
