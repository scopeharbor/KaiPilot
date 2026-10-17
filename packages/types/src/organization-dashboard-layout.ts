// @aiproj/types —— 组织 Dashboard 布局编排共享契约（前后端共享）。
// v3-organization-dashboard-layout-builder §2：layout scope、module registry、size tokens、
// breakpoint schema、warning codes、preview result、version fields 与 API envelopes。
//
// 红线：
//   - 布局是配置层，不是数据聚合层；模块只能引用后端注册的 moduleKey，不能携带查询表达式。
//   - 所有布局配置在渲染时必须经过后端白名单验证、权限校验与组织隔离。
//   - 系统默认布局来自代码常量，不可写入；个人/组织共享布局可版本化写入。

// ─── Layout Scopes ───────────────────────────────────────────────────────────────

export const ORGANIZATION_DASHBOARD_LAYOUT_SCOPES = {
  SYSTEM: 'system',
  PERSONAL: 'personal',
  SHARED: 'shared',
} as const

export type OrganizationDashboardLayoutScope =
  (typeof ORGANIZATION_DASHBOARD_LAYOUT_SCOPES)[keyof typeof ORGANIZATION_DASHBOARD_LAYOUT_SCOPES]

export const ORGANIZATION_DASHBOARD_LAYOUT_SCOPE_VALUES = Object.values(
  ORGANIZATION_DASHBOARD_LAYOUT_SCOPES,
) as readonly OrganizationDashboardLayoutScope[]

// ─── Module Keys ────────────────────────────────────────────────────────────────

export const ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS = {
  IDENTITY: 'identity',
  KPI_STRIP: 'kpi_strip',
  STATUS_DISTRIBUTION: 'status_distribution',
  ATTENTION_PROJECTS: 'attention_projects',
  MEMBER_OVERVIEW: 'member_overview',
  RESOURCE_OVERVIEW: 'resource_overview',
  RISK_REMINDERS: 'risk_reminders',
  ACTIVITY: 'activity',
  PMO_ENTRY: 'pmo_entry',
  /** v3-okr-dashboard §4.3 — 组织级 OKR 只读摘要模块。 */
  OKR_DASHBOARD_SUMMARY: 'okr_dashboard_summary',
  /** v3-bi-dashboard-builder §7.1 — 组织级 BI Dashboard 只读摘要模块。 */
  BI_DASHBOARD_SUMMARY: 'bi_dashboard_summary',
} as const

export type OrganizationDashboardLayoutModuleKey =
  (typeof ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS)[keyof typeof ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS]

export const ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEY_VALUES = Object.values(
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS,
) as readonly OrganizationDashboardLayoutModuleKey[]

// ─── Size Tokens ────────────────────────────────────────────────────────────────

export const ORGANIZATION_DASHBOARD_LAYOUT_SIZES = {
  SMALL: 'small',
  MEDIUM: 'medium',
  LARGE: 'large',
  FULL: 'full',
} as const

export type OrganizationDashboardLayoutSize =
  (typeof ORGANIZATION_DASHBOARD_LAYOUT_SIZES)[keyof typeof ORGANIZATION_DASHBOARD_LAYOUT_SIZES]

export const ORGANIZATION_DASHBOARD_LAYOUT_SIZE_VALUES = Object.values(
  ORGANIZATION_DASHBOARD_LAYOUT_SIZES,
) as readonly OrganizationDashboardLayoutSize[]

/** Grid column spans for each size token at desktop breakpoint. */
export const ORGANIZATION_DASHBOARD_LAYOUT_SIZE_COLUMNS: Record<
  OrganizationDashboardLayoutSize,
  number
> = {
  [ORGANIZATION_DASHBOARD_LAYOUT_SIZES.SMALL]: 2,
  [ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM]: 4,
  [ORGANIZATION_DASHBOARD_LAYOUT_SIZES.LARGE]: 6,
  [ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL]: 12,
}

// ─── Density ────────────────────────────────────────────────────────────────────

export const ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES = {
  COMFORTABLE: 'comfortable',
  COMPACT: 'compact',
} as const

export type OrganizationDashboardLayoutDensity =
  (typeof ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES)[keyof typeof ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES]

export const ORGANIZATION_DASHBOARD_LAYOUT_DENSITY_VALUES = Object.values(
  ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES,
) as readonly OrganizationDashboardLayoutDensity[]

// ─── Breakpoint Schema ──────────────────────────────────────────────────────────

export const ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINTS = {
  MOBILE: 'mobile',
  TABLET: 'tablet',
  DESKTOP: 'desktop',
} as const

export type OrganizationDashboardLayoutBreakpoint =
  (typeof ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINTS)[keyof typeof ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINTS]

export const ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINT_VALUES = Object.values(
  ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINTS,
) as readonly OrganizationDashboardLayoutBreakpoint[]

/** Stable pixel thresholds for each breakpoint. */
export const ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINT_THRESHOLDS: Record<
  OrganizationDashboardLayoutBreakpoint,
  number
> = {
  [ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINTS.MOBILE]: 0,
  [ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINTS.TABLET]: 640,
  [ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINTS.DESKTOP]: 1024,
}

/** Grid column count at each breakpoint. */
export const ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINT_COLUMNS: Record<
  OrganizationDashboardLayoutBreakpoint,
  number
> = {
  [ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINTS.MOBILE]: 4,
  [ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINTS.TABLET]: 8,
  [ORGANIZATION_DASHBOARD_LAYOUT_BREAKPOINTS.DESKTOP]: 12,
}

// ─── Warning Codes ──────────────────────────────────────────────────────────────

export const ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES = {
  LAYOUT_FALLBACK_APPLIED: 'LAYOUT_FALLBACK_APPLIED',
  LAYOUT_MODULE_FORBIDDEN: 'LAYOUT_MODULE_FORBIDDEN',
  LAYOUT_MODULE_UNAVAILABLE: 'LAYOUT_MODULE_UNAVAILABLE',
  LAYOUT_STALE: 'LAYOUT_STALE',
  LAYOUT_NOT_FOUND: 'LAYOUT_NOT_FOUND',
  LAYOUT_VERSION_CONFLICT: 'LAYOUT_VERSION_CONFLICT',
  LAYOUT_PREVIEW_WARNING: 'LAYOUT_PREVIEW_WARNING',
} as const

export type OrganizationDashboardLayoutWarningCode =
  (typeof ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES)[keyof typeof ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES]

export const ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODE_VALUES = Object.values(
  ORGANIZATION_DASHBOARD_LAYOUT_WARNING_CODES,
) as readonly OrganizationDashboardLayoutWarningCode[]

// ─── Module Instance ────────────────────────────────────────────────────────────

export interface OrganizationDashboardLayoutModuleInstance {
  moduleKey: OrganizationDashboardLayoutModuleKey
  size: OrganizationDashboardLayoutSize
  /** 1-indexed grid row position (for stable ordering). */
  row: number
  /** 1-indexed grid column position (for stable ordering). */
  col: number
  /** Optional breakpoint overrides — only differ from the default placement. */
  breakpoints?: Partial<
    Record<
      OrganizationDashboardLayoutBreakpoint,
      {
        size?: OrganizationDashboardLayoutSize
        row?: number
        col?: number
      }
    >
  >
  /** Module-level settings (validated against registry schema). */
  settings?: Record<string, unknown>
}

// ─── Layout Envelope ────────────────────────────────────────────────────────────

export interface OrganizationDashboardLayout {
  layoutId: number
  organizationId: number
  scope: OrganizationDashboardLayoutScope
  /** Actor ID when scope is PERSONAL; null for SYSTEM and SHARED. */
  ownerActorId: number | null
  name: string | null
  version: number
  isDefault: boolean
  density: OrganizationDashboardLayoutDensity
  modules: OrganizationDashboardLayoutModuleInstance[]
  createdAt: string
  updatedAt: string
}

/** Create/update payload — client sends only mutable fields. */
export interface OrganizationDashboardLayoutPayload {
  name?: string
  density?: OrganizationDashboardLayoutDensity
  modules: OrganizationDashboardLayoutModuleInstance[]
  /** Expected version for optimistic concurrency (omit on create). */
  expectedVersion?: number
}

// ─── Preview ────────────────────────────────────────────────────────────────────

export interface OrganizationDashboardLayoutPreviewWarning {
  code: OrganizationDashboardLayoutWarningCode
  message: string
  moduleKey?: OrganizationDashboardLayoutModuleKey
  breakpoint?: OrganizationDashboardLayoutBreakpoint
}

export interface OrganizationDashboardLayoutPreviewResult {
  valid: boolean
  layout: OrganizationDashboardLayoutPayload
  warnings: OrganizationDashboardLayoutPreviewWarning[]
  /** Responsive breakpoint snapshots — grid state at each breakpoint. */
  breakpointSnapshots: Array<{
    breakpoint: OrganizationDashboardLayoutBreakpoint
    columnCount: number
    modules: Array<{
      moduleKey: OrganizationDashboardLayoutModuleKey
      size: OrganizationDashboardLayoutSize
      colSpan: number
      row: number
      col: number
    }>
  }>
}

// ─── API Envelopes ──────────────────────────────────────────────────────────────

export interface OrganizationDashboardLayoutListResponse {
  data: OrganizationDashboardLayout[]
  meta: {
    total: number
    organizationId: number
  }
}

export interface OrganizationDashboardLayoutCurrentResponse {
  data: {
    layout: OrganizationDashboardLayout
    warnings: OrganizationDashboardLayoutPreviewWarning[]
  }
}

export interface OrganizationDashboardLayoutPreviewResponse {
  data: OrganizationDashboardLayoutPreviewResult
}

export interface OrganizationDashboardLayoutDetailResponse {
  data: OrganizationDashboardLayout
}

// ─── Module Registry (Server-Controlled) ────────────────────────────────────────

export interface OrganizationDashboardModuleDefinition {
  moduleKey: OrganizationDashboardLayoutModuleKey
  /** i18n key for display name (zh-CN). */
  displayName: string
  /** i18n key for description. */
  description: string
  /** Allowed size tokens for this module. */
  allowedSizes: OrganizationDashboardLayoutSize[]
  /** Default size when first added. */
  defaultSize: OrganizationDashboardLayoutSize
  /** Default grid position (row, col). */
  defaultRow: number
  defaultCol: number
  /** Whether this module is available on mobile. */
  mobileSupported: boolean
  /** Required permission tags for this module's data. */
  requiredPermissions: string[]
  /** Data dependency source key. */
  dataDependencyId: string
  /** JSON Schema for module-level settings (null if no settings). */
  settingSchema: Record<string, unknown> | null
  /** Empty state message key. */
  emptyStateKey: string
  /** Whether the module can be hidden by users. */
  hideable: boolean
}

// ─── System Default Layout ──────────────────────────────────────────────────────

export const ORGANIZATION_DASHBOARD_SYSTEM_DEFAULT_LAYOUT: Omit<
  OrganizationDashboardLayout,
  'layoutId' | 'createdAt' | 'updatedAt'
> = {
  organizationId: 0,
  scope: ORGANIZATION_DASHBOARD_LAYOUT_SCOPES.SYSTEM,
  ownerActorId: null,
  name: '系统默认布局',
  version: 1,
  isDefault: false,
  density: ORGANIZATION_DASHBOARD_LAYOUT_DENSITIES.COMFORTABLE,
  modules: [
    {
      moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.IDENTITY,
      size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL,
      row: 1,
      col: 1,
    },
    {
      moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.KPI_STRIP,
      size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL,
      row: 2,
      col: 1,
    },
    {
      moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.STATUS_DISTRIBUTION,
      size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM,
      row: 3,
      col: 1,
    },
    {
      moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ATTENTION_PROJECTS,
      size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.LARGE,
      row: 3,
      col: 5,
    },
    {
      moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.MEMBER_OVERVIEW,
      size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.SMALL,
      row: 4,
      col: 1,
    },
    {
      moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RESOURCE_OVERVIEW,
      size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.SMALL,
      row: 4,
      col: 3,
    },
    {
      moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RISK_REMINDERS,
      size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM,
      row: 4,
      col: 5,
    },
    {
      moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ACTIVITY,
      size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM,
      row: 5,
      col: 1,
    },
    {
      moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.PMO_ENTRY,
      size: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM,
      row: 5,
      col: 5,
    },
  ],
}

// ─── Module Registry (Static) ───────────────────────────────────────────────────

export const ORGANIZATION_DASHBOARD_MODULE_REGISTRY: Record<
  OrganizationDashboardLayoutModuleKey,
  OrganizationDashboardModuleDefinition
> = {
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.IDENTITY]: {
    moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.IDENTITY,
    displayName: '组织身份',
    description: '组织名称、标识和基础信息',
    allowedSizes: [ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL],
    defaultSize: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL,
    defaultRow: 1,
    defaultCol: 1,
    mobileSupported: true,
    requiredPermissions: ['org:view'],
    dataDependencyId: 'organization',
    settingSchema: null,
    emptyStateKey: '无组织信息',
    hideable: false,
  },
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.KPI_STRIP]: {
    moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.KPI_STRIP,
    displayName: 'KPI 指标条',
    description: '项目总数、进行中、待关注等关键指标',
    allowedSizes: [ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL],
    defaultSize: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL,
    defaultRow: 2,
    defaultCol: 1,
    mobileSupported: true,
    requiredPermissions: ['org:view'],
    dataDependencyId: 'project',
    settingSchema: null,
    emptyStateKey: '无 KPI 数据',
    hideable: true,
  },
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.STATUS_DISTRIBUTION]: {
    moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.STATUS_DISTRIBUTION,
    displayName: '状态分布',
    description: '项目按状态分布概览',
    allowedSizes: [
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.SMALL,
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM,
    ],
    defaultSize: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM,
    defaultRow: 3,
    defaultCol: 1,
    mobileSupported: true,
    requiredPermissions: ['org:view'],
    dataDependencyId: 'project',
    settingSchema: null,
    emptyStateKey: '暂无项目',
    hideable: true,
  },
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ATTENTION_PROJECTS]: {
    moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ATTENTION_PROJECTS,
    displayName: '待关注项目',
    description: '需关注的项目列表及原因',
    allowedSizes: [
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM,
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.LARGE,
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL,
    ],
    defaultSize: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.LARGE,
    defaultRow: 3,
    defaultCol: 5,
    mobileSupported: false,
    requiredPermissions: ['org:view'],
    dataDependencyId: 'project',
    settingSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
      },
    },
    emptyStateKey: '暂无待关注项目',
    hideable: true,
  },
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.MEMBER_OVERVIEW]: {
    moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.MEMBER_OVERVIEW,
    displayName: '成员概览',
    description: '团队成员统计与角色分布',
    allowedSizes: [
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.SMALL,
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM,
    ],
    defaultSize: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.SMALL,
    defaultRow: 4,
    defaultCol: 1,
    mobileSupported: true,
    requiredPermissions: ['org:member:manage', 'org:view'],
    dataDependencyId: 'membership',
    settingSchema: null,
    emptyStateKey: '暂无成员',
    hideable: true,
  },
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RESOURCE_OVERVIEW]: {
    moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RESOURCE_OVERVIEW,
    displayName: '资源概览',
    description: '资源分配与负载概览',
    allowedSizes: [
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.SMALL,
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM,
    ],
    defaultSize: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.SMALL,
    defaultRow: 4,
    defaultCol: 3,
    mobileSupported: true,
    requiredPermissions: ['resource:view'],
    dataDependencyId: 'resource_summary',
    settingSchema: null,
    emptyStateKey: '暂无资源数据',
    hideable: true,
  },
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RISK_REMINDERS]: {
    moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RISK_REMINDERS,
    displayName: '风险提醒',
    description: '高风险、未关闭风险与延期提醒',
    allowedSizes: [
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM,
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.LARGE,
    ],
    defaultSize: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM,
    defaultRow: 4,
    defaultCol: 5,
    mobileSupported: false,
    requiredPermissions: ['risk:view'],
    dataDependencyId: 'risk_summary',
    settingSchema: null,
    emptyStateKey: '暂无风险',
    hideable: true,
  },
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ACTIVITY]: {
    moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ACTIVITY,
    displayName: '近期活动',
    description: '组织内近期活动流',
    allowedSizes: [
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.SMALL,
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM,
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.LARGE,
    ],
    defaultSize: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM,
    defaultRow: 5,
    defaultCol: 1,
    mobileSupported: false,
    requiredPermissions: ['audit:view'],
    dataDependencyId: 'activity_log',
    settingSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
    },
    emptyStateKey: '暂无活动',
    hideable: true,
  },
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.PMO_ENTRY]: {
    moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.PMO_ENTRY,
    displayName: 'PMO 入口',
    description: 'PMO 组合摘要与入口',
    allowedSizes: [
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.SMALL,
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM,
    ],
    defaultSize: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM,
    defaultRow: 5,
    defaultCol: 5,
    mobileSupported: true,
    requiredPermissions: ['portfolio:view'],
    dataDependencyId: 'pmo_portfolio',
    settingSchema: null,
    emptyStateKey: 'PMO 暂不可用',
    hideable: true,
  },
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.OKR_DASHBOARD_SUMMARY]: {
    moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.OKR_DASHBOARD_SUMMARY,
    displayName: 'OKR 摘要',
    description: '组织级 OKR 只读摘要：周期 / KPI / 关注项 / 对齐健康度 / 证据新鲜度',
    allowedSizes: [
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM,
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.LARGE,
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL,
    ],
    defaultSize: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.LARGE,
    defaultRow: 6,
    defaultCol: 1,
    mobileSupported: true,
    // 复用 OKR view 权限；未授权时模块降级为 emptyState，不泄露 objective/KR 明细
    requiredPermissions: ['okr:view'],
    dataDependencyId: 'okr_dashboard_summary',
    settingSchema: null,
    emptyStateKey: 'OKR 数据暂不可用',
    hideable: true,
  },
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.BI_DASHBOARD_SUMMARY]: {
    moduleKey: ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.BI_DASHBOARD_SUMMARY,
    displayName: 'BI 看板摘要',
    description: '已保存 BI Dashboard 的只读摘要：widgets、趋势、新鲜度、warnings',
    allowedSizes: [
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.MEDIUM,
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.LARGE,
      ORGANIZATION_DASHBOARD_LAYOUT_SIZES.FULL,
    ],
    defaultSize: ORGANIZATION_DASHBOARD_LAYOUT_SIZES.LARGE,
    defaultRow: 7,
    defaultCol: 1,
    mobileSupported: true,
    requiredPermissions: ['bi:view'],
    dataDependencyId: 'bi_dashboard_summary',
    settingSchema: {
      type: 'object',
      properties: {
        dashboardId: { type: 'integer', minimum: 1 },
        version: { type: 'integer', minimum: 1 },
      },
      required: ['dashboardId'],
      additionalProperties: false,
    },
    emptyStateKey: '无可用 BI Dashboard',
    hideable: true,
  },
}
