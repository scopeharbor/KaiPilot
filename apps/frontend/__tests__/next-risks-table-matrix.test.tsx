/**
 * v3-ui-next-risk-change-domains W1 · tasks 1.6 —— 风险登记底册多维筛选、状态推进、
 * 两步删除与 5×5 矩阵联动测试（容器级：WorkspaceRisksPage + 伪后端）。
 *
 * 覆盖（spec「风险登记底册、多维检索与受控全生命周期管理」场景）：
 * - 分类 / 状态 / 敞口分值区间 / 关键字多维筛选与「重置筛选」；
 * - 状态下拉仅呈现 RISK_ALLOWED_TRANSITIONS 白名单流转目标，提交后调用
 *   POST /risks/:id/status 并刷新缓存回显新状态；
 * - 删除风险两步确认弹窗（取消不删 / 确认后 DELETE）；
 * - 点击 5×5 矩阵单元格收敛底册、联动胶囊计数与一键清除、同格再点取消；
 * - 行内「编辑」呼出详情抽屉：GET /risks/:id → PATCH 保存闭环；
 * - 应对计划：列表渲染、新增（POST response-plans）与两步确认删除。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { WorkspaceRisksPage } from '@/components/next/risks/WorkspaceRisksPage'
import type { Project } from '@/lib/api/projects'
import type { Risk } from '@/lib/api/risks'
import type {
  RiskLevel,
  RiskResponsePlan,
  RiskReviewItem,
  RiskWorkbenchSummary,
} from '@/lib/api/risks-v2'
import { RISK_ALLOWED_TRANSITIONS } from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42/risks',
  useParams: () => ({ id: '42' }),
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------
function setAuth(permissions: string[], userId = 1) {
  useAuthStore.setState({
    user: {
      id: userId,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions,
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function makeProject(): Project {
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
    targetResolutionDate: '2026-10-30T00:00:00.000Z',
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

let nextPlanId = 9000
function makePlan(riskId: number, overrides: Partial<RiskResponsePlan> = {}): RiskResponsePlan {
  const now = '2026-09-01T00:00:00.000Z'
  return {
    organizationId: 1,
    projectId: 42,
    riskId,
    strategyType: 'mitigate',
    actionDescription: '主备切换演练',
    ownerId: null,
    targetDate: '2026-09-15T00:00:00.000Z',
    status: 'planned',
    completionEvidence: null,
    relatedTaskId: null,
    auditLogId: null,
    completedAt: null,
    createdBy: 1,
    updatedBy: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
    id: nextPlanId++,
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
      probability: 3,
      impact: 3,
      status: 'analyzing',
      mitigationStrategy: null,
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

function summaryOf(store: Risk[]): RiskWorkbenchSummary {
  return {
    totalRisks: store.length,
    openRisks: 4,
    highRiskCount: 2,
    criticalRiskCount: 1,
    overdueReviewCount: 0,
    incompleteResponsePlans: 0,
    trend30d: { created: 0, closed: 0 },
    healthScore: 70,
    topRisks: store
      .filter((risk) => risk.score >= 10)
      .slice(0, 3)
      .map((risk) => ({
        id: risk.id,
        title: risk.title,
        riskLevel: (risk.score >= 20 ? 'critical' : 'high') as RiskLevel,
        score: risk.score,
        status: risk.status,
      })),
  }
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
  body: Record<string, unknown> | null
}

function installFetchRouter(
  route: (
    path: string,
    method: string,
    body: Record<string, unknown> | null,
  ) => Response | Promise<Response> | null,
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
    const matched = await route(path, method, body)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }
  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function writeMethods(records: RequestRecord[]): string[] {
  return records.filter((record) => record.method !== 'GET').map((record) => record.method)
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
  const plansByRisk = new Map<number, RiskResponsePlan[]>([
    [101, [makePlan(101, { status: 'completed', actionDescription: '历史演练归档' })]],
  ])
  const queue: RiskReviewItem[] = []
  const project = makeProject()

  function paginate(page: number, perPage: number) {
    const total = store.length
    const totalPages = Math.max(1, Math.ceil(total / perPage))
    const start = (page - 1) * perPage
    return { data: store.slice(start, start + perPage), meta: { total, page, perPage, totalPages } }
  }

  function route(
    path: string,
    method: string,
    body: Record<string, unknown> | null = null,
  ): Response | null {
    if (path === '/projects/42' && method === 'GET') return jsonResponse(200, { data: project })
    if (path === '/projects/42/risks/workbench/summary' && method === 'GET') {
      return jsonResponse(200, { data: summaryOf(store) })
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

    // 行级状态推进（白名单校验与服务端语义一致，成功后 store 同步）
    const statusMatch = path.match(/^\/risks\/(\d+)\/status$/)
    if (statusMatch && method === 'POST') {
      const risk = store.find((item) => item.id === Number(statusMatch[1]))
      if (!risk) return jsonResponse(404, { error: { code: 'RISK_NOT_FOUND', message: '' } })
      const next = body?.status as Risk['status']
      const allowed = RISK_ALLOWED_TRANSITIONS[risk.status] ?? []
      if (!next || !allowed.includes(next)) {
        return jsonResponse(422, {
          error: { code: 'VALIDATION_ERROR', message: `不允许从 ${risk.status} 转换到 ${next}` },
        })
      }
      risk.status = next
      if (next === 'resolved' || next === 'closed') {
        risk.resolvedAt = '2026-09-02T00:00:00.000Z'
      }
      return jsonResponse(200, { data: { ...risk } })
    }

    // 复查（本组测试不触发）
    const reviewMatch = path.match(/^\/projects\/42\/risks\/(\d+)\/review$/)
    if (reviewMatch && method === 'POST') {
      return jsonResponse(200, { data: {} })
    }

    // 应对计划
    const plansListMatch = path.match(/^\/projects\/42\/risks\/(\d+)\/response-plans$/)
    if (plansListMatch && method === 'GET') {
      const riskId = Number(plansListMatch[1])
      return jsonResponse(200, { data: plansByRisk.get(riskId) ?? [] })
    }
    if (plansListMatch && method === 'POST') {
      const riskId = Number(plansListMatch[1])
      const plan = makePlan(riskId, {
        actionDescription: String(body?.actionDescription ?? ''),
        strategyType: (body?.strategyType as RiskResponsePlan['strategyType']) ?? 'mitigate',
        targetDate: body?.targetDate ? String(body.targetDate) : null,
      })
      const list = plansByRisk.get(riskId) ?? []
      list.push(plan)
      plansByRisk.set(riskId, list)
      return jsonResponse(201, { data: plan })
    }
    const planDeleteMatch = path.match(/^\/projects\/42\/risks\/(\d+)\/response-plans\/(\d+)$/)
    if (planDeleteMatch && method === 'DELETE') {
      const riskId = Number(planDeleteMatch[1])
      const planId = Number(planDeleteMatch[2])
      plansByRisk.set(
        riskId,
        (plansByRisk.get(riskId) ?? []).filter((plan) => plan.id !== planId),
      )
      return jsonResponse(204, undefined)
    }

    // 行级风险详情 / 更新 / 删除
    const riskMatch = path.match(/^\/risks\/(\d+)$/)
    if (riskMatch) {
      const risk = store.find((item) => item.id === Number(riskMatch[1]))
      if (!risk) return jsonResponse(404, { error: { code: 'RISK_NOT_FOUND', message: '' } })
      if (method === 'GET') return jsonResponse(200, { data: { ...risk } })
      if (method === 'DELETE') {
        const index = store.indexOf(risk)
        store.splice(index, 1)
        return jsonResponse(204, undefined)
      }
      if (method === 'PATCH') {
        if (body?.title !== undefined) risk.title = String(body.title)
        if (body?.description !== undefined) risk.description = String(body.description)
        if (body?.category !== undefined) risk.category = String(body.category) as Risk['category']
        if (body?.probability !== undefined) risk.probability = Number(body.probability)
        if (body?.impact !== undefined) risk.impact = Number(body.impact)
        if (body?.mitigationStrategy !== undefined) {
          risk.mitigationStrategy =
            body.mitigationStrategy === null ? null : String(body.mitigationStrategy)
        }
        if (body?.contingencyPlan !== undefined) {
          risk.contingencyPlan = body.contingencyPlan === null ? null : String(body.contingencyPlan)
        }
        risk.score = risk.probability * risk.impact
        return jsonResponse(200, { data: { ...risk } })
      }
    }
    return null
  }

  return { store, plansByRisk, route }
}

function resetFetchRouter() {
  vi.unstubAllGlobals()
}

function renderPage(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

/** 切到登记册视图并等待 6 行种子数据。 */
async function openRegisterView(backend: ReturnType<typeof createBackend>) {
  installFetchRouter(backend.route)
  renderPage(<WorkspaceRisksPage projectId={42} />)
  await waitFor(() => expect(document.querySelector('[data-risk-workspace-space]')).not.toBeNull())
  fireEvent.click(screen.getByRole('tab', { name: '登记册视图' }))
  await waitFor(() => expect(document.querySelector('[data-risk-table-view]')).not.toBeNull())
  await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(6))
}

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  nextPlanId = 9000
  setAuth(['risk:view', 'risk:manage'])
})

afterEach(() => {
  resetFetchRouter()
})

describe('登记底册：多维筛选与重置（spec 场景「筛选高危技术风险」）', () => {
  test('分类 / 状态 / 分值区间 / 关键字组合筛选，重置恢复全量', async () => {
    const backend = createBackend()
    await openRegisterView(backend)

    // 关键字：标题命中 1 条
    fireEvent.change(screen.getByLabelText('搜索风险关键字'), {
      target: { value: '数据库' },
    })
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(1))
    expect(document.querySelector('[data-risk-row="101"]')).not.toBeNull()

    // 分值区间 ≥ 10：101/102/104/106（10 分制以上均为高危敞口）
    fireEvent.change(screen.getByLabelText('搜索风险关键字'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('最低敞口分值'), { target: { value: '10' } })
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(4))
    expect(document.querySelector('[data-risk-row="103"]')).toBeNull()

    // 分值区间 ≤ 9：103/105
    fireEvent.change(screen.getByLabelText('最低敞口分值'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('最高敞口分值'), { target: { value: '9' } })
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(2))
    expect(document.querySelector('[data-risk-row="103"]')).not.toBeNull()
    expect(document.querySelector('[data-risk-row="105"]')).not.toBeNull()

    // 分类 + 状态 + 关键字组合收敛到 0 → 「未找到匹配的记录」
    fireEvent.change(screen.getByLabelText('最高敞口分值'), { target: { value: '25' } })
    fireEvent.change(screen.getByLabelText('按分类筛选风险'), { target: { value: 'technical' } })
    fireEvent.change(screen.getByLabelText('按状态筛选风险'), { target: { value: 'accepted' } })
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(0))
    expect(screen.getByText('未找到匹配的记录')).toBeInTheDocument()

    // 清除筛选条件 → 恢复全量
    fireEvent.click(screen.getByRole('button', { name: '清除筛选条件' }))
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(6))
  })
})

describe('登记底册：白名单状态推进（spec 场景「合法推进风险状态至缓解中」）', () => {
  test('状态下拉仅呈现合法流转目标；提交后调用 transitionRiskStatus 并回显新状态', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<WorkspaceRisksPage projectId={42} />)
    await waitFor(() =>
      expect(document.querySelector('[data-risk-workspace-space]')).not.toBeNull(),
    )
    fireEvent.click(screen.getByRole('tab', { name: '登记册视图' }))
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(6))

    const statusSelect = screen.getByLabelText('关键开发人员离职 状态') as HTMLSelectElement
    expect(statusSelect.value).toBe('analyzing')
    const optionValues = Array.from(statusSelect.options).map((option) => option.value)
    const allowed = RISK_ALLOWED_TRANSITIONS.analyzing ?? []
    expect(allowed).toContain('mitigating')
    expect(optionValues).toEqual(['analyzing', ...allowed])
    expect(optionValues).not.toContain('identified')

    // 伪后端更新 store，随后缓存刷新回显新状态
    fireEvent.change(statusSelect, { target: { value: 'mitigating' } })
    const risk = backend.store.find((item) => item.id === 103)
    expect(risk).toBeDefined()
    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.method === 'POST' &&
            record.url === '/risks/103/status' &&
            record.body?.status === 'mitigating',
        ),
      ).toBe(true),
    )
    await waitFor(() => {
      const select = document.querySelector(
        '[data-risk-row="103"] [data-risk-status-select]',
      ) as HTMLSelectElement | null
      expect(select?.value).toBe('mitigating')
    })
  })

  test('只读（risk:view）：状态列回退静态徽章且零写请求', async () => {
    setAuth(['risk:view'])
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<WorkspaceRisksPage projectId={42} />)
    await waitFor(() =>
      expect(document.querySelector('[data-risk-workspace-space]')).not.toBeNull(),
    )
    fireEvent.click(screen.getByRole('tab', { name: '登记册视图' }))
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(6))

    expect(document.querySelector('[data-risk-status-select]')).toBeNull()
    const row103 = document.querySelector('[data-risk-row="103"]')
    expect(row103?.querySelector('[data-risk-cell-status]')?.textContent).toBe('分析中')
    expect(writeMethods(records)).toHaveLength(0)
  })
})

describe('登记底册：两步确认删除（spec 场景「风险删除防误触」）', () => {
  test('取消不删除；确认后 DELETE 并移出底册', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<WorkspaceRisksPage projectId={42} />)
    await waitFor(() =>
      expect(document.querySelector('[data-risk-workspace-space]')).not.toBeNull(),
    )
    fireEvent.click(screen.getByRole('tab', { name: '登记册视图' }))
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(6))

    // 打开删除弹窗 → 取消
    fireEvent.click(screen.getByRole('button', { name: '删除 数据合规审计处罚' }))
    expect(document.querySelector('[data-risk-delete-dialog]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(document.querySelector('[data-risk-delete-dialog]')).toBeNull())
    expect(writeMethods(records)).toHaveLength(0)

    // 再次打开 → 确认删除 → DELETE /risks/106
    fireEvent.click(screen.getByRole('button', { name: '删除 数据合规审计处罚' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除 数据合规审计处罚' }))
    await waitFor(() =>
      expect(
        records.some((record) => record.method === 'DELETE' && record.url === '/risks/106'),
      ).toBe(true),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(5))
    expect(screen.queryByText('数据合规审计处罚')).toBeNull()
    expect(document.querySelector('[data-risk-register-total]')?.textContent).toContain('5')
  })
})

describe('5×5 矩阵联动收敛（spec 场景「矩阵单元格联动」）', () => {
  test('点击单元格收敛底册 → 联动胶囊清除 / 同格再点取消', async () => {
    const backend = createBackend()
    installFetchRouter(backend.route)
    renderPage(<WorkspaceRisksPage projectId={42} />)
    await waitFor(() =>
      expect(document.querySelector('[data-risk-workspace-space]')).not.toBeNull(),
    )
    fireEvent.click(screen.getByRole('tab', { name: '矩阵视图' }))
    await waitFor(() =>
      expect(document.querySelector('[data-risk-operational-matrix]')).not.toBeNull(),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-risk-cell]')).toHaveLength(25))

    // p4 × i5 单元格：101/102 两条高危
    const cell = screen.getByRole('button', { name: '概率 4 · 影响 5 · 高危 · 2 条风险' })
    expect(cell.getAttribute('data-risk-cell-count')).toBe('2')
    fireEvent.click(cell)

    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(2))
    expect(document.querySelector('[data-risk-cell-filter-chip]')).not.toBeNull()
    expect(document.querySelector('[data-risk-cell-filter-chip]')?.textContent).toContain('2 条')
    expect(screen.getByText('核心数据库迁移导致服务中断')).toBeInTheDocument()
    expect(screen.queryByText('关键开发人员离职')).toBeNull()
    expect(cell.getAttribute('aria-pressed')).toBe('true')

    // 同格再点 = 取消筛选
    fireEvent.click(cell)
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(6))
    expect(document.querySelector('[data-risk-cell-filter-chip]')).toBeNull()

    // 再次选中后经联动胶囊「清除筛选」复位
    fireEvent.click(cell)
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(6))
    expect(document.querySelector('[data-risk-cell-filter-chip]')).toBeNull()
  })
})

describe('详情编辑抽屉与应对计划（tasks 1.5/1.7 受控编辑闭环）', () => {
  test('行内「编辑」→ GET 详情 → PATCH 保存成功并关闭抽屉', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<WorkspaceRisksPage projectId={42} />)
    await waitFor(() =>
      expect(document.querySelector('[data-risk-workspace-space]')).not.toBeNull(),
    )
    fireEvent.click(screen.getByRole('tab', { name: '登记册视图' }))
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(6))

    fireEvent.click(screen.getByRole('button', { name: '编辑 核心数据库迁移导致服务中断' }))
    expect(document.querySelector('[data-risk-edit-drawer]')).not.toBeNull()
    // 详情加载完成后呈现表单
    await waitFor(() => expect(document.querySelector('[data-risk-edit-skeleton]')).toBeNull())
    await waitFor(() =>
      expect((screen.getByLabelText(/风险标题/) as HTMLInputElement).value).toBe(
        '核心数据库迁移导致服务中断',
      ),
    )
    expect(records.some((record) => record.method === 'GET' && record.url === '/risks/101')).toBe(
      true,
    )

    fireEvent.change(screen.getByLabelText('发生概率'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('缓解措施'), {
      target: { value: '升级为主备热切 + 季度演练' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.method === 'PATCH' &&
            record.url === '/risks/101' &&
            record.body?.probability === 2 &&
            record.body?.mitigationStrategy === '升级为主备热切 + 季度演练',
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(document.querySelector('[data-risk-edit-drawer]')).toBeNull())
    // 列表刷新后行内回显新概率
    await waitFor(() =>
      expect(
        document.querySelector('[data-risk-row="101"] [data-risk-cell-exposure]')?.textContent,
      ).toBe('2 × 5'),
    )
  })

  test('应对计划：新增（POST response-plans）与两步确认删除', async () => {
    const backend = createBackend()
    const { records } = installFetchRouter(backend.route)
    renderPage(<WorkspaceRisksPage projectId={42} />)
    await waitFor(() =>
      expect(document.querySelector('[data-risk-workspace-space]')).not.toBeNull(),
    )
    fireEvent.click(screen.getByRole('tab', { name: '登记册视图' }))
    await waitFor(() => expect(document.querySelectorAll('[data-risk-row]')).toHaveLength(6))

    fireEvent.click(screen.getByRole('button', { name: '编辑 核心数据库迁移导致服务中断' }))
    await waitFor(() => expect(document.querySelector('[data-risk-edit-skeleton]')).toBeNull())
    // 已存在 1 条历史演练计划（completed）
    await waitFor(() => expect(document.querySelectorAll('[data-risk-plan]')).toHaveLength(1))

    // 空行动描述：添加禁用
    expect((screen.getByRole('button', { name: '添加计划' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    fireEvent.change(screen.getByLabelText(/行动描述/), {
      target: { value: '双机房割接窗口增加写放大限流预案' },
    })
    fireEvent.click(screen.getByRole('button', { name: '添加计划' }))

    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.method === 'POST' &&
            record.url === '/projects/42/risks/101/response-plans' &&
            record.body?.actionDescription === '双机房割接窗口增加写放大限流预案' &&
            record.body?.strategyType === 'mitigate',
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-risk-plan]')).toHaveLength(2))
    expect(document.querySelectorAll('[data-risk-plan]')[1]?.textContent).toContain('缓解')
    expect(document.querySelectorAll('[data-risk-plan]')[1]?.textContent).toContain('已计划')

    // 两步确认删除新增计划
    fireEvent.click(
      screen.getByRole('button', {
        name: '删除应对计划：双机房割接窗口增加写放大限流预案',
      }),
    )
    expect(document.querySelector('[data-risk-plan-delete-confirm]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '取消删除应对计划' }))
    expect(document.querySelector('[data-risk-plan-delete-confirm]')).toBeNull()
    fireEvent.click(
      screen.getByRole('button', {
        name: '删除应对计划：双机房割接窗口增加写放大限流预案',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /确认删除应对计划/ }))
    await waitFor(() =>
      expect(
        records.some(
          (record) =>
            record.method === 'DELETE' &&
            /^\/projects\/42\/risks\/101\/response-plans\/\d+$/.test(record.url),
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-risk-plan]')).toHaveLength(1))
  })
})
