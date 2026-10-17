// @aiproj/types - PMO Investment Distribution shared contract.
// v3-pmo-investment-distribution: non-financial investment proxy distribution.

// ─── Basis Catalogue ──────────────────────────────────────────────────────────

export const PMO_INVESTMENT_NON_FINANCIAL_BASIS = {
  PROJECT_COUNT: 'project_count',
  PLANNED_EFFORT_HOURS: 'planned_effort_hours',
  ESTIMATED_EFFORT_HOURS: 'estimated_effort_hours',
  RESOURCE_ALLOCATION_PERCENT: 'resource_allocation_percent',
} as const

export type PmoInvestmentNonFinancialBasis =
  (typeof PMO_INVESTMENT_NON_FINANCIAL_BASIS)[keyof typeof PMO_INVESTMENT_NON_FINANCIAL_BASIS]

export const PMO_INVESTMENT_UNSUPPORTED_FINANCIAL_BASIS = {
  BUDGET_AMOUNT: 'budget_amount',
  ACTUAL_COST: 'actual_cost',
  FORECAST_COST: 'forecast_cost',
  BUDGET_EXECUTION_RATE: 'budget_execution_rate',
  ROI: 'roi',
  REVENUE: 'revenue',
  NPV: 'npv',
  IRR: 'irr',
} as const

export type PmoInvestmentFinancialBasis =
  (typeof PMO_INVESTMENT_UNSUPPORTED_FINANCIAL_BASIS)[keyof typeof PMO_INVESTMENT_UNSUPPORTED_FINANCIAL_BASIS]

export const PMO_INVESTMENT_DISTRIBUTION_BASIS = {
  ...PMO_INVESTMENT_NON_FINANCIAL_BASIS,
  ...PMO_INVESTMENT_UNSUPPORTED_FINANCIAL_BASIS,
} as const

export type PmoInvestmentDistributionBasis =
  (typeof PMO_INVESTMENT_DISTRIBUTION_BASIS)[keyof typeof PMO_INVESTMENT_DISTRIBUTION_BASIS]

export const PMO_INVESTMENT_DISTRIBUTION_BASIS_VALUES = Object.values(
  PMO_INVESTMENT_DISTRIBUTION_BASIS,
) as PmoInvestmentDistributionBasis[]

export const PMO_INVESTMENT_NON_FINANCIAL_BASIS_VALUES = Object.values(
  PMO_INVESTMENT_NON_FINANCIAL_BASIS,
) as PmoInvestmentNonFinancialBasis[]

export const PMO_INVESTMENT_FINANCIAL_BASIS_VALUES = Object.values(
  PMO_INVESTMENT_UNSUPPORTED_FINANCIAL_BASIS,
) as PmoInvestmentFinancialBasis[]

// ─── Dimensions And Display Modes ─────────────────────────────────────────────

export const PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS = {
  PROJECT_TYPE: 'project_type',
  LIFECYCLE_PHASE: 'lifecycle_phase',
  PRIORITY: 'priority',
  STATUS: 'status',
  MANAGER: 'manager',
  DEPARTMENT: 'department',
  STRATEGIC_THEME: 'strategic_theme',
  TRAFFIC_LIGHT_STATUS: 'traffic_light_status',
} as const

export type PmoInvestmentDistributionDimension =
  (typeof PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS)[keyof typeof PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS]

export const PMO_INVESTMENT_DISTRIBUTION_DIMENSION_VALUES = Object.values(
  PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS,
) as PmoInvestmentDistributionDimension[]

export const PMO_INVESTMENT_DISPLAY_MODES = {
  DONUT: 'donut',
  PIE: 'pie',
  HORIZONTAL_BAR: 'horizontal_bar',
  STACKED_BAR: 'stacked_bar',
  FLOW: 'flow',
  MATRIX: 'matrix',
} as const

export type PmoInvestmentDisplayMode =
  (typeof PMO_INVESTMENT_DISPLAY_MODES)[keyof typeof PMO_INVESTMENT_DISPLAY_MODES]

export const PMO_INVESTMENT_DISPLAY_MODE_VALUES = Object.values(
  PMO_INVESTMENT_DISPLAY_MODES,
) as PmoInvestmentDisplayMode[]

// ─── Sources, Statuses, And Warnings ──────────────────────────────────────────

export const PMO_INVESTMENT_SOURCES = {
  PROJECT: 'project',
  TASK_REQUIREMENT: 'task_requirement',
  RESOURCE_ALLOCATION: 'resource_allocation',
  PORTFOLIO_DASHBOARD: 'portfolio_dashboard',
  TRAFFIC_LIGHT: 'traffic_light',
  COMPUTED: 'computed',
} as const

export type PmoInvestmentSource =
  (typeof PMO_INVESTMENT_SOURCES)[keyof typeof PMO_INVESTMENT_SOURCES]

export const PMO_INVESTMENT_BUCKET_STATUSES = {
  OK: 'ok',
  EMPTY: 'empty',
  UNAVAILABLE: 'unavailable',
  FORBIDDEN: 'forbidden',
  STALE: 'stale',
  UNSUPPORTED: 'unsupported',
  REDACTED: 'redacted',
} as const

export type PmoInvestmentBucketStatus =
  (typeof PMO_INVESTMENT_BUCKET_STATUSES)[keyof typeof PMO_INVESTMENT_BUCKET_STATUSES]

export const PMO_INVESTMENT_WARNING_CODES = {
  EMPTY_PORTFOLIO: 'EMPTY_PORTFOLIO',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  SOURCE_STALE: 'SOURCE_STALE',
  PERMISSION_REDACTED: 'PERMISSION_REDACTED',
  LOW_CARDINALITY_REDACTED: 'LOW_CARDINALITY_REDACTED',
  FINANCIAL_BASIS_UNSUPPORTED: 'FINANCIAL_BASIS_UNSUPPORTED',
  FINANCIAL_SOURCE_UNAVAILABLE: 'FINANCIAL_SOURCE_UNAVAILABLE',
  DISPLAY_MODE_UNAVAILABLE: 'DISPLAY_MODE_UNAVAILABLE',
  CACHE_DEGRADED: 'CACHE_DEGRADED',
  INSUFFICIENT_SOURCE_DATA: 'INSUFFICIENT_SOURCE_DATA',
  VALIDATION_BOUNDED: 'VALIDATION_BOUNDED',
} as const

export type PmoInvestmentWarningCode =
  (typeof PMO_INVESTMENT_WARNING_CODES)[keyof typeof PMO_INVESTMENT_WARNING_CODES]

export interface PmoInvestmentDistributionWarning {
  code: PmoInvestmentWarningCode
  message: string
  basis?: PmoInvestmentDistributionBasis
  dimension?: PmoInvestmentDistributionDimension
  displayMode?: PmoInvestmentDisplayMode
  source?: PmoInvestmentSource
  bucketKey?: string
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface PmoInvestmentEvidenceRef {
  source: PmoInvestmentSource
  refHash: string
  valueSummary: string
  lastUpdatedAt: string | null
  available: boolean
  forbidden: boolean
}

export interface PmoInvestmentSourceFreshness {
  source: PmoInvestmentSource
  lastUpdatedAt: string | null
  isStale: boolean
  staleThresholdMinutes: number
}

export interface PmoInvestmentBucket {
  key: string
  label: string
  total: number | null
  percent: number
  projectCount: number | null
  status: PmoInvestmentBucketStatus
  evidenceRefs: PmoInvestmentEvidenceRef[]
  warnings: PmoInvestmentDistributionWarning[]
}

export interface PmoInvestmentTrendBucket {
  label: string
  startDate: string
  endDate: string
  buckets: PmoInvestmentBucket[]
  totalBasisValue: number | null
  warnings: PmoInvestmentDistributionWarning[]
}

export interface PmoInvestmentDrillDownItem {
  projectId: number
  projectName: string
  bucketKey: string
  basisValue: number | null
  status: PmoInvestmentBucketStatus
  evidenceRefs: PmoInvestmentEvidenceRef[]
  warnings: PmoInvestmentDistributionWarning[]
}

export interface PmoInvestmentDistributionMeta {
  calculatedAt: string
  metricVersion: string
  organizationId: number
  actorId: number
  visibleProjectCount: number
  basis: PmoInvestmentDistributionBasis
  dimension: PmoInvestmentDistributionDimension
  displayMode: PmoInvestmentDisplayMode
  totalBasisValue: number | null
  sourceFreshness: PmoInvestmentSourceFreshness[]
  inputSignatureHash?: string
}

export interface PmoInvestmentDistributionSummary {
  meta: PmoInvestmentDistributionMeta
  buckets: PmoInvestmentBucket[]
  warnings: PmoInvestmentDistributionWarning[]
}

export interface PmoInvestmentDistributionTrendResponse {
  meta: PmoInvestmentDistributionMeta
  data: PmoInvestmentTrendBucket[]
  warnings: PmoInvestmentDistributionWarning[]
}

export interface PmoInvestmentDistributionDrillDownResponse {
  meta: PmoInvestmentDistributionMeta
  data: PmoInvestmentDrillDownItem[]
  warnings: PmoInvestmentDistributionWarning[]
}

export interface PmoInvestmentSupportedCatalogue {
  nonFinancialBasis: PmoInvestmentNonFinancialBasis[]
  unsupportedFinancialBasis: PmoInvestmentFinancialBasis[]
  dimensions: PmoInvestmentDistributionDimension[]
  displayModes: PmoInvestmentDisplayMode[]
  topN: {
    default: number
    max: number
  }
  trendWindows: PmoInvestmentTrendWindow[]
  metricVersion: string
}

export const PMO_INVESTMENT_TREND_WINDOWS = {
  LAST_30_DAYS: 'last_30_days',
  LAST_90_DAYS: 'last_90_days',
} as const

export type PmoInvestmentTrendWindow =
  (typeof PMO_INVESTMENT_TREND_WINDOWS)[keyof typeof PMO_INVESTMENT_TREND_WINDOWS]

export const PMO_INVESTMENT_TREND_WINDOW_VALUES = Object.values(
  PMO_INVESTMENT_TREND_WINDOWS,
) as PmoInvestmentTrendWindow[]

export interface PmoInvestmentDistributionQuery {
  basis?: PmoInvestmentDistributionBasis
  dimension?: PmoInvestmentDistributionDimension
  displayMode?: PmoInvestmentDisplayMode
  topN?: number
  trendWindow?: PmoInvestmentTrendWindow
  filterStatus?: string
  filterPriority?: string
  search?: string
}

export interface PmoInvestmentDistributionDrillDownQuery extends PmoInvestmentDistributionQuery {
  bucketKey: string
  page?: number
  perPage?: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const PMO_INVESTMENT_DISTRIBUTION_METRIC_VERSION = 'pmo-investment-distribution.v1' as const
export const PMO_INVESTMENT_DEFAULT_TOP_N = 10
export const PMO_INVESTMENT_MAX_TOP_N = 20
export const PMO_INVESTMENT_MIN_BUCKET_PROJECT_COUNT = 2
export const PMO_INVESTMENT_STALE_THRESHOLD_MINUTES = 60
export const PMO_INVESTMENT_HOURS_PER_PERSON_DAY = 8

// ─── Contract Helpers ─────────────────────────────────────────────────────────

function includesValue<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value)
}

function roundTwo(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function isPmoInvestmentNonFinancialBasis(
  value: string,
): value is PmoInvestmentNonFinancialBasis {
  return includesValue(PMO_INVESTMENT_NON_FINANCIAL_BASIS_VALUES, value)
}

export function isPmoInvestmentFinancialBasis(value: string): value is PmoInvestmentFinancialBasis {
  return includesValue(PMO_INVESTMENT_FINANCIAL_BASIS_VALUES, value)
}

export function isPmoInvestmentDistributionBasis(
  value: string,
): value is PmoInvestmentDistributionBasis {
  return includesValue(PMO_INVESTMENT_DISTRIBUTION_BASIS_VALUES, value)
}

export function isPmoInvestmentDimension(
  value: string,
): value is PmoInvestmentDistributionDimension {
  return includesValue(PMO_INVESTMENT_DISTRIBUTION_DIMENSION_VALUES, value)
}

export function isPmoInvestmentDisplayMode(value: string): value is PmoInvestmentDisplayMode {
  return includesValue(PMO_INVESTMENT_DISPLAY_MODE_VALUES, value)
}

export function isPmoInvestmentTrendWindow(value: string): value is PmoInvestmentTrendWindow {
  return includesValue(PMO_INVESTMENT_TREND_WINDOW_VALUES, value)
}

export function investmentHoursFromPersonDays(
  personDays: number,
  hoursPerPersonDay: number = PMO_INVESTMENT_HOURS_PER_PERSON_DAY,
): number {
  return roundTwo(personDays * hoursPerPersonDay)
}

export function isInvestmentSourceStale(
  lastUpdatedAt: string | null,
  thresholdMinutes: number = PMO_INVESTMENT_STALE_THRESHOLD_MINUTES,
): boolean {
  if (!lastUpdatedAt) return true
  return Date.now() - new Date(lastUpdatedAt).getTime() > thresholdMinutes * 60 * 1000
}

export function projectFinancialBasisUnsupportedWarning(
  basis: PmoInvestmentFinancialBasis,
): PmoInvestmentDistributionWarning {
  return {
    code: PMO_INVESTMENT_WARNING_CODES.FINANCIAL_BASIS_UNSUPPORTED,
    message: '财务、预算、成本、收益和 ROI 口径不在当前 PMO 投入分布范围内',
    basis,
  }
}

export function projectFinancialSourceUnavailableWarning(
  basis: PmoInvestmentFinancialBasis,
): PmoInvestmentDistributionWarning {
  return {
    code: PMO_INVESTMENT_WARNING_CODES.FINANCIAL_SOURCE_UNAVAILABLE,
    message: '当前没有已批准的财务事实来源，不能生成该投资分布',
    basis,
  }
}

export function projectSourceUnavailableInvestmentWarning(
  source: PmoInvestmentSource,
  basis?: PmoInvestmentDistributionBasis,
): PmoInvestmentDistributionWarning {
  return {
    code: PMO_INVESTMENT_WARNING_CODES.SOURCE_UNAVAILABLE,
    message: '所选投入分布来源当前不可用',
    source,
    basis,
  }
}

export function projectStaleInvestmentWarning(
  source: PmoInvestmentSource,
): PmoInvestmentDistributionWarning {
  return {
    code: PMO_INVESTMENT_WARNING_CODES.SOURCE_STALE,
    message: '所选投入分布来源已过期',
    source,
  }
}

export function projectPermissionRedactedInvestmentWarning(
  dimension?: PmoInvestmentDistributionDimension,
  basis?: PmoInvestmentDistributionBasis,
  bucketKey?: string,
): PmoInvestmentDistributionWarning {
  return {
    code: PMO_INVESTMENT_WARNING_CODES.PERMISSION_REDACTED,
    message: '当前用户无权查看该投入分布明细，结果已脱敏',
    dimension,
    basis,
    bucketKey,
  }
}

export function projectLowCardinalityRedactedWarning(
  dimension?: PmoInvestmentDistributionDimension,
): PmoInvestmentDistributionWarning {
  return {
    code: PMO_INVESTMENT_WARNING_CODES.LOW_CARDINALITY_REDACTED,
    message: '低基数桶已合并或脱敏，以避免泄露受限项目或团队信息',
    dimension,
  }
}

export function projectDisplayModeUnavailableWarning(
  displayMode: PmoInvestmentDisplayMode,
): PmoInvestmentDistributionWarning {
  return {
    code: PMO_INVESTMENT_WARNING_CODES.DISPLAY_MODE_UNAVAILABLE,
    message: '所选展示模式在当前数据或权限范围下不可用',
    displayMode,
  }
}

export function projectEmptyInvestmentPortfolioWarning(): PmoInvestmentDistributionWarning {
  return {
    code: PMO_INVESTMENT_WARNING_CODES.EMPTY_PORTFOLIO,
    message: '当前范围内没有可见项目',
  }
}

export function buildRedactedInvestmentBucket(input: {
  key?: string
  label?: string
  dimension?: PmoInvestmentDistributionDimension
  basis?: PmoInvestmentDistributionBasis
  status?: Extract<PmoInvestmentBucketStatus, 'forbidden' | 'redacted'>
}): PmoInvestmentBucket {
  const key = input.key ?? 'redacted'
  return {
    key,
    label: input.label ?? '受限数据',
    total: null,
    percent: 0,
    projectCount: null,
    status: input.status ?? PMO_INVESTMENT_BUCKET_STATUSES.REDACTED,
    evidenceRefs: [],
    warnings: [projectPermissionRedactedInvestmentWarning(input.dimension, input.basis, key)],
  }
}

export function normalizeInvestmentBucketPercentages(
  buckets: readonly PmoInvestmentBucket[],
): PmoInvestmentBucket[] {
  const numericBuckets = buckets.filter((bucket) => typeof bucket.total === 'number')
  const basisTotal = numericBuckets.reduce((sum, bucket) => sum + (bucket.total ?? 0), 0)
  if (basisTotal <= 0) {
    return buckets.map((bucket) => ({ ...bucket, percent: 0 }))
  }

  const normalized = buckets.map((bucket) => ({
    ...bucket,
    percent: typeof bucket.total === 'number' ? roundTwo((bucket.total / basisTotal) * 100) : 0,
  }))

  const percentageTotal = roundTwo(normalized.reduce((sum, bucket) => sum + bucket.percent, 0))
  const adjustment = roundTwo(100 - percentageTotal)
  if (Math.abs(adjustment) < 0.01) return normalized

  let targetIndex = -1
  let maxTotal = Number.NEGATIVE_INFINITY
  for (const [index, bucket] of normalized.entries()) {
    if (typeof bucket.total === 'number' && bucket.total > maxTotal) {
      targetIndex = index
      maxTotal = bucket.total
    }
  }
  if (targetIndex < 0) return normalized

  return normalized.map((bucket, index) =>
    index === targetIndex ? { ...bucket, percent: roundTwo(bucket.percent + adjustment) } : bucket,
  )
}

export function mergeLowCardinalityInvestmentBuckets(
  buckets: readonly PmoInvestmentBucket[],
  options: {
    minProjectCount?: number
    dimension?: PmoInvestmentDistributionDimension
    otherKey?: string
    otherLabel?: string
  } = {},
): PmoInvestmentBucket[] {
  const minProjectCount = options.minProjectCount ?? PMO_INVESTMENT_MIN_BUCKET_PROJECT_COUNT
  const protectedBuckets = buckets.filter(
    (bucket) =>
      typeof bucket.projectCount === 'number' &&
      bucket.projectCount > 0 &&
      bucket.projectCount < minProjectCount,
  )
  if (protectedBuckets.length === 0) return normalizeInvestmentBucketPercentages(buckets)

  const visibleBuckets = buckets.filter((bucket) => !protectedBuckets.includes(bucket))
  const otherKey = options.otherKey ?? 'other'
  const otherBucket: PmoInvestmentBucket = {
    key: otherKey,
    label: options.otherLabel ?? '其他',
    total: null,
    percent: 0,
    projectCount: null,
    status: PMO_INVESTMENT_BUCKET_STATUSES.REDACTED,
    evidenceRefs: [],
    warnings: [projectLowCardinalityRedactedWarning(options.dimension)],
  }

  return normalizeInvestmentBucketPercentages([...visibleBuckets, otherBucket])
}

export function makeLowSensitiveInvestmentEvidenceRef(input: {
  source: PmoInvestmentSource
  refSeed: string
  valueSummary: string
  lastUpdatedAt?: string | null
  available?: boolean
  forbidden?: boolean
}): PmoInvestmentEvidenceRef {
  return {
    source: input.source,
    refHash: stableHash(`${input.source}:${input.refSeed}`),
    valueSummary: input.valueSummary,
    lastUpdatedAt: input.lastUpdatedAt ?? null,
    available: input.available ?? true,
    forbidden: input.forbidden ?? false,
  }
}

export function isLowSensitiveInvestmentEvidenceRef(ref: PmoInvestmentEvidenceRef): boolean {
  if (ref.forbidden) return false
  const payload = JSON.stringify(ref).toLowerCase()
  return !['prompt', 'model_output', 'secret', 'token', 'password', 'authorization'].some((term) =>
    payload.includes(term),
  )
}

export function makeInvestmentSourceFreshness(input: {
  source: PmoInvestmentSource
  lastUpdatedAt: string | null
  staleThresholdMinutes?: number
}): PmoInvestmentSourceFreshness {
  const staleThresholdMinutes =
    input.staleThresholdMinutes ?? PMO_INVESTMENT_STALE_THRESHOLD_MINUTES
  return {
    source: input.source,
    lastUpdatedAt: input.lastUpdatedAt,
    staleThresholdMinutes,
    isStale: isInvestmentSourceStale(input.lastUpdatedAt, staleThresholdMinutes),
  }
}

export function buildUnsupportedFinancialInvestmentSummary(input: {
  organizationId: number
  actorId: number
  basis: PmoInvestmentFinancialBasis
  dimension?: PmoInvestmentDistributionDimension
  displayMode?: PmoInvestmentDisplayMode
  calculatedAt?: string
}): PmoInvestmentDistributionSummary {
  const warning = projectFinancialBasisUnsupportedWarning(input.basis)
  return {
    meta: {
      calculatedAt: input.calculatedAt ?? new Date().toISOString(),
      metricVersion: PMO_INVESTMENT_DISTRIBUTION_METRIC_VERSION,
      organizationId: input.organizationId,
      actorId: input.actorId,
      visibleProjectCount: 0,
      basis: input.basis,
      dimension: input.dimension ?? PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.PROJECT_TYPE,
      displayMode: input.displayMode ?? PMO_INVESTMENT_DISPLAY_MODES.DONUT,
      totalBasisValue: null,
      sourceFreshness: [],
    },
    buckets: [],
    warnings: [warning],
  }
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
