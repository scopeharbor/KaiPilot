/**
 * v3-ui-next-pmo-domain W6 · tasks 6.7 —— PMO 决策详情「结论与交接」人工闭环测试
 * （spec「决策工作台详情与人工结论闭环」场景）。
 *
 * 覆盖：
 * - readiness 门禁：未通过 → 阻塞缺口清单 + 对话框不打开 + 结论零直写；
 * - approve 人工结论：二次确认对话框（审计元数据/理由 ≤2000 字/方案选择）→
 *   POST outcomes 参数对齐（action/selectedOptionId/reviewFingerprint/rationale/
 *   acknowledgedWarnings）→ 成功后转入 decided 归档并解锁受控交接；
 * - reject / request-more-evidence / supersede（新议题 ID 必填）动作参数；
 * - 无 decide 权限：结论按钮物理隐藏（RL-06）；
 * - 受控交接：仅 handoff 权限 + decided + approve 结论可见；发起前二次确认，
 *   确认前零写（RL-01）；POST handoffs 携带 target/idempotencyKey；失败回显；
 * - 全程断言「人工动作 → 网络写」的因果链（无后台自动写）。
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
  pmoDecisionApproveOutcomeFixture,
  pmoDecisionPendingHandoffFixture,
  pmoDecisionSnapshotSummaryFixture,
  pmoDecisionFixtureTimestamp,
} from '@aiproj/types'
import type {
  PmoDecisionCaseDTO,
  PmoDecisionOutcomeAction,
  PmoDecisionOutcomeDTO,
  PmoDecisionHandoffReceiptDTO,
  PmoDecisionReadinessPacket,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// mocks & 会话
// ---------------------------------------------------------------------------
const navMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navMocks.replace, push: navMocks.push, back: navMocks.back }),
  useParams: () => ({ decisionId: '101' }),
}))

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
// 后端（有状态）
// ---------------------------------------------------------------------------
const CASE_PATH = '/organizations/1/pmo/decision-workbench/cases/101'
const FINGERPRINT = 'cafebabedeadbeef'

function outcomeBackend(
  options: {
    status?: PmoDecisionCaseDTO['status']
    readiness?: 'ready' | 'blocked'
    outcomes?: PmoDecisionOutcomeDTO[]
    failHandoffWith?: { status: number; message: string } | null
  } = {},
) {
  const state = {
    status: options.status ?? 'under-review',
    outcomes: [...(options.outcomes ?? [])],
    receipts: [] as PmoDecisionHandoffReceiptDTO[],
    readiness: options.readiness ?? 'ready',
    failHandoffWith: options.failHandoffWith ?? null,
  }

  const readyPacket = (): PmoDecisionReadinessPacket => ({
    ready: true,
    blockingFindings: [],
    warnings: [{ code: 'W1', message: '某可选来源过期', source: 'priority_scoring' }],
    fingerprint: {
      fingerprint: FINGERPRINT,
      issuedAt: pmoDecisionFixtureTimestamp(59),
      expiresAt: pmoDecisionFixtureTimestamp(59 + 15),
      ttlMinutes: 15,
    },
    binding: null,
    checkedAt: pmoDecisionFixtureTimestamp(59),
  })

  const blockedPacket = (): PmoDecisionReadinessPacket => ({
    ready: false,
    blockingFindings: [
      {
        code: 'BLOCK_1',
        severity: 'blocking',
        message: '证据快照就绪度不足（blocked）',
        lensId: 'evidence_quality',
      },
    ],
    warnings: [],
    fingerprint: null,
    binding: null,
    checkedAt: pmoDecisionFixtureTimestamp(59),
  })

  const makeOutcome = (payload: {
    action: PmoDecisionOutcomeAction
    selectedOptionId: number | null
    reviewFingerprint: string
    rationale?: string
    supersededByCaseId?: number | null
  }): PmoDecisionOutcomeDTO => {
    const base = pmoDecisionApproveOutcomeFixture()
    const action = payload.action
    const targetStatus =
      action === 'approve' || action === 'reject'
        ? 'decided'
        : action === 'defer'
          ? 'deferred'
          : action === 'supersede'
            ? 'superseded'
            : 'collecting-evidence'
    state.status = targetStatus as PmoDecisionCaseDTO['status']
    return {
      ...base,
      id: 5000 + state.outcomes.length + 1,
      action,
      selectedOptionId: payload.selectedOptionId,
      reviewFingerprint: payload.reviewFingerprint,
      outcomeDigest: `digest-${action}-${state.outcomes.length + 1}`,
      acknowledgedWarnings: ['W1'],
      createdAt: pmoDecisionFixtureTimestamp(60),
    }
  }

  const route = (path: string, method: string, body: string | null): Response | null => {
    if (path === CASE_PATH && method === 'GET') {
      return jsonResponse(200, { data: { ...pmoDecisionSmallCaseFixture(), status: state.status } })
    }
    if (path === CASE_PATH + '/options' && method === 'GET') {
      return jsonResponse(200, { data: pmoDecisionOptionFixtures() })
    }
    if (path === CASE_PATH + '/positions' && method === 'GET') {
      return jsonResponse(200, { data: [] })
    }
    if (path === CASE_PATH + '/evidence/snapshots' && method === 'GET') {
      return jsonResponse(200, { data: [pmoDecisionSnapshotSummaryFixture()] })
    }
    if (path === CASE_PATH + '/comparison' && method === 'GET') {
      return jsonResponse(200, {
        data: {
          caseId: 101,
          baselineOptionId: 1,
          candidateOptionId: 2,
          cells: [],
          findings: [],
          lensVersions: [],
          hasWinnerScore: false,
        },
      })
    }
    if (path === CASE_PATH + '/outcomes' && method === 'GET') {
      return jsonResponse(200, { data: state.outcomes })
    }
    if (path === CASE_PATH + '/outcomes' && method === 'POST') {
      const payload = JSON.parse(body ?? '{}') as {
        action: PmoDecisionOutcomeAction
        selectedOptionId: number | null
        reviewFingerprint: string
        rationale?: string
        acknowledgedWarnings?: string[]
        supersededByCaseId?: number | null
      }
      const outcome = makeOutcome({
        action: payload.action,
        selectedOptionId: payload.selectedOptionId ?? null,
        reviewFingerprint: payload.reviewFingerprint,
        rationale: payload.rationale,
        supersededByCaseId: payload.supersededByCaseId,
      })
      state.outcomes.push(outcome)
      return jsonResponse(201, { data: outcome })
    }
    if (path === CASE_PATH + '/readiness' && method === 'POST') {
      return jsonResponse(200, {
        data: state.readiness === 'ready' ? readyPacket() : blockedPacket(),
      })
    }
    if (path === CASE_PATH + '/handoffs' && method === 'GET') {
      return jsonResponse(200, { data: state.receipts })
    }
    if (path === CASE_PATH + '/handoffs' && method === 'POST') {
      if (state.failHandoffWith !== null) {
        return jsonResponse(state.failHandoffWith.status, {
          error: { code: 'HANDOFF_FAILED', message: state.failHandoffWith.message },
        })
      }
      const payload = JSON.parse(body ?? '{}') as { target: string; idempotencyKey: string }
      const receipt: PmoDecisionHandoffReceiptDTO = {
        ...pmoDecisionPendingHandoffFixture(),
        id: 6000 + state.receipts.length + 1,
        target: payload.target as PmoDecisionHandoffReceiptDTO['target'],
        idempotencyKey: payload.idempotencyKey,
        pendingTargetRef: `${payload.target}:draft-${state.receipts.length + 1}`,
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
  setAuth([
    'pmo_decision:view',
    'pmo_decision:manage',
    'pmo_decision:decide',
    'pmo_decision:handoff',
  ])
})

afterEach(() => {
  resetFetchRouter()
})

// ---------------------------------------------------------------------------
// readiness 门禁
// ---------------------------------------------------------------------------
describe('结论提交：readiness 门禁', () => {
  test('readiness 未通过：列出阻塞缺口、对话框不打开、结论零直写', async () => {
    const backend = outcomeBackend({ readiness: 'blocked' })
    const { records } = installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-outcome-action="approve"]')).not.toBeNull(),
    )

    fireEvent.click(document.querySelector('[data-outcome-action="approve"]') as HTMLElement)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-readiness-blocked]')).not.toBeNull(),
    )
    expect(screen.getByText(/readiness 未通过：存在阻塞缺口，结论暂不可提交/)).toBeInTheDocument()
    expect(document.querySelector('[data-blocking-finding="BLOCK_1"]')?.textContent).toContain(
      '证据快照就绪度不足',
    )
    expect(document.querySelector('[data-pmo-decision-outcome-dialog]')).toBeNull()
    await settle()
    expect(
      records.some((record) => record.method === 'POST' && record.path.endsWith('/outcomes')),
    ).toBe(false)
  })

  test('readiness 就绪：动作点击先 POST readiness（绑定指纹）再开确认框', async () => {
    const backend = outcomeBackend()
    const { records } = installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-outcome-action="defer"]')).not.toBeNull(),
    )

    fireEvent.click(document.querySelector('[data-outcome-action="defer"]') as HTMLElement)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-outcome-dialog]')).not.toBeNull(),
    )
    const readinessPost = records.find(
      (record) => record.method === 'POST' && record.path.endsWith('/readiness'),
    )
    expect(readinessPost).toBeDefined()
    expect(document.querySelector('[data-pmo-decision-readiness-ready]')?.textContent).toContain(
      FINGERPRINT,
    )
    // 确认前：outcomes/handoffs 零直写
    expect(
      records.some((record) => record.method === 'POST' && record.path.endsWith('/outcomes')),
    ).toBe(false)
    fireEvent.click(document.querySelector('[data-pmo-decision-outcome-cancel]') as HTMLElement)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-outcome-dialog]')).toBeNull(),
    )
  })
})

// ---------------------------------------------------------------------------
// 人工结论提交（二次确认 + 参数对齐）
// ---------------------------------------------------------------------------
describe('结论提交：人工动作 → 参数对齐（audit 元数据）', () => {
  test('approve：默认选中首个 active 方案 → 改选 2 号 → 提交参数完整对齐', async () => {
    const backend = outcomeBackend()
    const { records } = installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-outcome-action="approve"]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-outcome-action="approve"]') as HTMLElement)
    await waitFor(() => expect(document.querySelector('[data-outcome-option="1"]')).not.toBeNull())
    // 审计元数据呈现
    const meta = document.querySelector('[data-outcome-audit-meta]')
    expect(meta?.textContent).toContain('批准')
    expect(meta?.textContent).toContain('已决定')
    expect(meta?.textContent).toContain('#7')
    expect(meta?.textContent).toContain(FINGERPRINT)
    // 默认选第一个 active 方案
    expect(
      (document.querySelector('[data-outcome-option="1"] input') as HTMLInputElement).checked,
    ).toBe(true)

    fireEvent.click(document.querySelector('[data-outcome-option="2"]') as HTMLElement)
    fireEvent.change(document.querySelector('[data-outcome-rationale]') as HTMLTextAreaElement, {
      target: { value: '经组合评审确认调动方案可行，约束已交接。' },
    })
    fireEvent.click(document.querySelector('[data-pmo-decision-outcome-submit]') as HTMLElement)

    await waitFor(() => {
      const post = records.find(
        (record) => record.method === 'POST' && record.path.endsWith('/outcomes'),
      )
      expect(post).toBeDefined()
      expect(JSON.parse(post?.body ?? '{}')).toMatchObject({
        action: 'approve',
        selectedOptionId: 2,
        reviewFingerprint: FINGERPRINT,
        rationale: '经组合评审确认调动方案可行，约束已交接。',
        acknowledgedWarnings: ['W1'],
      })
    })
    // 成功 → 关闭对话框、成功提示、议题转入 decided 归档、交接区解锁
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-outcome-success]')).not.toBeNull(),
    )
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-outcome-dialog]')).toBeNull(),
    )
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-handoff]')).not.toBeNull(),
    )
    expect(screen.getByText(/议题已决定（decided）/)).toBeInTheDocument()
    expect(
      document.querySelector('[data-outcome-row][data-outcome-action="approve"]')?.textContent,
    ).toContain('digest digest-approve-1')
  })

  test('reject：无需选中方案，selectedOptionId 为 null', async () => {
    const backend = outcomeBackend()
    const { records } = installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-outcome-action="reject"]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-outcome-action="reject"]') as HTMLElement)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-outcome-dialog]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-outcome-option]')).toBeNull()
    fireEvent.click(document.querySelector('[data-pmo-decision-outcome-submit]') as HTMLElement)
    await waitFor(() => {
      const post = records.find(
        (record) => record.method === 'POST' && record.path.endsWith('/outcomes'),
      )
      const payload = JSON.parse(post?.body ?? '{}') as Record<string, unknown>
      expect(payload.action).toBe('reject')
      expect(payload.selectedOptionId).toBeNull()
      expect(payload.reviewFingerprint).toBe(FINGERPRINT)
    })
  })

  test('supersede：必须填写取代目标议题 ID 才可提交', async () => {
    const backend = outcomeBackend()
    const { records } = installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-outcome-action="supersede"]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-outcome-action="supersede"]') as HTMLElement)
    await waitFor(() =>
      expect(document.querySelector('[data-outcome-supersede-target]')).not.toBeNull(),
    )
    const submit = document.querySelector('[data-pmo-decision-outcome-submit]') as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(
      document.querySelector('[data-outcome-supersede-target]') as HTMLInputElement,
      { target: { value: 'abc' } },
    )
    expect(submit.disabled).toBe(true)
    fireEvent.change(
      document.querySelector('[data-outcome-supersede-target]') as HTMLInputElement,
      { target: { value: '888' } },
    )
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => {
      const post = records.find(
        (record) => record.method === 'POST' && record.path.endsWith('/outcomes'),
      )
      const payload = JSON.parse(post?.body ?? '{}') as Record<string, unknown>
      expect(payload.action).toBe('supersede')
      expect(payload.supersededByCaseId).toBe(888)
    })
  })

  test('request-more-evidence：结论 → 议题回退 collecting-evidence，动作区隐藏并提示', async () => {
    const backend = outcomeBackend()
    installFetchRouter(backend.route)
    mountPage()
    await waitFor(() => expect(document.querySelector('[data-outcome-action]')).not.toBeNull())
    fireEvent.click(
      document.querySelector('[data-outcome-action="request-more-evidence"]') as HTMLElement,
    )
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-outcome-dialog]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-pmo-decision-outcome-submit]') as HTMLElement)
    await waitFor(() => {
      expect(document.querySelector('[data-pmo-decision-terminal-archive]')).toBeNull()
      expect(screen.getByText(/议题需先流转至 under-review/)).toBeInTheDocument()
    })
  })

  test('无 pmo_decision:decide：结论按钮物理隐藏（RL-06）', async () => {
    setAuth(['pmo_decision:view', 'pmo_decision:manage'])
    const backend = outcomeBackend()
    const { records } = installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-outcome]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-outcome-action]')).toBeNull()
    await settle()
    expect(
      records.some((record) => record.method === 'POST' && record.path.endsWith('/readiness')),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 受控交接
// ---------------------------------------------------------------------------
describe('受控交接：decided + approve 结论 + handoff 权限', () => {
  const decidedBackend = (failHandoffWith: { status: number; message: string } | null = null) =>
    outcomeBackend({
      status: 'decided',
      outcomes: [pmoDecisionApproveOutcomeFixture()],
      failHandoffWith,
    })

  test('发起前零写；二次确认后 POST handoffs（target + idempotencyKey）', async () => {
    const backend = decidedBackend()
    const { records } = installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-handoff]')).not.toBeNull(),
    )
    expect(
      document
        .querySelector('[data-handoff-target-option="allocation_draft"]')
        ?.getAttribute('data-handoff-target-disabled'),
    ).toBeNull()
    await settle()
    expect(
      records.some((record) => record.method === 'POST' && record.path.endsWith('/handoffs')),
    ).toBe(false)

    fireEvent.click(document.querySelector('[data-pmo-decision-handoff-open]') as HTMLElement)
    expect(document.querySelector('[data-pmo-decision-handoff-confirm]')).not.toBeNull()
    fireEvent.click(document.querySelector('[data-pmo-decision-handoff-submit]') as HTMLElement)
    await waitFor(() => {
      const post = records.find(
        (record) => record.method === 'POST' && record.path.endsWith('/handoffs'),
      )
      expect(post).toBeDefined()
      const payload = JSON.parse(post?.body ?? '{}') as { target: string; idempotencyKey: string }
      expect(payload.target).toBe('navigation')
      expect(payload.idempotencyKey).toMatch(/^handoff-101-navigation-\d+$/)
    })
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-handoff-message]')).not.toBeNull(),
    )
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-handoff-receipt]')).not.toBeNull(),
    )
  })

  test('需要选中方案的目标在结论无方案时禁用（eligibility 镜像后端 registry）', async () => {
    const outcomeWithoutOption = {
      ...pmoDecisionApproveOutcomeFixture(),
      selectedOptionId: null,
    }
    const backend = outcomeBackend({
      status: 'decided',
      outcomes: [outcomeWithoutOption],
    })
    installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-handoff]')).not.toBeNull(),
    )
    expect(
      document
        .querySelector('[data-handoff-target-option="priority_review_intent"]')
        ?.getAttribute('data-handoff-target-disabled'),
    ).toBe('true')
    expect(
      document
        .querySelector('[data-handoff-target-option="allocation_draft"]')
        ?.getAttribute('data-handoff-target-disabled'),
    ).toBe('true')
    expect(
      document
        .querySelector('[data-handoff-target-option="navigation"]')
        ?.getAttribute('data-handoff-target-disabled'),
    ).toBeNull()
  })

  test('创建失败：回显服务端错误并复位确认态，可重试', async () => {
    const backend = decidedBackend({ status: 422, message: '目标不可达' })
    const { records } = installFetchRouter(backend.route)
    mountPage()
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-handoff]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-pmo-decision-handoff-open]') as HTMLElement)
    fireEvent.click(document.querySelector('[data-pmo-decision-handoff-submit]') as HTMLElement)
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-handoff-error]')?.textContent).toContain(
        '目标不可达',
      ),
    )
    // 失败后复位：确认态收起、可再次发起
    await waitFor(() =>
      expect(document.querySelector('[data-pmo-decision-handoff-confirm]')).toBeNull(),
    )
    expect(
      records.filter((record) => record.method === 'POST' && record.path.endsWith('/handoffs'))
        .length,
    ).toBe(1)
  })
})
