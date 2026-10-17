/**
 * v3-legacy-contract-debt-fixes W1 · tasks 1.6 —— 资源争用族 hooks 信封契约回归（D-A §1.3）。
 *
 * 全程在 `global.fetch` 层设桩（伪后端按后端真实形状应答），让
 * `fetch → apiFetch → resourceContentionApi → hook` 整条链路真实执行；
 * **禁止**用 `vi.mock('@/lib/api/resource-contentions')` 复现解包行为（design §0.2：
 * 整体 mock 掉 api 模块正是这批债长期存活的原因）。
 *
 * 覆盖：
 * - summary / matrix / detail / evidence / suggestions 五件「数据真正落地」
 *   （`data` 深等于业务载荷本体，既不是 `undefined` 也不是信封）；
 * - 空态落地为空载荷而非 `undefined`；
 * - 4xx/5xx 为可辨识错误态（`isError` + `error.status` 可读），**证据端点 403 不得退化为空态**（RL-06）；
 * - 对照组：同族分页端点 `items` 仍走 `apiFetchEnvelope`，`data` 数组与 `meta.total` 保真。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import {
  useResourceContentionDetail,
  useResourceContentionEvidence,
  useResourceContentionItems,
  useResourceContentionMatrix,
  useResourceContentionSuggestions,
  useResourceContentionSummary,
} from '@/hooks/use-resource-contention-detection'
import {
  RESOURCE_CONTENTION_METRIC_VERSION,
  emptyReasonCounts,
  emptySeverityCounts,
  makeResourceContentionFreshness,
  type ResourceContentionEvidence,
  type ResourceContentionItem,
  type ResourceContentionMatrix,
  type ResourceContentionSuggestionPreview,
  type ResourceContentionSummary,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 伪后端（global.fetch 层设桩）
// ---------------------------------------------------------------------------
const API_PREFIX = 'http://localhost:3333/api/v1'
const ORG_ID = 1
const CONTENTIONS_PATH = `/organizations/${ORG_ID}/resource-contentions`

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

/** 按精确路径应答的后端真实形状；未命中的路径一律 404（防「测试打错端点也通过」）。 */
function installBackend(routes: Record<string, Response>): { urls: string[] } {
  const urls: string[] = []
  const fetchMock: typeof fetch = async (input) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = rawUrl.replace(API_PREFIX, '')
    urls.push(path)
    return (
      routes[path] ??
      jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: `未匹配 ${path}` } })
    )
  }
  vi.stubGlobal('fetch', fetchMock)
  return { urls }
}

/** `apiFetch` 抛的是 `ApiError`（非 Error 实例），按低敏字段读取。 */
function readApiError(error: unknown): { status?: number; code?: string } {
  return (error ?? {}) as { status?: number; code?: string }
}

// ---------------------------------------------------------------------------
// 夹具（后端真实形状）
// ---------------------------------------------------------------------------
function makeSummary(
  overrides: Partial<ResourceContentionSummary> = {},
): ResourceContentionSummary {
  return {
    meta: {
      calculatedAt: '2026-09-10T00:00:00.000Z',
      metricVersion: RESOURCE_CONTENTION_METRIC_VERSION,
      organizationId: ORG_ID,
      actorId: 1,
      visibleProjectCount: 2,
      visibleResourceCount: 2,
      querySignatureHash: 'query-sig',
      sourceSignatureHash: 'source-sig',
    },
    severityCounts: { ...emptySeverityCounts(), critical: 1, high: 1 },
    reasonCounts: {
      ...emptyReasonCounts(),
      'cross-project-overload': 1,
      'unavailable-allocation': 1,
    },
    affectedProjectCount: 2,
    affectedResourceCount: 2,
    totalContentions: 2,
    sourceFreshness: [
      makeResourceContentionFreshness({
        source: 'resource_allocation',
        lastUpdatedAt: '2026-09-09T00:00:00.000Z',
      }),
    ],
    warnings: [],
    evidenceHashes: ['evidence-hash-1', 'evidence-hash-2'],
    ...overrides,
  }
}

function makeItem(overrides: Partial<ResourceContentionItem> = {}): ResourceContentionItem {
  return {
    contentionId: 'ctn-1',
    severity: 'critical',
    reasonCode: 'cross-project-overload',
    resourceId: 7,
    resourceName: '张工',
    projectIds: [1, 2],
    projectNames: ['商城重构', '中台迁移'],
    taskId: null,
    allocationId: null,
    from: '2026-09-01',
    to: '2026-09-14',
    loadPercent: 145,
    affectedDateBuckets: null,
    description: '同期跨项目超配',
    remediationHint: '下调跨项目分配比例',
    evidenceHash: 'evidence-hash-1',
    target: null,
    redactionState: 'visible',
    createdAt: '2026-09-10T00:00:00.000Z',
    ...overrides,
  }
}

function makeMatrix(overrides: Partial<ResourceContentionMatrix> = {}): ResourceContentionMatrix {
  return {
    from: '2026-09-01',
    to: '2026-09-14',
    rows: [
      {
        resourceId: 7,
        resourceName: '张工',
        role: '前端',
        totalContentions: 1,
        maxSeverity: 'critical',
        cells: [
          {
            date: '2026-09-01',
            severity: 'critical',
            reasonCode: 'cross-project-overload',
            loadPercent: 145,
            contentionCount: 1,
            redactionState: 'visible',
            drillDownTarget: null,
          },
        ],
        redactionState: 'visible',
      },
    ],
    ...overrides,
  }
}

function makeEvidence(): ResourceContentionEvidence {
  return {
    evidenceHash: 'evidence-hash-1',
    source: 'resource_allocation',
    lastUpdatedAt: '2026-09-09T00:00:00.000Z',
    metricKeys: ['load_percent', 'allocation_hours'],
    isLowSensitive: true,
  }
}

function makeSuggestion(): ResourceContentionSuggestionPreview {
  return {
    suggestionId: 'sug-1',
    contentionId: 'ctn-1',
    kind: 'rule',
    title: '下调跨项目分配比例',
    description: '把「中台迁移」的同期投入从 60% 降到 40%',
    candidateActions: ['reduce-allocation'],
    isAdvisory: true,
    redactionState: 'visible',
    createdAt: '2026-09-10T00:00:00.000Z',
  }
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------
let client: QueryClient
let wrapper: ({ children }: { children: ReactNode }) => React.JSX.Element

beforeEach(() => {
  useAuthStore.setState({ currentOrganizationId: ORG_ID, accessToken: 'contention-test-token' })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  client.clear()
})

// ---------------------------------------------------------------------------

describe('资源争用族 hooks：数据真正落地（D-A §1.3 / tasks 1.5）', () => {
  test('summary：`data` 深等于摘要载荷本体（非 undefined、非信封）', async () => {
    const summary = makeSummary()
    const { urls } = installBackend({
      [`${CONTENTIONS_PATH}/summary`]: jsonResponse(200, { data: summary }),
    })

    const query = renderHook(() => useResourceContentionSummary(), { wrapper })
    await waitFor(() => expect(query.result.current.isSuccess).toBe(true))

    expect(urls).toEqual([`${CONTENTIONS_PATH}/summary`])
    expect(query.result.current.data).toEqual(summary)
    expect(query.result.current.data).not.toHaveProperty('data')
    expect(query.result.current.data?.totalContentions).toBe(2)
  })

  test('matrix：`data` 深等于矩阵载荷本体', async () => {
    const matrix = makeMatrix()
    const { urls } = installBackend({
      [`${CONTENTIONS_PATH}/matrix`]: jsonResponse(200, { data: matrix }),
    })

    const query = renderHook(() => useResourceContentionMatrix(), { wrapper })
    await waitFor(() => expect(query.result.current.isSuccess).toBe(true))

    expect(urls).toEqual([`${CONTENTIONS_PATH}/matrix`])
    expect(query.result.current.data).toEqual(matrix)
    expect(query.result.current.data).not.toHaveProperty('data')
    expect(query.result.current.data?.rows).toHaveLength(1)
  })

  test('detail：`data` 深等于争用条目实体', async () => {
    const item = makeItem()
    const { urls } = installBackend({
      [`${CONTENTIONS_PATH}/ctn-1`]: jsonResponse(200, { data: item }),
    })

    const query = renderHook(() => useResourceContentionDetail('ctn-1'), { wrapper })
    await waitFor(() => expect(query.result.current.isSuccess).toBe(true))

    expect(urls).toEqual([`${CONTENTIONS_PATH}/ctn-1`])
    expect(query.result.current.data).toEqual(item)
    expect(query.result.current.data?.contentionId).toBe('ctn-1')
  })

  test('evidence：`data` 深等于低敏证据实体', async () => {
    const evidence = makeEvidence()
    const { urls } = installBackend({
      [`${CONTENTIONS_PATH}/ctn-1/evidence`]: jsonResponse(200, { data: evidence }),
    })

    const query = renderHook(() => useResourceContentionEvidence('ctn-1'), { wrapper })
    await waitFor(() => expect(query.result.current.isSuccess).toBe(true))

    expect(urls).toEqual([`${CONTENTIONS_PATH}/ctn-1/evidence`])
    expect(query.result.current.data).toEqual(evidence)
    expect(query.result.current.data?.isLowSensitive).toBe(true)
  })

  test('suggestions：`data` 深等于建议预览数组（kind 落查询串）', async () => {
    const suggestions = [makeSuggestion()]
    const suggestionsPath = `${CONTENTIONS_PATH}/ctn-1/suggestions?kind=rule`
    const { urls } = installBackend({ [suggestionsPath]: jsonResponse(200, { data: suggestions }) })

    const query = renderHook(() => useResourceContentionSuggestions('ctn-1'), { wrapper })
    await waitFor(() => expect(query.result.current.isSuccess).toBe(true))

    expect(urls).toEqual([suggestionsPath])
    expect(query.result.current.data).toEqual(suggestions)
    expect(query.result.current.data).not.toHaveProperty('data')
    expect(query.result.current.data?.[0]?.isAdvisory).toBe(true)
  })
})

describe('资源争用族 hooks：三态（RL-06：错误不得被吞成空态）', () => {
  test('空态：矩阵零行与建议空数组落地为空载荷而非 undefined', async () => {
    const emptyMatrix = makeMatrix({ rows: [] })
    const { urls } = installBackend({
      [`${CONTENTIONS_PATH}/matrix`]: jsonResponse(200, { data: emptyMatrix }),
      [`${CONTENTIONS_PATH}/ctn-1/suggestions?kind=rule`]: jsonResponse(200, { data: [] }),
    })

    const matrix = renderHook(() => useResourceContentionMatrix(), { wrapper })
    await waitFor(() => expect(matrix.result.current.isSuccess).toBe(true))
    expect(matrix.result.current.data).toEqual(emptyMatrix)
    expect(matrix.result.current.data?.rows).toEqual([])
    expect(matrix.result.current.isError).toBe(false)

    const suggestions = renderHook(() => useResourceContentionSuggestions('ctn-1'), { wrapper })
    await waitFor(() => expect(suggestions.result.current.isSuccess).toBe(true))
    expect(suggestions.result.current.data).toEqual([])
    expect(suggestions.result.current.isError).toBe(false)

    expect(urls).toHaveLength(2)
  })

  test('evidence 403：可辨识错误态，不得退化为空态（RL-06）', async () => {
    installBackend({
      [`${CONTENTIONS_PATH}/ctn-1/evidence`]: jsonResponse(403, {
        error: { code: 'PERMISSION_DENIED', message: '无证据查看权限' },
      }),
    })

    const query = renderHook(() => useResourceContentionEvidence('ctn-1'), { wrapper })
    await waitFor(() => expect(query.result.current.isError).toBe(true))

    const error = readApiError(query.result.current.error)
    expect(error.status).toBe(403)
    expect(error.code).toBe('PERMISSION_DENIED')
    expect(query.result.current.isSuccess).toBe(false)
    expect(query.result.current.data).toBeUndefined()
  })

  test('detail 404：中性未找到为错误态且 status 可读', async () => {
    installBackend({
      [`${CONTENTIONS_PATH}/ctn-missing`]: jsonResponse(404, {
        error: { code: 'RESOURCE_NOT_FOUND', message: '未找到' },
      }),
    })

    const query = renderHook(() => useResourceContentionDetail('ctn-missing'), { wrapper })
    await waitFor(() => expect(query.result.current.isError).toBe(true))

    const error = readApiError(query.result.current.error)
    expect(error.status).toBe(404)
    expect(error.code).toBe('RESOURCE_NOT_FOUND')
    expect(query.result.current.isSuccess).toBe(false)
    expect(query.result.current.data).toBeUndefined()
  })

  test('summary 5xx：错误态且 status 可读，不被吞成空态', async () => {
    installBackend({
      [`${CONTENTIONS_PATH}/summary`]: jsonResponse(500, {
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'boom' },
      }),
    })

    const query = renderHook(() => useResourceContentionSummary(), { wrapper })
    await waitFor(() => expect(query.result.current.isError).toBe(true))

    expect(readApiError(query.result.current.error).status).toBe(500)
    expect(query.result.current.isSuccess).toBe(false)
    expect(query.result.current.data).toBeUndefined()
  })
})

describe('资源争用族 hooks：分页端点信封保真（对照组）', () => {
  test('items 仍走 apiFetchEnvelope，`data` 数组与 `meta.total` 未丢失', async () => {
    const items = [makeItem()]
    installBackend({
      [`${CONTENTIONS_PATH}/items`]: jsonResponse(200, {
        data: items,
        meta: { total: 7, page: 1, perPage: 20, totalPages: 1 },
      }),
    })

    const query = renderHook(() => useResourceContentionItems(), { wrapper })
    await waitFor(() => expect(query.result.current.isSuccess).toBe(true))

    expect(query.result.current.data?.data).toEqual(items)
    expect(typeof query.result.current.data?.meta.total).toBe('number')
    expect(query.result.current.data?.meta.total).toBe(7)
  })
})
