/**
 * v3-legacy-contract-debt-fixes W2 · tasks 2.4–2.6 —— RCCL 信封语义契约回归（D-C）。
 *
 * 伪后端（`vi.stubGlobal('fetch', …)`）按 `resource_capacity_loop_controller.ts` 的
 * **真实形状**应答，让 `fetch → apiFetch / apiFetchEnvelope → api client` 整条链路真实执行
 * （禁止 `vi.mock('@/lib/api/resource-capacity-loops')` 或 `@/lib/api-client` —— 那正是这批债
 * 长期存活的原因：mock 出来的形状把「信封被解掉一层」掩盖成了通过）。
 *
 * 断言重点：
 * ① `fetchRcclLoops` 结果保住信封——含 `data` 数组与顶层 `meta`（旧实现用 `apiFetch`，
 *   信封被解掉，列表页 `data?.data ?? []` 恒空、`data?.meta` 恒 `undefined`）；
 * ② `fetchRcclLoopDetail` 结果直接是 detail 实体（后端只返 `{ data: detail }` 单键），
 *   不再有 `data` 一层——旧详情页读 `data.data` 恒进错误分支；
 * ③ 写端点泛型逐个对齐后端 `{ data: … }` 单键：返回载荷本体而非信封；
 * ④ 4xx 不被吞成空信封。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createRcclLoop,
  fetchRcclLoopDetail,
  fetchRcclLoops,
  refreshRcclBaseline,
  type RcclLoopDetail,
  type RcclLoopListItem,
} from '@/lib/api/resource-capacity-loops'
import { useRcclLoops } from '@/hooks/use-resource-capacity-loops'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'

const ORGANIZATION_ID = 7
const LOOP_ID = 9
const LOOPS_PATH = `/organizations/${ORGANIZATION_ID}/resource-capacity-loops`
const DETAIL_PATH = `${LOOPS_PATH}/${LOOP_ID}`

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

/** 伪后端：只认目标路径（含 query 串）；未命中返回 500 而不是静默成功。 */
function installBackend(path: string, status: number, body: unknown) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push(url)
    if (!url.includes(path)) {
      return jsonResponse(500, { error: { code: 'UNMATCHED_TEST_ROUTE', message: url } })
    }
    void init
    return jsonResponse(status, body)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

/** 后端 `workbench.list()` 的单行投影（workbench_service.ts:58-72）。 */
function makeLoopRow(overrides: Partial<RcclLoopListItem> = {}): RcclLoopListItem {
  return {
    id: LOOP_ID,
    title: 'Q4 容量闭环',
    ownerUserId: 3,
    state: 'simulated',
    revision: 3,
    granularity: 'week',
    windowStart: '2026-09-01',
    windowEnd: '2026-11-30',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  }
}

const LIST_META = { total: 26, page: 2, perPage: 20, totalPages: 2 }

/** 后端 `workbench.detail()` 的返回体（controller `show` 包成 `{ data: detail }`）。 */
function makeDetail(): RcclLoopDetail {
  return {
    loop: {
      id: LOOP_ID,
      title: 'Q4 容量闭环',
      state: 'simulated',
      revision: 3,
      granularity: 'week',
      windowStart: '2026-09-01',
      windowEnd: '2026-11-30',
    },
    baseline: { id: 77, digest: 'fnv1a:abc123', readyForSimulation: true },
    scenarios: [{ id: 1, name: '情景一', revision: 2, active: true }],
    simulations: [{ id: 5, scenarioId: 1, digest: 'fnv1a:sim', staleState: 'current' }],
    currentSelection: null,
    receipts: [],
    observations: [],
    reviews: [],
    actionPosture: { writesApplied: false, confirmationRequired: true },
  }
}

beforeEach(() => {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'rccl-viewer@example.com',
      fullName: '容量闭环观察员',
      organizations: [
        { id: ORGANIZATION_ID, name: '北极星研发部', slug: 'northstar', role: 'member' },
      ],
    },
    accessToken: accessTokenWith(['resource_capacity_loop:view']),
    refreshToken: 'refresh-1',
    permissions: ['resource_capacity_loop:view'],
    currentOrganizationId: ORGANIZATION_ID,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ═══════════════════════════════════════════════════════════════════════════════
// ① 列表端点：信封保真（data 数组 + 顶层 meta）
// ═══════════════════════════════════════════════════════════════════════════════

describe('RCCL 列表：信封保真（design §3.1/§3.2）', () => {
  test('结果含 data 数组与顶层 meta（meta 不再丢失）', async () => {
    const row = makeLoopRow()
    const { calls } = installBackend(LOOPS_PATH, 200, { data: [row], meta: LIST_META })

    const result = await fetchRcclLoops(ORGANIZATION_ID, { state: 'simulated', page: 2 })

    expect(calls.some((url) => url.includes(`${LOOPS_PATH}?state=simulated&page=2`))).toBe(true)
    expect(result.data).toEqual([row])
    expect(result.meta).toEqual(LIST_META)
    // 类型收敛的锚点：结果就是 `{ data, meta }` 两个键（不多解也不少解一层）。
    expect(Object.keys(result).sort()).toEqual(['data', 'meta'])
  })

  test('空队列落地为空数组（不崩、不退化为 undefined）', async () => {
    installBackend(LOOPS_PATH, 200, {
      data: [],
      meta: { total: 0, page: 1, perPage: 20, totalPages: 0 },
    })

    const result = await fetchRcclLoops(ORGANIZATION_ID)

    expect(result.data).toEqual([])
    expect(result.meta.total).toBe(0)
  })

  test('4xx：抛可辨识错误，不被吞成空信封', async () => {
    installBackend(LOOPS_PATH, 404, {
      error: { code: 'RESOURCE_NOT_FOUND', message: '组织不可见' },
    })

    await expect(fetchRcclLoops(ORGANIZATION_ID)).rejects.toMatchObject({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ② 详情端点：结果直接是 detail 实体（单键 {data: detail} 解一层）
// ═══════════════════════════════════════════════════════════════════════════════

describe('RCCL 详情：结果即 detail 实体（design §3.2 第 2 条）', () => {
  test('fetchRcclLoopDetail 返回 detail 本体，不再有 data 一层', async () => {
    const detail = makeDetail()
    const { calls } = installBackend(DETAIL_PATH, 200, { data: detail })

    const result = await fetchRcclLoopDetail(ORGANIZATION_ID, LOOP_ID)

    expect(calls.some((url) => url.endsWith(DETAIL_PATH))).toBe(true)
    expect(result.loop.id).toBe(LOOP_ID)
    expect(result.loop.title).toBe(detail.loop.title)
    expect(Object.keys(result).sort()).toEqual(Object.keys(detail).sort())
    // 旧页面读的 `data.data` 不存在了：详情页必须按 `data.xxx` 读。
    expect((result as unknown as Record<string, unknown>).data).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ③ 写端点泛型逐个对齐后端 { data: … } 单键
// ═══════════════════════════════════════════════════════════════════════════════

describe('RCCL 写端点：泛型等于 data 内的载荷本体', () => {
  test('createRcclLoop 返回 { id, state, revision }（后端 controller#store 单键）', async () => {
    const { fetchMock } = installBackend(LOOPS_PATH, 201, {
      data: { id: 11, state: 'draft', revision: 1 },
    })

    const created = await createRcclLoop(ORGANIZATION_ID, {
      title: 'Q1 容量闭环',
      granularity: 'week',
      windowStart: '2027-01-01',
      windowEnd: '2027-03-31',
      projectIds: [3],
    })

    expect(created).toEqual({ id: 11, state: 'draft', revision: 1 })
    expect(created.id).toBe(11)
    const [, init] = fetchMock.mock.calls[0]!
    expect(init?.method).toBe('POST')
  })

  test('refreshRcclBaseline 返回显式降级载荷本体（后端 controller#refreshBaseline 单键）', async () => {
    const degraded = {
      refreshed: false,
      degradedReason: 'RCCL_SOURCE_REQUIRED_FAILED',
      detail: '基线刷新当前显式降级',
    }
    installBackend(`${DETAIL_PATH}/baseline-refresh`, 202, { data: degraded })

    const result = await refreshRcclBaseline(ORGANIZATION_ID, LOOP_ID)

    expect(result).toEqual(degraded)
    expect((result as unknown as Record<string, unknown>).data).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ④ 旧轨列表页读路径（data?.data / data?.meta）在真实链路上成立
// ═══════════════════════════════════════════════════════════════════════════════

function renderLoops() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  return renderHook(() => useRcclLoops({ state: 'simulated' }), { wrapper })
}

describe('RCCL 列表页读路径：hook → 页面（旧轨 page.tsx:100-101）', () => {
  test('hook 的 data 就是信封：页面 `data?.data` 有行、`data?.meta.total` 有值', async () => {
    const row = makeLoopRow()
    installBackend(LOOPS_PATH, 200, { data: [row], meta: LIST_META })

    const { result } = renderLoops()
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.data ?? []).toEqual([row])
    expect(result.current.data?.meta?.total).toBe(26)
  })
})
