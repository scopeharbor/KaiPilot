/**
 * v3-ui-next-risk-change-domains W1 · tasks 1.2 —— 风险域路由与工作台容器测试
 * （页面级真实路由 + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「风险域新轨工作面路由与工作台总览」场景）：
 * - /next/projects/:id/risks 初次加载：项目校验通过后渲染三态工作台骨架，顶部
 *   态势卡 + Top 高危列表 + 待复查队列 + 规则候选区按 workbench 态挂载；
 * - 无 risk:view → 受限横幅（data-permission-fallback）且业务请求零发出（RL-06）；
 * - 非数字项目 ID → 中性 404（「项目不存在或已被移除」）零网络请求（RL-05）；
 * - 工作台 / 登记册 / 矩阵三态切换：URL 保持稳定（无 push/replace/back），
 *   本地激活态随切换正确迁移，矩阵态挂载 5×5 热力矩阵与联动底册。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import ProjectRisksDomainPage from '@/app/(next)/next/projects/[id]/risks/page'
import type { Project } from '@/lib/api/projects'
import type { Risk } from '@/lib/api/risks'
import type { RiskLevel, RiskReviewItem, RiskWorkbenchSummary } from '@/lib/api/risks-v2'

// ---------------------------------------------------------------------------
// next/navigation mock（页面路由消费 useRouter / useParams）
// ---------------------------------------------------------------------------
const paramsMock = vi.hoisted(() => ({ value: { id: '42' } as { id: string } }))
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/risks',
  useParams: () => paramsMock.value,
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// 会话 & 夹具
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

let nextRiskId = 1000
function makeRisk(overrides: Partial<Risk>): Risk {
  const probability = overrides.probability ?? 3
  const impact = overrides.impact ?? 3
  const now = '2026-09-01T00:00:00.000Z'
  return {
    organizationId: 1,
    projectId: 42,
    riskCode: null,
    title: '未命名风险',
    description: '',
    category: 'technical',
    probability,
    impact,
    status: 'identified',
    mitigationStrategy: null,
    contingencyPlan: null,
    ownerId: null,
    triggerEvent: null,
    residualProbability: null,
    residualImpact: null,
    residualScore: null,
    identifiedAt: now,
    targetResolutionDate: null,
    resolvedAt: null,
    relatedTaskId: null,
    aiMetadata: null,
    createdBy: 1,
    updatedBy: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
    id: overrides.id ?? nextRiskId++,
    score: overrides.score ?? probability * impact,
  }
}

function defaultSeed(): Risk[] {
  nextRiskId = 1000
  return [
    makeRisk({
      id: 101,
      riskCode: 'RISK-101',
      title: '核心数据库迁移导致服务中断',
      description: '双机房割接窗口内存在写放大风险',
      category: 'technical',
      probability: 4,
      impact: 5,
      status: 'identified',
      mitigationStrategy: '主备切换与回滚演练预案',
      ownerId: 5,
    }),
    makeRisk({
      id: 102,
      riskCode: 'RISK-102',
      title: '云厂商服务涨价超预算',
      category: 'cost',
      probability: 4,
      impact: 5,
      status: 'identified',
    }),
    makeRisk({
      id: 103,
      riskCode: 'RISK-103',
      title: '关键开发人员离职',
      category: 'resource',
      probability: 4,
      impact: 4,
      status: 'mitigating',
      mitigationStrategy: '骨干备份与知识库沉淀',
      ownerId: 1,
    }),
    makeRisk({
      id: 104,
      title: '法规合规要求变更',
      category: 'legal',
      probability: 2,
      impact: 5,
      status: 'identified',
    }),
    makeRisk({
      id: 105,
      title: '验收口径未对齐',
      category: 'other',
      probability: 1,
      impact: 1,
      status: 'identified',
    }),
    makeRisk({
      id: 106,
      title: '数据合规审计处罚',
      category: 'external',
      probability: 5,
      impact: 5,
      status: 'accepted',
      ownerId: 1,
    }),
  ]
}

function makeSummary(seed: Risk[]): RiskWorkbenchSummary {
  return {
    totalRisks: seed.length,
    openRisks: 4,
    highRiskCount: 2,
    criticalRiskCount: 1,
    overdueReviewCount: 1,
    incompleteResponsePlans: 1,
    trend30d: { created: 3, closed: 1 },
    healthScore: 72,
    topRisks: [
      {
        id: 106,
        title: '数据合规审计处罚',
        riskLevel: 'critical' as RiskLevel,
        score: 25,
        status: 'accepted',
      },
      {
        id: 101,
        title: '核心数据库迁移导致服务中断',
        riskLevel: 'critical' as RiskLevel,
        score: 20,
        status: 'identified',
      },
      {
        id: 103,
        title: '关键开发人员离职',
        riskLevel: 'high' as RiskLevel,
        score: 16,
        status: 'mitigating',
      },
    ],
  }
}

function makeReviewQueue(): RiskReviewItem[] {
  return [
    {
      id: 103,
      title: '关键开发人员离职',
      riskLevel: 'high',
      score: 16,
      nextReviewAt: '2025-10-01T00:00:00.000Z',
      lastReviewAt: '2025-08-01T00:00:00.000Z',
      ownerId: 1,
    },
    {
      id: 101,
      title: '核心数据库迁移导致服务中断',
      riskLevel: 'critical',
      score: 20,
      nextReviewAt: '2099-01-15T00:00:00.000Z',
      lastReviewAt: null,
      ownerId: null,
    },
  ]
}

// ---------------------------------------------------------------------------
// 伪后端（页面全量端点语义）
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

export interface RequestRecord {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function installFetchRouter(
  route: (path: string, method: string) => Response | Promise<Response> | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: Record<string, unknown> | null = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>
      } catch {
        body = null
      }
    }
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({ method, url: path, body })
    const matched = await route(path, method)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function matrixCellsOf(store: Risk[]) {
  const cellMap = new Map<
    string,
    { probability: number; impact: number; count: number; topRiskIds: number[] }
  >()
  for (let p = 1; p <= 5; p += 1) {
    for (let i = 1; i <= 5; i += 1) {
      cellMap.set(`${p}-${i}`, { probability: p, impact: i, count: 0, topRiskIds: [] })
    }
  }
  for (const risk of store) {
    const cell = cellMap.get(`${risk.probability}-${risk.impact}`)
    if (cell) {
      cell.count += 1
      if (cell.topRiskIds.length < 5) cell.topRiskIds.push(risk.id)
    }
  }
  return { cells: Array.from(cellMap.values()) }
}

function createBackend() {
  const store: Risk[] = defaultSeed()
  const summary = makeSummary(store)
  const queue = makeReviewQueue()
  const project = makeProject()

  function paginate(page: number, perPage: number) {
    const total = store.length
    const totalPages = Math.max(1, Math.ceil(total / perPage))
    const start = (page - 1) * perPage
    const data = store.slice(start, start + perPage)
    return { data, meta: { total, page, perPage, totalPages } }
  }

  const route = (path: string, method: string): Response | null => {
    if (path === '/projects/42' && method === 'GET') {
      return jsonResponse(200, { data: project })
    }
    if (path === '/projects/42/risks/workbench/summary' && method === 'GET') {
      return jsonResponse(200, { data: summary })
    }
    if (path === '/projects/42/risks/workbench/review-queue' && method === 'GET') {
      return jsonResponse(200, { data: queue })
    }
    if (path.includes('/risks/matrix') && method === 'GET') {
      return jsonResponse(200, { data: matrixCellsOf(store) })
    }
    if (/^\/projects\/42\/risks(\?|$)/.test(path) && method === 'GET') {
      const query = new URL(path, 'http://x').searchParams
      const page = Number(query.get('page') ?? 1)
      const perPage = Number(query.get('perPage') ?? 100)
      return jsonResponse(200, paginate(page, perPage))
    }
    return null
  }

  return { store, summary, queue, route }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

function writeMethods(records: RequestRecord[]): string[] {
  return records.filter((record) => record.method !== 'GET').map((record) => record.method)
}

beforeEach(() => {
  paramsMock.value = { id: '42' }
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
})

afterEach(() => {
  resetFetchRouter()
})

describe('ProjectRisksDomainPage：初次加载渲染（spec 场景「用户进入风险管理工作台」）', () => {
  test('具备 risk:view：项目校验通过后渲染工作台，态势卡 / Top 高危 / 复查队列 / 候选区齐备', async () => {
    setAuth(['risk:view', 'risk:manage'])
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPage(<ProjectRisksDomainPage />)

    // 项目数据加载期先呈现骨架，随后渲染成功态容器
    expect(document.querySelector('[data-project-space-skeleton]')).not.toBeNull()
    await waitFor(() =>
      expect(document.querySelector('[data-risk-workspace-space]')).not.toBeNull(),
    )
    expect(screen.getByText('开项核心引擎 · 风险管理')).toBeInTheDocument()
    expect(document.querySelector('[data-risk-workspace-code]')?.textContent).toContain('PROJ-042')
    expect(document.querySelector('[data-risk-back-to-space]')).not.toBeNull()
    expect(document.querySelector('[data-risk-refresh-all]')).not.toBeNull()
    expect(document.querySelector('[data-risk-create-open]')).not.toBeNull()
    expect(document.querySelector('[data-risk-ai-open]')).not.toBeNull()

    // 工作台（默认态）：四张态势卡
    await waitFor(() => expect(document.querySelectorAll('[data-risk-stat-card]')).toHaveLength(4))
    const highCard = document.querySelector('[data-risk-stat-kind="highcritical"]')
    expect(highCard?.textContent).toContain('3')
    expect(highCard?.textContent).toContain('高危/严重风险')
    const healthCard = document.querySelector('[data-risk-stat-kind="health"]')
    expect(healthCard?.textContent).toContain('72')
    expect(healthCard?.getAttribute('data-health-tone')).toBe('success')

    // Top 高危简表 + 待复查队列 + 规则候选区
    expect(document.querySelectorAll('[data-risk-top-risk]')).toHaveLength(3)
    expect(screen.getByText('数据合规审计处罚')).toBeInTheDocument()
    expect(document.querySelector('[data-risk-review-queue]')).not.toBeNull()
    expect(screen.getByText('待复查风险队列')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-risk-review-item]')).toHaveLength(2)
    // 逾期条目高亮（2025 年复查日期）
    expect(document.querySelector('[data-review-overdue-badge]')).not.toBeNull()
    expect(document.querySelector('[data-risk-candidate-list]')).not.toBeNull()
    expect(screen.getByText('规则风险候选')).toBeInTheDocument()
    // 写能力：规则评估按钮可见
    expect(document.querySelector('[data-risk-candidates-evaluate]')).not.toBeNull()
  })

  test('无 risk:view：受限横幅渲染且业务请求零发出（RL-06）', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    renderPage(<ProjectRisksDomainPage />)

    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(screen.getByText('你没有查看该项目风险工作台的权限')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(records).toHaveLength(0)
  })

  test('非数字项目 ID：中性 404 视图，零网络请求（RL-05）', async () => {
    setAuth(['risk:view', 'risk:manage'])
    paramsMock.value = { id: 'abc' }
    const { records } = installFetchRouter(() => null)
    renderPage(<ProjectRisksDomainPage />)

    await screen.findByRole('status', { name: '项目不存在或已被移除' })
    expect(screen.getByText('项目不存在或已被移除')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('开项核心引擎')
    expect(records).toHaveLength(0)
  })
})

describe('ProjectRisksDomainPage：三态工作面视图切换（spec 场景「切换为风险登记册与矩阵视图」）', () => {
  test('工作台 → 登记册 → 矩阵：URL 稳定、本地激活态迁移正确', async () => {
    setAuth(['risk:view', 'risk:manage'])
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPage(<ProjectRisksDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-risk-workspace-space]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-risk-stat-card]')).toHaveLength(4))
    expect(document.querySelector('[data-risk-workbench-view]')).not.toBeNull()

    // 切到登记册
    fireViewTab('table')
    await waitFor(() => expect(document.querySelector('[data-risk-table-view]')).not.toBeNull())
    expect(document.querySelector('[data-risk-workbench-view]')).toBeNull()
    // 底册数据加载：6 条种子风险
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(6))
    expect(screen.getByText('核心数据库迁移导致服务中断')).toBeInTheDocument()
    expect(
      document.querySelector('[data-risk-view-tab="table"]')?.getAttribute('aria-selected'),
    ).toBe('true')

    // 切到矩阵：5×5 热力矩阵 + 联动底册
    fireViewTab('matrix')
    await waitFor(() =>
      expect(document.querySelector('[data-risk-operational-matrix]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-risk-cell]')).toHaveLength(25))
    expect(
      screen.getByRole('button', { name: '概率 4 · 影响 5 · 高危 · 2 条风险' }),
    ).toBeInTheDocument()
    expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(6)
    expect(
      document.querySelector('[data-risk-view-tab="matrix"]')?.getAttribute('aria-selected'),
    ).toBe('true')

    // 切回工作台：URL 全程未被改写（无 push/replace/back），本地激活态回迁
    fireViewTab('workbench')
    await waitFor(() => expect(document.querySelector('[data-risk-workbench-view]')).not.toBeNull())
    expect(
      document.querySelector('[data-risk-view-tab="workbench"]')?.getAttribute('aria-selected'),
    ).toBe('true')
    expect(navMock.push).not.toHaveBeenCalled()
    expect(navMock.replace).not.toHaveBeenCalled()
    expect(navMock.back).not.toHaveBeenCalled()
  })

  test('只读权限（risk:view 无写权限）：登记册数据可读，新建 / 规则评估入口物理隐藏', async () => {
    setAuth(['risk:view'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<ProjectRisksDomainPage />)

    await waitFor(() =>
      expect(document.querySelector('[data-risk-workspace-space]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-risk-create-open]')).toBeNull()
    expect(document.querySelector('[data-risk-ai-open]')).toBeNull()
    expect(document.querySelector('[data-risk-candidates-evaluate]')).toBeNull()

    fireViewTab('table')
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(6))
    // 只读行：无状态下拉、无编辑/删除入口
    expect(document.querySelector('[data-risk-status-select]')).toBeNull()
    expect(document.querySelector('[data-risk-edit-open]')).toBeNull()
    expect(document.querySelector('[data-risk-delete-open]')).toBeNull()
    const row101 = document.querySelector('[data-risk-row="101"]')
    expect(row101?.textContent).toContain('只读')
    expect(writeMethods(records)).toHaveLength(0)
  })
})

function fireViewTab(id: 'workbench' | 'table' | 'matrix') {
  const tab = document.querySelector(`[data-risk-view-tab="${id}"]`)
  expect(tab).not.toBeNull()
  fireEvent.click(tab as Element)
}
