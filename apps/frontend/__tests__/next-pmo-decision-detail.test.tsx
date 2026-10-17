/**
 * v3-ui-next-pmo-domain W6 · tasks 6.7 —— PMO 决策详情页装配测试
 * （spec「决策工作台详情与人工结论闭环」详情装配与中性 404 场景）。
 *
 * 覆盖：
 * - 非法 decisionId（非数字/非正整数）前端零发包渲染中性 404（RL-05）；
 * - 无 pmo_decision:view → 受限横幅且零请求（RL-06）；orgId 未水合 → 引导态；
 * - 授权装配：元数据头 + 状态机时间线 + 方案/对比/立场 + 证据快照 + 结论/交接面板，
 *   详情 8 个查询端点全部 GET、交互过程零写请求；
 * - 立场记录 recordPosition 仅需 pmo_decision:view（后端 authorizePosition 语义）：
 *   确认身份与立场内容后 POST .../positions（审计留痕）；
 * - 证据刷新 = pmo_decision:manage（两步武装确认）；view-only 成员无刷新入口；
 * - 终态议题（decided）：写控件隐藏、交接区按 handoff 权限显隐；
 * - 接口 404（跨组织/已删除）→ 同中性 404；500 → 错误卡重试闭环。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import PmoDecisionDetailPage from '@/app/(next)/next/pmo/decisions/[decisionId]/page'
import {
  pmoDecisionSmallCaseFixture,
  pmoDecisionOptionFixtures,
  pmoDecisionSnapshotSummaryFixture,
  pmoDecisionApproveOutcomeFixture,
  pmoDecisionPendingHandoffFixture,
  pmoDecisionFixtureTimestamp,
} from '@aiproj/types'
import type {
  PmoDecisionCaseDTO,
  PmoDecisionPositionDTO,
  PmoDecisionEvidenceSnapshotSummary,
  PmoDecisionOutcomeDTO,
  PmoDecisionHandoffReceiptDTO,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  decisionId: '101',
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navMocks.replace, push: navMocks.push, back: navMocks.back }),
  useParams: () => ({ decisionId: navMocks.decisionId }),
}))

// ---------------------------------------------------------------------------
// 会话 & 伪后端
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'

interface RequestRecord {
  method: string
  path: string
  body: string | null
}

function setAuth(permissions: string[], organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 7,
      email: 'pm@example.com',
      fullName: '项目经理',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'admin' }],
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

function installFetchRouter(
  route: (path: string, method: string, body: string | null) => Response | null,
): { records: RequestRecord[] } {
  const records: RequestRecord[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    records.push({
      method,
      path: path.split('?')[0] ?? path,
      body: init?.body ? String(init.body) : null,
    })
    const matched = route(records.at(-1)!.path, method, records.at(-1)!.body)
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
// 详情后端（有状态：可中途改 status / 追加 positions / outcomes / receipts）
// ---------------------------------------------------------------------------
const CASE_PATH = '/organizations/1/pmo/decision-workbench/cases/101'

function detailBackend(
  options: {
    status?: PmoDecisionCaseDTO['status']
    positions?: PmoDecisionPositionDTO[]
    outcomes?: PmoDecisionOutcomeDTO[]
    caseOverrides?: Partial<PmoDecisionCaseDTO>
    failCaseWith?: number | null
  } = {},
) {
  const state = {
    status: options.status ?? 'under-review',
    positions: [...(options.positions ?? [])],
    outcomes: [...(options.outcomes ?? [])],
    receipts: [] as PmoDecisionHandoffReceiptDTO[],
    caseOverrides: options.caseOverrides ?? {},
    failCaseWith: options.failCaseWith ?? null,
  }

  const caseDTO = (): PmoDecisionCaseDTO => ({
    ...pmoDecisionSmallCaseFixture(),
    status: state.status as PmoDecisionCaseDTO['status'],
    ...state.caseOverrides,
  })

  const route = (path: string, method: string, body: string | null): Response | null => {
    // ── case 详情 ──
    if (path === CASE_PATH && method === 'GET') {
      if (state.failCaseWith !== null) {
        return jsonResponse(state.failCaseWith, {
          error: { code: 'INTERNAL', message: 'boom' },
        })
      }
      return jsonResponse(200, { data: caseDTO() })
    }
    if (path === CASE_PATH + '/options' && method === 'GET') {
      return jsonResponse(200, { data: pmoDecisionOptionFixtures() })
    }
    if (path === CASE_PATH + '/positions' && method === 'GET') {
      return jsonResponse(200, { data: state.positions })
    }
    if (path === CASE_PATH + '/positions' && method === 'POST') {
      const payload = JSON.parse(body ?? '{}') as { stance: string; note?: string }
      const record: PmoDecisionPositionDTO = {
        id: 100 + state.positions.length + 1,
        organizationId: 1,
        caseId: 101,
        participantId: 7,
        stance: payload.stance as PmoDecisionPositionDTO['stance'],
        noteHash: 'aabbccdd',
        notePreview: payload.note ? payload.note.slice(0, 60) : null,
        revision: 1,
        immutableAfterDecision: false,
        createdAt: pmoDecisionFixtureTimestamp(60),
        updatedAt: pmoDecisionFixtureTimestamp(60),
      }
      state.positions.push(record)
      return jsonResponse(201, { data: record })
    }
    if (path === CASE_PATH + '/evidence/snapshots' && method === 'GET') {
      const snapshot: PmoDecisionEvidenceSnapshotSummary = pmoDecisionSnapshotSummaryFixture({
        sourceStates: [
          { source: 'portfolio_dashboard', state: 'available', required: true },
          { source: 'risk_register', state: 'forbidden', required: false },
        ],
      })
      return jsonResponse(200, { data: [snapshot] })
    }
    if (path === CASE_PATH + '/evidence/refresh' && method === 'POST') {
      return jsonResponse(200, { data: { refreshed: true } })
    }
    if (path === CASE_PATH + '/comparison' && method === 'GET') {
      return jsonResponse(200, {
        data: {
          caseId: 101,
          baselineOptionId: 1,
          candidateOptionId: 2,
          cells: [
            {
              lensId: 'strategy_priority',
              measureRef: 'priority_scoring:project-11',
              baselineValue: 72.5,
              candidateValue: 81.25,
              delta: 8.75,
              comparable: true,
              notComparableReason: null,
              unit: 'score',
            },
            {
              lensId: 'delivery_impact',
              measureRef: 'risk_register:project-12',
              baselineValue: null,
              candidateValue: 3,
              delta: null,
              comparable: false,
              notComparableReason: 'MISSING_VALUE',
              unit: null,
            },
          ],
          findings: [],
          lensVersions: [
            { lensId: 'strategy_priority', version: 'v3' },
            { lensId: 'delivery_impact', version: 'v2' },
          ],
          hasWinnerScore: false,
        },
      })
    }
    if (path === CASE_PATH + '/outcomes' && method === 'GET') {
      return jsonResponse(200, { data: state.outcomes })
    }
    if (path === CASE_PATH + '/handoffs' && method === 'GET') {
      return jsonResponse(200, { data: state.receipts })
    }
    if (path === CASE_PATH + '/handoffs' && method === 'POST') {
      const payload = JSON.parse(body ?? '{}') as { target: string; idempotencyKey: string }
      const receipt: PmoDecisionHandoffReceiptDTO = {
        ...pmoDecisionPendingHandoffFixture(),
        id: 6000 + state.receipts.length + 1,
        target: payload.target as PmoDecisionHandoffReceiptDTO['target'],
        idempotencyKey: payload.idempotencyKey,
        pendingTargetRef: `${payload.target}:ref-${state.receipts.length + 1}`,
        createdAt: pmoDecisionFixtureTimestamp(70),
        updatedAt: pmoDecisionFixtureTimestamp(70),
      }
      state.receipts.push(receipt)
      return jsonResponse(201, { data: receipt })
    }
    return null
  }
  return { route, state }
}

function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PmoDecisionDetailPage />
    </QueryClientProvider>,
  )
}

function settle(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeEach(() => {
  vi.clearAllMocks()
  navMocks.decisionId = '101'
  setAuth([
    'pmo_decision:view',
    'pmo_decision:manage',
    'pmo_decision:decide',
    'pmo_decision:handoff',
    'pmo_decision:request_ai',
  ])
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------
// 非法 ID / RBAC / 组织上下文（零请求）
// ---------------------------------------------------------------------------
describe('PmoDecisionDetailPage：非法 decisionId 中性 404（RL-05）', () => {
  for (const bad of ['abc', '0', '-3', '1.5', '1e3', '']) {
    test(`decisionId=${bad || '<empty>'}：零发包渲染中性 404`, async () => {
      navMocks.decisionId = bad
      const { records } = installFetchRouter(() => null)
      mountPage()

      expect(document.querySelector('[data-pmo-decision-not-found]')).not.toBeNull()
      expect(screen.getByText('议题不存在')).toBeInTheDocument()
      expect(document.querySelector('[data-pmo-decision-detail-workspace]')).toBeNull()
      await settle()
      expect(records).toHaveLength(0)
    })
  }

  test('合法整数 ID 不渲染 404（由工作台接管数据态）', async () => {
    const backend = detailBackend()
    installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-detail-workspace]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-pmo-decision-not-found]')).toBeNull()
  })
})

describe('PmoDecisionDetailPage：RBAC 守卫与组织上下文', () => {
  test('无 pmo_decision:view：受限横幅且零请求（RL-06）', async () => {
    setAuth(['task:view'])
    const { records } = installFetchRouter(() => null)
    mountPage()
    expect(document.querySelector('[data-permission-fallback]')).not.toBeNull()
    expect(document.querySelector('[data-pmo-decision-detail-workspace]')).toBeNull()
    await settle()
    expect(records).toHaveLength(0)
  })

  test('orgId 未水合：引导态且零请求', async () => {
    useAuthStore.setState({
      user: {
        id: 9,
        email: 'solo@example.com',
        fullName: '未入组成员',
        organizations: [],
      },
      currentOrganizationId: null,
      permissions: ['pmo_decision:view'],
    })
    const { records } = installFetchRouter(() => null)
    mountPage()
    expect(document.querySelector('[data-org-no-organization]')).not.toBeNull()
    await settle()
    expect(records).toHaveLength(0)
  })

  test('接口 404（跨组织/已删除）：同中性 404 呈现', async () => {
    const backend = detailBackend()
    const { records } = installFetchRouter((path, method, body) => {
      if (path === CASE_PATH && method === 'GET') {
        return jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: '资源不存在' } })
      }
      return backend.route(path, method, body)
    })
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-not-found]')).not.toBeNull(),
    )
    expect(screen.getByText('该决策议题不存在或已下线。')).toBeInTheDocument()
    // 后续不再有非 GET 动作；返回队列按钮可用
    fireEvent.click(document.querySelector('[data-pmo-decision-back-queue]') as HTMLElement)
    await waitFor(() => {
      expect(navMocks.push).toHaveBeenLastCalledWith('/next/pmo/decisions')
    })
    expect(records.some((record) => record.method !== 'GET')).toBe(false)
  })

  test('500 错误：错误卡重试成功后完整装配', async () => {
    const backend = detailBackend()
    backend.state.failCaseWith = 500
    const { records } = installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-project-space-empty="error"]')).not.toBeNull(),
    )
    backend.state.failCaseWith = null
    fireEvent.click(document.querySelector('[data-project-space-retry]') as HTMLElement)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-detail-workspace]')).not.toBeNull(),
    )
    const caseGets = records.filter(
      (record) => record.method === 'GET' && record.path === CASE_PATH,
    )
    expect(caseGets.length).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// 授权装配：8 面板查询 + 只读呈现（零写）
// ---------------------------------------------------------------------------
describe('PmoDecisionDetailWorkspace：详情 8 面板装配（只读零写）', () => {
  test('under-review 议题完整装配：元数据头/时间线/方案/对比/立场/证据/结论', async () => {
    const backend = detailBackend()
    const { records } = installFetchRouter(backend.route)
    mountPage()

    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-detail-workspace]')).not.toBeNull(),
    )
    // 元数据头与状态机时间线
    expect(screen.getByText('是否将资源从项目 A 调往项目 B')).toBeInTheDocument()
    expect(
      document
        .querySelector('[data-decision-timeline-step="current"]')
        ?.getAttribute('data-step-status'),
    ).toBe('under-review')
    // 方案与对比
    await waitFor(() =>
      expect(document.querySelectorAll('[data-pmo-decision-option]')).toHaveLength(2),
    )
    expect(screen.getByText('维持现状：不调动资源')).toBeInTheDocument()
    expect(document.querySelector('[data-pmo-decision-comparison] table')).not.toBeNull()
    expect(screen.getByText('8.75')).toBeInTheDocument()
    expect(screen.getByText('缺少值')).toBeInTheDocument() // not-comparable 显式
    // 立场空态
    expect(screen.getByText('暂无参与者立场记录。')).toBeInTheDocument()
    // 证据快照：来源状态双通道
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-evidence-snapshot]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-source-state="available"]')?.textContent).toContain('可用')
    expect(document.querySelector('[data-source-state="forbidden"]')?.textContent).toContain(
      '权限受限',
    )
    // 结论面板：under-review + decide → 动作按钮齐全
    expect(document.querySelector('[data-outcome-action="approve"]')).not.toBeNull()
    expect(document.querySelector('[data-pmo-decision-outcome-history]')).not.toBeNull()

    // 详情 8 个查询端点全部 GET ≥1；交互过程零写请求
    const wanted = [
      '/organizations/1/pmo/decision-workbench/cases/101',
      '/organizations/1/pmo/decision-workbench/cases/101/options',
      '/organizations/1/pmo/decision-workbench/cases/101/positions',
      '/organizations/1/pmo/decision-workbench/cases/101/evidence/snapshots',
      '/organizations/1/pmo/decision-workbench/cases/101/comparison',
      '/organizations/1/pmo/decision-workbench/cases/101/outcomes',
      '/organizations/1/pmo/decision-workbench/cases/101/handoffs',
    ]
    for (const path of wanted) {
      expect(records.some((record) => record.method === 'GET' && record.path === path)).toBe(true)
    }
    expect(records.some((record) => record.method !== 'GET')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 立场记录（view 即可；审计留痕）
// ---------------------------------------------------------------------------
describe('PmoDecisionDetailWorkspace：参与者立场记录（仅需 view）', () => {
  test('view-only MEMBER 可见立场按钮：确认身份 → POST positions（stance/note）→ 列表刷新', async () => {
    setAuth(['pmo_decision:view'])
    const backend = detailBackend()
    const { records } = installFetchRouter(backend.route)
    mountPage()

    await waitFor(() =>
      expect(document.querySelector('[data-position-stance="support"]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-position-stance="oppose"]') as HTMLElement)
    const confirmStrip = document.querySelector('[data-pmo-decision-position-confirm]')
    expect(confirmStrip).not.toBeNull()
    // 身份确认文案（审计留痕）分段断言，避免跨节点文本匹配脆弱性
    expect(confirmStrip?.textContent).toContain('项目经理')
    expect(confirmStrip?.textContent).toContain('用户 #7')
    expect(confirmStrip?.textContent).toContain('审计留痕')

    fireEvent.change(
      document.querySelector('[data-pmo-decision-position-note]') as HTMLTextAreaElement,
      { target: { value: '反对理由：关键路径不可再延迟' } },
    )
    fireEvent.click(document.querySelector('[data-pmo-decision-position-submit]') as HTMLElement)

    await waitFor(() => {
      const create = records.find(
        (record) => record.method === 'POST' && record.path.endsWith('/positions'),
      )
      expect(create).toBeDefined()
      expect(JSON.parse(create?.body ?? '{}')).toEqual({
        stance: 'oppose',
        note: '反对理由：关键路径不可再延迟',
      })
    })
    await waitFor(() => expect(document.querySelector('[data-stance="oppose"]')).not.toBeNull())
  })

  test('取消记录：不产生任何写请求（RL-01）', async () => {
    const backend = detailBackend()
    const { records } = installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-position-stance="support"]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-position-stance="support"]') as HTMLElement)
    fireEvent.click(document.querySelector('[data-pmo-decision-position-cancel]') as HTMLElement)
    await settle()
    expect(document.querySelector('[data-pmo-decision-position-confirm]')).toBeNull()
    expect(records.some((record) => record.method !== 'GET')).toBe(false)
  })

  test('终态议题：立场写入按钮隐藏', async () => {
    const backend = detailBackend({
      status: 'decided',
      outcomes: [pmoDecisionApproveOutcomeFixture()],
    })
    installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-detail-workspace]')).not.toBeNull(),
    )
    await waitFor(() => {
      expect(document.querySelector('[data-position-stance]')).toBeNull()
      expect(document.querySelector('[data-pmo-decision-positions]')).not.toBeNull()
      expect(screen.getByText(/终态立场冻结，只读/)).toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// 证据刷新（manage）与终态只读
// ---------------------------------------------------------------------------
describe('PmoDecisionDetailWorkspace：证据刷新与写入口门禁', () => {
  test('manage 用户：两步武装确认后 POST evidence/refresh', async () => {
    const backend = detailBackend()
    const { records } = installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-evidence-refresh]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-pmo-decision-evidence-refresh]') as HTMLElement)
    expect(document.querySelector('[data-pmo-decision-evidence-refresh-confirm]')).not.toBeNull()
    fireEvent.click(
      document.querySelector('[data-pmo-decision-evidence-refresh-confirm]') as HTMLElement,
    )
    await waitFor(() => {
      const refresh = records.find(
        (record) => record.method === 'POST' && record.path.endsWith('/evidence/refresh'),
      )
      expect(refresh).toBeDefined()
    })
  })

  test('view-only 用户：无刷新入口且无写请求', async () => {
    setAuth(['pmo_decision:view'])
    const backend = detailBackend()
    const { records } = installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-evidence-snapshot]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-pmo-decision-evidence-refresh]')).toBeNull()
    await settle()
    expect(records.some((record) => record.method !== 'GET')).toBe(false)
  })

  test('终态（decided）：结论动作区隐藏、归档标注、交接区按 handoff 权限显隐', async () => {
    const backend = detailBackend({
      status: 'decided',
      outcomes: [pmoDecisionApproveOutcomeFixture()],
    })
    installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-terminal-archive]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-outcome-action]')).toBeNull()
    // 具备 handoff 权限 + approve 结论 → 交接区可见（等 outcomes 加载完成后）
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-handoff]')).not.toBeNull(),
    )
    // 无 request_ai 场景另行覆盖（见 ai-narrative 测试）
  })

  test('无 handoff 权限：decided 议题不呈现交接区', async () => {
    setAuth(['pmo_decision:view', 'pmo_decision:manage', 'pmo_decision:decide'])
    const backend = detailBackend({
      status: 'decided',
      outcomes: [pmoDecisionApproveOutcomeFixture()],
    })
    installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-terminal-archive]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-pmo-decision-handoff]')).toBeNull()
  })
})
