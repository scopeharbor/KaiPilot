// @aiproj/types —— 组织级 Dashboard 共享契约（前后端共享）。
// v3-organization-dashboard §2：metric catalogue、DTO、warning、section 白名单、常量与确定性纯函数助手。
//
// 红线：
//   - 只读聚合，无副作用；不含财务/预算/ROI/成本一等字段。
//   - 权限受限维度只返回低敏 forbidden/unavailable 状态，不返回隐藏数量、名称、证据文本或未授权 target。
//   - 所有 drill-down target 由后端授权后下发，前端不得自行拼装未授权链接。

// ─── Metric Keys ───────────────────────────────────────────────────────────────

export const ORGANIZATION_DASHBOARD_METRIC_KEYS = {
  // 项目规模
  TOTAL_PROJECTS: 'org_total_projects',
  ACTIVE_PROJECTS: 'org_active_projects',
  ON_HOLD_PROJECTS: 'org_on_hold_projects',
  COMPLETED_PROJECTS: 'org_completed_projects',
  ARCHIVED_PROJECTS: 'org_archived_projects',

  // 交付压力
  ATTENTION_PROJECTS: 'org_attention_projects',
  OVERDUE_PROJECTS: 'org_overdue_projects',
  DUE_SOON_PROJECTS: 'org_due_soon_projects',
  OVERALL_PROGRESS_AVG: 'org_overall_progress_avg',

  // 团队与资源
  MEMBER_TOTAL: 'org_member_total',
  ACTIVE_MEMBER_TOTAL: 'org_active_member_total',
  RESOURCE_ALLOCATED_PROJECTS: 'org_resource_allocated_projects',
  RESOURCE_OVERLOAD_COUNT: 'org_resource_overload_count',

  // 风险
  OPEN_RISK_COUNT: 'org_open_risk_count',
  HIGH_RISK_COUNT: 'org_high_risk_count',

  // 活动与数据质量
  RECENT_ACTIVITY_COUNT: 'org_recent_activity_count',
  STALE_SOURCE_COUNT: 'org_stale_source_count',
} as const

export type OrganizationDashboardMetricKey =
  (typeof ORGANIZATION_DASHBOARD_METRIC_KEYS)[keyof typeof ORGANIZATION_DASHBOARD_METRIC_KEYS]

/** 稳定 metric key 全集——契约测试断言用。 */
export const ORGANIZATION_DASHBOARD_METRIC_KEY_VALUES = Object.values(
  ORGANIZATION_DASHBOARD_METRIC_KEYS,
) as readonly OrganizationDashboardMetricKey[]

/** 指标单位。 */
export type OrganizationDashboardMetricUnit = 'count' | 'percent' | 'avg'

// ─── Sources ───────────────────────────────────────────────────────────────────

export const ORGANIZATION_DASHBOARD_SOURCES = {
  ORGANIZATION: 'organization',
  PROJECT: 'project',
  PROJECT_DASHBOARD: 'project_dashboard',
  MEMBERSHIP: 'membership',
  RESOURCE_SUMMARY: 'resource_summary',
  RISK_SUMMARY: 'risk_summary',
  ACTIVITY_LOG: 'activity_log',
  PMO_PORTFOLIO: 'pmo_portfolio',
  COMPUTED: 'computed',
} as const

export type OrganizationDashboardSource =
  (typeof ORGANIZATION_DASHBOARD_SOURCES)[keyof typeof ORGANIZATION_DASHBOARD_SOURCES]

export const ORGANIZATION_DASHBOARD_SOURCE_VALUES = Object.values(
  ORGANIZATION_DASHBOARD_SOURCES,
) as readonly OrganizationDashboardSource[]

// ─── Statuses ──────────────────────────────────────────────────────────────────

export const ORGANIZATION_DASHBOARD_STATUSES = {
  OK: 'ok',
  EMPTY: 'empty',
  UNAVAILABLE: 'unavailable',
  FORBIDDEN: 'forbidden',
  STALE: 'stale',
  UNSUPPORTED: 'unsupported',
} as const

export type OrganizationDashboardStatus =
  (typeof ORGANIZATION_DASHBOARD_STATUSES)[keyof typeof ORGANIZATION_DASHBOARD_STATUSES]

// ─── Warnings ──────────────────────────────────────────────────────────────────

export const ORGANIZATION_DASHBOARD_WARNING_CODES = {
  EMPTY_ORGANIZATION_DASHBOARD: 'EMPTY_ORGANIZATION_DASHBOARD',
  PMO_SUMMARY_FORBIDDEN: 'PMO_SUMMARY_FORBIDDEN',
  PMO_SUMMARY_UNAVAILABLE: 'PMO_SUMMARY_UNAVAILABLE',
  PERMISSION_REDACTED: 'PERMISSION_REDACTED',
  SOURCE_STALE: 'SOURCE_STALE',
  SOURCE_PARTIAL: 'SOURCE_PARTIAL',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  FINANCIAL_UNSUPPORTED: 'FINANCIAL_UNSUPPORTED',
  CACHE_DEGRADED: 'CACHE_DEGRADED',
} as const

export type OrganizationDashboardWarningCode =
  (typeof ORGANIZATION_DASHBOARD_WARNING_CODES)[keyof typeof ORGANIZATION_DASHBOARD_WARNING_CODES]

export const ORGANIZATION_DASHBOARD_WARNING_CODE_VALUES = Object.values(
  ORGANIZATION_DASHBOARD_WARNING_CODES,
) as readonly OrganizationDashboardWarningCode[]

/** 低敏 warning envelope：只带 code / 中文说明 / 受影响 metric 或 source，不带隐藏数量与实体名。 */
export interface OrganizationDashboardWarning {
  code: OrganizationDashboardWarningCode
  message: string
  metricKey?: OrganizationDashboardMetricKey
  source?: OrganizationDashboardSource
}

// ─── Sections（查询白名单）─────────────────────────────────────────────────────

export const ORGANIZATION_DASHBOARD_SECTIONS = {
  IDENTITY: 'identity',
  KPI: 'kpi',
  STATUS_DISTRIBUTION: 'status_distribution',
  ATTENTION_PROJECTS: 'attention_projects',
  MEMBER_OVERVIEW: 'member_overview',
  RESOURCE_OVERVIEW: 'resource_overview',
  RISK_REMINDERS: 'risk_reminders',
  ACTIVITY: 'activity',
  PMO_ENTRY: 'pmo_entry',
} as const

export type OrganizationDashboardSection =
  (typeof ORGANIZATION_DASHBOARD_SECTIONS)[keyof typeof ORGANIZATION_DASHBOARD_SECTIONS]

export const ORGANIZATION_DASHBOARD_SECTION_VALUES = Object.values(
  ORGANIZATION_DASHBOARD_SECTIONS,
) as readonly OrganizationDashboardSection[]

// ─── Sort / Filter 白名单 ──────────────────────────────────────────────────────

export const ORGANIZATION_DASHBOARD_ATTENTION_SORT_KEYS = {
  ATTENTION_SCORE: 'attention_score',
  NAME: 'name',
  PROGRESS: 'progress',
  HEALTH: 'health',
  OVERDUE: 'overdue',
  UPDATED_AT: 'updated_at',
} as const

export type OrganizationDashboardAttentionSortKey =
  (typeof ORGANIZATION_DASHBOARD_ATTENTION_SORT_KEYS)[keyof typeof ORGANIZATION_DASHBOARD_ATTENTION_SORT_KEYS]

export const ORGANIZATION_DASHBOARD_ATTENTION_SORT_KEY_VALUES = Object.values(
  ORGANIZATION_DASHBOARD_ATTENTION_SORT_KEYS,
) as readonly OrganizationDashboardAttentionSortKey[]

export const ORGANIZATION_DASHBOARD_PROJECT_STATUS_FILTERS = [
  'planning',
  'active',
  'on_hold',
  'completed',
  'archived',
] as const

export type OrganizationDashboardProjectStatusFilter =
  (typeof ORGANIZATION_DASHBOARD_PROJECT_STATUS_FILTERS)[number]

export const ORGANIZATION_DASHBOARD_HEALTH_FILTERS = [
  'healthy',
  'at_risk',
  'critical',
  'unknown',
] as const

export type OrganizationDashboardHealthFilter =
  (typeof ORGANIZATION_DASHBOARD_HEALTH_FILTERS)[number]

// ─── 不支持的财务字段 ─────────────────────────────────────────────────────────

export const ORGANIZATION_DASHBOARD_UNSUPPORTED_FINANCIAL_FIELDS = [
  'budget',
  'cost',
  'roi',
  'financial_distribution',
] as const

export type OrganizationDashboardUnsupportedFinancialField =
  (typeof ORGANIZATION_DASHBOARD_UNSUPPORTED_FINANCIAL_FIELDS)[number]

// ─── 常量 ──────────────────────────────────────────────────────────────────────

export const ORGANIZATION_DASHBOARD_METRIC_VERSION = 'organization-dashboard.v1' as const

export const ORGANIZATION_DASHBOARD_DEFAULT_ATTENTION_LIMIT = 5
export const ORGANIZATION_DASHBOARD_MAX_ATTENTION_LIMIT = 20
export const ORGANIZATION_DASHBOARD_DEFAULT_ACTIVITY_LIMIT = 10
export const ORGANIZATION_DASHBOARD_MAX_ACTIVITY_LIMIT = 50
export const ORGANIZATION_DASHBOARD_STALE_THRESHOLD_MINUTES = 60
export const ORGANIZATION_DASHBOARD_MAX_FRESHNESS_WINDOW_MINUTES = 1440
export const ORGANIZATION_DASHBOARD_DEFAULT_DUE_SOON_DAYS = 7
export const ORGANIZATION_DASHBOARD_MAX_DUE_SOON_DAYS = 30
export const ORGANIZATION_DASHBOARD_MAX_SEARCH_LENGTH = 200
/** 单次聚合允许扫描的最大项目数——超过时按 attention/activity 采样并给出 SOURCE_PARTIAL warning。 */
export const ORGANIZATION_DASHBOARD_MAX_SCAN_PROJECTS = 2000

// ─── Drill-down Target（后端授权后下发）────────────────────────────────────────

export const ORGANIZATION_DASHBOARD_TARGET_KINDS = {
  PROJECT: 'project',
  PMO: 'pmo',
  RISK: 'risk',
  RESOURCE: 'resource',
  ACTIVITY: 'activity',
  MEMBER: 'member',
} as const

export type OrganizationDashboardTargetKind =
  (typeof ORGANIZATION_DASHBOARD_TARGET_KINDS)[keyof typeof ORGANIZATION_DASHBOARD_TARGET_KINDS]

/**
 * 低敏 route descriptor。只描述「去哪里」，不含实体名称或证据文本；
 * `authorized === false` 的 target 不会下发（后端直接返回 `null`），真实详情端点仍二次授权。
 */
export interface OrganizationDashboardTarget {
  kind: OrganizationDashboardTargetKind
  href: string
  authorized: boolean
}

// ─── Freshness ─────────────────────────────────────────────────────────────────

export interface OrganizationDashboardSourceFreshness {
  source: OrganizationDashboardSource
  lastUpdatedAt: string | null
  isStale: boolean
  staleThresholdMinutes: number
  status: OrganizationDashboardStatus
}

// ─── Metric ────────────────────────────────────────────────────────────────────

export interface OrganizationDashboardMetric {
  key: OrganizationDashboardMetricKey
  value: number | null
  unit: OrganizationDashboardMetricUnit
  source: OrganizationDashboardSource
  status: OrganizationDashboardStatus
  warnings?: OrganizationDashboardWarning[]
}

// ─── 组织身份 ──────────────────────────────────────────────────────────────────

export interface OrganizationDashboardIdentity {
  organizationId: number
  name: string
  slug: string | null
  planTier: string | null
  createdAt: string | null
}

// ─── 状态分布 ──────────────────────────────────────────────────────────────────

export interface OrganizationDashboardDistributionSlice {
  key: string
  label: string
  count: number
  percent: number
}

// ─── 待关注项目 ────────────────────────────────────────────────────────────────

export const ORGANIZATION_ATTENTION_REASONS = {
  HEALTH_CRITICAL: 'health_critical',
  HEALTH_AT_RISK: 'health_at_risk',
  OVERDUE: 'overdue',
  DUE_SOON: 'due_soon',
  ON_HOLD: 'on_hold',
  NO_PROGRESS: 'no_progress',
} as const

export type OrganizationAttentionReason =
  (typeof ORGANIZATION_ATTENTION_REASONS)[keyof typeof ORGANIZATION_ATTENTION_REASONS]

export const ORGANIZATION_ATTENTION_REASON_VALUES = Object.values(
  ORGANIZATION_ATTENTION_REASONS,
) as readonly OrganizationAttentionReason[]

/** 待关注项目条目——只含 actor 已授权可见的项目。 */
export interface OrganizationAttentionItem {
  projectId: number
  projectName: string
  status: string
  healthStatus: string
  progressPercent: number
  attentionScore: number
  reasons: OrganizationAttentionReason[]
  overdueTaskCount: number | null
  target: OrganizationDashboardTarget | null
  warnings: OrganizationDashboardWarning[]
}

// ─── 成员 / 资源概览 ───────────────────────────────────────────────────────────

export interface OrganizationMemberOverview {
  available: boolean
  forbidden: boolean
  totalMembers: number | null
  activeMembers: number | null
  roleDistribution: OrganizationDashboardDistributionSlice[]
  target: OrganizationDashboardTarget | null
  warnings: OrganizationDashboardWarning[]
}

export interface OrganizationResourceOverview {
  available: boolean
  forbidden: boolean
  allocatedProjectCount: number | null
  overloadedResourceCount: number | null
  totalAllocationPercent: number | null
  target: OrganizationDashboardTarget | null
  warnings: OrganizationDashboardWarning[]
}

// ─── 风险 / 延期提醒 ───────────────────────────────────────────────────────────

export const ORGANIZATION_REMINDER_CODES = {
  HIGH_RISK: 'high_risk',
  OPEN_RISK: 'open_risk',
  OVERDUE_PROJECT: 'overdue_project',
  DUE_SOON_PROJECT: 'due_soon_project',
} as const

export type OrganizationReminderCode =
  (typeof ORGANIZATION_REMINDER_CODES)[keyof typeof ORGANIZATION_REMINDER_CODES]

export interface OrganizationRiskReminder {
  code: OrganizationReminderCode
  label: string
  count: number | null
  status: OrganizationDashboardStatus
  source: OrganizationDashboardSource
  target: OrganizationDashboardTarget | null
  warnings: OrganizationDashboardWarning[]
}

// ─── 近期活动（低敏 envelope）──────────────────────────────────────────────────

/**
 * 活动条目只保留低敏字段：动作码、实体类型、严重度、时间与授权 target。
 * 不含实体名称、变更内容、证据文本、prompt、模型输出或跨组织引用。
 */
export interface OrganizationActivityItem {
  id: number
  action: string
  entityType: string | null
  severity: string
  projectId: number | null
  occurredAt: string
  target: OrganizationDashboardTarget | null
}

// ─── PMO 入口 ──────────────────────────────────────────────────────────────────

export interface OrganizationPmoEntrySummary {
  totalProjects: number | null
  atRiskProjects: number | null
  overallProgressAvg: number | null
}

export interface OrganizationPmoEntry {
  available: boolean
  forbidden: boolean
  summary: OrganizationPmoEntrySummary | null
  freshness: OrganizationDashboardSourceFreshness | null
  targets: OrganizationDashboardTarget[]
  warnings: OrganizationDashboardWarning[]
}

// ─── Meta 与 Summary ───────────────────────────────────────────────────────────

export interface OrganizationDashboardMeta {
  calculatedAt: string
  metricVersion: string
  organizationId: number
  actorId: number
  visibleProjectCount: number
  sections: OrganizationDashboardSection[]
  attentionLimit: number
  activityLimit: number
  staleThresholdMinutes: number
  inputSignatureHash: string
}

export interface OrganizationDashboardSummary {
  meta: OrganizationDashboardMeta
  organization: OrganizationDashboardIdentity
  kpis: OrganizationDashboardMetric[]
  statusDistribution: OrganizationDashboardDistributionSlice[]
  attentionProjects: OrganizationAttentionItem[]
  memberOverview: OrganizationMemberOverview
  resourceOverview: OrganizationResourceOverview
  riskReminders: OrganizationRiskReminder[]
  recentActivity: OrganizationActivityItem[]
  pmoEntry: OrganizationPmoEntry
  sourceFreshness: OrganizationDashboardSourceFreshness[]
  warnings: OrganizationDashboardWarning[]
}

// ─── Query ─────────────────────────────────────────────────────────────────────

export interface OrganizationDashboardQuery {
  sections?: OrganizationDashboardSection[]
  attentionLimit?: number
  activityLimit?: number
  freshnessWindowMinutes?: number
  dueSoonDays?: number
  attentionSort?: OrganizationDashboardAttentionSortKey
  attentionOrder?: 'asc' | 'desc'
  filterStatus?: OrganizationDashboardProjectStatusFilter
  filterHealth?: OrganizationDashboardHealthFilter
  search?: string
}

/** 归一化后的查询——所有上限已 clamp，section 已去重且落在白名单内。 */
export interface NormalizedOrganizationDashboardQuery {
  sections: OrganizationDashboardSection[]
  attentionLimit: number
  activityLimit: number
  freshnessWindowMinutes: number
  dueSoonDays: number
  attentionSort: OrganizationDashboardAttentionSortKey
  attentionOrder: 'asc' | 'desc'
  filterStatus?: OrganizationDashboardProjectStatusFilter
  filterHealth?: OrganizationDashboardHealthFilter
  search?: string
}

/** 校验失败时返回的低敏 detail——只暴露允许值，不回显组织内部事实。 */
export interface OrganizationDashboardValidationDetail {
  allowedSections: readonly OrganizationDashboardSection[]
  allowedAttentionSorts: readonly OrganizationDashboardAttentionSortKey[]
  allowedStatusFilters: readonly OrganizationDashboardProjectStatusFilter[]
  allowedHealthFilters: readonly OrganizationDashboardHealthFilter[]
  maxAttentionLimit: number
  maxActivityLimit: number
  maxFreshnessWindowMinutes: number
  maxDueSoonDays: number
}

/** 低敏 read audit envelope（可选）——不含证据文本、prompt、模型输出、Authorization、token。 */
export interface OrganizationDashboardReadAudit {
  actorId: number
  organizationId: number
  sections: OrganizationDashboardSection[]
  metricKeys: OrganizationDashboardMetricKey[]
  sourceFreshnessHashes: Array<{ source: OrganizationDashboardSource; hash: string }>
  querySignatureHash: string
  occurredAt: string
}

// ─── 纯函数助手 ────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.trunc(value), min), max)
}

/** 稳定 FNV-1a 哈希——用于 input signature 与 freshness 指纹，不含敏感原文。 */
export function organizationDashboardStableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 归一化查询：section 白名单 + 去重、limit clamp、search 截断。 */
export function normalizeOrganizationDashboardQuery(
  query: OrganizationDashboardQuery = {},
): NormalizedOrganizationDashboardQuery {
  const requested = query.sections?.filter((section) =>
    ORGANIZATION_DASHBOARD_SECTION_VALUES.includes(section),
  )
  const sections =
    requested && requested.length > 0
      ? ORGANIZATION_DASHBOARD_SECTION_VALUES.filter((section) => requested.includes(section))
      : [...ORGANIZATION_DASHBOARD_SECTION_VALUES]

  const search = query.search?.trim().slice(0, ORGANIZATION_DASHBOARD_MAX_SEARCH_LENGTH)

  return {
    sections,
    attentionLimit: clamp(
      query.attentionLimit ?? ORGANIZATION_DASHBOARD_DEFAULT_ATTENTION_LIMIT,
      1,
      ORGANIZATION_DASHBOARD_MAX_ATTENTION_LIMIT,
    ),
    activityLimit: clamp(
      query.activityLimit ?? ORGANIZATION_DASHBOARD_DEFAULT_ACTIVITY_LIMIT,
      1,
      ORGANIZATION_DASHBOARD_MAX_ACTIVITY_LIMIT,
    ),
    freshnessWindowMinutes: clamp(
      query.freshnessWindowMinutes ?? ORGANIZATION_DASHBOARD_STALE_THRESHOLD_MINUTES,
      1,
      ORGANIZATION_DASHBOARD_MAX_FRESHNESS_WINDOW_MINUTES,
    ),
    dueSoonDays: clamp(
      query.dueSoonDays ?? ORGANIZATION_DASHBOARD_DEFAULT_DUE_SOON_DAYS,
      1,
      ORGANIZATION_DASHBOARD_MAX_DUE_SOON_DAYS,
    ),
    attentionSort:
      query.attentionSort ?? ORGANIZATION_DASHBOARD_ATTENTION_SORT_KEYS.ATTENTION_SCORE,
    attentionOrder: query.attentionOrder === 'asc' ? 'asc' : 'desc',
    filterStatus: query.filterStatus,
    filterHealth: query.filterHealth,
    search: search ? search : undefined,
  }
}

/** 校验失败时返回给前端的低敏允许值清单。 */
export function organizationDashboardValidationDetail(): OrganizationDashboardValidationDetail {
  return {
    allowedSections: ORGANIZATION_DASHBOARD_SECTION_VALUES,
    allowedAttentionSorts: ORGANIZATION_DASHBOARD_ATTENTION_SORT_KEY_VALUES,
    allowedStatusFilters: ORGANIZATION_DASHBOARD_PROJECT_STATUS_FILTERS,
    allowedHealthFilters: ORGANIZATION_DASHBOARD_HEALTH_FILTERS,
    maxAttentionLimit: ORGANIZATION_DASHBOARD_MAX_ATTENTION_LIMIT,
    maxActivityLimit: ORGANIZATION_DASHBOARD_MAX_ACTIVITY_LIMIT,
    maxFreshnessWindowMinutes: ORGANIZATION_DASHBOARD_MAX_FRESHNESS_WINDOW_MINUTES,
    maxDueSoonDays: ORGANIZATION_DASHBOARD_MAX_DUE_SOON_DAYS,
  }
}

/** 判定来源是否过期。`null` 视为过期（无法证明新鲜）。 */
export function isOrganizationDashboardSourceStale(
  lastUpdatedAt: string | null,
  thresholdMinutes: number = ORGANIZATION_DASHBOARD_STALE_THRESHOLD_MINUTES,
  now: number = Date.now(),
): boolean {
  if (!lastUpdatedAt) return true
  const last = new Date(lastUpdatedAt).getTime()
  if (!Number.isFinite(last)) return true
  return now - last > thresholdMinutes * 60 * 1000
}

/** 构造 freshness 条目，自动推导 isStale 与 status。 */
export function makeOrganizationDashboardFreshness(input: {
  source: OrganizationDashboardSource
  lastUpdatedAt: string | null
  staleThresholdMinutes?: number
  forbidden?: boolean
  unavailable?: boolean
  now?: number
}): OrganizationDashboardSourceFreshness {
  const staleThresholdMinutes =
    input.staleThresholdMinutes ?? ORGANIZATION_DASHBOARD_STALE_THRESHOLD_MINUTES
  if (input.forbidden) {
    return {
      source: input.source,
      lastUpdatedAt: null,
      isStale: false,
      staleThresholdMinutes,
      status: ORGANIZATION_DASHBOARD_STATUSES.FORBIDDEN,
    }
  }
  if (input.unavailable) {
    return {
      source: input.source,
      lastUpdatedAt: null,
      isStale: false,
      staleThresholdMinutes,
      status: ORGANIZATION_DASHBOARD_STATUSES.UNAVAILABLE,
    }
  }
  const isStale = isOrganizationDashboardSourceStale(
    input.lastUpdatedAt,
    staleThresholdMinutes,
    input.now,
  )
  return {
    source: input.source,
    lastUpdatedAt: input.lastUpdatedAt,
    isStale,
    staleThresholdMinutes,
    status: isStale ? ORGANIZATION_DASHBOARD_STATUSES.STALE : ORGANIZATION_DASHBOARD_STATUSES.OK,
  }
}

/** freshness 指纹——低敏审计用，不含原始时间以外的业务事实。 */
export function organizationDashboardFreshnessHash(
  freshness: OrganizationDashboardSourceFreshness,
): string {
  return organizationDashboardStableHash(
    `${freshness.source}:${freshness.lastUpdatedAt ?? 'none'}:${freshness.status}`,
  )
}

// ─── Warning 工厂 ──────────────────────────────────────────────────────────────

export function emptyOrganizationDashboardWarning(): OrganizationDashboardWarning {
  return {
    code: ORGANIZATION_DASHBOARD_WARNING_CODES.EMPTY_ORGANIZATION_DASHBOARD,
    message: '当前组织没有可见项目，指标为空而非缺失',
  }
}

export function pmoSummaryForbiddenWarning(): OrganizationDashboardWarning {
  return {
    code: ORGANIZATION_DASHBOARD_WARNING_CODES.PMO_SUMMARY_FORBIDDEN,
    message: '当前用户无 PMO 组合摘要查看权限',
    source: ORGANIZATION_DASHBOARD_SOURCES.PMO_PORTFOLIO,
  }
}

export function pmoSummaryUnavailableWarning(): OrganizationDashboardWarning {
  return {
    code: ORGANIZATION_DASHBOARD_WARNING_CODES.PMO_SUMMARY_UNAVAILABLE,
    message: 'PMO 组合摘要来源不可用、未启用或尚未实现',
    source: ORGANIZATION_DASHBOARD_SOURCES.PMO_PORTFOLIO,
  }
}

/** 维度权限脱敏——只说明哪个来源被脱敏，不返回隐藏数量或名称。 */
export function organizationDimensionRedactedWarning(
  source: OrganizationDashboardSource,
  metricKey?: OrganizationDashboardMetricKey,
): OrganizationDashboardWarning {
  return {
    code: ORGANIZATION_DASHBOARD_WARNING_CODES.PERMISSION_REDACTED,
    message: `来源 ${source} 因权限不足已脱敏`,
    source,
    ...(metricKey ? { metricKey } : {}),
  }
}

export function organizationSourceStaleWarning(
  source: OrganizationDashboardSource,
): OrganizationDashboardWarning {
  return {
    code: ORGANIZATION_DASHBOARD_WARNING_CODES.SOURCE_STALE,
    message: `来源 ${source} 数据已超过新鲜度阈值`,
    source,
  }
}

export function organizationSourceUnavailableWarning(
  source: OrganizationDashboardSource,
): OrganizationDashboardWarning {
  return {
    code: ORGANIZATION_DASHBOARD_WARNING_CODES.SOURCE_UNAVAILABLE,
    message: `来源 ${source} 当前不可用`,
    source,
  }
}

export function organizationSourcePartialWarning(
  source: OrganizationDashboardSource,
): OrganizationDashboardWarning {
  return {
    code: ORGANIZATION_DASHBOARD_WARNING_CODES.SOURCE_PARTIAL,
    message: `来源 ${source} 仅返回采样结果，聚合为部分数据`,
    source,
  }
}

export function organizationFinancialUnsupportedWarning(
  field: OrganizationDashboardUnsupportedFinancialField,
): OrganizationDashboardWarning {
  return {
    code: ORGANIZATION_DASHBOARD_WARNING_CODES.FINANCIAL_UNSUPPORTED,
    message: `字段 ${field} 属财务范围，组织 Dashboard 不提供该数据`,
  }
}

export function organizationCacheDegradedWarning(): OrganizationDashboardWarning {
  return {
    code: ORGANIZATION_DASHBOARD_WARNING_CODES.CACHE_DEGRADED,
    message: '可选摘要缓存不可用，已直接读取有界授权数据',
  }
}

/** 判断字段名是否命中不支持的财务范围。 */
export function isUnsupportedFinancialField(
  field: string,
): field is OrganizationDashboardUnsupportedFinancialField {
  return (ORGANIZATION_DASHBOARD_UNSUPPORTED_FINANCIAL_FIELDS as readonly string[]).includes(field)
}

/** 合并 warning 并按 code+source+metricKey 去重，保持稳定顺序。 */
export function mergeOrganizationDashboardWarnings(
  ...groups: Array<OrganizationDashboardWarning[] | undefined>
): OrganizationDashboardWarning[] {
  const seen = new Set<string>()
  const merged: OrganizationDashboardWarning[] = []
  for (const group of groups) {
    for (const warning of group ?? []) {
      const key = `${warning.code}|${warning.source ?? ''}|${warning.metricKey ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(warning)
    }
  }
  return merged
}

// ─── 脱敏投影 ──────────────────────────────────────────────────────────────────

/** 权限不足时的指标投影：value 恒为 null，附 PERMISSION_REDACTED warning。 */
export function redactedOrganizationMetric(
  key: OrganizationDashboardMetricKey,
  source: OrganizationDashboardSource,
  unit: OrganizationDashboardMetricUnit = 'count',
): OrganizationDashboardMetric {
  return {
    key,
    value: null,
    unit,
    source,
    status: ORGANIZATION_DASHBOARD_STATUSES.FORBIDDEN,
    warnings: [organizationDimensionRedactedWarning(source, key)],
  }
}

/** 权限不足时的成员概览投影。 */
export function redactedOrganizationMemberOverview(): OrganizationMemberOverview {
  return {
    available: false,
    forbidden: true,
    totalMembers: null,
    activeMembers: null,
    roleDistribution: [],
    target: null,
    warnings: [organizationDimensionRedactedWarning(ORGANIZATION_DASHBOARD_SOURCES.MEMBERSHIP)],
  }
}

/** 权限不足时的资源概览投影。 */
export function redactedOrganizationResourceOverview(): OrganizationResourceOverview {
  return {
    available: false,
    forbidden: true,
    allocatedProjectCount: null,
    overloadedResourceCount: null,
    totalAllocationPercent: null,
    target: null,
    warnings: [
      organizationDimensionRedactedWarning(ORGANIZATION_DASHBOARD_SOURCES.RESOURCE_SUMMARY),
    ],
  }
}

/** 权限不足时的风险提醒投影——只保留 code 与 forbidden 状态，不返回计数。 */
export function redactedOrganizationRiskReminders(): OrganizationRiskReminder[] {
  return [
    {
      code: ORGANIZATION_REMINDER_CODES.HIGH_RISK,
      label: '高风险项目',
      count: null,
      status: ORGANIZATION_DASHBOARD_STATUSES.FORBIDDEN,
      source: ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY,
      target: null,
      warnings: [organizationDimensionRedactedWarning(ORGANIZATION_DASHBOARD_SOURCES.RISK_SUMMARY)],
    },
  ]
}

/** PMO 入口的 forbidden / unavailable 投影。 */
export function degradedOrganizationPmoEntry(
  reason: 'forbidden' | 'unavailable',
): OrganizationPmoEntry {
  const warning =
    reason === 'forbidden' ? pmoSummaryForbiddenWarning() : pmoSummaryUnavailableWarning()
  return {
    available: false,
    forbidden: reason === 'forbidden',
    summary: null,
    freshness: makeOrganizationDashboardFreshness({
      source: ORGANIZATION_DASHBOARD_SOURCES.PMO_PORTFOLIO,
      lastUpdatedAt: null,
      forbidden: reason === 'forbidden',
      unavailable: reason === 'unavailable',
    }),
    targets: [],
    warnings: [warning],
  }
}

// ─── 待关注评分（确定性）───────────────────────────────────────────────────────

/** 待关注理由 → 权重。分值越高越靠前，纯确定性，不含 AI。 */
export const ORGANIZATION_ATTENTION_REASON_WEIGHTS: Record<OrganizationAttentionReason, number> = {
  [ORGANIZATION_ATTENTION_REASONS.HEALTH_CRITICAL]: 40,
  [ORGANIZATION_ATTENTION_REASONS.OVERDUE]: 30,
  [ORGANIZATION_ATTENTION_REASONS.HEALTH_AT_RISK]: 20,
  [ORGANIZATION_ATTENTION_REASONS.DUE_SOON]: 15,
  [ORGANIZATION_ATTENTION_REASONS.ON_HOLD]: 10,
  [ORGANIZATION_ATTENTION_REASONS.NO_PROGRESS]: 5,
}

/** 由理由集合计算确定性 attention score（0–100）。 */
export function computeOrganizationAttentionScore(
  reasons: readonly OrganizationAttentionReason[],
): number {
  const total = reasons.reduce(
    (sum, reason) => sum + (ORGANIZATION_ATTENTION_REASON_WEIGHTS[reason] ?? 0),
    0,
  )
  return Math.min(100, total)
}

// ─── 空组织构造 ────────────────────────────────────────────────────────────────

/**
 * 构造合法的空组织 Dashboard：所有计数为 0、列表为空、带 `EMPTY_ORGANIZATION_DASHBOARD` warning，
 * 且不伪造健康、风险、资源、活动或 PMO 值。
 */
export function buildEmptyOrganizationDashboard(input: {
  organization: OrganizationDashboardIdentity
  actorId: number
  query?: NormalizedOrganizationDashboardQuery
  calculatedAt?: string
  pmoEntry?: OrganizationPmoEntry
}): OrganizationDashboardSummary {
  const query = input.query ?? normalizeOrganizationDashboardQuery()
  const calculatedAt = input.calculatedAt ?? new Date().toISOString()
  const emptyWarning = emptyOrganizationDashboardWarning()
  const pmoEntry = input.pmoEntry ?? degradedOrganizationPmoEntry('unavailable')

  const kpis: OrganizationDashboardMetric[] = ORGANIZATION_DASHBOARD_METRIC_KEY_VALUES.filter(
    (key) =>
      key !== ORGANIZATION_DASHBOARD_METRIC_KEYS.MEMBER_TOTAL &&
      key !== ORGANIZATION_DASHBOARD_METRIC_KEYS.ACTIVE_MEMBER_TOTAL,
  ).map((key) => ({
    key,
    value: 0,
    unit:
      key === ORGANIZATION_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG
        ? ('percent' as const)
        : ('count' as const),
    source: ORGANIZATION_DASHBOARD_SOURCES.COMPUTED,
    status: ORGANIZATION_DASHBOARD_STATUSES.EMPTY,
  }))

  return {
    meta: {
      calculatedAt,
      metricVersion: ORGANIZATION_DASHBOARD_METRIC_VERSION,
      organizationId: input.organization.organizationId,
      actorId: input.actorId,
      visibleProjectCount: 0,
      sections: query.sections,
      attentionLimit: query.attentionLimit,
      activityLimit: query.activityLimit,
      staleThresholdMinutes: query.freshnessWindowMinutes,
      inputSignatureHash: organizationDashboardStableHash(
        `${input.organization.organizationId}:${input.actorId}:empty:${query.sections.join(',')}`,
      ),
    },
    organization: input.organization,
    kpis,
    statusDistribution: [],
    attentionProjects: [],
    memberOverview: {
      available: true,
      forbidden: false,
      totalMembers: 0,
      activeMembers: 0,
      roleDistribution: [],
      target: null,
      warnings: [],
    },
    resourceOverview: {
      available: true,
      forbidden: false,
      allocatedProjectCount: 0,
      overloadedResourceCount: 0,
      totalAllocationPercent: 0,
      target: null,
      warnings: [],
    },
    riskReminders: [],
    recentActivity: [],
    pmoEntry,
    sourceFreshness: [
      makeOrganizationDashboardFreshness({
        source: ORGANIZATION_DASHBOARD_SOURCES.PROJECT,
        lastUpdatedAt: calculatedAt,
        staleThresholdMinutes: query.freshnessWindowMinutes,
      }),
    ],
    warnings: mergeOrganizationDashboardWarnings([emptyWarning], pmoEntry.warnings),
  }
}

// ─── 归一化分布 ────────────────────────────────────────────────────────────────

/** 由计数 map 生成百分比分布切片，百分比合计不超过 100（末位吸收舍入误差）。 */
export function toOrganizationDistribution(
  counts: ReadonlyArray<{ key: string; label: string; count: number }>,
): OrganizationDashboardDistributionSlice[] {
  const total = counts.reduce((sum, item) => sum + item.count, 0)
  if (total <= 0) {
    return counts.map((item) => ({ ...item, percent: 0 }))
  }
  const slices = counts.map((item) => ({
    ...item,
    percent: Math.round((item.count / total) * 1000) / 10,
  }))
  const sum = slices.reduce((acc, slice) => acc + slice.percent, 0)
  const drift = Math.round((100 - sum) * 10) / 10
  const last = slices[slices.length - 1]
  if (last && drift !== 0) {
    last.percent = Math.round((last.percent + drift) * 10) / 10
  }
  return slices
}
