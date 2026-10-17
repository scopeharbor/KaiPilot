/**
 * v3-legacy-contract-debt-fixes W1 · tasks 1.7/1.8 —— 跨项目调配族信封契约回归。
 *
 * 链路：`global.fetch` 伪后端（按 `cross_project_allocation_controller.ts` 的真实响应形状
 * 应答）→ `apiFetch` / `apiFetchEnvelope` → `lib/api/cross-project-resource-allocation` → hooks。
 * **禁止 `vi.mock` 替换 api client 模块**：那正是这批债长期存活的原因。
 *
 * 覆盖：
 * - `listDrafts` / `listCandidates` 走 `apiFetchEnvelope`：`data` 数组 + `meta` 保真；
 * - `getDraft` 与六个写路径走 `apiFetch<X>`：hook 不再二次解包，返回值即业务载荷本体；
 * - 旧轨 `Number(result.id)` 锚点（修复前 `result` 恒 `undefined` → `TypeError`）；
 * - 三态（RL-06）：空数据 → 空载荷而非 `undefined`；4xx/5xx → `isError` 且 `error.status` 可读。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import {
  useListCrossProjectAllocationDrafts,
  useCrossProjectAllocationDraft,
  useCrossProjectAllocationCandidates,
  useCreateCrossProjectAllocationDraft,
  useUpdateCrossProjectAllocationItems,
  usePreviewCrossProjectAllocationDraft,
  useConfirmCrossProjectAllocationDraft,
  useApplyCrossProjectAllocationDraft,
  useCancelCrossProjectAllocationDraft,
} from '@/hooks/use-cross-project-resource-allocation'
import type {
  CrossProjectAllocationApplyResult,
  CrossProjectAllocationCandidateResource,
  CrossProjectAllocationConfirmation,
  CrossProjectAllocationDraft,
  CrossProjectAllocationDraftDetail,
  CrossProjectAllocationDraftItem,
  CrossProjectAllocationPreview,
  CrossProjectAllocationQueryShape,
} from '@aiproj/types'

const API_PREFIX = 'http://localhost:3333/api/v1'
const BASE = '/organizations/1/cross-project-resource-allocations'

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------
function setAuth(organizationId: number | null = 1) {
  useAuthStore.setState({
    user: {
      id: 1,
      email: 'pm@example.com',
      fullName: '王启明',
      organizations: [{ id: 1, name: '北极星研发部', slug: 'northstar', role: 'project_manager' }],
    },
    accessToken: null,
    refreshToken: null,
    permissions: ['resource:view', 'resource:manage'],
    currentOrganizationId: organizationId,
    planTier: null,
    roleVersion: 0,
    isAuthenticated: true,
    hasHydrated: true,
    effectiveTenantContext: null,
    selectionEpoch: 0,
  })
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

// ---------------------------------------------------------------------------
// 夹具（后端真实形状）
// ---------------------------------------------------------------------------
const queryShape: CrossProjectAllocationQueryShape = {
  organizationId: 1,
  projectIds: [9],
  dateWindow: { from: '2026-09-01', to: '2026-11-30' },
  resourceTypes: [],
  roles: [],
  skillTags: [],
  departments: [],
  loadStatuses: [],
  conflictSeverities: [],
  draftStatuses: [],
  search: null,
  sort: 'created_at',
  sortDir: 'desc',
  page: 1,
  perPage: 20,
  topN: 10,
  freshnessThresholdMinutes: 60,
}

function makeDraft(
  overrides: Partial<CrossProjectAllocationDraft> = {},
): CrossProjectAllocationDraft {
  return {
    id: '2',
    organizationId: 1,
    status: 'draft',
    name: 'Q3 前端人力调配',
    queryShape,
    itemCount: 1,
    evidence: null,
    previewHash: null,
    previewExpiresAt: null,
    warnings: [],
    createdAt: '2026-09-01T02:00:00.000Z',
    updatedAt: '2026-09-01T02:00:00.000Z',
    ...overrides,
  }
}

function makeDraftItem(
  overrides: Partial<CrossProjectAllocationDraftItem> = {},
): CrossProjectAllocationDraftItem {
  return {
    id: 'i1',
    itemType: 'allocate',
    status: 'pending',
    demand: {
      id: 'd1',
      targetProjectId: 9,
      targetProjectName: '商城重构',
      targetTaskId: 51,
      targetTaskName: '订单列表重构',
      requiredSkillTags: ['React'],
      requiredHours: 120,
      requiredRole: '前端工程师',
      startDate: '2026-09-01',
      endDate: '2026-11-30',
      priority: 2,
      currentAllocationPercent: 0,
    },
    candidate: null,
    allocationPercent: 80,
    startDate: '2026-09-01',
    endDate: '2026-11-30',
    conflicts: [],
    source: 'rule',
    advisoryOnly: false,
    confirmationRequired: true,
    applied: false,
    createdAt: '2026-09-01T02:00:00.000Z',
    updatedAt: '2026-09-01T02:00:00.000Z',
    ...overrides,
  }
}

function makeDraftDetail(
  overrides: Partial<CrossProjectAllocationDraftDetail> = {},
): CrossProjectAllocationDraftDetail {
  return {
    ...makeDraft(),
    items: [makeDraftItem()],
    confirmation: null,
    applyResult: null,
    ...overrides,
  }
}

function makeCandidate(
  resourceId: number,
  resourceName: string,
): CrossProjectAllocationCandidateResource {
  return {
    resourceId,
    resourceName,
    redaction: 'visible',
    sourceProjectId: 10,
    sourceProjectName: '支付中台',
    remainingCapacityHours: 90,
    dailyCapacityHours: 8,
    skillTags: ['React', 'Go'],
    skillFitPercent: 85,
    availabilitySlots: [],
    unavailableDates: [],
    currentUtilizationPercent: 25,
    afterAllocationUtilizationPercent: null,
    pmoPriorityScore: null,
    source: 'rule',
    rationale: null,
  }
}

function makePreview(draftId: string): CrossProjectAllocationPreview {
  return {
    draftId,
    status: 'previewed',
    items: [makeDraftItem()],
    conflicts: [],
    affectedVisibleProjects: [{ projectId: 9, projectName: '商城重构', redaction: 'visible' }],
    evidence: {
      references: [],
      sourceSignatures: {},
      freshness: [],
      warnings: [],
      evidenceHash: 'ev-hash',
      computedAt: '2026-09-01T03:00:00.000Z',
    },
    previewHash: 'abc123def456',
    previewExpiresAt: '2026-09-30T00:00:00.000Z',
    warnings: [],
  }
}

function makeConfirmation(draftId: string): CrossProjectAllocationConfirmation {
  return {
    id: 'c1',
    draftId,
    actorId: 1,
    organizationId: 1,
    visibleTargetProjectIds: [9],
    itemIds: ['i1'],
    previewHash: 'abc123def456',
    queryShape,
    warnings: [],
    idempotencyKeyHash: 'hash',
    confirmedAt: '2026-09-01T04:00:00.000Z',
  }
}

function makeApplyResult(draftId: string): CrossProjectAllocationApplyResult {
  return {
    status: 'success',
    draftId,
    confirmationId: 'c1',
    itemResults: [
      {
        itemId: 'i1',
        status: 'applied',
        targetProjectId: 9,
        targetAllocationId: 501,
        errorCode: null,
      },
    ],
    idempotencyKeyHash: 'hash',
    appliedAt: '2026-09-01T05:00:00.000Z',
    warnings: [],
  }
}

// ---------------------------------------------------------------------------
// 伪后端（响应形状 = cross_project_allocation_controller.ts 单层包裹的真实形状：
// 单键端点为 `{data: X}`，分页端点 controller 直返 service 的 `{data, meta}`）
// ---------------------------------------------------------------------------
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  } as Response
}

function notFound(): Response {
  return jsonResponse(404, { error: { code: 'RESOURCE_NOT_FOUND', message: '草案不存在' } })
}

type RouteFn = (path: string, method: string, body: unknown) => Response | null

interface RecordedRequest {
  method: string
  path: string
  body: unknown
}

function installBackend(route: RouteFn): RecordedRequest[] {
  const records: RecordedRequest[] = []
  const fetchMock: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = rawUrl.replace(API_PREFIX, '')
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body ?? null)
    records.push({ method, path, body })
    return route(path, method, body) ?? notFound()
  }
  vi.stubGlobal('fetch', fetchMock)
  return records
}

interface BackendState {
  drafts: CrossProjectAllocationDraft[]
}

/** 标准伪后端：列表/候选为信封，详情/写端点为单键 `{data: X}`。 */
function createAllocationBackend(state: BackendState): RouteFn {
  return (path, method) => {
    if (method === 'GET' && (path === `${BASE}/drafts` || path.startsWith(`${BASE}/drafts?`))) {
      return jsonResponse(200, {
        data: state.drafts,
        meta: { total: state.drafts.length, page: 1, perPage: 20, totalPages: 1 },
      })
    }
    if (method === 'GET' && path.startsWith(`${BASE}/candidates`)) {
      const candidates = [makeCandidate(21, '孙全栈'), makeCandidate(22, '周数据')]
      return jsonResponse(200, {
        data: candidates,
        meta: { total: candidates.length, topN: 20, hasMore: false },
      })
    }
    const detailMatch =
      /^\/organizations\/1\/cross-project-resource-allocations\/drafts\/(\d+)$/.exec(path)
    if (method === 'GET' && detailMatch) {
      return jsonResponse(200, { data: makeDraftDetail({ id: detailMatch[1]! }) })
    }
    if (method === 'POST' && path === `${BASE}/drafts`) {
      return jsonResponse(201, { data: makeDraft({ id: '7' }) })
    }
    const itemsMatch =
      /^\/organizations\/1\/cross-project-resource-allocations\/drafts\/(\d+)\/items$/.exec(path)
    if (method === 'PUT' && itemsMatch) {
      return jsonResponse(200, { data: [makeDraftItem()] })
    }
    const actionMatch =
      /^\/organizations\/1\/cross-project-resource-allocations\/drafts\/(\d+)\/(preview|confirm|apply|cancel)$/.exec(
        path,
      )
    if (method === 'POST' && actionMatch) {
      const draftId = actionMatch[1]!
      if (actionMatch[2] === 'preview') return jsonResponse(200, { data: makePreview(draftId) })
      if (actionMatch[2] === 'confirm')
        return jsonResponse(200, { data: makeConfirmation(draftId) })
      if (actionMatch[2] === 'apply') return jsonResponse(200, { data: makeApplyResult(draftId) })
      return jsonResponse(200, { data: makeDraft({ id: draftId, status: 'cancelled' }) })
    }
    return null
  }
}

// ---------------------------------------------------------------------------

describe('跨项目调配族 hooks 信封契约（D-A）', () => {
  beforeEach(() => {
    setAuth(1)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  test('listDrafts：apiFetchEnvelope 保住 {data, meta}，meta.total 为数字', async () => {
    installBackend(
      createAllocationBackend({ drafts: [makeDraft({ id: '2' }), makeDraft({ id: '3' })] }),
    )

    const { result } = renderHook(() => useListCrossProjectAllocationDrafts(), {
      wrapper: makeWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // 数据真正落地：data 是数组本体，不是 undefined、不是裸数组
    expect(Array.isArray(result.current.data?.data)).toBe(true)
    expect(result.current.data?.data.map((draft) => draft.id)).toEqual(['2', '3'])
    // 信封保真：meta 未被 apiFetch 解掉
    expect(typeof result.current.data?.meta.total).toBe('number')
    expect(result.current.data?.meta.total).toBe(2)
  })

  test('getDraft：apiFetch 已解一层，hook 不再二次解包，data 直接是草案实体', async () => {
    installBackend(createAllocationBackend({ drafts: [] }))

    const { result } = renderHook(() => useCrossProjectAllocationDraft(2), {
      wrapper: makeWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(makeDraftDetail({ id: '2' }))
    expect(result.current.data?.items).toHaveLength(1)
    // 不是信封残壳
    expect(result.current.data?.name).toBe('Q3 前端人力调配')
  })

  test('listCandidates：信封保真，data 数组 + meta.total', async () => {
    installBackend(createAllocationBackend({ drafts: [] }))

    const { result } = renderHook(() => useCrossProjectAllocationCandidates(), {
      wrapper: makeWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data.map((item) => item.resourceId)).toEqual([21, 22])
    expect(result.current.data?.meta.total).toBe(2)
  })

  // ── 写路径：mutateAsync 返回值即业务载荷本体（恒 undefined 的旧行为回归锚点）────

  test('createDraft：mutateAsync 返回草案实体，旧轨 Number(result.id) 不再抛 TypeError', async () => {
    const records = installBackend(createAllocationBackend({ drafts: [] }))

    const { result } = renderHook(() => useCreateCrossProjectAllocationDraft(), {
      wrapper: makeWrapper(),
    })

    let selectedDraftId: number | null = null
    await act(async () => {
      const draft = await result.current.mutateAsync({
        name: '调配方案',
        projectIds: [],
        dateWindow: { from: '2026-09-01', to: '2026-11-30' },
      })
      // 旧轨 page.tsx:66 `setSelectedDraftId(Number(result.id))` 的原样写法
      selectedDraftId = Number(draft.id)
    })

    expect(selectedDraftId).toBe(7)
    expect(
      records.some((record) => record.method === 'POST' && record.path === `${BASE}/drafts`),
    ).toBe(true)
  })

  test('updateItems：mutateAsync 返回条目数组（逐项含 id）', async () => {
    installBackend(createAllocationBackend({ drafts: [] }))

    const { result } = renderHook(() => useUpdateCrossProjectAllocationItems(), {
      wrapper: makeWrapper(),
    })

    let itemIds: string[] = []
    await act(async () => {
      const items = await result.current.mutateAsync({ draftId: 2, body: { items: [] } })
      itemIds = items.map((item) => item.id)
    })

    expect(itemIds).toEqual(['i1'])
  })

  test('previewDraft：mutateAsync 返回预览载荷（含 draftId 与 previewHash）', async () => {
    installBackend(createAllocationBackend({ drafts: [] }))

    const { result } = renderHook(() => usePreviewCrossProjectAllocationDraft(), {
      wrapper: makeWrapper(),
    })

    let preview: CrossProjectAllocationPreview | null = null
    await act(async () => {
      preview = await result.current.mutateAsync(2)
    })

    expect(preview).not.toBeNull()
    expect(preview!.draftId).toBe('2')
    expect(preview!.previewHash).toBe('abc123def456')
  })

  test('confirmDraft：mutateAsync 返回确认快照（含 id）', async () => {
    installBackend(createAllocationBackend({ drafts: [] }))

    const { result } = renderHook(() => useConfirmCrossProjectAllocationDraft(), {
      wrapper: makeWrapper(),
    })

    let confirmationId: string | null = null
    await act(async () => {
      const confirmation = await result.current.mutateAsync({
        draftId: 2,
        body: { idempotencyKey: 'confirm-1' },
      })
      confirmationId = confirmation.id
    })

    expect(confirmationId).toBe('c1')
  })

  test('applyDraft：mutateAsync 返回应用结果（含 draftId 与 status）', async () => {
    installBackend(createAllocationBackend({ drafts: [] }))

    const { result } = renderHook(() => useApplyCrossProjectAllocationDraft(), {
      wrapper: makeWrapper(),
    })

    let applied: CrossProjectAllocationApplyResult | null = null
    await act(async () => {
      applied = await result.current.mutateAsync({
        draftId: 2,
        body: { idempotencyKey: 'apply-1' },
      })
    })

    expect(applied!.draftId).toBe('2')
    expect(applied!.status).toBe('success')
    expect(applied!.itemResults.map((item) => item.itemId)).toEqual(['i1'])
  })

  test('cancelDraft：mutateAsync 返回草案实体（含 id），旧轨 Number(result.id) 不再抛 TypeError', async () => {
    installBackend(createAllocationBackend({ drafts: [] }))

    const { result } = renderHook(() => useCancelCrossProjectAllocationDraft(), {
      wrapper: makeWrapper(),
    })

    let cancelledDraftId: number | null = null
    await act(async () => {
      const draft = await result.current.mutateAsync(2)
      cancelledDraftId = Number(draft.id)
    })

    expect(cancelledDraftId).toBe(2)
  })

  // ── 三态（RL-06）────────────────────────────────────────────────────────

  test('空数据：列表返回空数组载荷，不塌成 undefined', async () => {
    installBackend(createAllocationBackend({ drafts: [] }))

    const { result } = renderHook(() => useListCrossProjectAllocationDrafts(), {
      wrapper: makeWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data).toEqual([])
    expect(result.current.data?.meta.total).toBe(0)
    expect(result.current.isError).toBe(false)
  })

  test('4xx：403 不被吞成空态，isError 且 error.status 可读', async () => {
    installBackend(() =>
      jsonResponse(403, { error: { code: 'PERMISSION_DENIED', message: '无权查看跨项目调配' } }),
    )

    const { result } = renderHook(() => useListCrossProjectAllocationDrafts(), {
      wrapper: makeWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    expect((result.current.error as { status?: number } | null)?.status).toBe(403)
    expect((result.current.error as { code?: string } | null)?.code).toBe('PERMISSION_DENIED')
  })

  test('5xx：详情端点 500 上抛为错误态，不退化为空载荷', async () => {
    installBackend(() =>
      jsonResponse(500, { error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' } }),
    )

    const { result } = renderHook(() => useCrossProjectAllocationDraft(2), {
      wrapper: makeWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    expect((result.current.error as { status?: number } | null)?.status).toBe(500)
  })
})
