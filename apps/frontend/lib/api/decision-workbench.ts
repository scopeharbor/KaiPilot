import { apiFetchEnvelope } from '@/lib/api-client'
import type {
  PmoDecisionCaseDTO,
  PmoDecisionCaseListQuery,
  PmoDecisionCaseStatus,
  PmoDecisionComparisonCell,
  PmoDecisionEvidenceSnapshotSummary,
  PmoDecisionHandoffReceiptDTO,
  PmoDecisionOptionDTO,
  PmoDecisionOutcomeAction,
  PmoDecisionOutcomeDTO,
  PmoDecisionPaginationMeta,
  PmoDecisionPositionDTO,
  PmoDecisionReadinessPacket,
} from '@aiproj/types'

/**
 * PMO 决策工作台 API client（v3-pmo-decision-intelligence-workbench §5.10.1）。
 *
 * 红线：不持有任何 apply/confirm handle——handoff 只携带 pending 下游引用；
 * 组织 ID 显式带在路径上；query key 绑定 organization/case/filter/revision，
 * mutation 后精确失效。
 */

// ─── Query Keys ────────────────────────────────────────────────────────────────

export const decisionWorkbenchKeys = {
  all: ['organizations', 'pmo', 'decision-workbench'] as const,
  cases: (organizationId: number | null, query?: PmoDecisionCaseListQuery) =>
    [...decisionWorkbenchKeys.all, organizationId ?? 'none', 'cases', query ?? {}] as const,
  caseDetail: (organizationId: number | null, decisionId: number | null) =>
    [...decisionWorkbenchKeys.all, organizationId ?? 'none', 'case', decisionId ?? 'none'] as const,
  options: (organizationId: number | null, decisionId: number | null) =>
    [
      ...decisionWorkbenchKeys.all,
      organizationId ?? 'none',
      'options',
      decisionId ?? 'none',
    ] as const,
  positions: (organizationId: number | null, decisionId: number | null) =>
    [
      ...decisionWorkbenchKeys.all,
      organizationId ?? 'none',
      'positions',
      decisionId ?? 'none',
    ] as const,
  snapshots: (organizationId: number | null, decisionId: number | null) =>
    [
      ...decisionWorkbenchKeys.all,
      organizationId ?? 'none',
      'snapshots',
      decisionId ?? 'none',
    ] as const,
  comparison: (organizationId: number | null, decisionId: number | null, revision: number | null) =>
    [
      ...decisionWorkbenchKeys.all,
      organizationId ?? 'none',
      'comparison',
      decisionId ?? 'none',
      revision ?? 0,
    ] as const,
  outcomes: (organizationId: number | null, decisionId: number | null) =>
    [
      ...decisionWorkbenchKeys.all,
      organizationId ?? 'none',
      'outcomes',
      decisionId ?? 'none',
    ] as const,
  handoffs: (organizationId: number | null, decisionId: number | null) =>
    [
      ...decisionWorkbenchKeys.all,
      organizationId ?? 'none',
      'handoffs',
      decisionId ?? 'none',
    ] as const,
}

// ─── URL filter 序列化 ────────────────────────────────────────────────────────

export function serializeDecisionUrlFilters(query?: PmoDecisionCaseListQuery): string {
  if (!query) return ''
  const sp = new URLSearchParams()
  const statuses =
    query.status === undefined ? [] : Array.isArray(query.status) ? query.status : [query.status]
  if (statuses.length) sp.set('status', statuses.join(','))
  const owners =
    query.ownerId === undefined
      ? []
      : Array.isArray(query.ownerId)
        ? query.ownerId
        : [query.ownerId]
  if (owners.length) sp.set('ownerId', owners.join(','))
  if (query.attention) sp.set('attention', 'true')
  if (query.page && query.page > 1) sp.set('page', String(query.page))
  if (query.perPage) sp.set('perPage', String(query.perPage))
  if (query.sort) sp.set('sort', query.sort)
  if (query.order) sp.set('order', query.order)
  const qs = sp.toString()
  return qs ? '?' + qs : ''
}

export function parseDecisionUrlFilters(
  params: Record<string, string | string[] | undefined>,
): PmoDecisionCaseListQuery {
  const one = (key: string): string | undefined => {
    const value = params[key]
    return Array.isArray(value) ? value[0] : value
  }
  const query: PmoDecisionCaseListQuery = {}
  const status = one('status')
  if (status) {
    const list = status
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    if (list.length === 1) query.status = list[0] as PmoDecisionCaseStatus
    else if (list.length > 1) query.status = list as PmoDecisionCaseStatus[]
  }
  const ownerId = Number(one('ownerId'))
  if (Number.isFinite(ownerId) && ownerId > 0) query.ownerId = ownerId
  if (one('attention') === 'true') query.attention = true
  const page = Number(one('page'))
  if (Number.isFinite(page) && page > 1) query.page = page
  const perPage = Number(one('perPage'))
  if (Number.isFinite(perPage) && perPage > 0) query.perPage = perPage
  const sort = one('sort')
  if (sort === 'dueDate' || sort === 'createdAt' || sort === 'updatedAt' || sort === 'title')
    query.sort = sort
  if (one('order') === 'asc' || one('order') === 'desc')
    query.order = one('order') as 'asc' | 'desc'
  return query
}

// ─── Types（响应 envelope 局部视图）────────────────────────────────────────────

export interface DecisionComparisonView {
  caseId: number
  baselineOptionId: number
  candidateOptionId: number
  cells: PmoDecisionComparisonCell[]
  findings: Array<{ code: string; severity: string; message: string; lensId?: string }>
  lensVersions: Array<{ lensId: string; version: string }>
  hasWinnerScore: false
}

// ─── Reads ─────────────────────────────────────────────────────────────────────

function base(organizationId: number): string {
  return '/organizations/' + organizationId + '/pmo/decision-workbench'
}

export async function fetchDecisionCases(
  organizationId: number,
  query?: PmoDecisionCaseListQuery,
): Promise<{ data: PmoDecisionCaseDTO[]; meta: PmoDecisionPaginationMeta }> {
  return apiFetchEnvelope<{ data: PmoDecisionCaseDTO[]; meta: PmoDecisionPaginationMeta }>(
    base(organizationId) + '/cases' + serializeDecisionUrlFilters(query),
  )
}

export async function fetchDecisionCase(
  organizationId: number,
  decisionId: number,
): Promise<PmoDecisionCaseDTO> {
  const result = await apiFetchEnvelope<{ data: PmoDecisionCaseDTO }>(
    base(organizationId) + '/cases/' + decisionId,
  )
  return result.data
}

export async function fetchDecisionOptions(
  organizationId: number,
  decisionId: number,
): Promise<PmoDecisionOptionDTO[]> {
  const result = await apiFetchEnvelope<{ data: PmoDecisionOptionDTO[] }>(
    base(organizationId) + '/cases/' + decisionId + '/options',
  )
  return result.data
}

export async function fetchDecisionPositions(
  organizationId: number,
  decisionId: number,
): Promise<PmoDecisionPositionDTO[]> {
  const result = await apiFetchEnvelope<{ data: PmoDecisionPositionDTO[] }>(
    base(organizationId) + '/cases/' + decisionId + '/positions',
  )
  return result.data
}

export async function fetchDecisionSnapshots(
  organizationId: number,
  decisionId: number,
): Promise<PmoDecisionEvidenceSnapshotSummary[]> {
  const result = await apiFetchEnvelope<{ data: PmoDecisionEvidenceSnapshotSummary[] }>(
    base(organizationId) + '/cases/' + decisionId + '/evidence/snapshots',
  )
  return result.data
}

export async function fetchDecisionComparison(
  organizationId: number,
  decisionId: number,
): Promise<DecisionComparisonView> {
  const result = await apiFetchEnvelope<{ data: DecisionComparisonView }>(
    base(organizationId) + '/cases/' + decisionId + '/comparison',
  )
  return result.data
}

export async function fetchDecisionOutcomes(
  organizationId: number,
  decisionId: number,
): Promise<PmoDecisionOutcomeDTO[]> {
  const result = await apiFetchEnvelope<{ data: PmoDecisionOutcomeDTO[] }>(
    base(organizationId) + '/cases/' + decisionId + '/outcomes',
  )
  return result.data
}

export async function fetchDecisionHandoffs(
  organizationId: number,
  decisionId: number,
): Promise<PmoDecisionHandoffReceiptDTO[]> {
  const result = await apiFetchEnvelope<{ data: PmoDecisionHandoffReceiptDTO[] }>(
    base(organizationId) + '/cases/' + decisionId + '/handoffs',
  )
  return result.data
}

/** Readiness 检查（POST：可携带 warning acknowledgement）。 */
export async function checkDecisionReadiness(
  organizationId: number,
  decisionId: number,
  acknowledgedWarnings: string[] = [],
): Promise<PmoDecisionReadinessPacket> {
  const result = await apiFetchEnvelope<{ data: PmoDecisionReadinessPacket }>(
    base(organizationId) + '/cases/' + decisionId + '/readiness',
    { method: 'POST', body: JSON.stringify({ acknowledgedWarnings }) },
  )
  return result.data
}

// ─── Writes（全部为显式用户动作；无任何 apply/confirm）────────────────────────

export async function createDecisionCase(
  organizationId: number,
  input: {
    title: string
    decisionQuestion: string
    scopeSummary?: string
    ownerId?: number
    dueDate?: string
  },
): Promise<PmoDecisionCaseDTO> {
  const result = await apiFetchEnvelope<{ data: PmoDecisionCaseDTO }>(
    base(organizationId) + '/cases',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
  return result.data
}

export async function updateDecisionCase(
  organizationId: number,
  decisionId: number,
  input: { title?: string; expectedRevision: number },
): Promise<PmoDecisionCaseDTO> {
  const result = await apiFetchEnvelope<{ data: PmoDecisionCaseDTO }>(
    base(organizationId) + '/cases/' + decisionId,
    { method: 'PUT', body: JSON.stringify(input) },
  )
  return result.data
}

export async function transitionDecisionCase(
  organizationId: number,
  decisionId: number,
  input: { to: string; expectedRevision: number },
): Promise<PmoDecisionCaseDTO> {
  const result = await apiFetchEnvelope<{ data: PmoDecisionCaseDTO }>(
    base(organizationId) + '/cases/' + decisionId + '/transition',
    { method: 'POST', body: JSON.stringify(input) },
  )
  return result.data
}

export async function createDecisionOption(
  organizationId: number,
  decisionId: number,
  input: {
    label: string
    proposedOutcomeCategory: string
    assumptions?: string[]
    constraints?: string[]
    affectedProjectRefs?: string[]
  },
): Promise<PmoDecisionOptionDTO> {
  const result = await apiFetchEnvelope<{ data: PmoDecisionOptionDTO }>(
    base(organizationId) + '/cases/' + decisionId + '/options',
    { method: 'POST', body: JSON.stringify(input) },
  )
  return result.data
}

export async function recordDecisionPosition(
  organizationId: number,
  decisionId: number,
  input: { stance: 'support' | 'oppose' | 'abstain'; note?: string },
): Promise<PmoDecisionPositionDTO> {
  const result = await apiFetchEnvelope<{ data: PmoDecisionPositionDTO }>(
    base(organizationId) + '/cases/' + decisionId + '/positions',
    { method: 'POST', body: JSON.stringify(input) },
  )
  return result.data
}

export async function refreshDecisionEvidence(
  organizationId: number,
  decisionId: number,
): Promise<void> {
  await apiFetchEnvelope(base(organizationId) + '/cases/' + decisionId + '/evidence/refresh', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function submitDecisionOutcome(
  organizationId: number,
  decisionId: number,
  input: {
    action: PmoDecisionOutcomeAction
    selectedOptionId?: number | null
    reviewFingerprint: string
    rationale?: string
    acknowledgedWarnings?: string[]
    supersededByCaseId?: number | null
  },
): Promise<PmoDecisionOutcomeDTO> {
  const result = await apiFetchEnvelope<{ data: PmoDecisionOutcomeDTO }>(
    base(organizationId) + '/cases/' + decisionId + '/outcomes',
    { method: 'POST', body: JSON.stringify(input) },
  )
  return result.data
}

export async function createDecisionHandoff(
  organizationId: number,
  decisionId: number,
  input: { target: string; idempotencyKey: string },
): Promise<PmoDecisionHandoffReceiptDTO> {
  const result = await apiFetchEnvelope<{ data: PmoDecisionHandoffReceiptDTO }>(
    base(organizationId) + '/cases/' + decisionId + '/handoffs',
    { method: 'POST', body: JSON.stringify(input) },
  )
  return result.data
}

// ─── Advisory lenses（task 10.8：显式触发；输出为非信任草稿，不进入确定性核心）──

export interface AiNarrativeView {
  status: 'ok' | 'fallback' | 'isolated'
  narrative: string | null
  finding: { code: string; severity: string; message: string } | null
  provider: string
  outputHash: string
}

export interface PluginLensView {
  status: 'ok' | 'isolated' | 'unavailable'
  advisory: {
    lensId: string
    pluginId: string
    lensVersion: string
    commentary: string
  } | null
  finding: { code: string; severity: string; message: string } | null
}

/** 用户显式请求 AI 对比摘要（草稿）。 */
export async function requestAiNarrative(
  organizationId: number,
  decisionId: number,
): Promise<AiNarrativeView> {
  const result = await apiFetchEnvelope<{ data: AiNarrativeView }>(
    base(organizationId) + '/cases/' + decisionId + '/ai/narrative',
    { method: 'POST', body: JSON.stringify({}) },
  )
  return result.data
}

/** 用户显式执行已注册插件 lens。 */
export async function executePluginLens(
  organizationId: number,
  decisionId: number,
  input: { pluginId: string; lensId: string },
): Promise<PluginLensView> {
  const result = await apiFetchEnvelope<{ data: PluginLensView }>(
    base(organizationId) + '/cases/' + decisionId + '/plugin-lens',
    { method: 'POST', body: JSON.stringify(input) },
  )
  return result.data
}
