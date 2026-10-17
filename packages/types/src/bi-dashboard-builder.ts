// @aiproj/types —— BI Dashboard Builder 共享契约（前后端共享）。
// v3-bi-dashboard-builder §2：dashboard scope、widget key、layout、global filter、
// time window、definition、preview、freshness、warning/error、source/provenance、
// audit 和 API envelope 契约。
//
// 红线：
//   - Dashboard Builder 不复制报表或组织 Dashboard 能力，在它们之上组合 BI 资产。
//   - 所有运行时挂 /api/v1，使用 AdonisJS 五层、Lucid/SQLite、TanStack Query、Zustand。
//   - 零依赖：本文件不得 import AdonisJS、React、数据库客户端、AI SDK 或第三方运行时。
//   - Widget 只引用服务端白名单数据依赖和已保存授权资产。
//   - 定义 MUST NOT 包含任意 SQL、脚本、公式、外部 URL、prompt、模型输出、secret。
//   - 权限受限字段只返回低敏 forbidden/unavailable/redacted 状态。

// ─── 契约版本 ─────────────────────────────────────────────────────────────

export const BI_DASHBOARD_BUILDER_CONTRACT_VERSION = 'bi-dashboard-builder-v1'

// ─── Dashboard 作用域 ──────────────────────────────────────────────────────

export const BI_DASHBOARD_SCOPES = {
  PERSONAL: 'personal',
  ORGANIZATION_SHARED: 'organization_shared',
} as const

export type BiDashboardScope = (typeof BI_DASHBOARD_SCOPES)[keyof typeof BI_DASHBOARD_SCOPES]

export const BI_DASHBOARD_SCOPE_VALUES = Object.values(
  BI_DASHBOARD_SCOPES,
) as readonly BiDashboardScope[]

// ─── Widget 键白名单 ───────────────────────────────────────────────────────

/** P0 widget 键白名单，服务端 registry 控制，前端只能引用。 */
export const BI_DASHBOARD_WIDGET_KEYS = {
  BI_TREND: 'bi_trend',
  BI_RISK_HEATMAP: 'bi_risk_heatmap',
  BI_CUSTOM_REPORT_SUMMARY: 'bi_custom_report_summary',
  PMO_HEALTH: 'pmo_health',
  RESOURCE_SUMMARY: 'resource_summary',
  OKR_SUMMARY: 'okr_summary',
  ORGANIZATION_DASHBOARD_SUMMARY: 'organization_dashboard_summary',
} as const

export type BiDashboardWidgetKey =
  (typeof BI_DASHBOARD_WIDGET_KEYS)[keyof typeof BI_DASHBOARD_WIDGET_KEYS]

export const BI_DASHBOARD_WIDGET_KEY_VALUES = Object.values(
  BI_DASHBOARD_WIDGET_KEYS,
) as readonly BiDashboardWidgetKey[]

// ─── Widget 尺寸 token ─────────────────────────────────────────────────────

export const BI_DASHBOARD_WIDGET_SIZES = {
  SMALL: 'small',
  MEDIUM: 'medium',
  LARGE: 'large',
  FULL: 'full',
} as const

export type BiDashboardWidgetSize =
  (typeof BI_DASHBOARD_WIDGET_SIZES)[keyof typeof BI_DASHBOARD_WIDGET_SIZES]

// ─── 布局与断点 ────────────────────────────────────────────────────────────

export const BI_DASHBOARD_MAX_WIDGETS = 12
export const BI_DASHBOARD_MAX_BREAKPOINTS = 6
export const BI_DASHBOARD_MIN_COLUMNS = 1
export const BI_DASHBOARD_MAX_COLUMNS = 4

/** Dashboard 级布局配置。 */
export interface BiDashboardLayout {
  columns: number
  density: 'comfortable' | 'compact'
  breakpoints?: BiDashboardBreakpointConfig[]
}

export interface BiDashboardBreakpointConfig {
  minWidth: number
  columns: number
}

// ─── 全局筛选 ──────────────────────────────────────────────────────────────

export const BI_DASHBOARD_MAX_GLOBAL_FILTERS = 10

export interface BiDashboardGlobalFilter {
  key: string
  label: string
  type: 'portfolio' | 'project_status' | 'risk_level' | 'time_range' | 'tag'
  value: unknown
}

// ─── 时间窗口 ──────────────────────────────────────────────────────────────

export const BI_DASHBOARD_WINDOW_MAX_DAYS = 730 // 2年上限

export interface BiDashboardTimeWindow {
  mode: 'last_n_days' | 'custom'
  days?: number
  startDate?: string
  endDate?: string
}

// ─── Freshness 策略 ────────────────────────────────────────────────────────

export const BI_DASHBOARD_FRESHNESS_STATUSES = {
  FRESH: 'fresh',
  STALE: 'stale',
  UNAVAILABLE: 'unavailable',
} as const

export type BiDashboardFreshnessStatus =
  (typeof BI_DASHBOARD_FRESHNESS_STATUSES)[keyof typeof BI_DASHBOARD_FRESHNESS_STATUSES]

export interface BiDashboardFreshnessPolicy {
  maxAgeSeconds: number
  staleBehavior: 'warning' | 'block'
}

// ─── Warning / Error 状态 ──────────────────────────────────────────────────

export const BI_DASHBOARD_WARNING_CODES = {
  WIDGET_UNAVAILABLE: 'BI_DASHBOARD_WIDGET_UNAVAILABLE' as const,
  WIDGET_FORBIDDEN: 'BI_DASHBOARD_WIDGET_FORBIDDEN' as const,
  WIDGET_TIMEOUT: 'BI_DASHBOARD_WIDGET_TIMEOUT' as const,
  WIDGET_EMPTY: 'BI_DASHBOARD_WIDGET_EMPTY' as const,
  DATA_STALE: 'BI_DASHBOARD_DATA_STALE' as const,
  DATA_UNAVAILABLE: 'BI_DASHBOARD_DATA_UNAVAILABLE' as const,
  PERMISSION_REDACTED: 'BI_DASHBOARD_PERMISSION_REDACTED' as const,
  DEPENDENCY_UNAVAILABLE: 'BI_DASHBOARD_DEPENDENCY_UNAVAILABLE' as const,
  BLOCKING_MISSING_DEPENDENCY: 'BI_DASHBOARD_BLOCKING_MISSING_DEPENDENCY' as const,
  BLOCKING_PERMISSION: 'BI_DASHBOARD_BLOCKING_PERMISSION' as const,
  LAYOUT_FALLBACK_APPLIED: 'BI_DASHBOARD_LAYOUT_FALLBACK_APPLIED' as const,
} as const

export type BiDashboardWarningCode =
  (typeof BI_DASHBOARD_WARNING_CODES)[keyof typeof BI_DASHBOARD_WARNING_CODES]

export interface BiDashboardWarning {
  code: BiDashboardWarningCode
  widgetKey?: BiDashboardWidgetKey
  message: string
  blocking: boolean
}

// ─── Widget Instance (runtime payload) ──────────────────────────────────────

export interface BiDashboardWidgetInstance {
  widgetKey: BiDashboardWidgetKey
  size: BiDashboardWidgetSize
  position: BiDashboardWidgetPosition
  settings: Record<string, unknown>
  visualization?: string
}

export interface BiDashboardWidgetPosition {
  x: number
  y: number
  w: number
  h: number
}

// ─── Widget Preview 结果 ───────────────────────────────────────────────────

export interface BiDashboardWidgetPreview {
  widgetKey: BiDashboardWidgetKey
  size: BiDashboardWidgetSize
  status: 'available' | 'forbidden' | 'unavailable' | 'blocking'
  data?: unknown
  warnings: BiDashboardWarning[]
  freshness: {
    status: BiDashboardFreshnessStatus
    generatedAt: string
    maxAgeSeconds: number
  }
  sourceRefs: BiDashboardSourceRef[]
  sourceHash: string
  drillDownTargets?: BiDashboardDrillDownTarget[]
}

export interface BiDashboardSourceRef {
  sourceKey: string
  sourceHash: string
  generatedAt: string
}

export interface BiDashboardDrillDownTarget {
  label: string
  type: 'project' | 'task' | 'risk' | 'resource' | 'okr' | 'report'
  id: string
  authorized: boolean
}

// ─── Preview 结果 ──────────────────────────────────────────────────────────

export interface BiDashboardPreviewResult {
  definitionHash: string
  snapshotHash: string
  widgets: BiDashboardWidgetPreview[]
  globalWarnings: BiDashboardWarning[]
  saveable: boolean
  freshnessAggregate: {
    status: BiDashboardFreshnessStatus
    oldestGeneratedAt: string
  }
}

// ─── Definition (保存实体) ──────────────────────────────────────────────────

export interface BiDashboardDefinition {
  dashboardId: number
  organizationId: number
  scope: BiDashboardScope
  ownerActorId: number | null
  name: string
  version: number
  definitionHash: string
  snapshotHash: string
  layout: BiDashboardLayout
  widgets: BiDashboardWidgetInstance[]
  globalFilters: BiDashboardGlobalFilter[]
  timeWindow: BiDashboardTimeWindow
  freshnessPolicy: BiDashboardFreshnessPolicy
  isDefault: boolean
  isArchived: boolean
  warningSummary?: BiDashboardWarning[]
  createdAt: string
  updatedAt: string
}

// ─── Widget Registry Entry ─────────────────────────────────────────────────

export interface BiDashboardWidgetRegistryEntry {
  widgetKey: BiDashboardWidgetKey
  displayKey: string
  allowedSizes: BiDashboardWidgetSize[]
  supportedVisualizations: string[]
  settingSchema: Record<string, unknown>
  dataDependencyId: string
  permissionTags: string[]
  supportedFilters: string[]
  supportedDrillDown: boolean
  freshnessPolicy: BiDashboardFreshnessPolicy
  emptyBehavior: 'show_empty' | 'hide' | 'show_placeholder'
  fallbackBehavior: 'warning' | 'blocking' | 'skip'
  availability: 'available' | 'unavailable' | 'disabled'
}

// ─── API Envelope ──────────────────────────────────────────────────────────

export interface BiDashboardListResponse {
  data: BiDashboardDefinition[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

export interface BiDashboardDetailResponse {
  data: BiDashboardDefinition
}

export interface BiDashboardRegistryResponse {
  data: BiDashboardWidgetRegistryEntry[]
}

// ─── 请求载荷 ──────────────────────────────────────────────────────────────

export interface BiDashboardCreatePayload {
  name: string
  scope: BiDashboardScope
  layout: BiDashboardLayout
  widgets: BiDashboardWidgetInstance[]
  globalFilters?: BiDashboardGlobalFilter[]
  timeWindow?: BiDashboardTimeWindow
  freshnessPolicy?: BiDashboardFreshnessPolicy
}

export interface BiDashboardUpdatePayload extends BiDashboardCreatePayload {
  version: number
}

export interface BiDashboardPreviewPayload {
  layout: BiDashboardLayout
  widgets: BiDashboardWidgetInstance[]
  globalFilters?: BiDashboardGlobalFilter[]
  timeWindow?: BiDashboardTimeWindow
}

// ─── 系统默认 Dashboard ────────────────────────────────────────────────────

export const BI_DASHBOARD_SYSTEM_DEFAULT: Omit<
  BiDashboardDefinition,
  'dashboardId' | 'organizationId' | 'ownerActorId' | 'createdAt' | 'updatedAt'
> = {
  scope: 'organization_shared' as BiDashboardScope,
  name: '系统默认 BI 看板',
  version: 1,
  definitionHash: '',
  snapshotHash: '',
  layout: {
    columns: 2,
    density: 'comfortable',
    breakpoints: [],
  },
  widgets: [],
  globalFilters: [],
  timeWindow: { mode: 'last_n_days', days: 30 },
  freshnessPolicy: { maxAgeSeconds: 3600, staleBehavior: 'warning' },
  isDefault: true,
  isArchived: false,
}

// ─── 审计事件类型 ──────────────────────────────────────────────────────────

export const BI_DASHBOARD_AUDIT_EVENTS = {
  // 值与后端 AuditService 的 AuditEvent 常量保持一致（大写），
  // 否则 audit.log 的 event 参数会因类型不匹配被拒。
  CREATED: 'BI_DASHBOARD_CREATED',
  UPDATED: 'BI_DASHBOARD_UPDATED',
  COPIED: 'BI_DASHBOARD_COPIED',
  SET_DEFAULT: 'BI_DASHBOARD_SET_DEFAULT',
  ARCHIVED: 'BI_DASHBOARD_ARCHIVED',
  RESTORED: 'BI_DASHBOARD_RESTORED',
  DELETED: 'BI_DASHBOARD_DELETED',
} as const

// ─── 纯函数：normalize definition to hash ──────────────────────────────────

export function normalizeBiDashboardDefinition(
  definition: Omit<
    BiDashboardDefinition,
    | 'dashboardId'
    | 'organizationId'
    | 'version'
    | 'definitionHash'
    | 'snapshotHash'
    | 'createdAt'
    | 'updatedAt'
  >,
): string {
  const canonical = JSON.stringify(
    {
      name: definition.name,
      scope: definition.scope,
      layout: definition.layout,
      widgets: definition.widgets.map((w) => ({
        widgetKey: w.widgetKey,
        size: w.size,
        position: w.position,
        settings: w.settings,
        visualization: w.visualization,
      })),
      globalFilters: definition.globalFilters,
      timeWindow: definition.timeWindow,
      freshnessPolicy: definition.freshnessPolicy,
    },
    Object.keys({
      name: 1,
      scope: 1,
      layout: 1,
      widgets: 1,
      globalFilters: 1,
      timeWindow: 1,
      freshnessPolicy: 1,
    }).sort(),
  )
  return simpleHash(canonical)
}

export function computeBiDashboardSnapshotHash(
  definitionHash: string,
  widgetPreviews: Pick<BiDashboardWidgetPreview, 'sourceHash' | 'status'>[],
  visibleWarnings: Pick<BiDashboardWarning, 'code'>[],
): string {
  const payload = JSON.stringify({
    definitionHash,
    widgetSourceHashes: widgetPreviews.map((wp) => wp.sourceHash).sort(),
    widgetStatuses: widgetPreviews.map((wp) => wp.status).sort(),
    warningCodes: visibleWarnings.map((w) => w.code).sort(),
  })
  return simpleHash(payload)
}

export function aggregateBiDashboardFreshness(
  widgets: Pick<BiDashboardWidgetPreview, 'freshness' | 'status'>[],
): BiDashboardPreviewResult['freshnessAggregate'] {
  const available = widgets.filter((w) => w.status === 'available')
  if (available.length === 0) {
    return { status: 'unavailable' as BiDashboardFreshnessStatus, oldestGeneratedAt: '' }
  }
  const oldest = available.reduce(
    (earliest, w) => (w.freshness.generatedAt < earliest ? w.freshness.generatedAt : earliest),
    available[0]!.freshness.generatedAt,
  )
  const stalest = available.reduce((worst, w) => {
    if (w.freshness.status === 'unavailable') return 'unavailable'
    if (w.freshness.status === 'stale' && worst !== 'unavailable') return 'stale'
    return worst
  }, 'fresh' as string)
  return { status: stalest as BiDashboardFreshnessStatus, oldestGeneratedAt: oldest }
}

export function isBiDashboardSaveable(
  widgets: Pick<BiDashboardWidgetPreview, 'status' | 'warnings'>[],
  globalWarnings: BiDashboardWarning[],
): boolean {
  const hasBlockingWidget = widgets.some((w) => w.status === 'blocking')
  const hasBlockingWarning = globalWarnings.some((w) => w.blocking)
  return !hasBlockingWidget && !hasBlockingWarning
}

// ─── 内部：简单不可逆 hash ─────────────────────────────────────────────────

function simpleHash(input: string): string {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// ─── 纯函数：validate/redact helper ────────────────────────────────────────

export function isAllowedBiDashboardWidgetKey(value: unknown): value is BiDashboardWidgetKey {
  return (
    typeof value === 'string' &&
    (BI_DASHBOARD_WIDGET_KEY_VALUES as readonly string[]).includes(value)
  )
}

export function isAllowedBiDashboardScope(value: unknown): value is BiDashboardScope {
  return (
    typeof value === 'string' && (BI_DASHBOARD_SCOPE_VALUES as readonly string[]).includes(value)
  )
}

export function isAllowedBiDashboardWidgetSize(value: unknown): value is BiDashboardWidgetSize {
  return typeof value === 'string' && ['small', 'medium', 'large', 'full'].includes(value)
}
