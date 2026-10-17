/**
 * v3-legacy-contract-debt-fixes W1 · tasks 1.2 —— 组织资源池族信封契约回归。
 *
 * 伪后端（`vi.stubGlobal('fetch', …)`）按**后端真实形状**应答，让
 * `fetch → apiFetch / apiFetchEnvelope → api client → hook` 整条链路真实执行
 * （禁止 `vi.mock('@/lib/api/organization-resource-pool')`，那正是这批债长期存活的原因）。
 *
 * 覆盖 design §1.5 前三项：
 * ① 数据真正落地：summary / skills / capacity 的 `result.current.data` 是业务载荷本体；
 * ② 信封保真：resources 的 `data.data` 为数组且 `data.meta.total` 为数字
 *   （`apiFetchEnvelope` 不得被改回 `apiFetch`）；
 * ③ 三态：空载荷不吞、4xx / 5xx 落 `isError` 且 `error.status` 可读（RL-06）。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  useOrganizationResourcePoolCapacity,
  useOrganizationResourcePoolResources,
  useOrganizationResourcePoolSkills,
  useOrganizationResourcePoolSummary,
} from '@/hooks/use-organization-resource-pool'
import { useAuthStore } from '@/stores/auth-store'
import type { ApiError } from '@/lib/api-client'
import { emptyOrganizationResourcePool, normalOrganizationResourcePool } from '@aiproj/types'
import type {
  OrganizationResourcePoolCapacityMatrix,
  OrganizationResourcePoolResourceRow,
  OrganizationResourcePoolSkillItem,
} from '@aiproj/types'

// ── 伪后端 ──────────────────────────────────────────────────────────────────

interface FakeRoute {
  status: number
  body: unknown
}

const ORGANIZATION_ID = 1

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

/** 按 URL 片段路由的伪后端；未命中路由返回 500 而不是静默成功。 */
function installBackend(routes: Record<string, FakeRoute>) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push(url)
    const matched = Object.keys(routes).find((fragment) => url.includes(fragment))
    if (!matched) {
      return jsonResponse(500, { error: { code: 'UNMATCHED_TEST_ROUTE', message: url } })
    }
    const route = routes[matched]!
    return jsonResponse(route.status, route.body)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

function installAllErrorBackend(status: number, code: string) {
  const body = { error: { code, message: '测试错误' } }
  return installBackend({
    '/resource-pool/summary': { status, body },
    '/resource-pool/skills': { status, body },
    '/resource-pool/capacity': { status, body },
    '/resource-pool/resources': { status, body },
  })
}

// ── 业务载荷（后端 `{ data: … }` 里那个 `…`） ────────────────────────────────

function makeSkillItems(): OrganizationResourcePoolSkillItem[] {
  return [
    {
      skill: 'typescript',
      resourceCount: 5,
      capacityHours: 1200,
      allocatedHours: 600,
      remainingHours: 600,
      demandCount: 2,
      gap: false,
      redacted: false,
    },
  ]
}

function makeCapacityMatrix(): OrganizationResourcePoolCapacityMatrix {
  return {
    from: '2026-01-01',
    to: '2026-03-31',
    rows: [
      {
        resourceId: 1,
        resourceName: '张三',
        role: 'developer',
        loadStatus: 'normal',
        totalCapacityHours: 480,
        totalAllocatedHours: 240,
        totalRemainingHours: 240,
        utilizationPercent: 50,
        redacted: false,
        cells: [
          {
            date: '2026-01-01',
            capacityHours: 8,
            allocatedHours: 4,
            remainingHours: 4,
            utilizationPercent: 50,
            loadStatus: 'normal',
            conflictFlags: [],
          },
        ],
      },
    ],
  }
}

function makeResourceRows(): OrganizationResourcePoolResourceRow[] {
  return [
    {
      resourceId: 1,
      resourceName: '张三',
      resourceType: 'human',
      role: 'developer',
      status: 'active',
      skillTags: ['typescript'],
      department: null,
      linkedUserId: null,
      projectCount: 2,
      totalCapacityHours: 240,
      totalAllocatedHours: 120,
      totalRemainingHours: 120,
      utilizationPercent: 50,
      loadStatus: 'normal',
      conflictFlags: [],
      freshness: null,
      target: null,
      redacted: false,
    },
  ]
}

const RESOURCES_META = { total: 1, page: 1, perPage: 20, totalPages: 1 }

function installHappyBackend() {
  return installBackend({
    '/resource-pool/summary': {
      status: 200,
      body: { data: normalOrganizationResourcePool },
    },
    '/resource-pool/skills': { status: 200, body: { data: makeSkillItems() } },
    '/resource-pool/capacity': { status: 200, body: { data: makeCapacityMatrix() } },
    '/resource-pool/resources': {
      status: 200,
      body: { data: makeResourceRows(), meta: RESOURCES_META },
    },
  })
}

// ── 会话与渲染 ──────────────────────────────────────────────────────────────

/** 走真实 `useCurrentOrganizationId`（读 auth store），不 mock hook 模块。 */
function setOrganizationContext(organizationId: number | null) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pool-viewer@example.com',
      fullName: '资源池观察员',
      organizations:
        organizationId === null
          ? []
          : [{ id: organizationId, name: '北极星研发部', slug: 'northstar', role: 'member' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions: ['resource:view'],
    currentOrganizationId: organizationId,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: organizationId !== null,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

/** 每次渲染一个新的 QueryClient：共用一个会让上一条用例的缓存污染下一条。 */
function renderPool<TResult>(callback: () => TResult) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  return renderHook(callback, { wrapper })
}

interface QuerySnapshot<TData> {
  isError: boolean
  error: unknown
  data: TData | undefined
}

async function expectErrorState<TData>(
  rendered: { result: { current: QuerySnapshot<TData> } },
  status: number,
  code: string,
) {
  await waitFor(() => {
    expect(rendered.result.current.isError).toBe(true)
  })
  expect((rendered.result.current.error as ApiError).status).toBe(status)
  expect((rendered.result.current.error as ApiError).code).toBe(code)
  // 错误不得被吞成空态：data 保持 undefined，而不是「像空数据那样的合法空载荷」。
  expect(rendered.result.current.data).toBeUndefined()
}

beforeEach(() => {
  setOrganizationContext(ORGANIZATION_ID)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ═══════════════════════════════════════════════════════════════════════════════
// ① 数据真正落地 + ② 信封保真
// ═══════════════════════════════════════════════════════════════════════════════

describe('组织资源池族：真实链路数据落地（design §1.5 ①②）', () => {
  test('summary：data 直接等于业务载荷本体（不是信封、不是 undefined）', async () => {
    const { calls } = installHappyBackend()
    const { result } = renderPool(() => useOrganizationResourcePoolSummary())

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(
      calls.some((url) => url.includes(`/organizations/${ORGANIZATION_ID}/resource-pool/summary`)),
    ).toBe(true)
    expect(result.current.data).toEqual(normalOrganizationResourcePool)
    expect(result.current.data!.resourceCount).toBe(normalOrganizationResourcePool.resourceCount)
  })

  test('skills：data 直接等于技能覆盖数组', async () => {
    installHappyBackend()
    const { result } = renderPool(() => useOrganizationResourcePoolSkills())

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toEqual(makeSkillItems())
    expect(result.current.data![0]!.skill).toBe('typescript')
  })

  test('capacity：data 直接等于容量矩阵', async () => {
    installHappyBackend()
    const { result } = renderPool(() => useOrganizationResourcePoolCapacity())

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toEqual(makeCapacityMatrix())
    expect(result.current.data!.rows[0]!.cells.length).toBe(1)
  })

  test('resources：信封保真，data.data 是数组且 data.meta.total 是数字', async () => {
    installHappyBackend()
    const { result } = renderPool(() => useOrganizationResourcePoolResources())

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toEqual({ data: makeResourceRows(), meta: RESOURCES_META })
    expect(Array.isArray(result.current.data!.data)).toBe(true)
    expect(typeof result.current.data!.meta.total).toBe('number')
    expect(result.current.data!.meta.total).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ③ 三态（空 / 4xx / 5xx）
// ═══════════════════════════════════════════════════════════════════════════════

describe('组织资源池族：三态不被吞（design §1.5 ③ / RL-06）', () => {
  test('空数据：空载荷而非 undefined', async () => {
    installBackend({
      '/resource-pool/summary': { status: 200, body: { data: emptyOrganizationResourcePool } },
      '/resource-pool/skills': { status: 200, body: { data: [] } },
      '/resource-pool/capacity': {
        status: 200,
        body: { data: { from: '2026-01-01', to: '2026-03-31', rows: [] } },
      },
      '/resource-pool/resources': {
        status: 200,
        body: { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } },
      },
    })

    const summary = renderPool(() => useOrganizationResourcePoolSummary())
    await waitFor(() => {
      expect(summary.result.current.isSuccess).toBe(true)
    })
    expect(summary.result.current.data).toEqual(emptyOrganizationResourcePool)
    expect(summary.result.current.data!.resourceCount).toBe(0)
    expect(
      summary.result.current.data!.warnings.some(
        (warning) => warning.code === 'EMPTY_ORGANIZATION_RESOURCE_POOL',
      ),
    ).toBe(true)

    const skills = renderPool(() => useOrganizationResourcePoolSkills())
    await waitFor(() => {
      expect(skills.result.current.isSuccess).toBe(true)
    })
    expect(skills.result.current.data).toEqual([])

    const capacity = renderPool(() => useOrganizationResourcePoolCapacity())
    await waitFor(() => {
      expect(capacity.result.current.isSuccess).toBe(true)
    })
    expect(capacity.result.current.data!.rows).toEqual([])

    const resources = renderPool(() => useOrganizationResourcePoolResources())
    await waitFor(() => {
      expect(resources.result.current.isSuccess).toBe(true)
    })
    expect(resources.result.current.data!.data).toEqual([])
    expect(resources.result.current.data!.meta.total).toBe(0)
  })

  test('4xx：四个端点都落可辨识错误态，不退化为空态', async () => {
    installAllErrorBackend(403, 'PERMISSION_DENIED')

    await expectErrorState(
      renderPool(() => useOrganizationResourcePoolSummary()),
      403,
      'PERMISSION_DENIED',
    )
    await expectErrorState(
      renderPool(() => useOrganizationResourcePoolSkills()),
      403,
      'PERMISSION_DENIED',
    )
    await expectErrorState(
      renderPool(() => useOrganizationResourcePoolCapacity()),
      403,
      'PERMISSION_DENIED',
    )
    await expectErrorState(
      renderPool(() => useOrganizationResourcePoolResources()),
      403,
      'PERMISSION_DENIED',
    )
  })

  test('5xx：四个端点都落可辨识错误态，不退化为空态', async () => {
    installAllErrorBackend(500, 'INTERNAL_ERROR')

    await expectErrorState(
      renderPool(() => useOrganizationResourcePoolSummary()),
      500,
      'INTERNAL_ERROR',
    )
    await expectErrorState(
      renderPool(() => useOrganizationResourcePoolSkills()),
      500,
      'INTERNAL_ERROR',
    )
    await expectErrorState(
      renderPool(() => useOrganizationResourcePoolCapacity()),
      500,
      'INTERNAL_ERROR',
    )
    await expectErrorState(
      renderPool(() => useOrganizationResourcePoolResources()),
      500,
      'INTERNAL_ERROR',
    )
  })
})
