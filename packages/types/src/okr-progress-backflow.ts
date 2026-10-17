// @aiproj/types —— OKR 进度回流共享契约（前后端共享）。
// v3-okr-progress-backflow §2：建议/确认/拒绝/审计/contributions/warnings。
//
// 红线：
//   - 所有建议必须经用户显式确认才写入 KR 当前值（不自动落库）。
//   - source snapshot 只保存低敏元数据，不冗余项目/任务业务明文。
//   - 受限数据不暴露对象标题、数量或 ID；cross-org 数据不得泄露存在性。
//   - 审计字段不记录任务备注、证据文本、prompt、model output、Authorization headers 或 token。

import { type OkrConfidenceLevel, type OkrMeasurementType } from './okr.js'

// ─── Source Ref ───────────────────────────────────────────────────────────────

export const OKR_BACKFLOW_SOURCE_KINDS = {
  PROJECT: 'project',
  MILESTONE: 'milestone',
  TASK: 'task',
} as const

export type OkrBackflowSourceKind =
  (typeof OKR_BACKFLOW_SOURCE_KINDS)[keyof typeof OKR_BACKFLOW_SOURCE_KINDS]

export const OKR_BACKFLOW_SOURCE_KIND_VALUES = Object.values(
  OKR_BACKFLOW_SOURCE_KINDS,
) as readonly OkrBackflowSourceKind[]

/** 执行源引用（低敏：不暴露标题/描述） */
export interface OkrBackflowSourceRef {
  kind: OkrBackflowSourceKind
  id: number
  organizationId: number
  /** 贡献权重 0-100，聚合后归一化 */
  weight: number
  /** 该项目/里程碑/任务的当前进度百分比 0-100 */
  progress: number
  /** 源对象最后更新时间 */
  lastUpdatedAt: string
}

// ─── Contribution Snapshot ───────────────────────────────────────────────────

/** 单个来源的贡献明细 */
export interface OkrBackflowContribution {
  source: OkrBackflowSourceRef
  /** 归一化后的贡献进度值（measurementType 的本机范围） */
  contributedValue: number
  /** 权重乘以该源进度后的值 */
  weightedValue: number
}

// ─── Suggestion ──────────────────────────────────────────────────────────────

export const OKR_BACKFLOW_SUGGESTION_STATUSES = {
  PENDING: 'pending',
  NEEDS_REVIEW: 'needs_review',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
  STALE: 'stale',
} as const

export type OkrBackflowSuggestionStatus =
  (typeof OKR_BACKFLOW_SUGGESTION_STATUSES)[keyof typeof OKR_BACKFLOW_SUGGESTION_STATUSES]

export const OKR_BACKFLOW_SUGGESTION_STATUS_VALUES = Object.values(
  OKR_BACKFLOW_SUGGESTION_STATUSES,
) as readonly OkrBackflowSuggestionStatus[]

// ─── Warning Codes (Backflow-specific) ──────────────────────────────────────

export const OKR_BACKFLOW_WARNING_CODES = {
  MANUAL_OVERRIDE_CONFLICT: 'MANUAL_OVERRIDE_CONFLICT',
  RECENT_MANUAL_UPDATE: 'RECENT_MANUAL_UPDATE',
  RESTRICTED_SOURCE: 'RESTRICTED_SOURCE',
  INVALID_AGGREGATE_WEIGHT: 'INVALID_AGGREGATE_WEIGHT',
  STALE_SOURCE: 'STALE_SOURCE',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  CANCELLED_PROJECT: 'CANCELLED_PROJECT',
  PAUSED_PROJECT: 'PAUSED_PROJECT',
  UNSUPPORTED_LIFECYCLE: 'UNSUPPORTED_LIFECYCLE',
  CONCURRENT_UPDATE_CONFLICT: 'CONCURRENT_UPDATE_CONFLICT',
  BASE_PROGRESS_VERSION_MISMATCH: 'BASE_PROGRESS_VERSION_MISMATCH',
  SUGGESTION_HASH_MISMATCH: 'SUGGESTION_HASH_MISMATCH',
  NESTED_SOURCE_DEDUP: 'NESTED_SOURCE_DEDUP',
} as const

export type OkrBackflowWarningCode =
  (typeof OKR_BACKFLOW_WARNING_CODES)[keyof typeof OKR_BACKFLOW_WARNING_CODES]

export const OKR_BACKFLOW_WARNING_CODE_VALUES = Object.values(
  OKR_BACKFLOW_WARNING_CODES,
) as readonly OkrBackflowWarningCode[]

export interface OkrBackflowWarning {
  code: OkrBackflowWarningCode
  message: string
  details?: Record<string, unknown>
}

// ─── Reason Codes ───────────────────────────────────────────────────────────

export const OKR_BACKFLOW_REASON_CODES = {
  VALUE_INACCURATE: 'VALUE_INACCURATE',
  SOURCE_STALE: 'SOURCE_STALE',
  CONTRIBUTION_MISMATCH: 'CONTRIBUTION_MISMATCH',
  MANUAL_OVERRIDE_PREFERRED: 'MANUAL_OVERRIDE_PREFERRED',
  RESTRICTED_DATA_CONCERN: 'RESTRICTED_DATA_CONCERN',
  OTHER: 'OTHER',
} as const

export type OkrBackflowReasonCode =
  (typeof OKR_BACKFLOW_REASON_CODES)[keyof typeof OKR_BACKFLOW_REASON_CODES]

// ─── Suggestion DTO ─────────────────────────────────────────────────────────

export interface OkrBackflowSuggestion {
  id: number
  organizationId: number
  keyResultId: number
  /** 建议的进度值（measurementType 本机范围） */
  proposedValue: number
  /** KR 当前的进度值 */
  currentValue: number
  /** 差异（proposedValue - currentValue） */
  delta: number
  /** 来源贡献明细 */
  contributions: OkrBackflowContribution[]
  /** 聚合置信度 */
  confidence: OkrConfidenceLevel
  /** 建议状态 */
  status: OkrBackflowSuggestionStatus
  /** 警告列表 */
  warnings: OkrBackflowWarning[]
  /** 建议 hash（stable，用于幂等） */
  suggestionHash: string
  /** 生成时 KR 的 base progress version */
  baseProgressVersion: string
  /** freshness 元数据 */
  freshness: OkrBackflowFreshness
  /** 计算时间 */
  calculatedAt: string
  /** 确认/拒绝原因码 */
  reasonCode: OkrBackflowReasonCode | null
  /** 拒绝原因文本 */
  reasonNote: string | null
  /** 操作人 ID */
  actorId: number | null
  /** 操作时间 */
  actionedAt: string | null
  createdAt: string
  updatedAt: string
}

// ─── Freshness ──────────────────────────────────────────────────────────────

export interface OkrBackflowFreshness {
  /** 最旧的 source 最后更新时间 */
  oldestSourceUpdatedAt: string | null
  /** 最新的 source 最后更新时间 */
  newestSourceUpdatedAt: string | null
  /** 是否任何 source 超过 24h 未更新 */
  stale: boolean
}

// ─── Request DTOs ───────────────────────────────────────────────────────────

export interface OkrBackflowRecalculateRequest {
  /** KR ID */
  keyResultId: number
}

export interface OkrBackflowBatchRecalculateRequest {
  /** 范围类型 */
  scope: 'objective' | 'cycle'
  /** 目标/周期 ID */
  scopeId: number
  /** 最大 KR 数量（默认 100） */
  maxKrCount?: number
}

export interface OkrBackflowConfirmRequest {
  /** 建议 ID */
  suggestionId: number
  /** 确认时附带的可选备注 */
  note?: string | null
}

export interface OkrBackflowRejectRequest {
  /** 建议 ID */
  suggestionId: number
  /** 拒绝原因码（必填） */
  reasonCode: OkrBackflowReasonCode
  /** 拒绝原因详细说明（必填，≤500 字） */
  reasonNote: string
}

// ─── Query DTOs ────────────────────────────────────────────────────────────

export interface OkrBackflowListQuery {
  keyResultId?: number
  objectiveId?: number
  cycleId?: number
  status?: OkrBackflowSuggestionStatus | OkrBackflowSuggestionStatus[]
  warningCode?: OkrBackflowWarningCode
  sort?: 'calculatedAt' | 'createdAt' | 'delta'
  order?: 'asc' | 'desc'
  page?: number
  perPage?: number
}

// ─── Response Envelopes ──────────────────────────────────────────────────────

export interface OkrBackflowSuggestionResponse {
  data: OkrBackflowSuggestion
}

export interface OkrBackflowSuggestionListResponse {
  data: OkrBackflowSuggestion[]
  meta: OkrBackflowListMeta
}

export interface OkrBackflowBatchRecalculateResponse {
  data: OkrBackflowSuggestion[]
  meta: OkrBackflowBatchMeta
}

export interface OkrBackflowListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface OkrBackflowBatchMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
  /** 成功重算的 KR 数量 */
  recalculatedCount: number
  /** 部分失败的 KR 数量 */
  partialFailureCount: number
  /** 部分失败的 KR 详情 */
  partialFailures?: Array<{ keyResultId: number; reason: string }>
}

// ─── Audit Payload (low-sensitive) ──────────────────────────────────────────

export interface OkrBackflowAuditPayload {
  action: 'recalculate' | 'confirm' | 'reject'
  suggestionId?: number
  keyResultId: number
  organizationId: number
  actorId: number
  suggestionHash?: string
  reasonCode?: OkrBackflowReasonCode
  status: OkrBackflowSuggestionStatus
  timestamp: string
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const OKR_BACKFLOW_DEFAULTS = {
  MAX_KR_PER_BATCH: 100,
  MAX_REASON_NOTE_LENGTH: 500,
  STALE_THRESHOLD_MS: 24 * 60 * 60 * 1000, // 24h
  DEFAULT_PAGE_SIZE: 25,
  MAX_PAGE_SIZE: 100,
  SOURCE_FRESHNESS_WINDOW_MS: 7 * 24 * 60 * 60 * 1000, // 7d
} as const

export const OKR_BACKFLOW_SORT_FIELDS = {
  CALCULATED_AT: 'calculatedAt',
  CREATED_AT: 'createdAt',
  DELTA: 'delta',
} as const

export type OkrBackflowSortField =
  (typeof OKR_BACKFLOW_SORT_FIELDS)[keyof typeof OKR_BACKFLOW_SORT_FIELDS]

// ─── Source Precedence ──────────────────────────────────────────────────────

/**
 * 来源优先级顺序：project > milestone > task
 * 当同一个进度事实存在多层来源时，高优先级源保留，低优先级源被去重。
 */
export const OKR_BACKFLOW_SOURCE_PRECEDENCE: Record<OkrBackflowSourceKind, number> = {
  project: 3,
  milestone: 2,
  task: 1,
}

export function sourcePrecedence(kind: OkrBackflowSourceKind): number {
  return OKR_BACKFLOW_SOURCE_PRECEDENCE[kind]
}

// ─── Contribution Normalization ─────────────────────────────────────────────

/** 将贡献权重归一化到 0-1 范围 */
export function normalizeBackflowContributionWeights(
  contributions: OkrBackflowContribution[],
): OkrBackflowContribution[] {
  const totalWeight = contributions.reduce((sum, c) => sum + c.source.weight, 0)
  if (totalWeight === 0) return contributions
  return contributions.map((c) => ({
    ...c,
    weightedValue: (c.source.weight / totalWeight) * c.source.progress,
    contributedValue: c.contributedValue,
  }))
}

// ─── Progress Clamp ─────────────────────────────────────────────────────────

/** 将建议进度 clamp 到 measurement type 允许范围 */
export function clampBackflowProgress(value: number, measurementType: OkrMeasurementType): number {
  switch (measurementType) {
    case 'percent':
      return Math.max(0, Math.min(100, value))
    case 'binary':
    case 'milestone':
      return Math.max(0, Math.min(1, value))
    default:
      return Math.max(0, value)
  }
}

// ─── Delta Calculation ──────────────────────────────────────────────────────

export function computeBackflowDelta(proposedValue: number, currentValue: number): number {
  return Math.round((proposedValue - currentValue) * 100) / 100
}

// ─── Warning Generation ─────────────────────────────────────────────────────

export function makeManualOverrideWarning(): OkrBackflowWarning {
  return {
    code: 'MANUAL_OVERRIDE_CONFLICT',
    message: 'KR 存在手动覆盖记录，建议仅作参考',
  }
}

export function makeRecentManualUpdateWarning(): OkrBackflowWarning {
  return {
    code: 'RECENT_MANUAL_UPDATE',
    message: 'KR 最近有人工进度更新，请注意数据一致性',
  }
}

export function makeRestrictedSourceWarning(): OkrBackflowWarning {
  return {
    code: 'RESTRICTED_SOURCE',
    message: '部分执行源因权限受限不可见，建议值可能不完整',
  }
}

export function makeInvalidAggregateWeightWarning(): OkrBackflowWarning {
  return {
    code: 'INVALID_AGGREGATE_WEIGHT',
    message: '贡献权重合计异常，建议值已按等权处理',
  }
}

export function makeStaleSourceWarning(kind: OkrBackflowSourceKind): OkrBackflowWarning {
  return {
    code: 'STALE_SOURCE',
    message: `${kind} 源数据超过 24h 未更新，建议可能已陈旧`,
    details: { sourceKind: kind },
  }
}

export function makeSourceUnavailableWarning(kind: OkrBackflowSourceKind): OkrBackflowWarning {
  return {
    code: 'SOURCE_UNAVAILABLE',
    message: `${kind} 执行源数据不可用`,
    details: { sourceKind: kind },
  }
}

export function makeCancelledProjectWarning(): OkrBackflowWarning {
  return {
    code: 'CANCELLED_PROJECT',
    message: '关联项目已取消，相关执行源数据不再更新',
  }
}

export function makePausedProjectWarning(): OkrBackflowWarning {
  return {
    code: 'PAUSED_PROJECT',
    message: '关联项目已暂停，进展数据可能停滞',
  }
}

export function makeUnsupportedLifecycleWarning(): OkrBackflowWarning {
  return {
    code: 'UNSUPPORTED_LIFECYCLE',
    message: 'KR 生命周期状态不支持回流操作',
  }
}

export function makeConcurrentUpdateWarning(): OkrBackflowWarning {
  return {
    code: 'CONCURRENT_UPDATE_CONFLICT',
    message: 'KR 进度在建议生成后已被更新，请重新计算',
  }
}

export function makeBaseProgressVersionMismatchWarning(): OkrBackflowWarning {
  return {
    code: 'BASE_PROGRESS_VERSION_MISMATCH',
    message: 'base progress version 不匹配，请重新计算',
  }
}

export function makeSuggestionHashMismatchWarning(): OkrBackflowWarning {
  return {
    code: 'SUGGESTION_HASH_MISMATCH',
    message: '建议 hash 不匹配，请重新计算',
  }
}

export function makeNestedSourceDedupWarning(): OkrBackflowWarning {
  return {
    code: 'NESTED_SOURCE_DEDUP',
    message: '嵌套来源（项目/里程碑/任务）已去重，避免同一执行事实重复计入',
  }
}

/** 合并多个 backflow warnings 数组（按 code 去重） */
export function mergeBackflowWarnings(
  warningsArrays: OkrBackflowWarning[][],
): OkrBackflowWarning[] {
  const seen = new Set<string>()
  const merged: OkrBackflowWarning[] = []
  for (const arr of warningsArrays) {
    for (const w of arr) {
      if (!seen.has(w.code)) {
        seen.add(w.code)
        merged.push(w)
      }
    }
  }
  return merged
}

// ─── Freshness Metadata ─────────────────────────────────────────────────────

export function computeBackflowFreshness(sources: OkrBackflowSourceRef[]): OkrBackflowFreshness {
  if (sources.length === 0) {
    return {
      oldestSourceUpdatedAt: null,
      newestSourceUpdatedAt: null,
      stale: true,
    }
  }

  const timestamps = sources.map((s) => new Date(s.lastUpdatedAt).getTime())
  const oldest = new Date(Math.min(...timestamps)).toISOString()
  const newest = new Date(Math.max(...timestamps)).toISOString()
  const now = Date.now()
  const stale = timestamps.some((ts) => now - ts > OKR_BACKFLOW_DEFAULTS.STALE_THRESHOLD_MS)

  return { oldestSourceUpdatedAt: oldest, newestSourceUpdatedAt: newest, stale }
}

// ─── Stable Suggestion Hash ──────────────────────────────────────────────────

export function computeBackflowSuggestionHash(
  keyResultId: number,
  proposedValue: number,
  contributions: OkrBackflowContribution[],
  baseProgressVersion: string,
): string {
  const parts = [
    String(keyResultId),
    String(proposedValue),
    ...contributions.map((c) => `${c.source.kind}:${c.source.id}:${c.source.progress}`),
    baseProgressVersion,
  ].join('|')
  let hash = 0
  for (let i = 0; i < parts.length; i++) {
    const char = parts.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

// ─── Type Guards ────────────────────────────────────────────────────────────

export function isOkrBackflowSourceKind(value: unknown): value is OkrBackflowSourceKind {
  return (
    typeof value === 'string' &&
    OKR_BACKFLOW_SOURCE_KIND_VALUES.includes(value as OkrBackflowSourceKind)
  )
}

export function isOkrBackflowSuggestionStatus(
  value: unknown,
): value is OkrBackflowSuggestionStatus {
  return (
    typeof value === 'string' &&
    OKR_BACKFLOW_SUGGESTION_STATUS_VALUES.includes(value as OkrBackflowSuggestionStatus)
  )
}

export function isOkrBackflowWarningCode(value: unknown): value is OkrBackflowWarningCode {
  return (
    typeof value === 'string' &&
    OKR_BACKFLOW_WARNING_CODE_VALUES.includes(value as OkrBackflowWarningCode)
  )
}

export function isOkrBackflowReasonCode(value: unknown): value is OkrBackflowReasonCode {
  return (
    typeof value === 'string' &&
    Object.values(OKR_BACKFLOW_REASON_CODES).includes(value as OkrBackflowReasonCode)
  )
}

export function isOkrBackflowSortField(value: unknown): value is OkrBackflowSortField {
  return (
    typeof value === 'string' &&
    Object.values(OKR_BACKFLOW_SORT_FIELDS).includes(value as OkrBackflowSortField)
  )
}

// ─── Fixture Builders ───────────────────────────────────────────────────────

export function makeOkrBackflowSourceRef(
  overrides: Partial<OkrBackflowSourceRef> = {},
): OkrBackflowSourceRef {
  return {
    kind: 'project',
    id: 1,
    organizationId: 1,
    weight: 100,
    progress: 75,
    lastUpdatedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function makeOkrBackflowContribution(
  overrides: Partial<OkrBackflowContribution> = {},
): OkrBackflowContribution {
  return {
    source: makeOkrBackflowSourceRef(),
    contributedValue: 75,
    weightedValue: 75,
    ...overrides,
  }
}

export function makeOkrBackflowSuggestion(
  overrides: Partial<OkrBackflowSuggestion> = {},
): OkrBackflowSuggestion {
  const base: OkrBackflowSuggestion = {
    id: 1,
    organizationId: 1,
    keyResultId: 1,
    proposedValue: 75,
    currentValue: 50,
    delta: 25,
    contributions: [makeOkrBackflowContribution()],
    confidence: 'high',
    status: 'pending',
    warnings: [],
    suggestionHash: 'abc12345',
    baseProgressVersion: '1',
    freshness: {
      oldestSourceUpdatedAt: new Date().toISOString(),
      newestSourceUpdatedAt: new Date().toISOString(),
      stale: false,
    },
    calculatedAt: new Date().toISOString(),
    reasonCode: null,
    reasonNote: null,
    actorId: null,
    actionedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  return { ...base, ...overrides }
}

export function makeOkrBackflowAuditPayload(
  overrides: Partial<OkrBackflowAuditPayload> = {},
): OkrBackflowAuditPayload {
  return {
    action: 'recalculate',
    keyResultId: 1,
    organizationId: 1,
    actorId: 1,
    status: 'pending',
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

// ─── Fixture Scenarios ──────────────────────────────────────────────────────

/** 正常回流 fixture：project source 贡献 */
export function makeNormalBackflowFixture() {
  const source = makeOkrBackflowSourceRef({ kind: 'project', progress: 75, weight: 100 })
  const contribution = makeOkrBackflowContribution({
    source,
    contributedValue: 75,
    weightedValue: 75,
  })
  const suggestion = makeOkrBackflowSuggestion({
    contributions: [contribution],
    proposedValue: 75,
    currentValue: 50,
    delta: 25,
    suggestionHash: computeBackflowSuggestionHash(1, 75, [contribution], '1'),
    freshness: computeBackflowFreshness([source]),
  })
  return { sources: [source], contributions: [contribution], suggestions: [suggestion] }
}

/** 多源回流 fixture：project + milestone + task */
export function makeMultiSourceBackflowFixture() {
  const projectSource = makeOkrBackflowSourceRef({
    kind: 'project',
    id: 1,
    progress: 60,
    weight: 50,
  })
  const milestoneSource = makeOkrBackflowSourceRef({
    kind: 'milestone',
    id: 1,
    progress: 80,
    weight: 30,
  })
  const taskSource = makeOkrBackflowSourceRef({ kind: 'task', id: 1, progress: 40, weight: 20 })
  const contributions = [
    makeOkrBackflowContribution({ source: projectSource, contributedValue: 60, weightedValue: 30 }),
    makeOkrBackflowContribution({
      source: milestoneSource,
      contributedValue: 80,
      weightedValue: 24,
    }),
    makeOkrBackflowContribution({ source: taskSource, contributedValue: 40, weightedValue: 8 }),
  ]
  const proposedValue = (60 * 50 + 80 * 30 + 40 * 20) / 100 // 62
  const suggestion = makeOkrBackflowSuggestion({
    contributions,
    proposedValue,
    currentValue: 40,
    delta: 22,
    suggestionHash: computeBackflowSuggestionHash(1, proposedValue, contributions, '1'),
    freshness: computeBackflowFreshness([projectSource, milestoneSource, taskSource]),
  })
  return {
    sources: [projectSource, milestoneSource, taskSource],
    contributions,
    suggestions: [suggestion],
  }
}

/** 受限源 fixture：部分 source 不可见 */
export function makeRestrictedSourceBackflowFixture() {
  const visibleSource = makeOkrBackflowSourceRef({ kind: 'task', id: 1, progress: 50, weight: 100 })
  const contribution = makeOkrBackflowContribution({
    source: visibleSource,
    contributedValue: 50,
    weightedValue: 50,
  })
  const suggestion = makeOkrBackflowSuggestion({
    contributions: [contribution],
    proposedValue: 50,
    currentValue: 30,
    delta: 20,
    warnings: [makeRestrictedSourceWarning()],
    confidence: 'low',
    freshness: computeBackflowFreshness([visibleSource]),
  })
  return { sources: [visibleSource], contributions: [contribution], suggestions: [suggestion] }
}

/** 手动覆盖 fixture */
export function makeManualOverrideBackflowFixture() {
  const source = makeOkrBackflowSourceRef({ kind: 'project', progress: 90, weight: 100 })
  const contribution = makeOkrBackflowContribution({
    source,
    contributedValue: 90,
    weightedValue: 90,
  })
  const suggestion = makeOkrBackflowSuggestion({
    contributions: [contribution],
    proposedValue: 90,
    currentValue: 85,
    delta: 5,
    status: 'needs_review',
    warnings: [makeManualOverrideWarning()],
    freshness: computeBackflowFreshness([source]),
  })
  return { sources: [source], contributions: [contribution], suggestions: [suggestion] }
}

/** 无效权重 fixture */
export function makeInvalidWeightBackflowFixture() {
  const sources = [
    makeOkrBackflowSourceRef({ kind: 'task', id: 1, weight: 0, progress: 50 }),
    makeOkrBackflowSourceRef({ kind: 'task', id: 2, weight: 0, progress: 60 }),
  ]
  const contributions = sources.map((s) =>
    makeOkrBackflowContribution({ source: s, contributedValue: s.progress, weightedValue: 0 }),
  )
  const suggestion = makeOkrBackflowSuggestion({
    contributions,
    proposedValue: 55,
    currentValue: 30,
    delta: 25,
    warnings: [makeInvalidAggregateWeightWarning()],
    confidence: 'low',
    freshness: computeBackflowFreshness(sources),
  })
  return { sources, contributions, suggestions: [suggestion] }
}

/** 陈旧源 fixture */
export function makeStaleSourceBackflowFixture() {
  const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const source = makeOkrBackflowSourceRef({
    kind: 'project',
    lastUpdatedAt: staleDate,
    progress: 60,
    weight: 100,
  })
  const contribution = makeOkrBackflowContribution({
    source,
    contributedValue: 60,
    weightedValue: 60,
  })
  const suggestion = makeOkrBackflowSuggestion({
    contributions: [contribution],
    proposedValue: 60,
    currentValue: 40,
    delta: 20,
    warnings: [makeStaleSourceWarning('project')],
    freshness: computeBackflowFreshness([source]),
  })
  return { sources: [source], contributions: [contribution], suggestions: [suggestion] }
}

/** 嵌套源去重 fixture：project + 其子 milestone */
export function makeNestedSourceBackflowFixture() {
  const projectSource = makeOkrBackflowSourceRef({
    kind: 'project',
    id: 1,
    progress: 70,
    weight: 100,
  })
  const milestoneSource = makeOkrBackflowSourceRef({
    kind: 'milestone',
    id: 1,
    progress: 65,
    weight: 50,
  })
  // milestone 包含在 project 中，应按 precedence 保留 project
  const contribution = makeOkrBackflowContribution({
    source: projectSource,
    contributedValue: 70,
    weightedValue: 70,
  })
  const suggestion = makeOkrBackflowSuggestion({
    contributions: [contribution],
    proposedValue: 70,
    currentValue: 45,
    delta: 25,
    warnings: [makeNestedSourceDedupWarning()],
    freshness: computeBackflowFreshness([projectSource]),
  })
  return {
    sources: [projectSource, milestoneSource],
    contributions: [contribution],
    suggestions: [suggestion],
  }
}

/** 幂等确认 fixture：重复确认同一建议 */
export function makeIdempotentBackflowFixture() {
  const source = makeOkrBackflowSourceRef({ kind: 'task', progress: 80, weight: 100 })
  const contribution = makeOkrBackflowContribution({
    source,
    contributedValue: 80,
    weightedValue: 80,
  })
  const suggestion = makeOkrBackflowSuggestion({
    id: 99,
    contributions: [contribution],
    proposedValue: 80,
    currentValue: 50,
    delta: 30,
    status: 'confirmed',
    suggestionHash: computeBackflowSuggestionHash(99, 80, [contribution], '1'),
    freshness: computeBackflowFreshness([source]),
    actorId: 1,
    actionedAt: new Date().toISOString(),
  })
  return { sources: [source], contributions: [contribution], suggestions: [suggestion] }
}
