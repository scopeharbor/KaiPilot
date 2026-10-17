// @aiproj/types —— BI 报表模板库共享契约（前后端共享）。
// v3-bi-report-template-library §1.2：模板标识、版本、分类、场景、数据源键、
// 指标/维度/筛选/图表构成、freshness/warning/redaction、自定义副本结构、
// 审计事件类型与零运行时依赖纯函数。
//
// 红线：
//   - 模板定义为纯声明式数据，禁止 SQL/脚本/公式/外部 URL/prompt/模型输出。
//   - 只读派生：契约不携带任何写入语义；实例化走既有生成通道。
//   - 零依赖：本文件不得 import AdonisJS、React、数据库客户端、AI SDK 或第三方运行时。
//   - 权限受限维度只返回低敏 forbidden/unavailable/redacted 状态，不暴露隐藏计数、
//     名称、成员姓名、证据原文或不安全下钻链接。
//   - 财务/预算/ROI/成本等无一等事实来源的指标 MUST 判为 unsupported。

// ─── 契约版本 ───────────────────────────────────────────────────────────────

/** BI 报表模板库契约版本；破坏性变更必须升版本并触发契约测试更新。 */
export const BI_TEMPLATE_LIBRARY_VERSION = 'bi-template-library-v1'

// ─── 模板标识 ───────────────────────────────────────────────────────────────

/** 5 个内置 BI 报表模板 ID（PRD 6.4.2）。 */
export const BI_TEMPLATE_IDS = {
  /** 项目执行概览——周会汇报场景 */
  PROJECT_EXECUTION_OVERVIEW: 'project_execution_overview',
  /** 资源利用率报告——资源规划场景 */
  RESOURCE_UTILIZATION: 'resource_utilization',
  /** 风险分析报告——风险评审会场景 */
  RISK_ANALYSIS: 'risk_analysis',
  /** 里程碑追踪报告——进度评审场景 */
  MILESTONE_TRACKING: 'milestone_tracking',
  /** 团队绩效报告——绩效评估场景 */
  TEAM_PERFORMANCE: 'team_performance',
} as const

export type BiTemplateId = (typeof BI_TEMPLATE_IDS)[keyof typeof BI_TEMPLATE_IDS]

export const BI_TEMPLATE_ID_VALUES = Object.values(BI_TEMPLATE_IDS) as readonly BiTemplateId[]

/** 运行时守卫：判定是否为内置 BI 模板 ID。 */
export function isBiTemplateId(value: string): value is BiTemplateId {
  return (BI_TEMPLATE_ID_VALUES as readonly string[]).includes(value)
}

// ─── 模板版本 ───────────────────────────────────────────────────────────────

/** 内置模板版本号，单调递增。 */
export const BI_TEMPLATE_VERSIONS: Record<BiTemplateId, number> = {
  [BI_TEMPLATE_IDS.PROJECT_EXECUTION_OVERVIEW]: 1,
  [BI_TEMPLATE_IDS.RESOURCE_UTILIZATION]: 1,
  [BI_TEMPLATE_IDS.RISK_ANALYSIS]: 1,
  [BI_TEMPLATE_IDS.MILESTONE_TRACKING]: 1,
  [BI_TEMPLATE_IDS.TEAM_PERFORMANCE]: 1,
} as const

// ─── 模板分类 ───────────────────────────────────────────────────────────────

export const BI_TEMPLATE_CATEGORIES = {
  EXECUTION: 'execution',
  RESOURCE: 'resource',
  RISK: 'risk',
  MILESTONE: 'milestone',
  PEOPLE: 'people',
} as const

export type BiTemplateCategory =
  (typeof BI_TEMPLATE_CATEGORIES)[keyof typeof BI_TEMPLATE_CATEGORIES]

export const BI_TEMPLATE_CATEGORY_VALUES = Object.values(
  BI_TEMPLATE_CATEGORIES,
) as readonly BiTemplateCategory[]

// ─── 适用场景 ───────────────────────────────────────────────────────────────

export const BI_TEMPLATE_SCENARIOS = {
  WEEKLY_REVIEW: 'weekly_review',
  RESOURCE_PLANNING: 'resource_planning',
  RISK_REVIEW: 'risk_review',
  PROGRESS_REVIEW: 'progress_review',
  PERFORMANCE_REVIEW: 'performance_review',
} as const

export type BiTemplateScenario = (typeof BI_TEMPLATE_SCENARIOS)[keyof typeof BI_TEMPLATE_SCENARIOS]

export const BI_TEMPLATE_SCENARIO_VALUES = Object.values(
  BI_TEMPLATE_SCENARIOS,
) as readonly BiTemplateScenario[]

// ─── 模板来源（V3 模板即插件包扩展） ────────────────────────────────────────

export const BI_TEMPLATE_SOURCES = ['builtin', 'organization-copy', 'plugin'] as const
export type BiTemplateSource = (typeof BI_TEMPLATE_SOURCES)[number]

/** 插件来源元数据引用（低敏） */
export interface BiTemplatePluginRef {
  /** 插件唯一标识（如 com.aiproj.pilot-template-pack） */
  pluginId: string
  /** 插件 SemVer 版本 */
  pluginVersion: string
  /** 插件可读显示名（可选） */
  displayName?: string
}

// ─── 数据源键（组织/PMO 级，复用已注册数据源） ────────────────────────────

export const BI_DATASOURCE_KEYS = {
  /** 组织 Dashboard 聚合 */
  ORGANIZATION_DASHBOARD: 'organization_dashboard',
  /** PMO 组合 Dashboard */
  PMO_PORTFOLIO_DASHBOARD: 'pmo_portfolio_dashboard',
  /** 组织资源池 */
  ORGANIZATION_RESOURCE_POOL: 'organization_resource_pool',
  /** 资源技能矩阵 */
  RESOURCE_SKILL_MATRIX: 'resource_skill_matrix',
  /** OKR 层级 */
  OKR_HIERARCHY: 'okr_hierarchy',
  /** BI 趋势分析 */
  BI_TREND_ANALYSIS: 'bi_trend_analysis',
  /** 风险热力图 */
  BI_RISK_HEATMAP: 'bi_risk_heatmap',
  /** 资源需求预测 */
  RESOURCE_DEMAND_FORECASTING: 'resource_demand_forecasting',
  /** 资源缺口分析 */
  RESOURCE_GAP_ANALYSIS: 'resource_gap_analysis',
  /** 资源争用检测 */
  RESOURCE_CONTENTION_DETECTION: 'resource_contention_detection',
  /** V2 报表聚合（项目级快照） */
  REPORT_V2_AGGREGATION: 'report_v2_aggregation',
} as const

export type BiDataSourceKey = (typeof BI_DATASOURCE_KEYS)[keyof typeof BI_DATASOURCE_KEYS]

export const BI_DATASOURCE_KEY_VALUES = Object.values(
  BI_DATASOURCE_KEYS,
) as readonly BiDataSourceKey[]

// ─── 指标键 ─────────────────────────────────────────────────────────────────

export const BI_TEMPLATE_METRIC_KEYS = {
  /** 组织项目进度（完成度百分比） */
  PROJECT_PROGRESS: 'project_progress',
  /** 延期压力（逾期/临近截止占比） */
  SCHEDULE_DELAY_PRESSURE: 'schedule_delay_pressure',
  /** 风险压力（开放风险加权分） */
  RISK_PRESSURE: 'risk_pressure',
  /** 资源利用率（分配占比） */
  RESOURCE_UTILIZATION_RATE: 'resource_utilization_rate',
  /** 资源缺口（缺口小时数） */
  RESOURCE_GAP_HOURS: 'resource_gap_hours',
  /** 资源争用（冲突计数） */
  RESOURCE_CONTENTION_COUNT: 'resource_contention_count',
  /** 里程碑完成率（已完成/总里程碑） */
  MILESTONE_COMPLETION_RATE: 'milestone_completion_rate',
  /** 里程碑逾期数 */
  MILESTONE_OVERDUE_COUNT: 'milestone_overdue_count',
  /** OKR 进展（KR 平均进度） */
  OKR_PROGRESS: 'okr_progress',
  /** 团队任务完成率 */
  TEAM_TASK_COMPLETION_RATE: 'team_task_completion_rate',
  /** 团队负载分布 */
  TEAM_WORKLOAD_DISTRIBUTION: 'team_workload_distribution',
} as const

export type BiTemplateMetricKey =
  (typeof BI_TEMPLATE_METRIC_KEYS)[keyof typeof BI_TEMPLATE_METRIC_KEYS]

export const BI_TEMPLATE_METRIC_KEY_VALUES = Object.values(
  BI_TEMPLATE_METRIC_KEYS,
) as readonly BiTemplateMetricKey[]

// ─── 维度键 ─────────────────────────────────────────────────────────────────

export const BI_TEMPLATE_DIMENSION_KEYS = {
  /** 项目维度 */
  PROJECT: 'project',
  /** 组织维度 */
  ORGANIZATION: 'organization',
  /** 团队维度 */
  TEAM: 'team',
  /** 人员维度（需额外权限位） */
  PERSON: 'person',
  /** 时间维度 */
  TIME: 'time',
  /** 风险等级维度 */
  RISK_LEVEL: 'risk_level',
  /** 里程碑维度 */
  MILESTONE: 'milestone',
} as const

export type BiTemplateDimensionKey =
  (typeof BI_TEMPLATE_DIMENSION_KEYS)[keyof typeof BI_TEMPLATE_DIMENSION_KEYS]

export const BI_TEMPLATE_DIMENSION_KEY_VALUES = Object.values(
  BI_TEMPLATE_DIMENSION_KEYS,
) as readonly BiTemplateDimensionKey[]

// ─── 图表组件类型 ───────────────────────────────────────────────────────────

export const BI_CHART_TYPES = {
  /** 柱状图 */
  BAR: 'bar',
  /** 折线图 */
  LINE: 'line',
  /** 饼图 */
  PIE: 'pie',
  /** 表格 */
  TABLE: 'table',
  /** 统计卡片 */
  STAT_CARD: 'stat_card',
  /** 热力图 */
  HEATMAP: 'heatmap',
  /** 进度条 */
  PROGRESS_BAR: 'progress_bar',
} as const

export type BiChartType = (typeof BI_CHART_TYPES)[keyof typeof BI_CHART_TYPES]

export const BI_CHART_TYPE_VALUES = Object.values(BI_CHART_TYPES) as readonly BiChartType[]

// ─── Freshness 状态 ─────────────────────────────────────────────────────────

export const BI_FRESHNESS_STATES = {
  FRESH: 'fresh',
  STALE: 'stale',
  UNAVAILABLE: 'unavailable',
} as const

export type BiFreshnessState = (typeof BI_FRESHNESS_STATES)[keyof typeof BI_FRESHNESS_STATES]

// ─── Warning Code ───────────────────────────────────────────────────────────

export const BI_TEMPLATE_WARNING_CODES = {
  /** 数据源不可用 */
  DATASOURCE_UNAVAILABLE: 'BI_TEMPLATE_DATASOURCE_UNAVAILABLE',
  /** 数据源权限不足 */
  DATASOURCE_FORBIDDEN: 'BI_TEMPLATE_DATASOURCE_FORBIDDEN',
  /** 数据源超时 */
  DATASOURCE_TIMEOUT: 'BI_TEMPLATE_DATASOURCE_TIMEOUT',
  /** 数据源为空 */
  DATASOURCE_EMPTY: 'BI_TEMPLATE_DATASOURCE_EMPTY',
  /** 部分数据源失败 */
  PARTIAL_RESULT: 'BI_TEMPLATE_PARTIAL_RESULT',
  /** 维度已脱敏 */
  DIMENSION_REDACTED: 'BI_TEMPLATE_DIMENSION_REDACTED',
  /** 数据陈旧 */
  DATA_STALE: 'BI_TEMPLATE_DATA_STALE',
  /** 副本有新版 */
  COPY_OUTDATED: 'BI_TEMPLATE_COPY_OUTDATED',
  /** 财务类指标不支持 */
  FINANCIAL_UNSUPPORTED: 'BI_TEMPLATE_FINANCIAL_UNSUPPORTED',
} as const

export type BiTemplateWarningCode =
  (typeof BI_TEMPLATE_WARNING_CODES)[keyof typeof BI_TEMPLATE_WARNING_CODES]

// ─── Redaction 状态 ─────────────────────────────────────────────────────────

export const BI_REDACTION_STATES = {
  /** 未脱敏 */
  NONE: 'none',
  /** 已脱敏（聚合返回） */
  REDACTED: 'redacted',
  /** 无权限（完全不可见） */
  FORBIDDEN: 'forbidden',
} as const

export type BiRedactionState = (typeof BI_REDACTION_STATES)[keyof typeof BI_REDACTION_STATES]

// ─── 自定义副本状态 ─────────────────────────────────────────────────────────

export const BI_COPY_STATUSES = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
} as const

export type BiCopyStatus = (typeof BI_COPY_STATUSES)[keyof typeof BI_COPY_STATUSES]

// ─── 审计事件类型 ───────────────────────────────────────────────────────────

export const BI_TEMPLATE_AUDIT_EVENTS = {
  /** 另存为自定义副本 */
  COPY_SAVED: 'bi_template.copy_saved',
  /** 副本元数据编辑 */
  COPY_UPDATED: 'bi_template.copy_updated',
  /** 副本归档 */
  COPY_ARCHIVED: 'bi_template.copy_archived',
  /** 副本恢复 */
  COPY_RESTORED: 'bi_template.copy_restored',
  /** 副本同步到新版 */
  COPY_SYNCED: 'bi_template.copy_synced',
  /** 从模板创建实例 */
  INSTANTIATED: 'bi_template.instantiated',
} as const

export type BiTemplateAuditEvent =
  (typeof BI_TEMPLATE_AUDIT_EVENTS)[keyof typeof BI_TEMPLATE_AUDIT_EVENTS]

// ─── 模板构成：图表组件声明 ─────────────────────────────────────────────────

/** 单个图表组件声明 */
export interface BiChartComponent {
  /** 图表类型 */
  chartType: BiChartType
  /** 图表标题 */
  title: string
  /** 使用的指标键列表 */
  metricKeys: BiTemplateMetricKey[]
  /** 使用的维度键 */
  dimensionKey: BiTemplateDimensionKey
  /** 默认筛选值 */
  defaultFilters?: Record<string, string>
  /** 是否可关闭/切换 */
  optional?: boolean
}

// ─── 模板构成：完整声明 ─────────────────────────────────────────────────────

/** 内置模板的完整声明式构成 */
export interface BiTemplateComposition {
  /** 使用的数据源键 */
  dataSourceKeys: BiDataSourceKey[]
  /** 使用的指标键 */
  metricKeys: BiTemplateMetricKey[]
  /** 使用的维度键 */
  dimensionKeys: BiTemplateDimensionKey[]
  /** 默认筛选 */
  defaultFilters: Record<string, string>
  /** 图表组件列表 */
  charts: BiChartComponent[]
}

// ─── 内置模板定义 ───────────────────────────────────────────────────────────

/** 内置 BI 报表模板的声明式定义 */
export interface BiTemplateDef {
  /** 模板唯一标识 */
  templateId: BiTemplateId | string
  /** 模板版本号 */
  version: number
  /** 模板中文名称 */
  name: string
  /** 模板中文描述 */
  description: string
  /** 模板分类 */
  category: BiTemplateCategory
  /** 适用场景 */
  scenario: BiTemplateScenario
  /** 模板构成 */
  composition: BiTemplateComposition
  /** 人员维度是否需要额外权限位 */
  personDimensionRequiresExtraPermission: boolean
}

// ─── Freshness 信息 ─────────────────────────────────────────────────────────

/** 单个数据源的 freshness 信息 */
export interface BiSourceFreshness {
  /** 数据源键 */
  dataSourceKey: BiDataSourceKey
  /** freshness 状态 */
  state: BiFreshnessState
  /** 数据最后更新时间 ISO-8601 */
  lastUpdatedAt: string | null
  /** 可读说明 */
  message?: string
}

// ─── Warning 结构 ───────────────────────────────────────────────────────────

/** BI 模板库 warning */
export interface BiTemplateWarning {
  /** 机器可读 warning code */
  code: BiTemplateWarningCode
  /** 严重度 */
  level: 'info' | 'warning' | 'critical'
  /** 简体中文消息 */
  message: string
  /** 关联的数据源键（可选） */
  dataSourceKey?: BiDataSourceKey
}

// ─── Redaction 信息 ─────────────────────────────────────────────────────────

/** 维度脱敏信息 */
export interface BiDimensionRedaction {
  /** 维度键 */
  dimensionKey: BiTemplateDimensionKey
  /** 脱敏状态 */
  state: BiRedactionState
  /** 脱敏原因说明 */
  reason?: string
}

// ─── 模板预览结果 ───────────────────────────────────────────────────────────

/** 单个数据源的预览结果 */
export interface BiPreviewSourceResult {
  /** 数据源键 */
  dataSourceKey: BiDataSourceKey
  /** 数据源状态 */
  status: 'available' | 'unavailable' | 'forbidden' | 'timeout'
  /** freshness 信息 */
  freshness: BiSourceFreshness
  /** warnings */
  warnings: BiTemplateWarning[]
  /** 脱敏信息 */
  redactions: BiDimensionRedaction[]
  /** 预览数据（脱敏后） */
  data: unknown | null
}

/** 模板预览聚合结果 */
export interface BiTemplatePreview {
  /** 模板 ID */
  templateId: BiTemplateId
  /** 模板版本 */
  version: number
  /** 各数据源预览结果 */
  sources: BiPreviewSourceResult[]
  /** 聚合 warnings */
  warnings: BiTemplateWarning[]
  /** 是否有阻塞性 warning */
  blocking: boolean
  /** 整体 freshness */
  aggregatedFreshness: BiFreshnessState
}

// ─── 模板目录条目 ───────────────────────────────────────────────────────────

/** 模板目录条目（列表响应） */
export interface BiTemplateEntry {
  /** 模板 ID */
  templateId: string
  /** 模板版本 */
  version: number
  /** 模板名称 */
  name: string
  /** 模板描述 */
  description: string
  /** 模板分类 */
  category: BiTemplateCategory
  /** 适用场景 */
  scenario: BiTemplateScenario
  /** 是否为内置模板 */
  builtin: boolean
  /** 是否为组织自定义副本 */
  isCopy: boolean
  /** 模板来源（默认 builtin） */
  source?: BiTemplateSource
  /** 插件来源元数据（仅 plugin 来源） */
  pluginRef?: BiTemplatePluginRef
  /** 来源模板 ID（仅自定义副本） */
  sourceTemplateId?: BiTemplateId
  /** 来源模板版本（仅自定义副本） */
  sourceVersion?: number
  /** 是否有新版内置模板（仅自定义副本） */
  hasNewerVersion?: boolean
  /** 副本状态（仅自定义副本） */
  copyStatus?: BiCopyStatus
  /** 创建时间 ISO-8601 */
  createdAt?: string
  /** 更新时间 ISO-8601 */
  updatedAt?: string
}

// ─── 自定义副本结构 ─────────────────────────────────────────────────────────

/** 自定义模板副本的可编辑元数据 */
export interface BiCopyEditableMeta {
  /** 副本名称 */
  name: string
  /** 副本描述 */
  description: string
  /** 筛选默认值覆盖 */
  defaultFilters?: Record<string, string>
  /** 图表开关覆盖 */
  chartOverrides?: Record<string, boolean>
}

/** 自定义模板副本 */
export interface BiTemplateCopy {
  /** 副本 ID */
  id: number
  /** 组织 ID */
  organizationId: number
  /** 来源内置模板 ID */
  sourceTemplateId: BiTemplateId
  /** 来源内置模板版本 */
  sourceVersion: number
  /** 副本名称 */
  name: string
  /** 副本描述 */
  description: string
  /** 配置 JSON（筛选/图表覆盖） */
  config: BiCopyEditableMeta
  /** 副本状态 */
  status: BiCopyStatus
  /** 乐观并发版本号 */
  concurrencyVersion: number
  /** 创建人 ID */
  createdBy: number
  /** 创建时间 ISO-8601 */
  createdAt: string
  /** 更新时间 ISO-8601 */
  updatedAt: string
}

// ─── API 请求/响应载荷 ──────────────────────────────────────────────────────

/** GET /api/v1/organizations/:organizationId/bi/report-templates 查询参数 */
export interface BiListTemplatesQuery {
  /** 分类筛选 */
  category?: BiTemplateCategory
  /** 分页 */
  page?: number
  perPage?: number
}

/** GET /api/v1/organizations/:organizationId/bi/report-templates 响应 */
export interface BiListTemplatesResponse {
  data: BiTemplateEntry[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

/** GET /api/v1/organizations/:organizationId/bi/report-templates/:templateId 响应 */
export interface BiGetTemplateResponse {
  data: BiTemplateEntry
}

/** GET /api/v1/organizations/:organizationId/bi/report-templates/:templateId/preview 响应 */
export interface BiPreviewTemplateResponse {
  data: BiTemplatePreview
}

/** POST /api/v1/organizations/:organizationId/bi/report-templates/:templateId/instantiate 请求体 */
export interface BiInstantiateRequest {
  /** 目标项目 ID（降级路径需要） */
  projectId?: number
  /** 覆盖默认筛选 */
  filters?: Record<string, string>
}

/** POST /api/v1/organizations/:organizationId/bi/report-templates/:templateId/instantiate 响应 */
export interface BiInstantiateResponse {
  data: {
    /** 实例化路径 */
    path: 'custom_report_builder' | 'reporting_system_upgrade'
    /** 预填的报表定义（custom_report_builder 路径） */
    prefill?: Record<string, unknown>
    /** 降级路径的预览 ID */
    previewId?: string
  }
}

/** POST /api/v1/organizations/:organizationId/bi/report-templates/:templateId/copy 请求体 */
export interface BiSaveCopyRequest {
  name: string
  description?: string
}

/** POST /api/v1/organizations/:organizationId/bi/report-templates/:templateId/copy 响应 */
export interface BiSaveCopyResponse {
  data: BiTemplateCopy
}

/** PATCH /api/v1/organizations/:organizationId/bi/report-templates/copies/:copyId 请求体 */
export interface BiUpdateCopyRequest {
  name?: string
  description?: string
  defaultFilters?: Record<string, string>
  chartOverrides?: Record<string, boolean>
  /** 乐观并发版本号（必传） */
  concurrencyVersion: number
}

/** PATCH /api/v1/organizations/:organizationId/bi/report-templates/copies/:copyId 响应 */
export interface BiUpdateCopyResponse {
  data: BiTemplateCopy
}

/** POST /api/v1/organizations/:organizationId/bi/report-templates/copies/:copyId/archive 响应 */
export interface BiArchiveCopyResponse {
  data: BiTemplateCopy
}

/** POST /api/v1/organizations/:organizationId/bi/report-templates/copies/:copyId/restore 响应 */
export interface BiRestoreCopyResponse {
  data: BiTemplateCopy
}

// ─── 零运行时依赖纯函数 ────────────────────────────────────────────────────

/**
 * 判定模板是否为内置模板（非自定义副本）。
 */
export function isBuiltinTemplate(entry: BiTemplateEntry): boolean {
  return entry.builtin && !entry.isCopy
}

/**
 * 判定 templateId 是否符合插件模板命名空间（`ptpl_` 前缀）。
 */
export function isPluginBiTemplateId(templateId: string): boolean {
  return typeof templateId === 'string' && templateId.startsWith('ptpl_')
}

/**
 * 根据 templateId 确定模板来源三分支：builtin / organization-copy / plugin。
 */
export function resolveBiTemplateSource(templateId: string): BiTemplateSource {
  if (isPluginBiTemplateId(templateId)) {
    return 'plugin'
  }
  if (templateId.startsWith('copy_')) {
    return 'organization-copy'
  }
  return 'builtin'
}

/**
 * 判定模板副本是否有新版内置模板可同步。
 */
export function hasNewerBuiltinVersion(
  copy: BiTemplateCopy | BiTemplateEntry,
  currentVersion: number,
): boolean {
  const sourceVersion: number =
    'sourceVersion' in copy && copy.sourceVersion != null ? (copy.sourceVersion as number) : 0
  return sourceVersion < currentVersion
}

/**
 * 聚合多个数据源的 freshness 为整体 freshness。
 * 优先级：unavailable > stale > fresh。
 */
export function aggregateBiTemplateFreshness(sources: BiSourceFreshness[]): BiFreshnessState {
  if (sources.length === 0) return BI_FRESHNESS_STATES.UNAVAILABLE
  const states = sources.map((s) => s.state)
  if (states.includes(BI_FRESHNESS_STATES.UNAVAILABLE)) return BI_FRESHNESS_STATES.UNAVAILABLE
  if (states.includes(BI_FRESHNESS_STATES.STALE)) return BI_FRESHNESS_STATES.STALE
  return BI_FRESHNESS_STATES.FRESH
}

/**
 * 从预览结果中提取所有阻塞性 warning。
 */
export function getBlockingWarnings(warnings: BiTemplateWarning[]): BiTemplateWarning[] {
  return warnings.filter((w) => w.level === 'critical')
}

/**
 * 判定预览是否有阻塞性 warning。
 */
export function hasBlockingWarnings(warnings: BiTemplateWarning[]): boolean {
  return warnings.some((w) => w.level === 'critical')
}

/**
 * 构建低敏 warning 对象。
 */
export function buildBiTemplateWarning(
  code: BiTemplateWarningCode,
  level: 'info' | 'warning' | 'critical',
  message: string,
  dataSourceKey?: BiDataSourceKey,
): BiTemplateWarning {
  return { code, level, message, ...(dataSourceKey ? { dataSourceKey } : {}) }
}

/**
 * 构建 freshness 对象。
 */
export function buildBiSourceFreshness(
  dataSourceKey: BiDataSourceKey,
  state: BiFreshnessState,
  lastUpdatedAt: string | null = null,
  message?: string,
): BiSourceFreshness {
  return { dataSourceKey, state, lastUpdatedAt, ...(message ? { message } : {}) }
}

/**
 * 构建脱敏信息对象。
 */
export function buildBiRedaction(
  dimensionKey: BiTemplateDimensionKey,
  state: BiRedactionState,
  reason?: string,
): BiDimensionRedaction {
  return { dimensionKey, state, ...(reason ? { reason } : {}) }
}
