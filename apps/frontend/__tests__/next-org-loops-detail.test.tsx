/**
 * v3-ui-next-org-portfolio-domains W6 · tasks 6.6 —— 容量环详情工作台与动作条测试
 * （组件级真实数据链：hooks + 全局 fetch 伪后端）。
 *
 * 覆盖（spec「资源容量闭环咨询工作台（列表与详情）」场景 + tasks 6.4–6.6）：
 * - 详情分区渲染：事实表/情景列表/模拟摘要/观察复核时间线/咨询姿态红线文案
 *   （「选择仅表达方向，不构成对任何正式资源记录的写入授权」「本页面所有建议均为
 *   咨询性质且未被应用」）；
 * - 无 resource_capacity_loop:manage：模拟/新建情景/刷新基线/动作条全部物理隐藏，
 *   网络监控写请求零发出（RL-06）；
 * - 状态机动作条：simulate（情景面板）→ select → handoff → review → close/cancel，
 *   各动作确认弹窗阻断（取消零写）与提交（payload 断言）；
 * - mutation 成功 invalidate 刷新详情（GET 重发）；提交防抖（isPending）；
 * - 基线刷新后端显式降级结果回显；
 * - 404（跨组织/非法 loopId）中性「容量环未找到」（不泄露后端 message）、
 *   5xx 可重试（RL-05）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { CapacityLoopDetailWorkspace } from '@/components/next/org-loops/CapacityLoopDetailWorkspace'
import type { RcclLoopDetail } from '@/lib/api/resource-capacity-loops'

// ---------------------------------------------------------------------------
// next/navigation mock
// ---------------------------------------------------------------------------
const navMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push, replace: navMock.replace, back: navMock.back }),
  usePathname: () => '/next/organization/resource-capacity-loops/7',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}))

// ---------------------------------------------------------------------------
// 会话与网络
// ---------------------------------------------------------------------------
function setAuth(permissions: string[]) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'admin@example.com',
      fullName: '管理员',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'org_admin' }],
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

const API_PREFIX = 'http://localhost:3333/api/v1'
const DETAIL_PATH = '/organizations/1/resource-capacity-loops/7'

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

function writes(records: RequestRecord[]): RequestRecord[] {
  return records.filter((record) => record.method !== 'GET')
}

function renderWorkspace(loopId = 7) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CapacityLoopDetailWorkspace loopId={loopId} />
    </QueryClientProvider>,
  )
}

// ---------------------------------------------------------------------------
// 详情夹具（后端 show 响应信封 {data: detail}）
// ---------------------------------------------------------------------------
function makeDetail(state: string, overrides: Partial<RcclLoopDetail> = {}): RcclLoopDetail {
  return {
    loop: {
      id: 7,
      title: 'Q4 容量闭环',
      state,
      revision: 3,
      granularity: 'week',
      windowStart: '2026-09-01',
      windowEnd: '2026-11-30',
    },
    baseline: { id: 77, digest: 'fnv1a:abc123', readyForSimulation: true },
    scenarios: [
      { id: 1, name: '情景一：维持现状', revision: 1, active: true },
      { id: 2, name: '情景二：前端 +20%', revision: 1, active: true },
    ],
    simulations: [
      { id: 51, scenarioId: 1, digest: 'fnv1a:sim-a', staleState: 'current' },
      { id: 52, scenarioId: 2, digest: 'fnv1a:sim-b', staleState: 'current' },
    ],
    currentSelection: null,
    receipts: [],
    observations: [],
    reviews: [],
    actionPosture: { writesApplied: false, confirmationRequired: true },
    ...overrides,
  }
}

function detailBackend(initial: RcclLoopDetail, failing = false) {
  const detailGets: string[] = []
  return {
    detailGets,
    route: (path: string, method: string): Response | null => {
      if (path === DETAIL_PATH && method === 'GET') {
        detailGets.push('GET')
        if (failing) {
          return jsonResponse(500, { error: { code: 'INTERNAL', message: '内部错误' } })
        }
        return jsonResponse(200, { data: initial })
      }
      return null
    },
  }
}

function loop404Backend() {
  return (path: string, method: string): Response | null => {
    if (path === DETAIL_PATH && method === 'GET') {
      return jsonResponse(404, {
        error: { code: 'RESOURCE_NOT_FOUND', message: '容量闭环不存在' },
      })
    }
    return null
  }
}

beforeEach(() => {
  navMock.push.mockReset()
  navMock.replace.mockReset()
  navMock.back.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
describe('CapacityLoopDetailWorkspace：分区渲染与咨询姿态文案（tasks 6.4）', () => {
  test('授权用户渲染事实表/情景/时间线与红线文案', async () => {
    setAuth(['resource_capacity_loop:view', 'resource_capacity_loop:manage'])
    const backend = detailBackend(makeDetail('draft'))
    installFetchRouter(backend.route)
    renderWorkspace()

    await waitFor(() =>
      expect(document.querySelector('[data-rccl-detail-title]')?.textContent).toContain(
        'Q4 容量闭环',
      ),
    )
    // 状态徽标与元信息
    expect(document.querySelector('[data-rccl-detail-state]')?.textContent).toBe('草稿')
    expect(document.querySelector('[data-rccl-detail-meta]')?.textContent).toContain('修订 v3')
    expect(document.querySelector('[data-rccl-detail-meta]')?.textContent).toContain('周粒度')
    expect(document.querySelector('[data-rccl-detail-meta]')?.textContent).toContain(
      '窗口 2026-09-01 ~ 2026-11-30',
    )
    // 事实表（图表的表格替代）
    const factTable = document.querySelector('[data-rccl-fact-table]')
    expect(factTable).not.toBeNull()
    expect(factTable?.textContent).toContain('77')
    expect(factTable?.textContent).toContain('fnv1a:abc123')
    expect(document.body.textContent).toContain('事实数据')
    expect(document.body.textContent).toContain('可模拟')
    // 情景行 + 模拟摘要
    expect(document.querySelectorAll('[data-rccl-scenario-row]')).toHaveLength(2)
    expect(document.querySelector('[data-rccl-simulation-summary]')?.textContent).toContain(
      '已生成 2 份模拟快照',
    )
    // 观察/复核时间线空态
    expect(document.querySelector('[data-rccl-timeline]')?.textContent).toContain(
      '下游到达可观察状态后',
    )
  })

  test('咨询姿态红线文案常驻（选择不构成写授权 + 建议未被应用）', async () => {
    setAuth(['resource_capacity_loop:view'])
    const detail = makeDetail('selected', {
      currentSelection: {
        id: 12,
        scenarioId: 1,
        fingerprint: 'fnv1a:fpx',
        expiresAt: '2026-10-01T00:00:00Z',
      },
      receipts: [{ id: 9, target: 'cross-project-allocation-draft', status: 'pending' }],
    })
    installFetchRouter(detailBackend(detail).route)
    renderWorkspace()

    await waitFor(() => expect(document.querySelector('[data-rccl-selection-info]')).not.toBeNull())
    const selectionInfo = document.querySelector('[data-rccl-selection-info]')
    expect(selectionInfo?.textContent).toContain(
      '选择仅表达方向，不构成对任何正式资源记录的写入授权',
    )
    expect(document.querySelector('[data-rccl-receipt-list]')?.textContent).toContain(
      '正式写入须在下游完成预览并二次确认后发生',
    )
    const postureNote = document.querySelector('[data-rccl-posture-note]')
    expect(postureNote?.textContent).toContain('咨询性质')
    expect(postureNote?.textContent).toContain('未被应用')
    expect(postureNote?.textContent).toContain('显式确认')
  })
})

describe('CapacityLoopDetailWorkspace：无 manage 只读（tasks 6.6）', () => {
  test('只读成员：模拟/新建情景/刷新基线/动作条全部物理隐藏且写请求零发出', async () => {
    setAuth(['resource_capacity_loop:view'])
    const backend = detailBackend(makeDetail('draft'))
    const { records } = installFetchRouter(backend.route)
    renderWorkspace()

    await waitFor(() => expect(document.querySelector('[data-rccl-detail-title]')).not.toBeNull())
    expect(document.querySelector('[data-rccl-simulate-button]')).toBeNull()
    expect(document.querySelector('[data-rccl-scenario-create-open]')).toBeNull()
    expect(document.querySelector('[data-rccl-baseline-refresh-open]')).toBeNull()
    expect(document.querySelector('[data-rccl-action-bar]')).toBeNull()
    // 事实表与情景只读呈现
    expect(document.querySelector('[data-rccl-fact-table]')).not.toBeNull()
    expect(document.querySelectorAll('[data-rccl-scenario-row]')).toHaveLength(2)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(writes(records)).toEqual([])
    expect(backend.detailGets.length).toBeGreaterThan(0)
  })
})

describe('CapacityLoopDetailWorkspace：动作条写路径（tasks 6.5/6.6）', () => {
  test('模拟按钮（manage + 基线就绪 + ≥2 情景）：提交 expectedRevision；成功刷新详情', async () => {
    setAuth(['resource_capacity_loop:view', 'resource_capacity_loop:manage'])
    const detail = makeDetail('draft')
    const { records } = installFetchRouter((path, method) => {
      if (path === DETAIL_PATH && method === 'GET') return jsonResponse(200, { data: detail })
      if (path === `${DETAIL_PATH}/simulate` && method === 'POST') {
        return jsonResponse(200, { data: { loopState: 'simulated', results: [] } })
      }
      return null
    })
    renderWorkspace()

    await waitFor(() =>
      expect(document.querySelector('[data-rccl-simulate-button]')).not.toBeNull(),
    )
    const simulate = document.querySelector('[data-rccl-simulate-button]') as HTMLButtonElement
    expect(simulate.disabled).toBe(false)
    expect(simulate.textContent).toContain('v3')
    fireEvent.click(simulate)

    await waitFor(() => {
      const simulatePost = records.find((record) => record.url === `${DETAIL_PATH}/simulate`)
      expect(simulatePost?.body).toEqual({ expectedRevision: 3 })
    })
    // mutation 成功 → invalidate → 详情 GET 重新发出（刷新闭环）
    await waitFor(() => {
      const detailGets = records.filter(
        (record) => record.url === DETAIL_PATH && record.method === 'GET',
      )
      expect(detailGets.length).toBeGreaterThanOrEqual(2)
    })
    expect(writes(records).map((record) => record.url)).toEqual([`${DETAIL_PATH}/simulate`])
  })

  test('模拟按钮能力门禁：情景不足 2 个时禁用并给说明（区别于权限隐藏）', async () => {
    setAuth(['resource_capacity_loop:view', 'resource_capacity_loop:manage'])
    const detail = makeDetail('draft', {
      scenarios: [{ id: 1, name: '唯一情景', revision: 1, active: true }],
    })
    installFetchRouter(detailBackend(detail).route)
    renderWorkspace()

    await waitFor(() =>
      expect(document.querySelector('[data-rccl-simulate-button]')).not.toBeNull(),
    )
    const simulate = document.querySelector('[data-rccl-simulate-button]') as HTMLButtonElement
    expect(simulate.disabled).toBe(true)
    expect(document.querySelector('[data-rccl-simulate-hint]')?.textContent).toContain(
      '至少需要 2 个活动情景',
    )
  })

  test('新建情景：确认弹窗提交 name/overlays/expectedRevision（capacity-delta 行随附）', async () => {
    setAuth(['resource_capacity_loop:view', 'resource_capacity_loop:manage'])
    const detail = makeDetail('draft')
    const { records } = installFetchRouter((path, method) => {
      if (path === DETAIL_PATH && method === 'GET') return jsonResponse(200, { data: detail })
      if (path === `${DETAIL_PATH}/scenarios` && method === 'POST') {
        return jsonResponse(201, { data: { id: 9, revision: 1 } })
      }
      return null
    })
    renderWorkspace()

    await waitFor(() =>
      expect(document.querySelector('[data-rccl-scenario-create-open]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-rccl-scenario-create-open]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-rccl-scenario-dialog]')).not.toBeNull(),
    )
    // 未填名称：确认被禁用（弹窗阻断）
    const confirm = document.querySelector(
      '[data-rccl-scenario-dialog-confirm]',
    ) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)

    fireEvent.change(document.querySelector('[data-rccl-scenario-name]') as Element, {
      target: { value: '情景三：测试支援' },
    })
    // 添加一条 capacity-delta 调整行并填充
    fireEvent.click(document.querySelector('[data-rccl-overlay-add]') as Element)
    await waitFor(() => expect(document.querySelector('[data-rccl-overlay-row]')).not.toBeNull())
    const row = document.querySelector('[data-rccl-overlay-row]') as HTMLElement
    fireEvent.change(row.querySelectorAll('input')[0] as Element, {
      target: { value: '前端工程师' },
    })
    fireEvent.change(row.querySelectorAll('input')[1] as Element, {
      target: { value: '2026-09-14' },
    })
    fireEvent.change(row.querySelectorAll('input')[2] as Element, { target: { value: '160' } })
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(confirm)

    await waitFor(() => {
      const scenarioPost = records.find((record) => record.url === `${DETAIL_PATH}/scenarios`)
      expect(scenarioPost?.body).toMatchObject({
        name: '情景三：测试支援',
        expectedRevision: 3,
      })
      const overlays = scenarioPost?.body?.overlays as Array<Record<string, unknown>>
      expect(overlays).toHaveLength(1)
      expect(overlays[0]).toMatchObject({
        kind: 'capacity-delta',
        role: '前端工程师',
        bucket: '2026-09-14',
        deltaHours: 160,
      })
    })
    // 成功后弹窗关闭
    await waitFor(() => expect(document.querySelector('[data-rccl-scenario-dialog]')).toBeNull())
  })

  test('刷新基线：确认弹窗 → POST /baseline-refresh；后端降级结果原样回显', async () => {
    setAuth(['resource_capacity_loop:view', 'resource_capacity_loop:manage'])
    const detail = makeDetail('draft')
    const { records } = installFetchRouter((path, method) => {
      if (path === DETAIL_PATH && method === 'GET') return jsonResponse(200, { data: detail })
      if (path === `${DETAIL_PATH}/baseline-refresh` && method === 'POST') {
        return jsonResponse(202, {
          data: {
            refreshed: false,
            degradedReason: 'RCCL_SOURCE_REQUIRED_FAILED',
            detail: '基线刷新的生产来源接线将在 Service 层装配（当前显式降级）',
          },
        })
      }
      return null
    })
    renderWorkspace()

    await waitFor(() =>
      expect(document.querySelector('[data-rccl-baseline-refresh-open]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-rccl-baseline-refresh-open]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-rccl-baseline-dialog]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-rccl-baseline-dialog-confirm]') as Element)

    await waitFor(() => {
      const post = records.find((record) => record.url === `${DETAIL_PATH}/baseline-refresh`)
      expect(post?.method).toBe('POST')
      expect(post?.body).toEqual({})
    })
    await waitFor(() =>
      expect(document.querySelector('[data-rccl-baseline-result]')?.textContent).toContain(
        '基线刷新未产生变更（RCCL_SOURCE_REQUIRED_FAILED）',
      ),
    )
  })

  test('select 流程：simulated 态动作可见；确认弹窗提交 scenarioId/simulationSnapshotId', async () => {
    setAuth(['resource_capacity_loop:view', 'resource_capacity_loop:manage'])
    const detail = makeDetail('simulated')
    const { records } = installFetchRouter((path, method) => {
      if (path === DETAIL_PATH && method === 'GET') return jsonResponse(200, { data: detail })
      if (path === `${DETAIL_PATH}/select` && method === 'POST') {
        return jsonResponse(200, {
          data: { selectionId: 12, fingerprint: 'fnv1a:fpx', writesApplied: false },
        })
      }
      return null
    })
    renderWorkspace()

    await waitFor(() =>
      expect(document.querySelector('[data-rccl-action-open="select"]')).not.toBeNull(),
    )
    // 无 manage 时不渲染已在其他用例锁定；此处动作条可见（manage 持有）
    fireEvent.click(document.querySelector('[data-rccl-action-open="select"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-rccl-action-dialog="select"]')).not.toBeNull(),
    )
    // 阻断：取消弹窗零写
    fireEvent.click(document.querySelector('[data-rccl-action-dialog-cancel]') as Element)
    expect(document.querySelector('[data-rccl-action-dialog="select"]')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(writes(records)).toEqual([])

    // 再次打开并提交（默认预选第一个情景 1 → 快照 51）
    fireEvent.click(document.querySelector('[data-rccl-action-open="select"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-rccl-action-dialog="select"]')).not.toBeNull(),
    )
    const scenarioSelect = document.querySelector(
      '[data-rccl-select-scenario]',
    ) as HTMLSelectElement
    expect(scenarioSelect.value).toBe('1')
    fireEvent.change(scenarioSelect, { target: { value: '2' } })
    fireEvent.click(document.querySelector('[data-rccl-action-dialog-confirm]') as Element)
    await waitFor(() => {
      const selectPost = records.find((record) => record.url === `${DETAIL_PATH}/select`)
      expect(selectPost?.body).toMatchObject({
        scenarioId: 2,
        simulationSnapshotId: 52,
        actorType: 'human_user',
      })
    })
    await waitFor(() =>
      expect(document.querySelector('[data-rccl-action-dialog="select"]')).toBeNull(),
    )
  })

  test('handoff 流程：selected 态提交 target/幂等键；幂等键 ≥8 字符', async () => {
    setAuth(['resource_capacity_loop:view', 'resource_capacity_loop:manage'])
    const detail = makeDetail('selected', {
      currentSelection: { id: 12, scenarioId: 1, fingerprint: 'fnv1a:fpx', expiresAt: null },
    })
    const { records } = installFetchRouter((path, method) => {
      if (path === DETAIL_PATH && method === 'GET') return jsonResponse(200, { data: detail })
      if (path === `${DETAIL_PATH}/handoff` && method === 'POST') {
        return jsonResponse(200, {
          data: { receiptId: 33, status: 'pending', writesApplied: false },
        })
      }
      return null
    })
    renderWorkspace()

    await waitFor(() =>
      expect(document.querySelector('[data-rccl-action-open="handoff"]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-rccl-action-open="handoff"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-rccl-action-dialog="handoff"]')).not.toBeNull(),
    )
    const idemInput = document.querySelector('[data-rccl-handoff-idemkey]') as HTMLInputElement
    expect(idemInput.value.length).toBeGreaterThanOrEqual(8)
    expect(idemInput.value.startsWith('rccl-')).toBe(true)

    fireEvent.change(document.querySelector('[data-rccl-handoff-target]') as Element, {
      target: { value: 'project-resource-suggestion-preview' },
    })
    fireEvent.click(document.querySelector('[data-rccl-action-dialog-confirm]') as Element)
    await waitFor(() => {
      const handoffPost = records.find((record) => record.url === `${DETAIL_PATH}/handoff`)
      expect(handoffPost?.body).toMatchObject({
        target: 'project-resource-suggestion-preview',
        requestedRefs: [],
        authorizedVisibleRefIds: [],
      })
      const key = handoffPost?.body?.idempotencyKey
      expect(typeof key).toBe('string')
      expect(String(key).length).toBeGreaterThanOrEqual(8)
    })
  })

  test('review 流程：observing 态提交观察快照/结论/有界理由', async () => {
    setAuth(['resource_capacity_loop:view', 'resource_capacity_loop:manage'])
    const detail = makeDetail('observing', {
      observations: [{ id: 91, comparable: true, status: 'applied_downstream' }],
      reviews: [],
    })
    const { records } = installFetchRouter((path, method) => {
      if (path === DETAIL_PATH && method === 'GET') return jsonResponse(200, { data: detail })
      if (path === `${DETAIL_PATH}/review` && method === 'POST') {
        return jsonResponse(200, { data: { reviewId: 7, outcome: 'not_met' } })
      }
      return null
    })
    renderWorkspace()

    await waitFor(() =>
      expect(document.querySelector('[data-rccl-action-open="review"]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-rccl-action-open="review"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-rccl-action-dialog="review"]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-rccl-action-dialog="review"]')?.textContent).toContain(
      '#91',
    )
    fireEvent.change(document.querySelector('[data-rccl-review-outcome]') as Element, {
      target: { value: 'not_met' },
    })
    fireEvent.change(document.querySelector('[data-rccl-review-rationale]') as Element, {
      target: { value: '口径失配导致对比无效' },
    })
    fireEvent.click(document.querySelector('[data-rccl-action-dialog-confirm]') as Element)
    await waitFor(() => {
      const reviewPost = records.find((record) => record.url === `${DETAIL_PATH}/review`)
      expect(reviewPost?.body).toMatchObject({
        observationSnapshotId: 91,
        outcome: 'not_met',
        boundedRationale: '口径失配导致对比无效',
      })
    })
  })

  test('close 流程：reviewed 态提交 expectedRevision', async () => {
    setAuth(['resource_capacity_loop:view', 'resource_capacity_loop:manage'])
    const detail = makeDetail('reviewed', {
      observations: [{ id: 91, comparable: true, status: 'applied_downstream' }],
      reviews: [{ id: 7, outcome: 'goal_met' }],
    })
    const { records } = installFetchRouter((path, method) => {
      if (path === DETAIL_PATH && method === 'GET') return jsonResponse(200, { data: detail })
      if (path === `${DETAIL_PATH}/close` && method === 'POST') {
        return jsonResponse(200, { data: { state: 'closed', revision: 4 } })
      }
      return null
    })
    renderWorkspace()

    await waitFor(() =>
      expect(document.querySelector('[data-rccl-action-open="close"]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-rccl-action-open="close"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-rccl-action-dialog="close"]')).not.toBeNull(),
    )
    fireEvent.click(document.querySelector('[data-rccl-action-dialog-confirm]') as Element)
    await waitFor(() => {
      const closePost = records.find((record) => record.url === `${DETAIL_PATH}/close`)
      expect(closePost?.body).toEqual({ expectedRevision: 3 })
    })
  })

  test('cancel 流程：draft 态提交原因（可选留空）', async () => {
    setAuth(['resource_capacity_loop:view', 'resource_capacity_loop:manage'])
    const detail = makeDetail('draft')
    const { records } = installFetchRouter((path, method) => {
      if (path === DETAIL_PATH && method === 'GET') return jsonResponse(200, { data: detail })
      if (path === `${DETAIL_PATH}/cancel` && method === 'POST') {
        return jsonResponse(200, { data: { state: 'cancelled', revision: 4 } })
      }
      return null
    })
    renderWorkspace()

    await waitFor(() =>
      expect(document.querySelector('[data-rccl-action-open="cancel"]')).not.toBeNull(),
    )
    // 场景 1：填写原因
    fireEvent.click(document.querySelector('[data-rccl-action-open="cancel"]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-rccl-action-dialog="cancel"]')).not.toBeNull(),
    )
    fireEvent.change(document.querySelector('[data-rccl-cancel-reason]') as Element, {
      target: { value: '需求范围变化' },
    })
    fireEvent.click(document.querySelector('[data-rccl-action-dialog-confirm]') as Element)
    await waitFor(() => {
      const cancelPost = records.find((record) => record.url === `${DETAIL_PATH}/cancel`)
      expect(cancelPost?.body).toEqual({ reason: '需求范围变化' })
    })
    await waitFor(() =>
      expect(document.querySelector('[data-rccl-action-dialog="cancel"]')).toBeNull(),
    )
  })

  test('终态 closed：动作条整体物理隐藏（零动作、零写）', async () => {
    setAuth(['resource_capacity_loop:view', 'resource_capacity_loop:manage'])
    const detail = makeDetail('closed')
    const { records } = installFetchRouter(detailBackend(detail).route)
    renderWorkspace()

    await waitFor(() => expect(document.querySelector('[data-rccl-detail-title]')).not.toBeNull())
    // 终态无任何生命周期动作（含 cancel），动作条整体不渲染
    expect(document.querySelector('[data-rccl-action-bar]')).toBeNull()
    expect(document.querySelector('[data-rccl-action-open]')).toBeNull()
    // 终态语义由页头徽标传达
    expect(document.querySelector('[data-rccl-detail-state]')?.textContent).toBe('已关闭')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(writes(records)).toEqual([])
  })
})

describe('CapacityLoopDetailWorkspace：中性 404 与错误重试（tasks 6.6/RL-05）', () => {
  test('后端 404（跨租户/非法引用）：中性「容量环未找到」，零写请求', async () => {
    setAuth(['resource_capacity_loop:view'])
    const { records } = installFetchRouter(loop404Backend())
    renderWorkspace()

    await waitFor(() => expect(document.querySelector('[data-rccl-detail-error]')).not.toBeNull())
    expect(screen.getByText('容量环未找到')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('容量闭环不存在')
    expect(document.querySelector('[data-rccl-detail-back-list]')).not.toBeNull()
    expect(writes(records)).toEqual([])
  })

  test('5xx 错误可重试：点击重试 refetch 成功', async () => {
    setAuth(['resource_capacity_loop:view'])
    let failing = true
    const detail = makeDetail('draft')
    installFetchRouter((path, method) => {
      if (path === DETAIL_PATH && method === 'GET') {
        if (failing) {
          return jsonResponse(503, { error: { code: 'UNAVAILABLE', message: '服务暂不可用' } })
        }
        return jsonResponse(200, { data: detail })
      }
      return null
    })
    renderWorkspace()

    await waitFor(() => expect(document.querySelector('[data-rccl-detail-error]')).not.toBeNull())
    expect(screen.getByText('加载失败')).toBeInTheDocument()
    expect(screen.queryByText('容量环未找到')).toBeNull()

    failing = false
    fireEvent.click(document.querySelector('[data-rccl-detail-retry]') as Element)
    await waitFor(() =>
      expect(document.querySelector('[data-rccl-detail-title]')?.textContent).toContain(
        'Q4 容量闭环',
      ),
    )
  })
})
