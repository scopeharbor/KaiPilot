/**
 * v3-legacy-contract-debt-fixes W1 · tasks 1.3/1.4 —— 资源缺口族信封回归。
 *
 * 测试铁律（design §0.2）：**在 `global.fetch` 层设桩**，让
 * `fetch → apiFetch / apiFetchEnvelope → resourceGapApi → hook` 整条链路真实执行；
 * **禁止** `vi.mock('@/lib/api/resource-gap-analysis')`——既有 next-org-gaps-* 测试
 * 就是这么写的（mock 掉的 api 返回信封形态，于是 hook 的二次解包在测试里恰好是对的），
 * 那正是这条债长期存活的温床。
 *
 * 覆盖（design §1.2 修法 + §1.5 四项）：
 * 1. 数据真正落地：伪后端按后端真实形状 `{ data: 载荷 }` 应答（`resource_gap_analysis_controller.ts`
 *    的 summary / explanation / drill-down 三处 `ctx.response.ok({ data: result })`）→
 *    hook 的 `data` 深等于业务载荷本体，不是 `undefined`、也不带信封层；
 * 2. 三态（RL-06）：空数据 → 空载荷而非 `undefined`；4xx / 5xx → `isError` 为真且
 *    `error.status` 可读，错误不得被吞成空态；
 * 3. 对照组：`by-role` 走 `apiFetchEnvelope`（后端 `{ data: gaps, meta, warnings }`），
 *    `meta` 不得丢失。
 */
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useResourceGapByRole,
  useResourceGapDrillDown,
  useResourceGapExplanation,
  useResourceGapSummary,
} from '@/hooks/use-resource-gap-analysis'
import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'
import type { ApiError } from '@/lib/api-client'
import {
  RESOURCE_GAP_ANALYSIS_METRIC_VERSION,
  type ResourceGapDrillDownResponse,
  type ResourceGapEntry,
  type ResourceGapExplanation,
  type ResourceGapMeta,
  type ResourceGapSummary,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 伪后端（fetch 桩）
// ---------------------------------------------------------------------------

const ORG_ID = 7
const GAP_ID = 'gap-role-backend'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

const forbiddenResponse = () =>
  jsonResponse(403, { error: { code: 'PERMISSION_DENIED', message: '权限不足' } })
const serverErrorResponse = () =>
  jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: '服务异常' } })

type RouteKey = 'summary' | 'byRole' | 'explanation' | 'drillDown'

/** 按端点后缀分发；未设桩的请求直接以 reject 暴露（防止测试静默跑空）。 */
function installFetch(responders: Partial<Record<RouteKey, () => Response>>) {
  const routes: Array<[RouteKey, string]> = [
    ['summary', '/resource-gaps/summary'],
    ['byRole', '/resource-gaps/by-role'],
    ['explanation', '/resource-gaps/explanation'],
    ['drillDown', '/resource-gaps/drill-down'],
  ]
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    for (const [key, needle] of routes) {
      const responder = responders[key]
      if (responder && url.includes(needle)) return Promise.resolve(responder())
    }
    return Promise.reject(new Error(`未设桩的资源缺口请求：${url}`))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// ---------------------------------------------------------------------------
// 后端真实形状的载荷
// ---------------------------------------------------------------------------

function gapMeta(): ResourceGapMeta {
  return {
    calculatedAt: '2026-09-01T00:00:00.000Z',
    metricVersion: RESOURCE_GAP_ANALYSIS_METRIC_VERSION,
    organizationId: ORG_ID,
    actorId: 1,
    querySignatureHash: 'a1b2c3d4',
    visibleProjectCount: 2,
    visibleResourceCount: 5,
    dateWindow: { from: '2026-06-08', to: '2026-09-01' },
    upstreamAvailability: {
      demandForecasting: true,
      contentionDetection: true,
      skillMatrix: true,
      resourcePool: true,
    },
    sourceFreshness: { allocation: '2026-09-01T00:00:00.000Z' },
  }
}

function gapEntry(overrides: Partial<ResourceGapEntry> = {}): ResourceGapEntry {
  return {
    gapId: GAP_ID,
    dimension: 'role',
    dimensionValue: 'backend',
    dimensionLabel: '后端工程师',
    metric: 'allocated_vs_demand',
    severity: 'critical',
    demandHours: 320,
    supplyHours: 240,
    gapHours: 80,
    gapRatio: 0.25,
    dateWindow: { from: '2026-06-08', to: '2026-09-01' },
    reasons: [
      {
        code: 'NO_CANDIDATE_RESOURCE',
        label: '无候选资源',
        priority: 0,
        evidenceRefs: [],
        explanation: '组织中不存在具有所需技能的资源',
      },
    ],
    warnings: [],
    redacted: false,
    ...overrides,
  }
}

function gapSummary(): ResourceGapSummary {
  return {
    meta: gapMeta(),
    totalGaps: 3,
    severityDistribution: { critical: 1, high: 1, medium: 1, low: 0, none: 0 },
    metricDistribution: {
      allocated_vs_demand: 3,
      available_vs_demand: 0,
      skill_shortfall: 0,
      forecast_gap: 0,
    },
    dimensionDistribution: {
      role: 1,
      skill: 1,
      timeBucket: 0,
      project: 1,
      portfolio: 0,
      organization: 0,
    },
    totalDemandHours: 320,
    totalSupplyHours: 240,
    totalGapHours: 80,
    averageGapRatio: 0.25,
    topGaps: [gapEntry()],
    warnings: [],
  }
}

function emptySummary(): ResourceGapSummary {
  return {
    ...gapSummary(),
    totalGaps: 0,
    severityDistribution: { critical: 0, high: 0, medium: 0, low: 0, none: 0 },
    metricDistribution: {
      allocated_vs_demand: 0,
      available_vs_demand: 0,
      skill_shortfall: 0,
      forecast_gap: 0,
    },
    dimensionDistribution: {
      role: 0,
      skill: 0,
      timeBucket: 0,
      project: 0,
      portfolio: 0,
      organization: 0,
    },
    totalDemandHours: 0,
    totalSupplyHours: 0,
    totalGapHours: 0,
    averageGapRatio: 0,
    topGaps: [],
  }
}

function gapExplanation(): ResourceGapExplanation {
  return {
    gapId: GAP_ID,
    ruleExplanation: '后端工程师需求 320h、供给 240h，缺口 80h。',
    aiExplanation: '建议先评估内部转岗可行性，再考虑外部招聘。',
    aiConfidence: 0.82,
    suggestedActions: [
      {
        actionType: 'reallocate',
        description: '从低优先级项目调配 1 名后端工程师',
        estimatedImpactHours: 40,
        targetRole: 'backend',
        targetSkill: null,
      },
    ],
    actionLinks: [
      {
        label: '去资源池查看候选资源',
        href: '/next/organization/resource-pool',
        targetCapability: 'resource-registry-and-allocation',
      },
    ],
    evidenceRefs: [
      {
        kind: 'allocation',
        sourceKey: 'allocation:12',
        targetIds: [12],
        hash: 'deadbeef',
        timestamp: '2026-09-01T00:00:00.000Z',
      },
    ],
    warnings: [],
  }
}

/** AI 不可用 / 低置信度：解释载荷本身仍必须落地，`aiExplanation` 为 null 是真值语义。 */
function gapExplanationWithoutAi(): ResourceGapExplanation {
  return { ...gapExplanation(), aiExplanation: null, aiConfidence: null, suggestedActions: [] }
}

function gapDrillDown(): ResourceGapDrillDownResponse {
  return {
    meta: gapMeta(),
    gapId: GAP_ID,
    items: [
      {
        itemId: 12,
        itemType: 'allocation',
        itemName: '项目甲 · 后端工程师',
        details: { hours: 120 },
        redacted: false,
      },
    ],
    sourceCapability: 'resource-registry-and-allocation',
    authorization: { authorized: true },
    warnings: [],
  }
}

/** 下钻空态：无权限或无可下钻条目时后端返回空 items（不是 undefined）。 */
function emptyDrillDown(): ResourceGapDrillDownResponse {
  return {
    ...gapDrillDown(),
    items: [],
    authorization: { authorized: false, reason: 'NO_VISIBLE_ITEMS' },
  }
}

/** by-role 维度端点：后端走信封（`{ data, meta, warnings }`）。 */
function byRoleEnvelope(entries: ResourceGapEntry[]) {
  return {
    data: entries,
    meta: { total: entries.length, page: 1, perPage: 20, totalPages: entries.length ? 1 : 0 },
    warnings: [],
  }
}

// ---------------------------------------------------------------------------
// 渲染脚手架
// ---------------------------------------------------------------------------

function renderGapHook<T>(hook: () => T) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  return renderHook(hook, { wrapper })
}

function apiError(error: unknown): ApiError {
  return error as ApiError
}

beforeEach(() => {
  useAuthStore.getState().setSession({
    user: { id: 1, email: 'pm@example.com', fullName: '甲', organizations: [] },
    accessToken: accessTokenWith(['resource:view'], { organizationId: ORG_ID }),
    refreshToken: 'refresh-1',
  })
})

afterEach(() => {
  // 不用 vi.restoreAllMocks()：它会清掉 setup.ts 里手工挂的 matchMedia 全局 mock。
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════
// useResourceGapSummary
// ═══════════════════════════════════════════════════════════════════════════

describe('useResourceGapSummary（信封）', () => {
  it('数据真正落地：data 深等于 summary 载荷本体，不带信封层', async () => {
    const summary = gapSummary()
    const fetchMock = installFetch({ summary: () => jsonResponse(200, { data: summary }) })

    const { result } = renderGapHook(() => useResourceGapSummary())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(summary)
    // 载荷本体没有 `data` 键：证明 hook 没有多解一层、也没把信封当载荷返回。
    expect(result.current.data).not.toHaveProperty('data')
    expect(result.current.data?.totalGaps).toBe(3)
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`/organizations/${ORG_ID}/resource-gaps/summary`)
  })

  it('空态：totalGaps 为 0、topGaps 为空数组，不塌成 undefined', async () => {
    installFetch({ summary: () => jsonResponse(200, { data: emptySummary() }) })

    const { result } = renderGapHook(() => useResourceGapSummary())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeDefined()
    expect(result.current.data?.totalGaps).toBe(0)
    expect(result.current.data?.topGaps).toEqual([])
    expect(result.current.isError).toBe(false)
  })

  it('4xx：403 是可辨识错误态，不被吞成空态', async () => {
    installFetch({ summary: forbiddenResponse })

    const { result } = renderGapHook(() => useResourceGapSummary())

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    expect(apiError(result.current.error).status).toBe(403)
    expect(apiError(result.current.error).code).toBe('PERMISSION_DENIED')
  })

  it('5xx：500 是可辨识错误态，不被吞成空态', async () => {
    installFetch({ summary: serverErrorResponse })

    const { result } = renderGapHook(() => useResourceGapSummary())

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    expect(apiError(result.current.error).status).toBe(500)
    expect(apiError(result.current.error).code).toBe('INTERNAL_ERROR')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// useResourceGapExplanation
// ═══════════════════════════════════════════════════════════════════════════

describe('useResourceGapExplanation（信封）', () => {
  it('数据真正落地：data 深等于 explanation 载荷本体', async () => {
    const explanation = gapExplanation()
    const fetchMock = installFetch({
      explanation: () => jsonResponse(200, { data: explanation }),
    })

    const { result } = renderGapHook(() => useResourceGapExplanation(GAP_ID, true))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(explanation)
    expect(result.current.data).not.toHaveProperty('data')
    expect(result.current.data?.ruleExplanation).toContain('缺口 80h')
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      '/resource-gaps/explanation?gapId=gap-role-backend',
    )
  })

  it('空态：AI 不可用时 aiExplanation 为 null，载荷本身仍落地', async () => {
    installFetch({ explanation: () => jsonResponse(200, { data: gapExplanationWithoutAi() }) })

    const { result } = renderGapHook(() => useResourceGapExplanation(GAP_ID))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeDefined()
    expect(result.current.data?.gapId).toBe(GAP_ID)
    expect(result.current.data?.aiExplanation).toBeNull()
    expect(result.current.data?.suggestedActions).toEqual([])
  })

  it('4xx：403 是可辨识错误态，不被吞成空态', async () => {
    installFetch({ explanation: forbiddenResponse })

    const { result } = renderGapHook(() => useResourceGapExplanation(GAP_ID, true))

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    expect(apiError(result.current.error).status).toBe(403)
  })

  it('5xx：500 是可辨识错误态，不被吞成空态', async () => {
    installFetch({ explanation: serverErrorResponse })

    const { result } = renderGapHook(() => useResourceGapExplanation(GAP_ID))

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    expect(apiError(result.current.error).status).toBe(500)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// useResourceGapDrillDown
// ═══════════════════════════════════════════════════════════════════════════

describe('useResourceGapDrillDown（信封）', () => {
  it('数据真正落地：data 深等于 drill-down 载荷本体', async () => {
    const drillDown = gapDrillDown()
    const fetchMock = installFetch({ drillDown: () => jsonResponse(200, { data: drillDown }) })

    const { result } = renderGapHook(() =>
      useResourceGapDrillDown(GAP_ID, 'resource-registry-and-allocation'),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(drillDown)
    expect(result.current.data).not.toHaveProperty('data')
    expect(result.current.data?.items).toHaveLength(1)
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      '/resource-gaps/drill-down?gapId=gap-role-backend',
    )
  })

  it('空态：items 为空数组且授权判定可读，不塌成 undefined', async () => {
    installFetch({ drillDown: () => jsonResponse(200, { data: emptyDrillDown() }) })

    const { result } = renderGapHook(() => useResourceGapDrillDown(GAP_ID))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeDefined()
    expect(result.current.data?.items).toEqual([])
    expect(result.current.data?.authorization.authorized).toBe(false)
  })

  it('4xx：403 是可辨识错误态，不被吞成空态', async () => {
    installFetch({ drillDown: forbiddenResponse })

    const { result } = renderGapHook(() => useResourceGapDrillDown(GAP_ID))

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    expect(apiError(result.current.error).status).toBe(403)
    expect(apiError(result.current.error).code).toBe('PERMISSION_DENIED')
  })

  it('5xx：500 是可辨识错误态，不被吞成空态', async () => {
    installFetch({ drillDown: serverErrorResponse })

    const { result } = renderGapHook(() => useResourceGapDrillDown(GAP_ID))

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    expect(apiError(result.current.error).status).toBe(500)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 对照组：by-role 走 apiFetchEnvelope，meta 不得丢失
// ═══════════════════════════════════════════════════════════════════════════

describe('useResourceGapByRole（信封保真对照组）', () => {
  it('信封原样返回：data 是条目数组且 meta.total 为数字', async () => {
    const entries = [
      gapEntry(),
      gapEntry({ gapId: 'gap-role-qa', dimensionValue: 'qa', dimensionLabel: '测试工程师' }),
    ]
    installFetch({ byRole: () => jsonResponse(200, byRoleEnvelope(entries)) })

    const { result } = renderGapHook(() => useResourceGapByRole())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(byRoleEnvelope(entries))
    expect(Array.isArray(result.current.data?.data)).toBe(true)
    expect(result.current.data?.data).toHaveLength(2)
    expect(typeof result.current.data?.meta.total).toBe('number')
    expect(result.current.data?.meta.total).toBe(2)
    // 后端同时返回 `warnings`（类型 ResourceGapEnvelope 未声明），信封必须原样保真。
    expect(result.current.data).toHaveProperty('warnings')
  })

  it('空态：data 为空数组且 meta.total 为 0，meta 不丢失', async () => {
    installFetch({ byRole: () => jsonResponse(200, byRoleEnvelope([])) })

    const { result } = renderGapHook(() => useResourceGapByRole())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeDefined()
    expect(result.current.data?.data).toEqual([])
    expect(result.current.data?.meta.total).toBe(0)
  })
})
