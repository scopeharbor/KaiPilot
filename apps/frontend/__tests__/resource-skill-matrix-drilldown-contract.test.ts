/**
 * v3-legacy-contract-debt-fixes W2 · tasks 2.1–2.3 —— 技能矩阵 drill-down 契约对齐回归。
 *
 * 伪后端（`vi.stubGlobal('fetch', …)`）按**后端真实形状**应答：
 * `resource_skill_matrix_controller#drillDown` 返回 `{ data: { items }, meta }` ——
 * `meta` 是 `data` 的**兄弟键**，顶层没有 `warnings`（警告挂在每个 item 上）。
 * 伪装后端让 `fetch → apiFetchEnvelope → api client → hook` 整条链路真实执行
 * （禁止 `vi.mock('@/lib/api/resource-skill-matrix')`，那正是这批债长期存活的原因）。
 *
 * 断言重点：
 * ① `fetchResourceSkillMatrixDrillDown` 结果同时含 `items` 与 `meta`
 *   （旧实现只 `return result.data`，`meta` 被整块丢弃）；
 * ② `meta` 来自信封顶层而不是 `data.meta`（防再次错位）；
 * ③ item 级 `warnings` 保持原样（顶层 `warnings` 已从类型删除 —— 后端不产出）；
 * ④ 空 `items` 不崩、4xx/5xx 不被吞成空态。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useResourceSkillMatrixDrillDown } from '@/hooks/use-resource-skill-matrix'
import { fetchResourceSkillMatrixDrillDown } from '@/lib/api/resource-skill-matrix'
import { useAuthStore } from '@/stores/auth-store'
import type { ApiError } from '@/lib/api-client'
import type { ResourceSkillMatrixDrillDownItem, ResourceSkillMatrixMeta } from '@aiproj/types'
import { accessTokenWith } from './_jwt-helper'

const ORGANIZATION_ID = 1
const DRILL_DOWN_PATH = `/organizations/${ORGANIZATION_ID}/resource-skill-matrix/drill-down`

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

/** 伪后端：按 URL 片段路由；未命中返回 500 而不是静默成功。 */
function installBackend(status: number, body: unknown) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push(url)
    if (!url.includes(DRILL_DOWN_PATH)) {
      return jsonResponse(500, { error: { code: 'UNMATCHED_TEST_ROUTE', message: url } })
    }
    return jsonResponse(status, body)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

/** react-query 默认把 error 收敛成 `Error`；这里显式还原成 api-client 的 `ApiError`。 */
function apiErrorOf(error: unknown): ApiError {
  return error as ApiError
}

/** 后端信封顶层的 `meta`（`result.meta`）。 */
function makeMeta(overrides: Partial<ResourceSkillMatrixMeta> = {}): ResourceSkillMatrixMeta {
  return {
    calculatedAt: '2026-09-01T08:00:00.000Z',
    metricVersion: '1.0.0',
    organizationId: ORGANIZATION_ID,
    actorId: 1,
    scope: 'organization',
    visibleProjectCount: 2,
    visibleResourceCount: 5,
    visibleRequirementCount: 4,
    visibleSkillCount: 3,
    dateWindow: { from: '2026-08-01', to: '2026-09-01' },
    sourceFreshness: [
      {
        source: 'project_resource',
        lastUpdatedAt: '2026-09-01T07:00:00.000Z',
        stale: false,
      },
    ],
    inputSignatureHash: 'sig-hash',
    ...overrides,
  }
}

function makeDrillDownItems(): ResourceSkillMatrixDrillDownItem[] {
  return [
    {
      itemId: 10,
      itemType: 'resource',
      itemName: '陈默',
      skillKey: 'react',
      details: { resourceId: 10, resourceName: '陈默', role: 'developer' },
      evidenceRefs: [
        {
          source: 'project_resource',
          refSeed: 'seed-1',
          valueSummary: '北极星项目资源登记',
          visibility: 'full',
          lastUpdatedAt: '2026-09-01T07:00:00.000Z',
        },
        {
          source: 'resource_pool',
          refSeed: 'seed-2',
          valueSummary: '',
          visibility: 'redacted',
          lastUpdatedAt: null,
        },
      ],
      warnings: [
        {
          code: 'STALE_RESOURCE_DATA',
          message: '资源数据超过新鲜度窗口',
          resourceId: 10,
          severity: 'info',
        },
      ],
    },
  ]
}

/** 后端真实响应体：`meta` 与 `data` 平级。 */
function makeBackendBody(items: ResourceSkillMatrixDrillDownItem[], meta: ResourceSkillMatrixMeta) {
  return { data: { items }, meta }
}

beforeEach(() => {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'skill-matrix-viewer@example.com',
      fullName: '技能矩阵观察员',
      organizations: [
        { id: ORGANIZATION_ID, name: '北极星研发部', slug: 'northstar', role: 'member' },
      ],
    },
    accessToken: accessTokenWith(['resource:view']),
    refreshToken: 'refresh-1',
    permissions: ['resource:view'],
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
// ① + ② items 与 meta 同时落地，且 meta 来自信封顶层
// ═══════════════════════════════════════════════════════════════════════════════

describe('技能矩阵 drill-down：信封解包契约（design §2.1/§2.2）', () => {
  test('结果同时含 items 与 meta（meta 不再被丢弃）', async () => {
    const items = makeDrillDownItems()
    const meta = makeMeta()
    const { calls } = installBackend(200, makeBackendBody(items, meta))

    const result = await fetchResourceSkillMatrixDrillDown(ORGANIZATION_ID, 'resource', 'react')

    expect(
      calls.some((url) => url.includes(`${DRILL_DOWN_PATH}?itemType=resource&skillKey=react`)),
    ).toBe(true)
    expect(result.items).toEqual(items)
    expect(result.meta).toEqual(meta)
    // 类型收敛的锚点：结果就是 `{ items, meta }` 两个键，顶层没有 `warnings`。
    expect(Object.keys(result).sort()).toEqual(['items', 'meta'])
  })

  test('meta 取自信封顶层而非 data.meta（防再次错位）', async () => {
    // data 内埋一个与顶层不同的 meta：只有读顶层才算对。
    const poisoned = makeMeta({ inputSignatureHash: 'inside-data', visibleSkillCount: 99 })
    const top = makeMeta({ inputSignatureHash: 'top-level', visibleSkillCount: 3 })
    installBackend(200, { data: { items: makeDrillDownItems(), meta: poisoned }, meta: top })

    const result = await fetchResourceSkillMatrixDrillDown(ORGANIZATION_ID, 'resource', 'react')

    expect(result.meta.inputSignatureHash).toBe('top-level')
    expect(result.meta.visibleSkillCount).toBe(3)
  })

  test('item 级 warnings 保持原样（顶层 warnings 已从契约删除）', async () => {
    const items = makeDrillDownItems()
    installBackend(200, makeBackendBody(items, makeMeta()))

    const result = await fetchResourceSkillMatrixDrillDown(ORGANIZATION_ID, 'resource', 'react')

    expect(result.items[0]!.warnings).toEqual(items[0]!.warnings)
    expect(result.items[0]!.warnings[0]!.code).toBe('STALE_RESOURCE_DATA')
    expect((result as unknown as Record<string, unknown>).warnings).toBeUndefined()
  })

  test('空 items 落地为空数组（不崩、不退化为 undefined）', async () => {
    installBackend(200, makeBackendBody([], makeMeta({ visibleResourceCount: 0 })))

    const result = await fetchResourceSkillMatrixDrillDown(ORGANIZATION_ID, 'resource', 'vue')

    expect(result.items).toEqual([])
    expect(result.meta.visibleResourceCount).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// ③ hook 链路 + 4xx / 5xx 不被吞成空态
// ═══════════════════════════════════════════════════════════════════════════════

function renderDrillDown() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  return renderHook(() => useResourceSkillMatrixDrillDown(ORGANIZATION_ID, 'resource', 'react'), {
    wrapper,
  })
}

describe('技能矩阵 drill-down：hook 链路与三态（RL-06）', () => {
  test('hook 的 data 就是 `{ items, meta }`（items 与 meta 都可用）', async () => {
    const items = makeDrillDownItems()
    const meta = makeMeta()
    installBackend(200, makeBackendBody(items, meta))

    const { result } = renderDrillDown()
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data!.items).toEqual(items)
    expect(result.current.data!.meta.inputSignatureHash).toBe('sig-hash')
  })

  test('4xx：落可辨识错误态，不退化为空态', async () => {
    installBackend(403, { error: { code: 'PERMISSION_DENIED', message: '无权下钻该维度' } })

    const { result } = renderDrillDown()
    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(apiErrorOf(result.current.error).status).toBe(403)
    expect(apiErrorOf(result.current.error).code).toBe('PERMISSION_DENIED')
    expect(result.current.data).toBeUndefined()
  })

  test('5xx：落可辨识错误态，不退化为空态', async () => {
    installBackend(500, { error: { code: 'INTERNAL_ERROR', message: 'boom' } })

    const { result } = renderDrillDown()
    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(apiErrorOf(result.current.error).status).toBe(500)
    expect(result.current.data).toBeUndefined()
  })
})
