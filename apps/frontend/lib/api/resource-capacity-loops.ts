import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'

/**
 * 资源容量闭环 API client（v3-resource-capacity-forecasting-closed-loop §8.1）。
 *
 * 组织 ID 显式带在路径上；query key 绑定 organization / loop / revision / filters。
 * 服务端态一律走 TanStack Query，不进入 Zustand。
 * 所有 mutation 姿态：writesApplied=false、confirmationRequired=true（下游二次确认）。
 */

// ─── 类型 ────────────────────────────────────────────────────────────────────

export interface RcclLoopListItem {
  id: number
  title: string
  ownerUserId: number
  state:
    | 'draft'
    | 'simulated'
    | 'selected'
    | 'handed-off'
    | 'observing'
    | 'reviewed'
    | 'closed'
    | 'cancelled'
  revision: number
  granularity: string
  windowStart: string
  windowEnd: string
  createdAt: string | null
  updatedAt: string | null
}

export interface RcclLoopListResponse {
  data: RcclLoopListItem[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface RcclLoopDetail {
  loop: {
    id: number
    title: string
    state: string
    revision: number
    granularity: string
    windowStart: string
    windowEnd: string
  }
  baseline: { id: number; digest: string; readyForSimulation: boolean } | null
  scenarios: Array<{ id: number; name: string; revision: number; active: boolean }>
  simulations: Array<{ id: number; scenarioId: number; digest: string; staleState: string }>
  currentSelection: {
    id: number
    scenarioId: number
    fingerprint: string
    expiresAt: string | null
  } | null
  receipts: Array<{ id: number; target: string; status: string }>
  observations: Array<{ id: number; comparable: boolean; status: string }>
  reviews: Array<{ id: number; outcome: string }>
  actionPosture: { writesApplied: false; confirmationRequired: true }
}

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const resourceCapacityLoopKeys = {
  all: ['organizations', 'resource-capacity-loops'] as const,
  list: (organizationId: number | null, filters?: Record<string, unknown>) =>
    [...resourceCapacityLoopKeys.all, organizationId ?? 'none', 'list', filters ?? {}] as const,
  detail: (organizationId: number | null, loopId: number | null) =>
    [
      ...resourceCapacityLoopKeys.all,
      organizationId ?? 'none',
      'detail',
      loopId ?? 'none',
    ] as const,
}

// ─── URL filter 序列化 ──────────────────────────────────────────────────────

export function serializeRcclUrlFilters(filters?: {
  state?: string
  page?: number
  perPage?: number
}): string {
  if (!filters) return ''
  const sp = new URLSearchParams()
  if (filters.state) sp.set('state', filters.state)
  if (filters.page && filters.page > 1) sp.set('page', String(filters.page))
  if (filters.perPage && filters.perPage !== 20) sp.set('perPage', String(filters.perPage))
  const qs = sp.toString()
  return qs ? '?' + qs : ''
}

export function parseRcclUrlFilters(params: Record<string, string | string[] | undefined>): {
  state?: string
  page?: number
} {
  const one = (key: string): string | undefined => {
    const v = params[key]
    return Array.isArray(v) ? v[0] : v
  }
  const out: { state?: string; page?: number } = {}
  const state = one('state')
  if (state) out.state = state
  const page = Number(one('page'))
  if (Number.isFinite(page) && page > 1) out.page = page
  return out
}

// ─── Fetchers ────────────────────────────────────────────────────────────────
//
// 信封语义（逐个对照后端 resource_capacity_loop_controller.ts）：
// - 列表 `GET /` 返 `{ data: […], meta: {…} }` → `apiFetchEnvelope`，信封保真，
//   调用方按 `.data` / `.meta` 读；
// - 详情与全部写端点均返 `{ data: … }` 单键 → `apiFetch<T>` 解一层，`T` 即 `data`
//   内的载荷本体（返回类型必须等于运行时值，调用方不得再解包）。

export async function fetchRcclLoops(
  organizationId: number,
  filters?: { state?: string; page?: number },
): Promise<RcclLoopListResponse> {
  const qs = serializeRcclUrlFilters(filters)
  return apiFetchEnvelope<RcclLoopListResponse>(
    `/organizations/${organizationId}/resource-capacity-loops${qs}`,
  )
}

export async function fetchRcclLoopDetail(
  organizationId: number,
  loopId: number,
): Promise<RcclLoopDetail> {
  return apiFetch<RcclLoopDetail>(
    `/organizations/${organizationId}/resource-capacity-loops/${loopId}`,
  )
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function createRcclLoop(
  organizationId: number,
  body: {
    title: string
    granularity: string
    windowStart: string
    windowEnd: string
    projectIds: number[]
  },
): Promise<{ id: number; state: string; revision: number }> {
  return post(`/organizations/${organizationId}/resource-capacity-loops`, body)
}

export async function createRcclScenario(
  organizationId: number,
  loopId: number,
  body: { name: string; overlays: unknown[]; expectedRevision: number },
): Promise<{ id: number; revision: number }> {
  return post(`/organizations/${organizationId}/resource-capacity-loops/${loopId}/scenarios`, body)
}

export async function simulateRcclLoop(
  organizationId: number,
  loopId: number,
  expectedRevision: number,
): Promise<{
  loopState: string
  loopRevision: number
  results: Array<{
    scenarioId: number
    simulationSnapshotId: number | null
    gapDeltaHours: number | null
    idempotentReuse: boolean
  }>
}> {
  return post(`/organizations/${organizationId}/resource-capacity-loops/${loopId}/simulate`, {
    expectedRevision,
  })
}

export async function selectRcclScenario(
  organizationId: number,
  loopId: number,
  body: {
    scenarioId: number
    simulationSnapshotId: number
    acknowledgedWarnings?: string[]
    actorType: 'human_user'
  },
): Promise<{
  selectionId: number
  fingerprint: string
  expiresAt: string
  replayed: boolean
  writesApplied: false
  confirmationRequired: true
}> {
  return post(`/organizations/${organizationId}/resource-capacity-loops/${loopId}/select`, body)
}

export async function handoffRcclSelection(
  organizationId: number,
  loopId: number,
  body: {
    target: string
    idempotencyKey: string
    requestedRefs: string[]
    authorizedVisibleRefIds: string[]
  },
): Promise<{
  receiptId: number
  status: string
  pendingRefId: string | null
  replayed: boolean
  writesApplied: false
  confirmationRequired: true
}> {
  return post(`/organizations/${organizationId}/resource-capacity-loops/${loopId}/handoff`, body)
}

export async function reviewRcclLoop(
  organizationId: number,
  loopId: number,
  body: {
    observationSnapshotId: number
    outcome: string
    boundedRationale: string
    acknowledgedWarnings?: string[]
  },
): Promise<{ reviewId: number; outcome: string }> {
  return post(`/organizations/${organizationId}/resource-capacity-loops/${loopId}/review`, body)
}

export async function refreshRcclBaseline(
  organizationId: number,
  loopId: number,
): Promise<{ refreshed: false; degradedReason: 'RCCL_SOURCE_REQUIRED_FAILED'; detail: string }> {
  return post(
    `/organizations/${organizationId}/resource-capacity-loops/${loopId}/baseline-refresh`,
    {},
  )
}

export async function closeRcclLoop(
  organizationId: number,
  loopId: number,
  body: { expectedRevision: number },
): Promise<{ state: string; revision: number }> {
  return post(`/organizations/${organizationId}/resource-capacity-loops/${loopId}/close`, body)
}

export async function cancelRcclLoop(
  organizationId: number,
  loopId: number,
  body: { reason?: string },
): Promise<{ state: string; revision: number }> {
  return post(`/organizations/${organizationId}/resource-capacity-loops/${loopId}/cancel`, body)
}
