// @aiproj/types — PMO 组合分组视图共享契约（前后端共享）。
// v3-pmo-portfolio-grouping-views §2: view definition, grouping keys, DTOs, helpers, constants.

import type { PortfolioDashboardMetricKey } from './pmo-portfolio-dashboard.js'
import { PORTFOLIO_DASHBOARD_METRIC_KEYS } from './pmo-portfolio-dashboard.js'

// ─── Grouping Keys ──────────────────────────────────────────────────────────────

/** 主分组维度白名单。 */
export const PMO_GROUPING_VIEW_PRIMARY_KEYS = {
  STATUS: 'status',
  HEALTH: 'health',
  TRAFFIC_LIGHT: 'traffic_light',
  MANAGER: 'manager',
  PROJECT_TYPE: 'project_type',
  LIFECYCLE_PHASE: 'lifecycle_phase',
  DEPARTMENT: 'department',
  SOURCE_FRESHNESS: 'source_freshness',
} as const

export type PmoGroupingViewPrimaryKey =
  (typeof PMO_GROUPING_VIEW_PRIMARY_KEYS)[keyof typeof PMO_GROUPING_VIEW_PRIMARY_KEYS]

/** 二级分组维度白名单（首期仅允许一组，且不能与 primary 相同）。 */
export const PMO_GROUPING_VIEW_SECONDARY_KEYS = {
  STATUS: 'status',
  HEALTH: 'health',
  TRAFFIC_LIGHT: 'traffic_light',
  PROJECT_TYPE: 'project_type',
  LIFECYCLE_PHASE: 'lifecycle_phase',
} as const

export type PmoGroupingViewSecondaryKey =
  (typeof PMO_GROUPING_VIEW_SECONDARY_KEYS)[keyof typeof PMO_GROUPING_VIEW_SECONDARY_KEYS]

// ─── Compare Modes ──────────────────────────────────────────────────────────────

export const PMO_GROUPING_VIEW_COMPARE_MODES = {
  NONE: 'none',
  SIDE_BY_SIDE: 'side_by_side',
  TREND_DELTA: 'trend_delta',
} as const

export type PmoGroupingViewCompareMode =
  (typeof PMO_GROUPING_VIEW_COMPARE_MODES)[keyof typeof PMO_GROUPING_VIEW_COMPARE_MODES]

// ─── View Scope ─────────────────────────────────────────────────────────────────

export const PMO_GROUPING_VIEW_SCOPES = {
  SYSTEM: 'system',
  PERSONAL: 'personal',
  ORGANIZATION: 'organization',
} as const

export type PmoGroupingViewScope =
  (typeof PMO_GROUPING_VIEW_SCOPES)[keyof typeof PMO_GROUPING_VIEW_SCOPES]

// ─── Sort Keys ──────────────────────────────────────────────────────────────────

export const PMO_GROUPING_VIEW_SORT_KEYS = {
  GROUP_NAME: 'group_name',
  PROJECT_COUNT: 'project_count',
  PROGRESS_AVG: 'progress_avg',
  HEALTH_STATUS: 'health_status',
  TRAFFIC_LIGHT: 'traffic_light',
  UPDATED_AT: 'updated_at',
} as const

export type PmoGroupingViewSortKey =
  (typeof PMO_GROUPING_VIEW_SORT_KEYS)[keyof typeof PMO_GROUPING_VIEW_SORT_KEYS]

// ─── Trend Windows ──────────────────────────────────────────────────────────────

export { PORTFOLIO_TREND_WINDOWS as PMO_GROUPING_VIEW_TREND_WINDOWS }
import { PORTFOLIO_TREND_WINDOWS } from './pmo-portfolio-dashboard.js'

export type PmoGroupingViewTrendWindow =
  (typeof PORTFOLIO_TREND_WINDOWS)[keyof typeof PORTFOLIO_TREND_WINDOWS]

// ─── Warning Codes ──────────────────────────────────────────────────────────────

export const PMO_GROUPING_VIEW_WARNING_CODES = {
  GROUP_TRUNCATED: 'GROUP_TRUNCATED',
  SECONDARY_GROUP_TRUNCATED: 'SECONDARY_GROUP_TRUNCATED',
  DIMENSION_REDACTED: 'DIMENSION_REDACTED',
  COMPARE_UNAVAILABLE: 'COMPARE_UNAVAILABLE',
  METRIC_FORBIDDEN: 'METRIC_FORBIDDEN',
  METRIC_UNAVAILABLE: 'METRIC_UNAVAILABLE',
  METRIC_STALE: 'METRIC_STALE',
  SOURCE_STALE: 'SOURCE_STALE',
  CACHE_DEGRADED: 'CACHE_DEGRADED',
  TRAFFIC_LIGHT_UNAVAILABLE: 'TRAFFIC_LIGHT_UNAVAILABLE',
  SYSTEM_PRESET_IMMUTABLE: 'SYSTEM_PRESET_IMMUTABLE',
} as const

export type PmoGroupingViewWarningCode =
  (typeof PMO_GROUPING_VIEW_WARNING_CODES)[keyof typeof PMO_GROUPING_VIEW_WARNING_CODES]

export interface PmoGroupingViewWarning {
  code: PmoGroupingViewWarningCode
  message: string
  groupKey?: string
  metricKey?: string
}

// ─── Stored View Definition ────────────────────────────────────────────────────

export const PMO_GROUPING_VIEW_DEFINITION_VERSION = 'grouping-view.v1' as const

/** 查询定义（低敏 query shape，不保存结果/证据）。 */
export interface PmoGroupingViewQueryDefinition {
  primaryGrouping: PmoGroupingViewPrimaryKey
  secondaryGrouping?: PmoGroupingViewSecondaryKey
  filters?: {
    status?: string[]
    health?: string[]
    search?: string
  }
  sort?: PmoGroupingViewSortKey
  order?: 'asc' | 'desc'
  trendWindow?: PmoGroupingViewTrendWindow
  displayMetricKeys?: PortfolioDashboardMetricKey[]
  compareMode?: PmoGroupingViewCompareMode
  topN?: number
  bottomN?: number
}

/** 持久化视图定义。 */
export interface PmoGroupingViewDefinition {
  id: string
  scope: PmoGroupingViewScope
  organizationId: number
  ownerUserId?: number
  name: string
  description?: string
  definitionVersion: string
  query: PmoGroupingViewQueryDefinition
  isDefault: boolean
  capabilities: PmoGroupingViewCapabilities
  createdAt: string
  updatedAt: string
}

/** 视图能力标记（前端据此展示可用操作）。 */
export interface PmoGroupingViewCapabilities {
  canEdit: boolean
  canDelete: boolean
  canDuplicate: boolean
  canSetDefault: boolean
  canSetOrgDefault: boolean
  isReadonly: boolean
}

// ─── Request / Response DTOs ────────────────────────────────────────────────────

export interface PmoGroupingViewListQuery {
  page?: number
  perPage?: number
  scope?: PmoGroupingViewScope
  search?: string
}

export interface PmoGroupingViewListResponse {
  data: PmoGroupingViewDefinition[]
  meta: PmoGroupingViewPaginationMeta
}

export interface PmoGroupingViewPreviewRequest {
  /** 使用已保存视图的 ID 预览 */
  viewId?: string
  /** 或使用临时查询定义 */
  query?: PmoGroupingViewQueryDefinition
}

export interface PmoGroupingViewPreviewResponse {
  view?: PmoGroupingViewDefinition
  groups: PmoGroupingViewGroupSlice[]
  secondaryGroups?: PmoGroupingViewSecondaryGroupSlice[]
  compare?: PmoGroupingViewCompareBlock
  freshness: PmoGroupingViewSourceFreshness[]
  warnings: PmoGroupingViewWarning[]
  meta: PmoGroupingViewPreviewMeta
}

export interface PmoGroupingViewPreviewMeta {
  calculatedAt: string
  metricVersion: string
  organizationId: number
  visibleProjectCount: number
  primaryGroupCount: number
  secondaryGroupCount: number
  truncated: boolean
}

export interface PmoGroupingViewGroupSlice {
  groupKey: string
  groupValue: string
  projectCount: number
  kpis: Array<{
    key: string
    value: number | null
    unit: string
    status: string
  }>
  secondaryGroups?: PmoGroupingViewSecondaryGroupSlice[]
  warnings: PmoGroupingViewWarning[]
}

export interface PmoGroupingViewSecondaryGroupSlice {
  secondaryKey: string
  secondaryValue: string
  projectCount: number
  kpis: Array<{
    key: string
    value: number | null
    unit: string
    status: string
  }>
  warnings: PmoGroupingViewWarning[]
}

export interface PmoGroupingViewCompareBlock {
  mode: PmoGroupingViewCompareMode
  available: boolean
  baseline?: {
    window: string
    label: string
    groups: PmoGroupingViewGroupSlice[]
  }
  delta?: Array<{
    groupKey: string
    groupValue: string
    projectCountDelta: number
    warnings: PmoGroupingViewWarning[]
  }>
  warnings: PmoGroupingViewWarning[]
}

export interface PmoGroupingViewSourceFreshness {
  source: string
  lastUpdatedAt: string | null
  isStale: boolean
  staleThresholdMinutes: number
}

export interface PmoGroupingViewCreateRequest {
  name: string
  description?: string
  scope: PmoGroupingViewScope
  query: PmoGroupingViewQueryDefinition
  isDefault?: boolean
}

export interface PmoGroupingViewUpdateRequest {
  name?: string
  description?: string
  query?: PmoGroupingViewQueryDefinition
  isDefault?: boolean
}

export interface PmoGroupingViewSetDefaultRequest {
  scope: 'personal' | 'organization'
}

// ─── Pagination ─────────────────────────────────────────────────────────────────

export interface PmoGroupingViewPaginationMeta {
  page: number
  perPage: number
  total: number
  totalPages: number
}

// ─── Constants ──────────────────────────────────────────────────────────────────

export const PMO_GROUPING_VIEW_MAX_PER_PAGE = 100
export const PMO_GROUPING_VIEW_DEFAULT_PER_PAGE = 20
export const PMO_GROUPING_VIEW_MAX_GROUP_CARDINALITY = 30
export const PMO_GROUPING_VIEW_MAX_SECONDARY_GROUPS = 8
export const PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N = 20
export const PMO_GROUPING_VIEW_MAX_NAME_LENGTH = 120
export const PMO_GROUPING_VIEW_MAX_DESCRIPTION_LENGTH = 400
export const PMO_GROUPING_VIEW_MAX_FILTER_VALUES = 15
export const PMO_GROUPING_VIEW_MAX_DISPLAY_METRICS = 8

// ─── System Preset Catalogue ───────────────────────────────────────────────────

/** 系统预设视图 ID 前缀。 */
export const PMO_GROUPING_VIEW_SYSTEM_PRESET_IDS = {
  BY_STATUS: 'system-by-status',
  BY_HEALTH: 'system-by-health',
  BY_TRAFFIC_LIGHT: 'system-by-traffic-light',
  BY_MANAGER: 'system-by-manager',
  BY_DEPARTMENT: 'system-by-department',
  BY_LIFECYCLE: 'system-by-lifecycle',
} as const

export type PmoGroupingViewSystemPresetId =
  (typeof PMO_GROUPING_VIEW_SYSTEM_PRESET_IDS)[keyof typeof PMO_GROUPING_VIEW_SYSTEM_PRESET_IDS]

/** 系统预设视图目录（6 个）。 */
export function getSystemPresetViews(organizationId: number): PmoGroupingViewDefinition[] {
  const now = new Date().toISOString()
  return [
    {
      id: PMO_GROUPING_VIEW_SYSTEM_PRESET_IDS.BY_STATUS,
      scope: 'system',
      organizationId,
      name: '按状态分组',
      description: '按项目状态（活跃/归档/暂停/草稿）查看组织组合分布',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      query: {
        primaryGrouping: 'status',
        displayMetricKeys: [
          PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
          PORTFOLIO_DASHBOARD_METRIC_KEYS.ACTIVE_PROJECTS,
        ],
      },
      isDefault: false,
      capabilities: {
        canEdit: false,
        canDelete: false,
        canDuplicate: true,
        canSetDefault: false,
        canSetOrgDefault: false,
        isReadonly: true,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PMO_GROUPING_VIEW_SYSTEM_PRESET_IDS.BY_HEALTH,
      scope: 'system',
      organizationId,
      name: '按健康度分组',
      description: '按项目健康状态查看组织组合分布',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      query: {
        primaryGrouping: 'health',
        displayMetricKeys: [
          PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
          PORTFOLIO_DASHBOARD_METRIC_KEYS.AT_RISK_PROJECTS,
        ],
      },
      isDefault: false,
      capabilities: {
        canEdit: false,
        canDelete: false,
        canDuplicate: true,
        canSetDefault: false,
        canSetOrgDefault: false,
        isReadonly: true,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PMO_GROUPING_VIEW_SYSTEM_PRESET_IDS.BY_TRAFFIC_LIGHT,
      scope: 'system',
      organizationId,
      name: '按交通灯分组',
      description: '按组合交通灯颜色（红/黄/绿/灰）查看项目分布',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      query: {
        primaryGrouping: 'traffic_light',
        displayMetricKeys: [
          PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
          PORTFOLIO_DASHBOARD_METRIC_KEYS.TRAFFIC_LIGHT_RED_COUNT,
        ],
      },
      isDefault: false,
      capabilities: {
        canEdit: false,
        canDelete: false,
        canDuplicate: true,
        canSetDefault: false,
        canSetOrgDefault: false,
        isReadonly: true,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PMO_GROUPING_VIEW_SYSTEM_PRESET_IDS.BY_MANAGER,
      scope: 'system',
      organizationId,
      name: '按负责人分组',
      description: '按项目负责人查看管理跨度与负载',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      query: {
        primaryGrouping: 'manager',
        displayMetricKeys: [
          PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
          PORTFOLIO_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG,
        ],
      },
      isDefault: false,
      capabilities: {
        canEdit: false,
        canDelete: false,
        canDuplicate: true,
        canSetDefault: false,
        canSetOrgDefault: false,
        isReadonly: true,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PMO_GROUPING_VIEW_SYSTEM_PRESET_IDS.BY_DEPARTMENT,
      scope: 'system',
      organizationId,
      name: '按部门分组',
      description: '按部门查看组织级项目分布',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      query: {
        primaryGrouping: 'department',
        displayMetricKeys: [
          PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
          PORTFOLIO_DASHBOARD_METRIC_KEYS.OVERALL_PROGRESS_AVG,
        ],
      },
      isDefault: false,
      capabilities: {
        canEdit: false,
        canDelete: false,
        canDuplicate: true,
        canSetDefault: false,
        canSetOrgDefault: false,
        isReadonly: true,
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PMO_GROUPING_VIEW_SYSTEM_PRESET_IDS.BY_LIFECYCLE,
      scope: 'system',
      organizationId,
      name: '按生命周期分组',
      description: '按项目生命周期阶段查看组织组合分布',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      query: {
        primaryGrouping: 'lifecycle_phase',
        displayMetricKeys: [
          PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS,
          PORTFOLIO_DASHBOARD_METRIC_KEYS.ACTIVE_PROJECTS,
        ],
      },
      isDefault: false,
      capabilities: {
        canEdit: false,
        canDelete: false,
        canDuplicate: true,
        canSetDefault: false,
        canSetOrgDefault: false,
        isReadonly: true,
      },
      createdAt: now,
      updatedAt: now,
    },
  ]
}

/** 判断是否为系统预设 ID。 */
export function isSystemPresetId(id: string): boolean {
  return Object.values(PMO_GROUPING_VIEW_SYSTEM_PRESET_IDS).includes(
    id as PmoGroupingViewSystemPresetId,
  )
}

/** 判断视图是否为系统预设（scope === 'system' 或 ID 在系统预设目录中）。 */
export function isSystemPreset(view: { scope: string; id: string }): boolean {
  return view.scope === PMO_GROUPING_VIEW_SCOPES.SYSTEM || isSystemPresetId(view.id)
}

// ─── Contract Helpers ───────────────────────────────────────────────────────────

/**
 * 规范化查询定义——填充缺失字段为默认值。
 */
export function normalizeGroupingViewQuery(
  query: PmoGroupingViewQueryDefinition,
): PmoGroupingViewQueryDefinition {
  return {
    primaryGrouping: query.primaryGrouping,
    secondaryGrouping: query.secondaryGrouping,
    filters: query.filters ?? {},
    sort: query.sort ?? PMO_GROUPING_VIEW_SORT_KEYS.PROJECT_COUNT,
    order: query.order ?? 'desc',
    trendWindow: query.trendWindow ?? PORTFOLIO_TREND_WINDOWS.LAST_30_DAYS,
    displayMetricKeys: query.displayMetricKeys ?? [PORTFOLIO_DASHBOARD_METRIC_KEYS.TOTAL_PROJECTS],
    compareMode: query.compareMode ?? PMO_GROUPING_VIEW_COMPARE_MODES.NONE,
    topN: query.topN,
    bottomN: query.bottomN,
  }
}

/**
 * 校验查询定义中的 grouping key 是否为合法白名单值。
 * 返回空数组表示通过。
 */
export function validateGroupingViewKeys(query: PmoGroupingViewQueryDefinition): string[] {
  const errors: string[] = []
  const primaryValues = Object.values(PMO_GROUPING_VIEW_PRIMARY_KEYS) as string[]
  if (!primaryValues.includes(query.primaryGrouping)) {
    errors.push(`不支持的主分组维度: ${query.primaryGrouping}`)
  }
  if (query.secondaryGrouping) {
    const secondaryValues = Object.values(PMO_GROUPING_VIEW_SECONDARY_KEYS) as string[]
    if (!secondaryValues.includes(query.secondaryGrouping)) {
      errors.push(`不支持的二级分组维度: ${query.secondaryGrouping}`)
    }
    if (query.secondaryGrouping === query.primaryGrouping) {
      errors.push('二级分组维度不能与主分组维度相同')
    }
  }
  if (query.compareMode) {
    const compareModes = Object.values(PMO_GROUPING_VIEW_COMPARE_MODES) as string[]
    if (!compareModes.includes(query.compareMode)) {
      errors.push(`不支持比较模式: ${query.compareMode}`)
    }
  }
  if (query.sort) {
    const sortKeys = Object.values(PMO_GROUPING_VIEW_SORT_KEYS) as string[]
    if (!sortKeys.includes(query.sort)) {
      errors.push(`不支持排序字段: ${query.sort}`)
    }
  }
  if (
    query.topN !== undefined &&
    (query.topN < 1 || query.topN > PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N)
  ) {
    errors.push(`topN 必须在 1-${PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N} 范围内`)
  }
  if (
    query.bottomN !== undefined &&
    (query.bottomN < 1 || query.bottomN > PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N)
  ) {
    errors.push(`bottomN 必须在 1-${PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N} 范围内`)
  }
  return errors
}

/**
 * 拒绝保存包含敏感内容的视图定义。
 * 敏感内容包括：结果列表、证据文本、hidden dimension 计数、prompt/model output/token/API key/跨组织引用。
 */
export function containsSensitiveContent(definition: unknown): { found: boolean; reason?: string } {
  const json = JSON.stringify(definition)
  const forbiddenFields = [
    'projectResults',
    'projectList',
    'resolvedIds',
    'evidenceText',
    'evidenceBody',
    'hiddenCounts',
    'prompt',
    'modelOutput',
    'modelResponse',
    'token',
    'apiKey',
    'api_key',
    'secret',
    'authorization',
    'password',
    'crossOrganization',
    'foreignOrg',
  ]
  for (const field of forbiddenFields) {
    if (json.includes(`"${field}"`) || json.includes(`'${field}'`)) {
      return { found: true, reason: `定义中包含禁止字段: ${field}` }
    }
  }
  return { found: false }
}

/**
 * 对查询定义生成稳定的低敏哈希（用于审计/比较）。不含结果数据。
 */
export function hashGroupingViewQuery(query: PmoGroupingViewQueryDefinition): string {
  const normalized = normalizeGroupingViewQuery(query)
  const canonical = JSON.stringify(normalized, Object.keys(normalized).sort())
  // 简单确定性哈希（SHA-256 的 16 进制前 16 字符近似，用于低敏审计）
  let hash = 0
  for (let i = 0; i < canonical.length; i++) {
    const char = canonical.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return `gv-${Math.abs(hash).toString(16).padStart(8, '0')}`
}

/**
 * 低敏 warning 投影：只返回 warning 的 code、message、groupKey，不泄露指标值/项目名。
 */
export function toLowSensitiveGroupingWarning(
  warning: PmoGroupingViewWarning,
): PmoGroupingViewWarning {
  return {
    code: warning.code,
    message: warning.message,
    groupKey: warning.groupKey,
  }
}

/**
 * 构建维度脱敏的 trunacted warning。
 */
export function groupTruncatedWarning(
  groupKey: string,
  totalCount: number,
  maxCardinality: number,
): PmoGroupingViewWarning {
  return {
    code: PMO_GROUPING_VIEW_WARNING_CODES.GROUP_TRUNCATED,
    message: `分组 ${groupKey} 的结果已截断：共 ${totalCount} 个分组，仅返回前 ${maxCardinality} 个`,
    groupKey,
  }
}

/**
 * 构建维度脱敏 warning。
 */
export function dimensionRedactedWarning(groupKey: string): PmoGroupingViewWarning {
  return {
    code: PMO_GROUPING_VIEW_WARNING_CODES.DIMENSION_REDACTED,
    message: `分组 ${groupKey} 的部分维度因权限不足已脱敏`,
    groupKey,
  }
}

/**
 * 构建 traffic-light 不可用 warning。
 */
export function groupingTrafficLightUnavailableWarning(): PmoGroupingViewWarning {
  return {
    code: PMO_GROUPING_VIEW_WARNING_CODES.TRAFFIC_LIGHT_UNAVAILABLE,
    message: 'PMO 交通灯能力未启用，按交通灯分组将显示为灰色',
  }
}

/**
 * 构建系统预设不可修改 warning。
 */
export function systemPresetImmutableWarning(viewId: string): PmoGroupingViewWarning {
  return {
    code: PMO_GROUPING_VIEW_WARNING_CODES.SYSTEM_PRESET_IMMUTABLE,
    message: `系统预设视图 ${viewId} 不可修改或删除`,
  }
}

/**
 * 判断分组结果是否因数据不可用而全部降级。
 */
export function isAllGroupsRedacted(warnings: PmoGroupingViewWarning[]): boolean {
  return warnings.every(
    (w) =>
      w.code === PMO_GROUPING_VIEW_WARNING_CODES.DIMENSION_REDACTED ||
      w.code === PMO_GROUPING_VIEW_WARNING_CODES.METRIC_FORBIDDEN,
  )
}
