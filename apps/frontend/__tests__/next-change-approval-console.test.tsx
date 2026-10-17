/**
 * v3-ui-next-risk-change-domains W2 · tasks 2.10 —— 变更审批决策控制台测试。
 *
 * 覆盖（spec「变更请求受控审批流与全生命周期闭环」/ design Decision 5.1）：
 * - 具备 change_request:approve 权限时展开决策字段（决策理由/附加条件）；
 * - 批准：录入理由与生效条件 → POST /change-requests/:id/approve（载荷对齐）；
 * - 退回修改：仅审核中（under_review）呈现 → POST /change-requests/:id/return；
 * - 影响分析快照引用：有效快照随批准携带 impactAnalysisId；
 * - 过期快照防御：快照 stale 且未填写 confirmStaleReason 时批准/拒绝保持禁用，
 *   填写书面确认理由后解锁并在载荷中携带；
 * - 无审批权限用户：决策控件物理隐藏，仅见只读「审批处理中」；
 * - 请求人不得自批：自批场景呈现阻断提示。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ChangeImpactAnalysis, ChangeRequest } from '@/lib/api/change-requests'
import { ChangeApprovalConsole } from '@/components/next/change-requests/ChangeApprovalConsole'
import { useAuthStore } from '@/stores/auth-store'
import { jsonResponse, resetFetchRouter, API_PREFIX } from './helpers/chart-gallery-network'

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

function makeCr(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 7,
    crCode: 'CR-2026-007',
    organizationId: 1,
    projectId: 42,
    title: '增加移动端扫码登录模块',
    description: null,
    changeType: 'scope',
    status: 'submitted',
    priority: 'high',
    requesterId: 2,
    approverId: null,
    requestedBy: 2,
    reviewedBy: null,
    impactSummary: null,
    impactAnalysis: null,
    conditions: null,
    decisionReason: null,
    approvalComments: null,
    submittedAt: '2026-09-05T02:30:00.000Z',
    approvedAt: null,
    implementedAt: null,
    implementedBy: null,
    closedAt: null,
    closedBy: null,
    createdAt: '2026-09-04T08:00:00.000Z',
    updatedAt: '2026-09-05T02:30:00.000Z',
    currentImpactAnalysisId: null,
    approveRefAnalysisId: null,
    impactAnalysisConfirmStatus: null,
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
    inputSignature: 'sig',
    summary: {
      totalAffected: 2,
      severityDistribution: { critical: 0, high: 1, medium: 1, low: 0, none: 0 },
      dimensionSummaries: [],
      criticalPathAffected: false,
      hasBlockingWarnings: false,
    },
    items: [],
    warnings: [],
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

const emptyMeta = { total: 0, page: 1, perPage: 10, totalPages: 1 }

/** 记录请求体的 fetch 路由（断言审批动作载荷）。 */
function installBodyRouter(
  route: (path: string, method: string, body: string | null) => Response | null,
): Array<{ method: string; url: string; body: string | null }> {
  const records: Array<{ method: string; url: string; body: string | null }> = []
  const fetchMock: typeof fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? init.body : null
    records.push({ method, url: rawUrl.replace(API_PREFIX, ''), body })
    const matched = route(rawUrl.replace(API_PREFIX, ''), method, body)
    if (matched) return matched
    return jsonResponse(404, {
      error: { code: 'NOT_FOUND', message: `未匹配 ${method} ${rawUrl}` },
    })
  }
  vi.stubGlobal('fetch', fetchMock)
  return records
}

function renderConsole(cr: ChangeRequest) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ChangeApprovalConsole projectId={42} cr={cr} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  setAuth(['change_request:create', 'change_request:approve'])
})

afterEach(() => {
  resetFetchRouter()
})

describe('待审批态决策字段与动作（submitted / under_review）', () => {
  test('具备审批权限时展开决策理由/附加条件，批准动作按状态机呈现', async () => {
    const records = installBodyRouter((path, method) => {
      if (path === '/projects/42/change-requests/7/impact-analyses' && method === 'GET') {
        return jsonResponse(200, { data: [], meta: emptyMeta })
      }
      if (path === '/change-requests/7/approve' && method === 'POST') {
        return jsonResponse(200, { data: makeCr({ status: 'approved' }) })
      }
      return null
    })
    renderConsole(makeCr())
    expect(await screen.findByText('审批决策控制台')).toBeInTheDocument()
    expect(document.querySelector('[data-cr-console-reason]')).not.toBeNull()
    expect(document.querySelector('[data-cr-console-conditions]')).not.toBeNull()
    // submitted 合法动作：批准 + 拒绝；退回仅审核中态（状态机镜像）
    expect(document.querySelector('[data-cr-console-approve]')).not.toBeNull()
    expect(document.querySelector('[data-cr-console-reject]')).not.toBeNull()
    expect(document.querySelector('[data-cr-console-return]')).toBeNull()

    fireEvent.change(document.querySelector('[data-cr-console-reason]')!, {
      target: { value: '评估后资源可协调' },
    })
    fireEvent.change(document.querySelector('[data-cr-console-conditions]')!, {
      target: { value: '批准后 3 日内补演练记录' },
    })
    fireEvent.click(document.querySelector('[data-cr-console-approve]')!)
    await waitFor(() => {
      const approve = records.find(
        (record) => record.method === 'POST' && record.url === '/change-requests/7/approve',
      )
      expect(approve).toBeDefined()
      const payload = JSON.parse(approve!.body ?? '{}') as {
        decisionReason: string
        conditions: string
        impactAnalysisId: number | null
      }
      expect(payload.decisionReason).toBe('评估后资源可协调')
      expect(payload.conditions).toBe('批准后 3 日内补演练记录')
      expect(payload.impactAnalysisId).toBeNull()
    })
  })

  test('审核中态呈现退回修改并调用 return 端点', async () => {
    const records = installBodyRouter((path, method) => {
      if (path === '/projects/42/change-requests/7/impact-analyses' && method === 'GET') {
        return jsonResponse(200, { data: [], meta: emptyMeta })
      }
      if (path === '/change-requests/7/return' && method === 'POST') {
        return jsonResponse(200, { data: makeCr({ status: 'returned' }) })
      }
      return null
    })
    renderConsole(makeCr({ status: 'under_review', reviewedBy: 2 }))
    await screen.findByText('审批决策控制台')
    const returnButton = document.querySelector('[data-cr-console-return]') as HTMLButtonElement
    expect(returnButton).not.toBeNull()

    fireEvent.change(document.querySelector('[data-cr-console-reason]')!, {
      target: { value: '缺少针对核心数据库的备份回滚方案' },
    })
    fireEvent.click(returnButton)
    await waitFor(() => {
      const returnCall = records.find(
        (record) => record.method === 'POST' && record.url === '/change-requests/7/return',
      )
      expect(returnCall).toBeDefined()
      const payload = JSON.parse(returnCall!.body ?? '{}') as { decisionReason: string }
      expect(payload.decisionReason).toContain('备份回滚方案')
    })
  })

  test('标记已实施（approved → implement）与关闭（implemented → close）入口按状态呈现', async () => {
    const records = installBodyRouter((path, method) => {
      if (path === '/projects/42/change-requests/7/impact-analyses' && method === 'GET') {
        return jsonResponse(200, { data: [], meta: emptyMeta })
      }
      if (path === '/change-requests/7/mark-implemented' && method === 'POST') {
        return jsonResponse(200, { data: makeCr({ status: 'implemented' }) })
      }
      return null
    })
    renderConsole(makeCr({ status: 'approved', approvedAt: '2026-09-06T08:00:00.000Z' }))
    await screen.findByText('审批决策控制台')
    const implementButton = document.querySelector(
      '[data-cr-console-implement]',
    ) as HTMLButtonElement
    expect(implementButton).not.toBeNull()
    fireEvent.click(implementButton)
    await waitFor(() => {
      expect(
        records.some(
          (record) =>
            record.method === 'POST' && record.url === '/change-requests/7/mark-implemented',
        ),
      ).toBe(true)
    })
  })
})

describe('影响分析快照引用与过期防御', () => {
  function snapshotRouter(analysis: ChangeImpactAnalysis) {
    return (path: string, method: string): Response | null => {
      if (path === '/projects/42/change-requests/7/impact-analyses' && method === 'GET') {
        return jsonResponse(200, {
          data: [analysis],
          meta: { total: 1, page: 1, perPage: 10, totalPages: 1 },
        })
      }
      if (path === '/impact-analyses/101' && method === 'GET') {
        return jsonResponse(200, { data: analysis })
      }
      return null
    }
  }

  test('引用有效快照批准时携带 impactAnalysisId', async () => {
    const records = installBodyRouter((path, method) => {
      const matched = snapshotRouter(makeAnalysis())(path, method)
      if (matched) return matched
      if (path === '/change-requests/7/approve' && method === 'POST') {
        return jsonResponse(200, { data: makeCr({ status: 'approved' }) })
      }
      return null
    })
    renderConsole(makeCr({ currentImpactAnalysisId: 101 }))
    await screen.findByText('审批决策控制台')
    await waitFor(() => {
      expect(document.querySelector('[data-cr-console-snapshot-check]')).not.toBeNull()
    })
    const check = document.querySelector('[data-cr-console-snapshot-check]') as HTMLInputElement
    expect(check.checked).toBe(true)
    // 有效快照：批准按钮解锁（无需过期理由）
    const approve = document.querySelector('[data-cr-console-approve]') as HTMLButtonElement
    expect(approve.disabled).toBe(false)
    fireEvent.click(approve)
    await waitFor(() => {
      const call = records.find(
        (record) => record.method === 'POST' && record.url === '/change-requests/7/approve',
      )
      const payload = JSON.parse(call!.body ?? '{}') as {
        impactAnalysisId: number | null
        confirmStaleReason: string | null
      }
      expect(payload.impactAnalysisId).toBe(101)
      expect(payload.confirmStaleReason).toBeNull()
    })
  })

  test('过期快照未填确认理由时批准保持禁用，填写后解锁并携带 confirmStaleReason', async () => {
    const stale = makeAnalysis({
      status: 'stale',
      isStale: true,
      staleReason: '基线任务工期已调整',
    })
    const records = installBodyRouter((path, method) => {
      const matched = snapshotRouter(stale)(path, method)
      if (matched) return matched
      if (path === '/change-requests/7/approve' && method === 'POST') {
        return jsonResponse(200, { data: makeCr({ status: 'approved' }) })
      }
      return null
    })
    renderConsole(makeCr({ currentImpactAnalysisId: 101 }))
    await screen.findByText('审批决策控制台')
    await waitFor(() => {
      expect(document.querySelector('[data-cr-console-stale]')).not.toBeNull()
    })
    expect(document.querySelector('[data-cr-console-stale]')?.textContent).toContain(
      '基线任务工期已调整',
    )
    const approve = document.querySelector('[data-cr-console-approve]') as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    expect((document.querySelector('[data-cr-console-reject]') as HTMLButtonElement).disabled).toBe(
      true,
    )

    fireEvent.change(document.querySelector('[data-cr-console-stale-reason]')!, {
      target: { value: '经核对排程变化不影响本次变更，确认引用该快照' },
    })
    expect(approve.disabled).toBe(false)
    fireEvent.click(approve)
    await waitFor(() => {
      const call = records.find(
        (record) => record.method === 'POST' && record.url === '/change-requests/7/approve',
      )
      const payload = JSON.parse(call!.body ?? '{}') as {
        impactAnalysisId: number | null
        confirmStaleReason: string | null
      }
      expect(payload.impactAnalysisId).toBe(101)
      expect(payload.confirmStaleReason).toBe('经核对排程变化不影响本次变更，确认引用该快照')
    })
  })
})

describe('权限守卫与自批阻断', () => {
  test('无 change_request:approve 权限：决策控件物理隐藏，仅见只读指示', async () => {
    setAuth(['change_request:view'])
    installBodyRouter((path, method) => {
      if (path === '/projects/42/change-requests/7/impact-analyses' && method === 'GET') {
        return jsonResponse(200, { data: [], meta: emptyMeta })
      }
      return null
    })
    renderConsole(makeCr())
    await screen.findByText('审批决策控制台')
    expect(document.querySelector('[data-cr-console-readonly]')?.textContent).toContain(
      '审批处理中',
    )
    expect(document.querySelector('[data-cr-console-approve]')).toBeNull()
    expect(document.querySelector('[data-cr-console-reject]')).toBeNull()
    expect(document.querySelector('[data-cr-console-return]')).toBeNull()
    expect(document.querySelector('[data-cr-console-reason]')).toBeNull()
  })

  test('请求人不得自批：呈现阻断提示且不展开决策字段', async () => {
    // 当前用户 id=1 恰为变更请求人
    renderConsole(makeCr({ requesterId: 1, requestedBy: 1 }))
    await screen.findByText('审批决策控制台')
    expect(screen.getByText(/变更申请人不能自行审批本请求/)).toBeInTheDocument()
    expect(document.querySelector('[data-cr-console-approve]')).toBeNull()
    expect(document.querySelector('[data-cr-console-reason]')).toBeNull()
  })

  test('草稿/退回态且请求人本人：呈现提交审批入口', async () => {
    const records = installBodyRouter((path, method) => {
      if (path === '/projects/42/change-requests/7/impact-analyses' && method === 'GET') {
        return jsonResponse(200, { data: [], meta: emptyMeta })
      }
      if (path === '/change-requests/7/submit' && method === 'POST') {
        return jsonResponse(200, { data: makeCr({ status: 'submitted' }) })
      }
      return null
    })
    renderConsole(makeCr({ status: 'returned', requesterId: 1, requestedBy: 1 }))
    await screen.findByText('审批决策控制台')
    const submitButton = document.querySelector('[data-cr-console-submit]') as HTMLButtonElement
    expect(submitButton).not.toBeNull()
    fireEvent.click(submitButton)
    await waitFor(() => {
      expect(
        records.some(
          (record) => record.method === 'POST' && record.url === '/change-requests/7/submit',
        ),
      ).toBe(true)
    })
  })
})
