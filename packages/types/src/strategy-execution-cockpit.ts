// @aiproj/types —— Strategy Execution Cockpit 共享契约（前后端共享）。
// v3-strategy-execution-cockpit §2：固定 metric keys、source kinds、warning codes、
// mapping kinds、query bounds、DTO、closed-set enums、redaction guard 与确定性纯函数。
//
// 红线：
//   - 只读投影：不调用 AIGateway、不启动 Compiler、不刷新领域快照、不写业务事实、
//     不发通知/Webhook/Web Push、不换 OAuth token、不做外部网络写。
//   - 策略到执行的连接只允许基于显式、同组织、active、cycle 兼容且目标可见的
//     OKR→project 映射事实；禁止从名称/标签/owner/AI 文本猜测关系。
//   - 每个指标必须携带权威 source + source version + freshness；缺失/受限来源
//     不得以零值冒充事实，禁止生成财务代理或新总分。
//   - 受限来源在聚合前排除，输出只保留低敏 forbidden/partial/unavailable 状态，
//     不泄露隐藏 id/count/hash/range/name/evidence/prompt/model output/Authorization。
//   - 不暴露 confirm/apply handle；所有 target 只打开既有授权工作台，下钻二次授权。

import type { OkrScope, OkrStatus } from './okr.js'
import { OKR_METRIC_VERSION } from './okr.js'

// ─── Metric Version ─────────────────────────────────────────────────────────────
export const STRATEGY_EXECUTION_COCKPIT_METRIC_VERSION =
  `strategy-execution-cockpit.v${OKR_METRIC_VERSION}` as const

// ─── Metric Keys ───────────────────────────────────────────────────────────────
export const COCKPIT_METRIC_KEYS = {
  TOTAL_OBJECTIVES: 'cockpit_total_objectives',
  ACTIVE_OBJECTIVES: 'cockpit_active_objectives',
  AT_RISK_OBJECTIVES: 'cockpit_at_risk_objectives',
  COMPLETED_OBJECTIVES: 'cockpit_completed_objectives',
  BEHIND_OBJECTIVES: 'cockpit_behind_objectives',
  TOTAL_KEY_RESULTS: 'cockpit_total_key_results',
  BEHIND_KEY_RESULTS: 'cockpit_behind_key_results',
  STALE_KEY_RESULTS: 'cockpit_stale_key_results',
  TOTAL_MAPPED_PROJECTS: 'cockpit_total_mapped_projects',
  MAPPING_COVERAGE_PERCENT: 'cockpit_mapping_coverage_percent',
  STRATEGY_PROGRESS_AVG: 'cockpit_strategy_progress_avg',
  PORTFOLIO_TRAFFIC_LIGHT_RED: 'cockpit_portfolio_traffic_light_red',
  PORTFOLIO_TRAFFIC_LIGHT_YELLOW: 'cockpit_portfolio_traffic_light_yellow',
  PORTFOLIO_TRAFFIC_LIGHT_GREEN: 'cockpit_portfolio_traffic_light_green',
  PORTFOLIO_TRAFFIC_LIGHT_GRAY: 'cockpit_portfolio_traffic_light_gray',
  PRIORITY_MISMATCH_COUNT: 'cockpit_priority_mismatch_count',
  INVESTMENT_MISMATCH_COUNT: 'cockpit_investment_mismatch_count',
  RESOURCE_RISK_PRESSURE_COUNT: 'cockpit_resource_risk_pressure_count',
  ATTENTION_COUNT: 'cockpit_attention_count',
  SOURCE_STALE_COUNT: 'cockpit_source_stale_count',
  SOURCE_UNAVAILABLE_COUNT: 'cockpit_source_unavailable_count',
  BACKFLOW_CANDIDATE_COUNT: 'cockpit_backflow_candidate_count',
} as const

export type CockpitMetricKey = (typeof COCKPIT_METRIC_KEYS)[keyof typeof COCKPIT_METRIC_KEYS]

export const COCKPIT_METRIC_KEY_VALUES = Object.values(
  COCKPIT_METRIC_KEYS,
) as readonly CockpitMetricKey[]

export type CockpitMetricUnit = 'count' | 'percent' | 'avg' | 'score'

// ─── Source Kinds ──────────────────────────────────────────────────────────────
export const COCKPIT_SOURCES = {
  OKR_CYCLE: 'okr_cycle',
  OKR_OBJECTIVE: 'okr_objective',
  OKR_KEY_RESULT: 'okr_key_result',
  OKR_MAPPING: 'okr_mapping',
  PORTFOLIO_DASHBOARD: 'portfolio_dashboard',
  PORTFOLIO_TRAFFIC_LIGHT: 'portfolio_traffic_light',
  PORTFOLIO_PRIORITY: 'portfolio_priority',
  INVESTMENT_DISTRIBUTION: 'investment_distribution',
  RESOURCE_RISK: 'resource_risk',
  BACKFLOW: 'backflow',
  COMPUTED: 'computed',
} as const

export type CockpitSource = (typeof COCKPIT_SOURCES)[keyof typeof COCKPIT_SOURCES]

export const COCKPIT_SOURCE_VALUES = Object.values(COCKPIT_SOURCES) as readonly CockpitSource[]

// ─── Source Status（D7）──────────────────────────────────────────────────────
export const COCKPIT_SOURCE_STATUSES = {
  AVAILABLE: 'available',
  STALE: 'stale',
  PARTIAL: 'partial',
  FORBIDDEN: 'forbidden',
  UNAVAILABLE: 'unavailable',
  UNSUPPORTED: 'unsupported',
} as const

export type CockpitSourceStatus =
  (typeof COCKPIT_SOURCE_STATUSES)[keyof typeof COCKPIT_SOURCE_STATUSES]

export const COCKPIT_SOURCE_STATUS_VALUES = Object.values(
  COCKPIT_SOURCE_STATUSES,
) as readonly CockpitSourceStatus[]

// ─── Overall Status（D7）──────────────────────────────────────────────────────
export const COCKPIT_OVERALL_STATUSES = {
  READY: 'ready',
  DEGRADED: 'degraded',
  UNAVAILABLE: 'unavailable',
  EMPTY: 'empty',
} as const

export type CockpitOverallStatus =
  (typeof COCKPIT_OVERALL_STATUSES)[keyof typeof COCKPIT_OVERALL_STATUSES]

export const COCKPIT_OVERALL_STATUS_VALUES = Object.values(
  COCKPIT_OVERALL_STATUSES,
) as readonly CockpitOverallStatus[]

// ─── Warning Codes ────────────────────────────────────────────────────────────
export const COCKPIT_WARNING_CODES = {
  EMPTY_STRATEGY_SCOPE: 'EMPTY_STRATEGY_SCOPE',
  EXECUTION_MAPPING_MISSING: 'EXECUTION_MAPPING_MISSING',
  EXECUTION_MAPPING_FORBIDDEN: 'EXECUTION_MAPPING_FORBIDDEN',
  EXECUTION_MAPPING_UNAVAILABLE: 'EXECUTION_MAPPING_UNAVAILABLE',
  SOURCE_STALE: 'SOURCE_STALE',
  SOURCE_PARTIAL: 'SOURCE_PARTIAL',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  SOURCE_FORBIDDEN: 'SOURCE_FORBIDDEN',
  FINANCIAL_UNSUPPORTED: 'FINANCIAL_UNSUPPORTED',
  ATTENTION_TRUNCATED: 'ATTENTION_TRUNCATED',
  PERMISSION_REDACTED: 'PERMISSION_REDACTED',
  CACHE_DEGRADED: 'CACHE_DEGRADED',
} as const

export type CockpitWarningCode = (typeof COCKPIT_WARNING_CODES)[keyof typeof COCKPIT_WARNING_CODES]

export const COCKPIT_WARNING_CODE_VALUES = Object.values(
  COCKPIT_WARNING_CODES,
) as readonly CockpitWarningCode[]

// ─── Attention Reason Codes（D4）───────────────────────────────────────────────
export const COCKPIT_ATTENTION_REASONS = {
  STRATEGY_PROGRESS_AT_RISK: 'STRATEGY_PROGRESS_AT_RISK',
  EXECUTION_COVERAGE_GAP: 'EXECUTION_COVERAGE_GAP',
  EXECUTION_COVERAGE_UNAVAILABLE: 'EXECUTION_COVERAGE_UNAVAILABLE',
  INVESTMENT_PRIORITY_MISMATCH: 'INVESTMENT_PRIORITY_MISMATCH',
  EXECUTION_SOURCE_STALE: 'EXECUTION_SOURCE_STALE',
} as const

export type CockpitAttentionReason =
  (typeof COCKPIT_ATTENTION_REASONS)[keyof typeof COCKPIT_ATTENTION_REASONS]

export const COCKPIT_ATTENTION_REASON_VALUES = Object.values(
  COCKPIT_ATTENTION_REASONS,
) as readonly CockpitAttentionReason[]

// ─── Mapping Kinds（D3）────────────────────────────────────────────────────────
export const COCKPIT_MAPPING_KINDS = {
  DIRECT_PROJECT_CONTRIBUTION: 'direct_project_contribution',
  KR_PROJECT_EVIDENCE: 'kr_project_evidence',
  ALIGNMENT: 'alignment',
  CONTRIBUTION: 'contribution',
} as const

export type CockpitMappingKind = (typeof COCKPIT_MAPPING_KINDS)[keyof typeof COCKPIT_MAPPING_KINDS]

export const COCKPIT_MAPPING_KIND_VALUES = Object.values(
  COCKPIT_MAPPING_KINDS,
) as readonly CockpitMappingKind[]

// ─── Include / Sort / Target Kind ──────────────────────────────────────────────
export const COCKPIT_INCLUDES = {
  OBJECTIVE_MATRIX: 'objective_matrix',
  PORTFOLIO_TRAFFIC_LIGHT: 'portfolio_traffic_light',
  PRIORITY: 'priority',
  INVESTMENT: 'investment',
  RESOURCE_RISK: 'resource_risk',
  ATTENTION: 'attention',
  BACKFLOW: 'backflow',
} as const

export type CockpitInclude = (typeof COCKPIT_INCLUDES)[keyof typeof COCKPIT_INCLUDES]

export const COCKPIT_INCLUDE_VALUES = Object.values(COCKPIT_INCLUDES) as readonly CockpitInclude[]

export const COCKPIT_SORT_KEYS = {
  PRIORITY: 'priority',
  PROGRESS: 'progress',
  RISK: 'risk',
  TITLE: 'title',
  MAPPING_COVERAGE: 'mapping_coverage',
} as const

export type CockpitSortKey = (typeof COCKPIT_SORT_KEYS)[keyof typeof COCKPIT_SORT_KEYS]

export const COCKPIT_SORT_KEY_VALUES = Object.values(COCKPIT_SORT_KEYS) as readonly CockpitSortKey[]

export const COCKPIT_TARGET_KINDS = {
  OKR_OBJECTIVE: 'okr_objective',
  OKR_KEY_RESULT: 'okr_key_result',
  OKR_CYCLE: 'okr_cycle',
  OKR_DASHBOARD: 'okr_dashboard',
  PMO_PORTFOLIO: 'pmo_portfolio',
  PMO_TRAFFIC_LIGHT: 'pmo_traffic_light',
  PMO_PRIORITY: 'pmo_priority',
  PMO_INVESTMENT: 'pmo_investment',
  RESOURCE: 'resource',
  RISK: 'risk',
  BACKFLOW: 'backflow',
  ALLOCATION: 'allocation',
  ORGANIZATION_DASHBOARD: 'organization_dashboard',
} as const

export type CockpitTargetKind = (typeof COCKPIT_TARGET_KINDS)[keyof typeof COCKPIT_TARGET_KINDS]

export const COCKPIT_TARGET_KIND_VALUES = Object.values(
  COCKPIT_TARGET_KINDS,
) as readonly CockpitTargetKind[]

// ─── Bounds（D6/D9）────────────────────────────────────────────────────────────
export const COCKPIT_DEFAULT_ATTENTION_LIMIT = 10
export const COCKPIT_MAX_ATTENTION_LIMIT = 50
export const COCKPIT_DEFAULT_FRESHNESS_MINUTES = 60 * 24 * 3 // 3 天
export const COCKPIT_MAX_FRESHNESS_MINUTES = 60 * 24 * 30 // 30 天
export const COCKPIT_MAX_DATE_WINDOW_DAYS = 365
export const COCKPIT_MAX_SCOPE_CARDINALITY = 10
export const COCKPIT_MAX_OWNER_CARDINALITY = 20
export const COCKPIT_MAX_STATUS_CARDINALITY = 10
export const COCKPIT_MAX_THEME_CARDINALITY = 20
export const COCKPIT_MAX_INCLUDE_CARDINALITY = 20
export const COCKPIT_MAX_MAPPED_PROJECTS = 10_000
export const COCKPIT_MAX_SCAN_OBJECTIVES = 5_000
export const COCKPIT_MAX_PAYLOAD_BYTES = 1_000_000

/** ruleVersion 前缀：attention 规则版本与 contract 版本解耦。 */
export const COCKPIT_ATTENTION_RULE_VERSION = 'cockpit-attention-rules.v1'

// ─── DTOs ──────────────────────────────────────────────────────────────────────

export interface CockpitWarning {
  code: CockpitWarningCode
  message: string
  source?: CockpitSource
  metricKey?: CockpitMetricKey
}

export interface CockpitSourceFreshness {
  source: CockpitSource
  lastUpdatedAt: string | null
  isStale: boolean
  staleThresholdMinutes: number
  status: CockpitSourceStatus
  warning?: CockpitWarning
}

export interface CockpitMetric {
  key: CockpitMetricKey
  value: number | null
  unit: CockpitMetricUnit
  source: CockpitSource
  status: CockpitSourceStatus
  warnings?: CockpitWarning[]
}

export interface CockpitTarget {
  kind: CockpitTargetKind
  href: string
  authorized: boolean
}

export interface CockpitCycleContext {
  cycleId: number | null
  title: string | null
  status: OkrStatus | null
  startDate: string | null
  endDate: string | null
  elapsedPercent: number | null
  daysRemaining: number | null
}

export interface CockpitMappingProjection {
  kind: CockpitMappingKind
  projectId: number
  weight: number | null
  contributionPercent: number | null
  sourceVersion: string
  target: CockpitTarget
  authorized: boolean
}

export interface CockpitObjectiveRow {
  objectiveId: number
  objectiveTitle: string
  scope: OkrScope | null
  status: OkrStatus
  progress: number
  confidence: 'low' | 'medium' | 'high'
  keyResultCount: number
  behindKeyResultCount: number
  mappedProjects: CockpitMappingProjection[]
  coveragePercent: number | null
  executionHealth: 'on_track' | 'attention' | 'at_risk' | 'unavailable' | 'unknown'
  priorityBand: 'high' | 'medium' | 'low' | 'unknown'
  investmentAlignment: 'aligned' | 'mismatch' | 'unknown'
  resourceRiskPressure: number | null
  attentionReasons: CockpitAttentionReason[]
  warnings: CockpitWarning[]
  target: CockpitTarget | null
}

export interface CockpitAttentionItem {
  id: string
  severity: 'info' | 'warning' | 'critical'
  reasonCode: CockpitAttentionReason
  message: string
  basis: string
  ruleVersion: string
  objectiveId: number | null
  projectIds: number[]
  sourceFreshness: CockpitSourceFreshness[]
  target: CockpitTarget | null
  warnings: CockpitWarning[]
}

export interface CockpitPortfolioTrafficLightBlock {
  available: boolean
  forbidden: boolean
  redCount: number
  yellowCount: number
  greenCount: number
  grayCount: number
  freshness: CockpitSourceFreshness | null
  warnings: CockpitWarning[]
}

export interface CockpitPriorityInvestmentBlock {
  available: boolean
  forbidden: boolean
  unsupportedFinancial: boolean
  priorityMismatchCount: number | null
  investmentMismatchCount: number | null
  basis: string
  freshness: CockpitSourceFreshness | null
  warnings: CockpitWarning[]
}

export interface CockpitResourceRiskBlock {
  available: boolean
  forbidden: boolean
  pressureCount: number | null
  freshness: CockpitSourceFreshness | null
  warnings: CockpitWarning[]
}

export interface CockpitMeta {
  calculatedAt: string
  metricVersion: string
  organizationId: number
  actorId: number
  cycleId: number | null
  overallStatus: CockpitOverallStatus
  visibleObjectiveCount: number
  visibleKeyResultCount: number
  mappedProjectCount: number
  restrictedObjectiveCount: number
  restrictedMappingCount: number
  includes: CockpitInclude[]
  attentionLimit: number
  freshnessWindowMinutes: number
  inputSignatureHash: string
}

export interface CockpitSummary {
  meta: CockpitMeta
  cycleContext: CockpitCycleContext
  kpis: CockpitMetric[]
  objectiveRows: CockpitObjectiveRow[]
  attention: CockpitAttentionItem[]
  portfolioTrafficLight: CockpitPortfolioTrafficLightBlock
  priorityInvestment: CockpitPriorityInvestmentBlock
  resourceRisk: CockpitResourceRiskBlock
  sourceFreshness: CockpitSourceFreshness[]
  warnings: CockpitWarning[]
}

export interface CockpitSummaryResponse {
  data: CockpitSummary
}

export interface CockpitReadAudit {
  actorId: number
  organizationId: number
  cycleId: number | null
  overallStatus: CockpitOverallStatus
  metricKeys: CockpitMetricKey[]
  sourceFreshnessHashes: Array<{ source: CockpitSource; hash: string }>
  querySignatureHash: string
  occurredAt: string
}

// ─── Query 类型 ────────────────────────────────────────────────────────────────
export interface CockpitQuery {
  cycleId?: number
  scope?: OkrScope | OkrScope[]
  ownerId?: number
  status?: OkrStatus | OkrStatus[]
  theme?: string | string[]
  include?: CockpitInclude | CockpitInclude[]
  freshnessWindowMinutes?: number
  attentionLimit?: number
  sort?: CockpitSortKey
  order?: 'asc' | 'desc'
  dateFrom?: string
  dateTo?: string
}

export interface NormalizedCockpitQuery {
  cycleId?: number
  scopes: OkrScope[]
  ownerIds: number[]
  statuses: OkrStatus[]
  themes: string[]
  includes: CockpitInclude[]
  freshnessWindowMinutes: number
  attentionLimit: number
  sort: CockpitSortKey
  order: 'asc' | 'desc'
  dateFrom?: string
  dateTo?: string
}

export interface CockpitValidationDetail {
  allowedScopes: readonly OkrScope[]
  allowedStatuses: readonly OkrStatus[]
  allowedIncludes: readonly CockpitInclude[]
  allowedSorts: readonly CockpitSortKey[]
  maxAttentionLimit: number
  maxFreshnessWindowMinutes: number
  maxDateWindowDays: number
  maxScopeCardinality: number
  maxOwnerCardinality: number
  maxStatusCardinality: number
  maxThemeCardinality: number
  maxIncludeCardinality: number
  maxMappedProjects: number
}

// ─── 内部事实类型（source adapter 的低敏输出，不暴露领域原始 DTO）───────────────
export interface CockpitObjectiveFact {
  id: number
  organizationId: number
  cycleId: number | null
  projectId: number | null
  scope: OkrScope | null
  title: string
  status: OkrStatus
  progress: number
  confidence: 'low' | 'medium' | 'high'
  priorityBand: 'high' | 'medium' | 'low' | 'unknown' | null
  updatedAt: string | null
}

export interface CockpitKeyResultFact {
  id: number
  organizationId: number
  objectiveId: number
  status: OkrStatus
  progress: number
  updatedAt: string | null
}

export interface CockpitMappingFact {
  id: number
  organizationId: number
  objectiveId: number
  keyResultId: number | null
  projectId: number
  kind: CockpitMappingKind
  weight: number | null
  contributionPercent: number | null
  active: boolean
  deletedAt: string | null
  sourceVersion: string
  targetVisible: boolean
}

export interface CockpitPortfolioTrafficLightFact {
  available: boolean
  forbidden: boolean
  redCount: number | null
  yellowCount: number | null
  greenCount: number | null
  grayCount: number | null
  lastUpdatedAt: string | null
  sourceVersion: string
}

export interface CockpitPriorityFact {
  available: boolean
  forbidden: boolean
  unsupportedFinancial: boolean
  mismatchCount: number | null
  basis: string
  lastUpdatedAt: string | null
  sourceVersion: string
}

export interface CockpitInvestmentFact {
  available: boolean
  forbidden: boolean
  unsupportedFinancial: boolean
  mismatchCount: number | null
  basis: string
  lastUpdatedAt: string | null
  sourceVersion: string
}

export interface CockpitResourceRiskFact {
  available: boolean
  forbidden: boolean
  pressureCount: number | null
  lastUpdatedAt: string | null
  sourceVersion: string
}

export interface CockpitBackflowFact {
  available: boolean
  forbidden: boolean
  candidateCount: number | null
  lastUpdatedAt: string | null
  sourceVersion: string
}

/** source adapter 统一 output allowlist 结构（3.1）。 */
export type CockpitSourceResult =
  | { source: CockpitSource; status: CockpitSourceStatus; freshness: CockpitSourceFreshness }
  | {
      source: CockpitSource
      status: CockpitSourceStatus
      freshness: CockpitSourceFreshness
      value: unknown
    }

// ─── 纯函数：归一化 query ───────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.trunc(value), min), max)
}

function coerceArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function uniq<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

export function cockpitValidationDetail(): CockpitValidationDetail {
  return {
    allowedScopes: ['organization', 'team', 'project', 'individual'],
    allowedStatuses: ['draft', 'active', 'paused', 'completed', 'archived'],
    allowedIncludes: [...COCKPIT_INCLUDE_VALUES],
    allowedSorts: [...COCKPIT_SORT_KEY_VALUES],
    maxAttentionLimit: COCKPIT_MAX_ATTENTION_LIMIT,
    maxFreshnessWindowMinutes: COCKPIT_MAX_FRESHNESS_MINUTES,
    maxDateWindowDays: COCKPIT_MAX_DATE_WINDOW_DAYS,
    maxScopeCardinality: COCKPIT_MAX_SCOPE_CARDINALITY,
    maxOwnerCardinality: COCKPIT_MAX_OWNER_CARDINALITY,
    maxStatusCardinality: COCKPIT_MAX_STATUS_CARDINALITY,
    maxThemeCardinality: COCKPIT_MAX_THEME_CARDINALITY,
    maxIncludeCardinality: COCKPIT_MAX_INCLUDE_CARDINALITY,
    maxMappedProjects: COCKPIT_MAX_MAPPED_PROJECTS,
  }
}

export function normalizeCockpitQuery(query: CockpitQuery = {}): NormalizedCockpitQuery {
  const detail = cockpitValidationDetail()
  const includes = uniq(
    coerceArray(query.include).filter((value): value is CockpitInclude =>
      COCKPIT_INCLUDE_VALUES.includes(value),
    ),
  )
  const scopes = uniq(
    coerceArray(query.scope).filter((value): value is OkrScope =>
      detail.allowedScopes.includes(value),
    ),
  )
  const statuses = uniq(
    coerceArray(query.status).filter((value): value is OkrStatus =>
      detail.allowedStatuses.includes(value),
    ),
  )
  const ownerIds = uniq(
    coerceArray(query.ownerId)
      .filter((value) => Number.isFinite(Number(value)))
      .map((value) => Math.trunc(Number(value))),
  )
  const themes = uniq(
    coerceArray(query.theme)
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0 && value.length <= 80),
  )
  const sort = COCKPIT_SORT_KEY_VALUES.includes(query.sort as CockpitSortKey)
    ? (query.sort as CockpitSortKey)
    : COCKPIT_SORT_KEYS.RISK
  return {
    cycleId:
      query.cycleId !== undefined && Number.isFinite(Number(query.cycleId))
        ? Math.trunc(Number(query.cycleId))
        : undefined,
    scopes: scopes.slice(0, detail.maxScopeCardinality),
    ownerIds: ownerIds.slice(0, detail.maxOwnerCardinality),
    statuses: statuses.slice(0, detail.maxStatusCardinality),
    themes: themes.slice(0, detail.maxThemeCardinality),
    includes: (includes.length > 0 ? includes : [...COCKPIT_INCLUDE_VALUES]).slice(
      0,
      detail.maxIncludeCardinality,
    ),
    freshnessWindowMinutes: clamp(
      query.freshnessWindowMinutes ?? COCKPIT_DEFAULT_FRESHNESS_MINUTES,
      1,
      detail.maxFreshnessWindowMinutes,
    ),
    attentionLimit: clamp(
      query.attentionLimit ?? COCKPIT_DEFAULT_ATTENTION_LIMIT,
      1,
      detail.maxAttentionLimit,
    ),
    sort,
    order: query.order === 'asc' || query.order === 'desc' ? query.order : 'desc',
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
  }
}

// ─── 纯函数：stable hash / freshness / 状态矩阵 ────────────────────────────────

/** 稳定 FNV-1a 哈希——input signature 与 freshness 指纹用。 */
export function cockpitStableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function isCockpitSourceStale(
  lastUpdatedAt: string | null,
  thresholdMinutes: number,
  now: number = Date.now(),
): boolean {
  if (!lastUpdatedAt) return true
  const last = new Date(lastUpdatedAt).getTime()
  if (!Number.isFinite(last)) return true
  return now - last > thresholdMinutes * 60 * 1000
}

export function makeCockpitSourceFreshness(input: {
  source: CockpitSource
  lastUpdatedAt: string | null
  staleThresholdMinutes?: number
  now?: number
  forbidden?: boolean
  unavailable?: boolean
  unsupported?: boolean
  partial?: boolean
}): CockpitSourceFreshness {
  const threshold = input.staleThresholdMinutes ?? COCKPIT_DEFAULT_FRESHNESS_MINUTES
  const status: CockpitSourceStatus = input.forbidden
    ? COCKPIT_SOURCE_STATUSES.FORBIDDEN
    : input.unavailable
      ? COCKPIT_SOURCE_STATUSES.UNAVAILABLE
      : input.unsupported
        ? COCKPIT_SOURCE_STATUSES.UNSUPPORTED
        : input.partial
          ? COCKPIT_SOURCE_STATUSES.PARTIAL
          : isCockpitSourceStale(input.lastUpdatedAt, threshold, input.now)
            ? COCKPIT_SOURCE_STATUSES.STALE
            : COCKPIT_SOURCE_STATUSES.AVAILABLE
  return {
    source: input.source,
    lastUpdatedAt: input.lastUpdatedAt,
    isStale: status === COCKPIT_SOURCE_STATUSES.STALE,
    staleThresholdMinutes: threshold,
    status,
  }
}

export function cockpitFreshnessHash(freshness: CockpitSourceFreshness): string {
  return cockpitStableHash(
    [freshness.source, freshness.lastUpdatedAt ?? '', freshness.status].join(':'),
  )
}

/**
 * D7 状态矩阵：mandatory 来源失败 → unavailable；mandatory 可用但关键 optional
 * 非 available → degraded；其余 → ready。空战略范围由调用方按 EMPTY 处理。
 */
export function deriveCockpitOverallStatus(input: {
  sourceStatuses: CockpitSourceStatus[]
  mandatorySources: CockpitSource[]
}): Exclude<CockpitOverallStatus, 'empty'> {
  const mandatory = new Set(input.mandatorySources)
  const statuses = input.sourceStatuses
  if (statuses.some((status) => status === COCKPIT_SOURCE_STATUSES.FORBIDDEN)) {
    return COCKPIT_OVERALL_STATUSES.UNAVAILABLE
  }
  if (statuses.some((status) => status === COCKPIT_SOURCE_STATUSES.UNAVAILABLE)) {
    return COCKPIT_OVERALL_STATUSES.UNAVAILABLE
  }
  if (statuses.some((status) => status === COCKPIT_SOURCE_STATUSES.UNSUPPORTED)) {
    return COCKPIT_OVERALL_STATUSES.DEGRADED
  }
  if (
    statuses.some(
      (status) =>
        status === COCKPIT_SOURCE_STATUSES.STALE || status === COCKPIT_SOURCE_STATUSES.PARTIAL,
    )
  ) {
    return COCKPIT_OVERALL_STATUSES.DEGRADED
  }
  // mandatory 全部 available，optional 也均为 available 才算 ready；否则 degraded
  const mandatoryAvailable = [...mandatory].every((_source) =>
    statuses.includes(COCKPIT_SOURCE_STATUSES.AVAILABLE),
  )
  return mandatoryAvailable ? COCKPIT_OVERALL_STATUSES.READY : COCKPIT_OVERALL_STATUSES.DEGRADED
}

// ─── 纯函数：显式 mapping 校验与投影（D3）───────────────────────────────────────

export interface MappingValidationResult {
  valid: boolean
  status: 'ok' | 'missing' | 'forbidden' | 'unavailable' | 'invalid'
  warning?: CockpitWarning
}

export function validateCockpitMapping(input: {
  mapping: CockpitMappingFact | null
  organizationId: number
  cycleId: number | null
  visibleProjectIds: Set<number>
}): MappingValidationResult {
  const m = input.mapping
  if (!m) {
    return {
      valid: false,
      status: 'missing',
      warning: {
        code: COCKPIT_WARNING_CODES.EXECUTION_MAPPING_MISSING,
        message: '无可用的显式 OKR→项目映射事实',
        source: COCKPIT_SOURCES.OKR_MAPPING,
      },
    }
  }
  if (m.deletedAt || !m.active) {
    return {
      valid: false,
      status: 'invalid',
      warning: {
        code: COCKPIT_WARNING_CODES.EXECUTION_MAPPING_UNAVAILABLE,
        message: '映射已删除或未激活',
        source: COCKPIT_SOURCES.OKR_MAPPING,
      },
    }
  }
  if (Number(m.organizationId) !== Number(input.organizationId)) {
    return {
      valid: false,
      status: 'forbidden',
      warning: {
        code: COCKPIT_WARNING_CODES.EXECUTION_MAPPING_FORBIDDEN,
        message: '跨组织映射不可见',
        source: COCKPIT_SOURCES.OKR_MAPPING,
      },
    }
  }
  if (!m.targetVisible) {
    return {
      valid: false,
      status: 'forbidden',
      warning: {
        code: COCKPIT_WARNING_CODES.EXECUTION_MAPPING_FORBIDDEN,
        message: '目标项目不可见',
        source: COCKPIT_SOURCES.OKR_MAPPING,
      },
    }
  }
  if (!input.visibleProjectIds.has(Number(m.projectId))) {
    return {
      valid: false,
      status: 'unavailable',
      warning: {
        code: COCKPIT_WARNING_CODES.EXECUTION_MAPPING_UNAVAILABLE,
        message: '目标项目不在可见集合中',
        source: COCKPIT_SOURCES.OKR_MAPPING,
      },
    }
  }
  if (!COCKPIT_MAPPING_KIND_VALUES.includes(m.kind)) {
    return {
      valid: false,
      status: 'invalid',
      warning: {
        code: COCKPIT_WARNING_CODES.EXECUTION_MAPPING_UNAVAILABLE,
        message: '未知映射 kind',
        source: COCKPIT_SOURCES.OKR_MAPPING,
      },
    }
  }
  if (m.weight !== null && (!Number.isFinite(m.weight) || m.weight < 0)) {
    return {
      valid: false,
      status: 'invalid',
      warning: {
        code: COCKPIT_WARNING_CODES.EXECUTION_MAPPING_UNAVAILABLE,
        message: '映射权重非法',
        source: COCKPIT_SOURCES.OKR_MAPPING,
      },
    }
  }
  return { valid: true, status: 'ok' }
}

/** 把合法映射投影为低敏 block；cycle 不一致时标记 invalid。 */
export function projectExplicitCockpitMappings(input: {
  mappings: CockpitMappingFact[]
  organizationId: number
  cycleId: number | null
  visibleProjectIds: Set<number>
}): {
  valid: CockpitMappingProjection[]
  invalidCount: number
  forbiddenCount: number
  missingCount: number
  unavailableCount: number
} {
  const valid: CockpitMappingProjection[] = []
  let invalidCount = 0
  let forbiddenCount = 0
  let missingCount = 0
  let unavailableCount = 0
  for (const mapping of input.mappings) {
    const result = validateCockpitMapping({
      mapping,
      organizationId: input.organizationId,
      cycleId: input.cycleId,
      visibleProjectIds: input.visibleProjectIds,
    })
    if (!result.valid) {
      if (result.status === 'forbidden') forbiddenCount += 1
      else if (result.status === 'unavailable') unavailableCount += 1
      else if (result.status === 'missing') missingCount += 1
      else invalidCount += 1
      continue
    }
    valid.push({
      kind: mapping.kind,
      projectId: Number(mapping.projectId),
      weight: mapping.weight,
      contributionPercent: mapping.contributionPercent,
      sourceVersion: mapping.sourceVersion,
      target: {
        kind: COCKPIT_TARGET_KINDS.PMO_PORTFOLIO,
        href: `/projects/${mapping.projectId}`,
        authorized: true,
      },
      authorized: true,
    })
  }
  return { valid, invalidCount, forbiddenCount, missingCount, unavailableCount }
}

// ─── 纯函数：attention rules（D4）与确定性排序、有界截断 ─────────────────────────

export interface CockpitAttentionRuleInput {
  objective: CockpitObjectiveFact
  mappedCount: number
  coveragePercent: number | null
  projectHealth: Array<'green' | 'yellow' | 'red' | 'unknown'>
  investmentMismatch: boolean
  staleSources: CockpitSource[]
  now: number
  /** cycle 已过百分比 [0,100]；缺省时不做 behind 判断。 */
  elapsedPercent?: number
}

export function evaluateCockpitAttentionRules(input: CockpitAttentionRuleInput): Array<{
  reason: CockpitAttentionReason
  severity: 'info' | 'warning' | 'critical'
  basis: string
}> {
  const items: Array<{
    reason: CockpitAttentionReason
    severity: 'info' | 'warning' | 'critical'
    basis: string
  }> = []
  const risk = input.projectHealth.some((health) => health === 'red')
  const behind =
    input.elapsedPercent !== undefined &&
    input.objective.status === 'active' &&
    input.objective.progress + 15 < input.elapsedPercent
  // 不以输入推断未知进度：仅用传入 objective progress 与固定阈值做保守判断
  if (behind && risk) {
    items.push({
      reason: COCKPIT_ATTENTION_REASONS.STRATEGY_PROGRESS_AT_RISK,
      severity: 'critical',
      basis: 'objective behind && mapped project red/blocked',
    })
  }
  if (input.mappedCount === 0) {
    items.push({
      reason:
        input.coveragePercent === null
          ? COCKPIT_ATTENTION_REASONS.EXECUTION_COVERAGE_UNAVAILABLE
          : COCKPIT_ATTENTION_REASONS.EXECUTION_COVERAGE_GAP,
      severity: 'warning',
      basis: 'no active explicit mapping coverage',
    })
  }
  if (input.investmentMismatch) {
    items.push({
      reason: COCKPIT_ATTENTION_REASONS.INVESTMENT_PRIORITY_MISMATCH,
      severity: 'warning',
      basis: 'non-financial investment distribution inconsistent with authoritative priority',
    })
  }
  if (input.staleSources.length > 0) {
    items.push({
      reason: COCKPIT_ATTENTION_REASONS.EXECUTION_SOURCE_STALE,
      severity: 'info',
      basis: 'execution source stale',
    })
  }
  return items
}

export interface CockpitAttentionSortInput {
  severity: 'info' | 'warning' | 'critical'
  reason: CockpitAttentionReason
}

const SEVERITY_ORDER: Record<'info' | 'warning' | 'critical', number> = {
  info: 0,
  warning: 1,
  critical: 2,
}

export function compareCockpitAttention(
  a: CockpitAttentionSortInput,
  b: CockpitAttentionSortInput,
): number {
  const bySeverity = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
  if (bySeverity !== 0) return bySeverity
  return a.reason.localeCompare(b.reason)
}

export function sortCockpitAttention<T extends CockpitAttentionSortInput>(items: T[]): T[] {
  return [...items].sort(compareCockpitAttention)
}

/** 有界截断：返回截断后的 attention 与是否发生截断。 */
export function boundCockpitAttention<T extends CockpitAttentionSortInput>(
  items: T[],
  limit: number,
): { items: T[]; truncated: boolean } {
  const bounded = [...items].sort(compareCockpitAttention).slice(0, Math.max(1, Math.trunc(limit)))
  return { items: bounded, truncated: bounded.length < items.length }
}

export function cockpitEmptyStrategyWarning(): CockpitWarning {
  return {
    code: COCKPIT_WARNING_CODES.EMPTY_STRATEGY_SCOPE,
    message: '该组织当前无可见 OKR 周期、目标或关键结果',
    source: COCKPIT_SOURCES.OKR_OBJECTIVE,
  }
}

export function cockpitSourceStaleWarning(source: CockpitSource): CockpitWarning {
  return {
    code: COCKPIT_WARNING_CODES.SOURCE_STALE,
    message: `来源 ${source} 数据过期`,
    source,
  }
}

export function cockpitSourcePartialWarning(source: CockpitSource): CockpitWarning {
  return {
    code: COCKPIT_WARNING_CODES.SOURCE_PARTIAL,
    message: `来源 ${source} 数据不完整`,
    source,
  }
}

export function cockpitSourceUnavailableWarning(source: CockpitSource): CockpitWarning {
  return {
    code: COCKPIT_WARNING_CODES.SOURCE_UNAVAILABLE,
    message: `来源 ${source} 不可用`,
    source,
  }
}

export function cockpitSourceForbiddenWarning(source: CockpitSource): CockpitWarning {
  return {
    code: COCKPIT_WARNING_CODES.SOURCE_FORBIDDEN,
    message: `来源 ${source} 因权限受限不可见`,
    source,
  }
}

export function cockpitFinancialUnsupportedWarning(): CockpitWarning {
  return {
    code: COCKPIT_WARNING_CODES.FINANCIAL_UNSUPPORTED,
    message: '财务/预算/ROI 指标不在当前范围，禁止以计划小时或分配比例代理',
  }
}

export function cockpitPermissionRedactedWarning(): CockpitWarning {
  return {
    code: COCKPIT_WARNING_CODES.PERMISSION_REDACTED,
    message: '部分维度因权限不足已脱敏',
  }
}

export function cockpitAttentionTruncatedWarning(): CockpitWarning {
  return {
    code: COCKPIT_WARNING_CODES.ATTENTION_TRUNCATED,
    message: '注意力队列已按规定上限截断',
  }
}

export function mergeCockpitWarnings(
  ...groups: Array<CockpitWarning[] | undefined>
): CockpitWarning[] {
  const seen = new Set<string>()
  const merged: CockpitWarning[] = []
  for (const group of groups) {
    for (const warning of group ?? []) {
      const key = [warning.code, warning.source ?? '', warning.metricKey ?? ''].join(':')
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(warning)
    }
  }
  return merged
}

// ─── 纯函数：forbidden-field guard / redaction（D5/3.6）─────────────────────────

export const COCKPIT_FORBIDDEN_KEYS: readonly string[] = [
  'prompt',
  'modelOutput',
  'model_output',
  'evidence',
  'evidenceText',
  'evidence_text',
  'secret',
  'token',
  'accessToken',
  'access_token',
  'apiKey',
  'api_key',
  'authorization',
  'password',
  'refreshToken',
  'refresh_token',
]

export interface CockpitForbiddenFieldFinding {
  path: string
  key: string
}

export function detectCockpitForbiddenFields(
  value: unknown,
  path = 'root',
): CockpitForbiddenFieldFinding[] {
  const findings: CockpitForbiddenFieldFinding[] = []
  if (value === null || value === undefined) return findings
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      findings.push(...detectCockpitForbiddenFields(item, `${path}[${index}]`))
    })
    return findings
  }
  if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (COCKPIT_FORBIDDEN_KEYS.includes(key)) {
        findings.push({ path: `${path}.${key}`, key })
        continue
      }
      findings.push(...detectCockpitForbiddenFields(val, `${path}.${key}`))
    }
  }
  return findings
}

/** 确定性 redaction：把命中 forbidden 的 key 替换为低敏占位符，避免响应泄露。 */
export function redactCockpitForbiddenFields(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) {
    return value.map((item) => redactCockpitForbiddenFields(item))
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (COCKPIT_FORBIDDEN_KEYS.includes(key)) {
        out[key] = '[redacted]'
      } else {
        out[key] = redactCockpitForbiddenFields(val)
      }
    }
    return out
  }
  return value
}

export function cockpitWarningCodes(warnings: readonly CockpitWarning[]): CockpitWarningCode[] {
  return [...new Set(warnings.map((warning) => warning.code))]
}
