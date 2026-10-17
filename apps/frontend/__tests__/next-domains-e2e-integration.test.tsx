/**
 * v3-ui-next-risk-change-domains W4 · tasks 4.3 —— 两域全链路端到端集成测试
 * （项目空间 → 功能域菜单 → 风险工作台 → 变更请求审批 → 返回项目空间）。
 *
 * 单一旅程贯通（spec 场景链）：
 * 1. 项目空间顶栏 ProjectDomainMenu（真实 ProjectSpaceContainer 挂载）→ 风险管理
 *    push /next/projects/42/risks；
 * 2. 风险工作台：态势大盘（4 态势卡 + 复查队列）→ 规则评估 → 审查证据链 → 确认
 *    采纳规则候选（POST candidates/501/accept）→ 呼出 AI 风险建议抽屉 → 修改概率
 *    与缓解方案 → 人工确认采纳（accept 载荷 modifiedByUser: true，RL-01）；
 * 3. 功能域菜单切换 → 变更请求主页（空态引导新建）→ 新建页录入六维影响摘要 →
 *    POST 落库并 push 详情页；
 * 4. 变更详情：草稿 → 提交审批 → 解算六维影响分析 → 关键路径触碰警示（
 *    criticalPathAffected）→ 审批人（换角色）勾选引用分析快照 #101 批准 →
 *    approve 载荷携带 impactAnalysisId（快照引用审批）→ 状态机推进至已批准 →
 *    「返回项目空间」动线就绪。
 * 5. 全旅程写请求白名单断言：零意外写（零 DELETE/PATCH/PUT）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { ProjectSpaceContainer } from '@/components/next/project-space/ProjectSpaceContainer'
import { ProjectDomainMenu } from '@/components/next/project-space/ProjectDomainMenu'
import ProjectRisksDomainPage from '@/app/(next)/next/projects/[id]/risks/page'
import NextProjectChangeRequestsPage from '@/app/(next)/next/projects/[id]/change-requests/page'
import NextProjectNewChangeRequestPage from '@/app/(next)/next/projects/[id]/change-requests/new/page'
import NextProjectChangeRequestDetailPage from '@/app/(next)/next/projects/[id]/change-requests/[crId]/page'
import { kanbanApi, type KanbanColumn } from '@/lib/api/kanban'
import type { ChangeRequest, ChangeImpactAnalysis } from '@/lib/api/change-requests'
import { API_PREFIX, jsonResponse, resetFetchRouter } from './helpers/chart-gallery-network'

// ---------------------------------------------------------------------------
// 模块级桩（ProjectSpaceContainer 主工作面装配所需的既有模块，W3 同款模式）
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/projects/42',
  useParams: () => ({ id: '42', crId: '7' }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

/** 可变的“服务器”夹具共享仓（变更列表行——模块桩与伪后端共用）。 */
const serverStore = vi.hoisted(() => ({
  crRows: [] as unknown[],
  crMeta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
}))

const projectsApiMock = vi.hoisted(() => ({ get: vi.fn(), members: vi.fn() }))
vi.mock('@/lib/api/projects', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/projects')>()
  return {
    ...original,
    projectsApi: { ...original.projectsApi, get: projectsApiMock.get },
    projectMembersApi: { ...original.projectMembersApi, list: projectsApiMock.members },
  }
})

const risksV2ApiMock = vi.hoisted(() => ({ summary: vi.fn(), queue: vi.fn() }))
vi.mock('@/lib/api/risks-v2', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/risks-v2')>()
  return {
    ...original,
    getRiskSummary: risksV2ApiMock.summary,
    getReviewQueue: risksV2ApiMock.queue,
  }
})

const changeRequestsApiMock = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/api/change-requests', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/change-requests')>()
  return { ...original, listChangeRequests: changeRequestsApiMock.list }
})

// ---------------------------------------------------------------------------
// 会话与夹具
// ---------------------------------------------------------------------------
const ALL_DOMAIN_PERMISSIONS = [
  'project:view',
  'task:view',
  'risk:view',
  'risk:manage',
  'change_request:view',
  'change_request:create',
  'change_request:approve',
  'change_impact:view',
  'change_impact:manage',
  'comment:view',
  'comment:create',
]

function setAuth(userId: number) {
  useAuthStore.setState({
    user: {
      id: userId,
      email: userId === 1 ? 'pm@example.com' : 'approver@example.com',
      fullName: userId === 1 ? '王启明' : '李思远',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions: ALL_DOMAIN_PERMISSIONS,
    currentOrganizationId: 1,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function makeProject() {
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

function makeSummary() {
  return {
    totalRisks: 6,
    openRisks: 5,
    highRiskCount: 2,
    criticalRiskCount: 1,
    overdueReviewCount: 1,
    incompleteResponsePlans: 1,
    trend30d: { created: 3, closed: 1 },
    healthScore: 72,
    topRisks: [
      {
        id: 101,
        title: '核心数据库迁移导致服务中断',
        riskLevel: 'critical',
        score: 20,
        status: 'identified',
      },
      { id: 103, title: '关键开发人员离职', riskLevel: 'high', score: 16, status: 'mitigating' },
    ],
  }
}

function makeQueue() {
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
  ]
}

/** 变更请求“服务器”行（随旅程状态机推进而改写）。 */
function makeDraftCr(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 7,
    crCode: 'CR-2026-007',
    organizationId: 1,
    projectId: 42,
    title: '增加移动端扫码登录模块',
    description: '在现有账号体系外补充扫码登录通道，复用既有用户中心',
    changeType: 'scope',
    status: 'draft',
    priority: 'high',
    requesterId: 1,
    approverId: null,
    requestedBy: 1,
    reviewedBy: null,
    impactSummary: {
      scope: '覆盖移动端登录入口调整',
      schedule: '进度整体延期 5 天',
      resources: '需新增 2 名前端资源',
      cost: '外包预算增加 2 万元',
      risks: '渠道风控合规风险需评审',
      assumptions: '默认扫码服务商 SLA 99.9%',
    },
    impactAnalysis: null,
    conditions: null,
    decisionReason: null,
    approvalComments: null,
    submittedAt: null,
    approvedAt: null,
    implementedAt: null,
    implementedBy: null,
    closedAt: null,
    closedBy: null,
    createdAt: '2026-09-04T08:00:00.000Z',
    updatedAt: '2026-09-04T08:00:00.000Z',
    currentImpactAnalysisId: null,
    approveRefAnalysisId: null,
    impactAnalysisConfirmStatus: null,
    ...overrides,
  }
}

function makeCandidate() {
  return {
    id: 501,
    ruleId: 'R003-critical-path-slip',
    ruleVersion: '1.2.0',
    severity: 'high',
    evidence: [
      { type: 'task', id: 77, title: '核心网关联调', detail: '前序依赖延迟 4 天，存在级联滑移' },
      { type: 'milestone', id: 8, title: 'UAT 验收', detail: '关键路径触碰发布里程碑' },
    ],
    recommendedAction: '为核心网关联调预留 3 天缓冲并前置资源确认',
    confidence: 0.85,
    source: 'risk-signal-evaluator',
    templateId: null,
    idempotencyKey: 'k-501',
    expiresAt: '2099-12-31T00:00:00.000Z',
    status: 'pending',
  }
}

function makeAiSuggestion(overrides: Record<string, unknown> = {}) {
  return {
    title: '核心网关前序依赖延迟',
    description: '核心网关任务前序依赖节点延迟 4 天，存在级联滑移风险',
    category: 'schedule',
    probability: 5,
    impact: 4,
    suggestedMitigation: '为关键路径预留 3 天缓冲并前置资源确认',
    aiMarker: {
      confidence: 0.85,
      source: 'inferred',
      reason: '核心网关任务前序依赖节点延迟 4 天，存在级联滑移风险',
      needsConfirmation: true,
    },
    suggestionBatchId: 'ai-batch-001',
    ...overrides,
  }
}

function makeAnalysis(overrides: Partial<ChangeImpactAnalysis> = {}): ChangeImpactAnalysis {
  return {
    id: 101,
    organizationId: 1,
    projectId: 42,
    changeRequestId: 7,
    status: 'completed',
    ruleVersion: 'R1.4',
    inputSignature: 'sig-20260904',
    summary: {
      totalAffected: 4,
      severityDistribution: { critical: 1, high: 2, medium: 1, low: 0, none: 0 },
      dimensionSummaries: [
        {
          dimension: 'schedule',
          affectedCount: 2,
          highestSeverity: 'high',
          topEvidence: ['关键路径任务 #8 前序延迟 4 天'],
        },
        {
          dimension: 'resource',
          affectedCount: 1,
          highestSeverity: 'medium',
          topEvidence: ['前端资源负载超过 90%'],
        },
        {
          dimension: 'scope',
          affectedCount: 1,
          highestSeverity: 'critical',
          topEvidence: ['范围基线需要变更申请'],
        },
      ],
      criticalPathAffected: true,
      hasBlockingWarnings: true,
    },
    items: [
      {
        id: 1001,
        entityType: 'task',
        entityId: 8,
        dimension: 'schedule',
        severity: 'high',
        score: 16,
        propagationPath: null,
        depth: 1,
        ruleId: 'R001',
        evidence: '核心网关任务前序依赖节点延迟 4 天，存在级联滑移风险',
        requiresReview: false,
        isVisible: true,
      },
      {
        id: 1002,
        entityType: 'task',
        entityId: 9,
        dimension: 'scope',
        severity: 'critical',
        score: 20,
        propagationPath: [
          {
            fromEntityType: 'task',
            fromEntityId: 8,
            toEntityType: 'task',
            toEntityId: 9,
            relationshipType: 'depends_on',
            relationshipId: null,
          },
        ],
        depth: 2,
        ruleId: 'R003',
        evidence: '关键路径节点 #9 依赖被阻断',
        requiresReview: true,
        isVisible: true,
      },
    ],
    warnings: [{ code: 'BLOCKING', message: '任务 #9 处于阻断状态', dimension: 'schedule' }],
    missingInputs: null,
    isStale: false,
    staleReason: null,
    aiExplanation: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: '2026-09-04T09:00:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 渲染与网络辅助
// ---------------------------------------------------------------------------
interface RequestRecord {
  method: string
  url: string
  body: Record<string, unknown> | null
}

/** 有状态伪后端（两域全端点语义；随旅程改写服务器状态）。 */
function createJourneyBackend(): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const cr = makeDraftCr()
  const analysis = makeAnalysis()
  let candidateAccepted = false
  let analysisCreated = false
  // React Query v5 structural sharing：响应必须返回新对象引用，否则查询缓存视为
  // 「无变化」而跳过通知（服务器状态推进必须通过克隆回显）。
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

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
    const matched = route(path, method, body)
    if (matched) return matched
    return jsonResponse(404, { error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${path}` } })
  }

  const route = (
    path: string,
    method: string,
    _body: Record<string, unknown> | null,
  ): Response | null => {
    // ---- 风险域：规则候选 + AI 建议 ----
    if (path === '/projects/42/risks/evaluate-candidates' && method === 'POST') {
      return jsonResponse(200, { data: candidateAccepted ? [] : [makeCandidate()] })
    }
    if (path === '/projects/42/risks/candidates/501/accept' && method === 'POST') {
      candidateAccepted = true
      return jsonResponse(201, { data: { id: 999, title: '已转正式风险' } })
    }
    if (path === '/projects/42/risks/ai-suggestions' && method === 'POST') {
      return jsonResponse(200, {
        data: { suggestions: [makeAiSuggestion()], suggestionBatchId: 'ai-batch-001' },
      })
    }
    if (path === '/projects/42/risks/ai-suggestions/ai-batch-001/accept' && method === 'POST') {
      return jsonResponse(201, { data: { id: 888, title: '已采纳正式风险' } })
    }

    // ---- 变更域 ----
    if (path === '/projects/42/change-requests' && method === 'POST') {
      serverStore.crRows = [clone(cr)]
      serverStore.crMeta = { total: 1, page: 1, perPage: 20, totalPages: 1 }
      return jsonResponse(201, { data: clone(cr) })
    }
    if (path === '/change-requests/7' && method === 'GET') {
      return jsonResponse(200, { data: clone(cr) })
    }
    if (path === '/change-requests/7/submit' && method === 'POST') {
      cr.status = 'submitted'
      cr.submittedAt = '2026-09-05T02:30:00.000Z'
      return jsonResponse(200, { data: clone(cr) })
    }
    if (path === '/change-requests/7/approve' && method === 'POST') {
      cr.status = 'approved'
      cr.approvedAt = '2026-09-06T08:00:00.000Z'
      cr.approverId = 2
      cr.approveRefAnalysisId = 101
      cr.decisionReason = String(_body?.decisionReason ?? '')
      cr.conditions = String(_body?.conditions ?? '')
      return jsonResponse(200, { data: clone(cr) })
    }
    if (path.startsWith('/projects/42/change-requests/7/impact-analyses') && method === 'GET') {
      return jsonResponse(200, {
        data: analysisCreated ? [clone(analysis)] : [],
        meta: { total: analysisCreated ? 1 : 0, page: 1, perPage: 10, totalPages: 1 },
      })
    }
    if (path === '/projects/42/change-requests/7/impact-analyses' && method === 'POST') {
      analysisCreated = true
      return jsonResponse(201, { data: clone(analysis) })
    }
    if (path === '/impact-analyses/101' && method === 'GET') {
      return jsonResponse(200, { data: clone(analysis) })
    }
    if (path.startsWith('/projects/42/comments') && method === 'GET') {
      return jsonResponse(200, {
        data: [],
        meta: { total: 0, page: 1, perPage: 50, totalPages: 0 },
      })
    }
    return null
  }

  vi.stubGlobal('fetch', fetchMock)
  return { records }
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { view: render(<QueryClientProvider client={client}>{node}</QueryClientProvider>), client }
}

function writeMethods(records: RequestRecord[]): string[] {
  return records.filter((record) => record.method !== 'GET').map((record) => record.url)
}

// 看板装配桩（W3 同款：空列 + rect 桩）
let kanbanListSpy: MockInstance<typeof kanbanApi.listColumn> | null = null
let rectSpy: MockInstance<typeof Element.prototype.getBoundingClientRect> | null = null
function installSpaceStubs() {
  kanbanListSpy = vi
    .spyOn(kanbanApi, 'listColumn')
    .mockImplementation(async (_projectId: number, _column: KanbanColumn) => ({
      data: [],
      meta: { total: 0, page: 1, perPage: 25, totalPages: 0 },
    }))
  rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    return {
      x: 0,
      y: 0,
      width: 280,
      height: 600,
      top: 0,
      left: 0,
      right: 280,
      bottom: 600,
      toJSON: () => ({}),
    } as DOMRect
  })
}

function seedDomainApiMocks() {
  projectsApiMock.get.mockResolvedValue(makeProject())
  projectsApiMock.members.mockResolvedValue([])
  risksV2ApiMock.summary.mockResolvedValue({ data: makeSummary() })
  risksV2ApiMock.queue.mockResolvedValue({ data: makeQueue() })
  changeRequestsApiMock.list.mockImplementation(async () => ({
    data: serverStore.crRows,
    meta: serverStore.crMeta,
  }))
}

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
  serverStore.crRows = []
  serverStore.crMeta = { total: 0, page: 1, perPage: 20, totalPages: 0 }
  projectsApiMock.get.mockReset()
  projectsApiMock.members.mockReset()
  risksV2ApiMock.summary.mockReset()
  risksV2ApiMock.queue.mockReset()
  changeRequestsApiMock.list.mockReset()
  setAuth(1)
  installSpaceStubs()
})

afterEach(() => {
  vi.clearAllMocks()
  kanbanListSpy?.mockRestore()
  rectSpy?.mockRestore()
  resetFetchRouter()
})

describe('两域全链路集成（tasks 4.3）', () => {
  test('项目空间 → 风险工作台（候选采纳 + AI 修改采纳）→ 变更新建与六维解算 → 快照引用批准 → 返回项目空间', async () => {
    const journey = createJourneyBackend()
    seedDomainApiMocks()

    // ============================================================
    // 1. 项目空间顶栏 ProjectDomainMenu → 风险管理
    // ============================================================
    const space = renderWithClient(<ProjectSpaceContainer projectId={42} />)
    await screen.findByText('开项核心引擎')
    expect(document.querySelector('[data-project-domain-menu]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /风险管理/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/risks')
    space.view.unmount()

    // ============================================================
    // 2. 风险工作台：态势大盘 / 复查队列 → 规则候选采纳 → AI 修改采纳
    // ============================================================
    const risks = renderWithClient(<ProjectRisksDomainPage />)
    await waitFor(() =>
      expect(document.querySelector('[data-risk-workspace-space]')).not.toBeNull(),
    )
    // 态势大盘与复查队列
    await waitFor(() => expect(document.querySelectorAll('[data-risk-stat-card]')).toHaveLength(4))
    expect(document.querySelector('[data-risk-stat-kind="highcritical"]')?.textContent).toContain(
      '3',
    )
    expect(document.querySelector('[data-risk-review-queue]')).not.toBeNull()
    await waitFor(() =>
      expect(document.querySelectorAll('[data-risk-review-item]')).toHaveLength(1),
    )

    // 规则评估 → 候选审查 → 确认采纳（转为正式风险）
    fireEvent.click(screen.getByRole('button', { name: '规则评估' }))
    await waitFor(() => expect(document.querySelectorAll('[data-risk-candidate]')).toHaveLength(1))
    const candidate = document.querySelector('[data-risk-candidate="501"]')
    expect(candidate?.textContent).toContain('置信度 85%')
    expect(candidate?.textContent).toContain('R003-critical-path-slip')
    // 证据链展开审查
    fireEvent.click(screen.getByRole('button', { name: '查看证据链（2）' }))
    expect(document.querySelector('[data-risk-candidate-evidence]')?.textContent).toContain(
      '核心网关联调',
    )
    fireEvent.click(screen.getByRole('button', { name: '收起证据链' }))
    fireEvent.click(screen.getByRole('button', { name: /采纳候选：为核心网关联调预留/ }))
    await waitFor(() =>
      expect(document.querySelector('[data-risk-candidate-confirm]')).not.toBeNull(),
    )
    fireEvent.click(screen.getByRole('button', { name: '确认采纳' }))
    await waitFor(() =>
      expect(
        journey.records.some(
          (record) =>
            record.method === 'POST' && record.url === '/projects/42/risks/candidates/501/accept',
        ),
      ).toBe(true),
    )
    // 采纳后候选移出队列（回读为无候选空态）
    await waitFor(() =>
      expect(document.querySelector('[data-risk-candidates-empty]')).not.toBeNull(),
    )

    // AI 风险建议抽屉：修改参数后人工确认采纳（RL-01）
    fireEvent.click(document.querySelector('[data-risk-ai-open]') as Element)
    await waitFor(() => expect(document.querySelector('[data-risk-ai-drawer]')).not.toBeNull())
    await waitFor(() => expect(document.querySelectorAll('[data-risk-ai-card]')).toHaveLength(1))
    const disclaimer = document.querySelector('[data-risk-ai-disclaimer]')
    expect(disclaimer?.textContent).toContain('绝不会自动写入正式项目')
    // AIMarker 置信度/来源/原因
    const marker = document.querySelector('[data-ai-marker]')
    expect(marker?.querySelector('[data-ai-marker-confidence]')?.textContent).toContain('85%')
    expect(marker?.querySelector('[data-ai-marker-source]')?.textContent).toContain('自动推断')
    // 修改并采纳：概率 5 → 3，缓解方案微调
    fireEvent.click(screen.getByRole('button', { name: '修改并采纳：核心网关前序依赖延迟' }))
    expect(document.querySelector('[data-risk-ai-edit]')).not.toBeNull()
    fireEvent.change(screen.getByLabelText('发生概率'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('缓解方案'), {
      target: { value: '关键路径预留 5 天缓冲并双人复核排期' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认采纳（已修改）' }))
    await waitFor(() =>
      expect(
        journey.records.some(
          (record) =>
            record.method === 'POST' &&
            record.url === '/projects/42/risks/ai-suggestions/ai-batch-001/accept' &&
            record.body?.modifiedByUser === true &&
            record.body?.probability === 3 &&
            record.body?.impact === 4 &&
            record.body?.mitigation === '关键路径预留 5 天缓冲并双人复核排期' &&
            record.body?.suggestionBatchId === 'ai-batch-001',
        ),
      ).toBe(true),
    )
    await waitFor(() =>
      expect(document.querySelector('[data-risk-ai-card-accepted]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-risk-ai-card-accepted]')?.textContent).toContain('已采纳')
    fireEvent.click(document.querySelector('[data-risk-ai-close-footer]') as Element)
    await waitFor(() => expect(document.querySelector('[data-risk-ai-drawer]')).toBeNull())
    risks.view.unmount()

    // ============================================================
    // 3. 功能域菜单切至变更请求 → 新建六维摘要变更
    // ============================================================
    const menu = renderWithClient(<ProjectDomainMenu projectId={42} />)
    fireEvent.click(screen.getByRole('button', { name: '功能域菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /变更请求/ }))
    expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/change-requests')
    menu.view.unmount()

    // 变更列表空态 → 「新建变更请求」引导
    const listPage = renderWithClient(<NextProjectChangeRequestsPage />)
    await waitFor(() => expect(document.querySelector('[data-cr-empty]')).not.toBeNull())
    expect(screen.getByText('暂无变更请求')).toBeInTheDocument()
    const createEntry = document.querySelector('[data-cr-empty-create]') as HTMLAnchorElement
    expect(createEntry.getAttribute('href')).toBe('/next/projects/42/change-requests/new')
    listPage.view.unmount()

    // 新建页：录入基本信息 + 六维影响摘要 → 提交落库 → push 详情
    const newPage = renderWithClient(<NextProjectNewChangeRequestPage />)
    await screen.findByText('新建变更请求')
    fireEvent.change(document.querySelector('[data-cr-form-title]')!, {
      target: { value: '增加移动端扫码登录模块' },
    })
    fireEvent.change(document.querySelector('[data-cr-form-description]')!, {
      target: { value: '补充扫码登录通道并复用用户中心' },
    })
    fireEvent.change(document.querySelector('[data-cr-form-type]')!, {
      target: { value: 'scope' },
    })
    fireEvent.change(document.querySelector('[data-cr-form-priority]')!, {
      target: { value: 'high' },
    })
    // 六维影响摘要逐维录入
    fireEvent.change(document.querySelector('[data-cr-form-impact="scope"]')!, {
      target: { value: '覆盖移动端登录入口调整' },
    })
    fireEvent.change(document.querySelector('[data-cr-form-impact="schedule"]')!, {
      target: { value: '进度整体延期 5 天' },
    })
    fireEvent.change(document.querySelector('[data-cr-form-impact="resources"]')!, {
      target: { value: '需新增 2 名前端资源' },
    })
    fireEvent.change(document.querySelector('[data-cr-form-impact="cost"]')!, {
      target: { value: '外包预算增加 2 万元' },
    })
    fireEvent.change(document.querySelector('[data-cr-form-impact="risks"]')!, {
      target: { value: '渠道风控合规风险需评审' },
    })
    fireEvent.change(document.querySelector('[data-cr-form-impact="assumptions"]')!, {
      target: { value: '默认扫码服务商 SLA 99.9%' },
    })
    fireEvent.click(document.querySelector('[data-cr-form-submit]')!)
    await waitFor(() =>
      expect(
        journey.records.some(
          (record) => record.method === 'POST' && record.url === '/projects/42/change-requests',
        ),
      ).toBe(true),
    )
    const createPost = journey.records.find(
      (record) => record.method === 'POST' && record.url === '/projects/42/change-requests',
    )
    const payload = createPost?.body as {
      title: string
      changeType: string
      priority: string
      impactSummary: Record<string, string>
    }
    expect(payload.title).toBe('增加移动端扫码登录模块')
    expect(payload.changeType).toBe('scope')
    expect(payload.priority).toBe('high')
    expect(payload.impactSummary).toMatchObject({
      scope: '覆盖移动端登录入口调整',
      schedule: '进度整体延期 5 天',
      resources: '需新增 2 名前端资源',
      cost: '外包预算增加 2 万元',
      risks: '渠道风控合规风险需评审',
      assumptions: '默认扫码服务商 SLA 99.9%',
    })
    await waitFor(() =>
      expect(navMock.push).toHaveBeenCalledWith('/next/projects/42/change-requests/7'),
    )
    newPage.view.unmount()

    // ============================================================
    // 4. 详情页：草稿 → 提交审批 → 六维影响分析 → 快照引用批准
    // ============================================================
    const detailPage = renderWithClient(<NextProjectChangeRequestDetailPage />)
    await waitFor(() => expect(document.querySelector('[data-cr-detail]')).not.toBeNull())
    // 元数据 + 初始六维摘要回显
    expect(document.querySelector('[data-cr-detail-code]')?.textContent).toContain('CR-2026-007')
    expect(
      document.querySelector('[data-cr-detail-impact-field="schedule"]')?.textContent,
    ).toContain('进度整体延期 5 天')
    expect(document.querySelector('[data-cr-lifecycle-status="draft"]')).not.toBeNull()

    // 请求人本人提交审批
    const submitBtn = document.querySelector('[data-cr-console-submit]') as HTMLButtonElement
    expect(submitBtn).not.toBeNull()
    fireEvent.click(submitBtn)
    await waitFor(() =>
      expect(
        journey.records.some(
          (record) => record.method === 'POST' && record.url === '/change-requests/7/submit',
        ),
      ).toBe(true),
    )
    await waitFor(() =>
      expect(document.querySelector('[data-cr-lifecycle-status="submitted"]')).not.toBeNull(),
    )
    // 请求人自批阻断：只读提示（等待审批人）
    await waitFor(() =>
      expect(document.querySelector('[data-cr-console-self-block]')).not.toBeNull(),
    )

    // 解算六维影响分析（空态 → 开始影响分析）
    const createAnalysis = document.querySelector('[data-change-impact-create]')
    expect(createAnalysis).not.toBeNull()
    fireEvent.click(createAnalysis as Element)
    await waitFor(() =>
      expect(
        journey.records.some(
          (record) =>
            record.method === 'POST' &&
            record.url === '/projects/42/change-requests/7/impact-analyses',
        ),
      ).toBe(true),
    )
    // 受影响大盘 + 关键路径触碰警示
    await waitFor(() =>
      expect(document.querySelector('[data-change-impact-total]')?.textContent).toContain('4'),
    )
    const criticalPath = document.querySelector('[data-change-impact-critical-path]')
    expect(criticalPath?.getAttribute('data-change-impact-critical-path-value')).toBe('true')
    expect(criticalPath?.textContent).toContain('触碰项目关键路径')
    expect(
      document
        .querySelector('[data-change-impact-blocking]')
        ?.getAttribute('data-change-impact-blocking-value'),
    ).toBe('true')
    expect(
      document.querySelector('[data-change-impact-severity="critical"]')?.textContent,
    ).toContain('严重 1')
    expect(document.querySelector('[data-change-impact-item]')?.textContent).toContain('R001')

    // ---- 角色切换：审批人（user 2）接手（useAuthStore 状态更新需包 act）----
    act(() => {
      setAuth(2)
    })
    await waitFor(() => expect(document.querySelector('[data-cr-console-reason]')).not.toBeNull())
    // 快照 #101 就绪（控制台头部 + 引用勾选）
    const snapshotBadge = document.querySelector('[data-cr-console-snapshot]')
    expect(snapshotBadge?.getAttribute('data-cr-console-snapshot-id')).toBe('101')
    const snapshotCheck = document.querySelector(
      '[data-cr-console-snapshot-check]',
    ) as HTMLInputElement
    expect(snapshotCheck).not.toBeNull()

    // 录入决策理由 → 勾选引用当前影响分析快照 → 批准（快照引用审批）
    fireEvent.change(document.querySelector('[data-cr-console-reason]')!, {
      target: { value: '影响分析显示触碰关键路径但资源可协调，批准实施并持续监控' },
    })
    fireEvent.click(snapshotCheck)
    fireEvent.click(document.querySelector('[data-cr-console-approve]') as Element)
    await waitFor(() =>
      expect(
        journey.records.some(
          (record) => record.method === 'POST' && record.url === '/change-requests/7/approve',
        ),
      ).toBe(true),
    )
    const approvePost = journey.records.find(
      (record) => record.method === 'POST' && record.url === '/change-requests/7/approve',
    )
    expect(approvePost?.body).toMatchObject({
      decisionReason: '影响分析显示触碰关键路径但资源可协调，批准实施并持续监控',
      impactAnalysisId: 101,
      confirmStaleReason: null,
    })
    // 批准落定：状态机推进到已批准 + 决策原因回显
    await waitFor(() =>
      expect(document.querySelector('[data-cr-lifecycle-status="approved"]')).not.toBeNull(),
    )
    expect(
      document.querySelector('[data-cr-console]')?.getAttribute('data-cr-console-status'),
    ).toBe('approved')
    expect(document.querySelector('[data-cr-detail-decision-reason]')?.textContent).toContain(
      '影响分析显示触碰关键路径但资源可协调',
    )
    // 已批准 → 实施推进入口呈现
    expect(document.querySelector('[data-cr-console-implement]')).not.toBeNull()
    // 快照引用留痕
    expect(document.querySelector('[data-cr-console-snapshot]')?.textContent).toContain('快照 #101')

    // ============================================================
    // 5. 返回项目空间动线闭环（详情页头部常驻返回指引）
    // ============================================================
    const backLink = document.querySelector('[data-cr-back-to-space]') as HTMLAnchorElement
    expect(backLink).not.toBeNull()
    expect(backLink.getAttribute('aria-label')).toBe('返回项目主空间')
    expect(backLink.getAttribute('href')).toBe('/next/projects/42')

    // ============================================================
    // 6. 全旅程写请求白名单（零意外写：无 DELETE/PATCH/PUT）
    // ============================================================
    const unexpected = writeMethods(journey.records).filter(
      (url) =>
        ![
          '/projects/42/risks/evaluate-candidates',
          '/projects/42/risks/candidates/501/accept',
          '/projects/42/risks/ai-suggestions',
          '/projects/42/risks/ai-suggestions/ai-batch-001/accept',
          '/projects/42/change-requests',
          '/change-requests/7/submit',
          '/projects/42/change-requests/7/impact-analyses',
          '/change-requests/7/approve',
        ].includes(url),
    )
    expect(unexpected).toEqual([])
    expect(writeMethods(journey.records)).toEqual([
      '/projects/42/risks/evaluate-candidates',
      '/projects/42/risks/candidates/501/accept',
      '/projects/42/risks/ai-suggestions',
      '/projects/42/risks/ai-suggestions/ai-batch-001/accept',
      '/projects/42/change-requests',
      '/change-requests/7/submit',
      '/projects/42/change-requests/7/impact-analyses',
      '/change-requests/7/approve',
    ])
    detailPage.view.unmount()
  })
})
