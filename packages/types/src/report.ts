/**
 * preset-project-reports / v2-reporting-system-upgrade —— V1 + V2 报表共享契约（前后端共享）。
 *
 * 契约来源：
 *   - V1: `openspec/changes/preset-project-reports/specs/preset-project-reports/spec.md`
 *   - V2: `openspec/changes/v2-reporting-system-upgrade/specs/reporting-system-upgrade/spec.md`
 *
 * V1 提供了四类预设模板（progress/delay/workload/milestone）和 Markdown/CSV 导出。
 * V2 扩展了模板目录、导出格式、版本快照、生成任务、AI 草稿、数据源聚合和多格式导出（PDF/XLSX）。
 *
 * 纯静态类型 + const 数组，零运行时依赖（同 @aiproj/types 其他模块）。
 * 校验函数在后端 Validator 与服务中实现。
 */

// ---------------------------------------------------------------------------
// V1 报表模板白名单（向后兼容）
// ---------------------------------------------------------------------------

/** 当前快照契约版本，写入 `snapshotMetadata.templateVersion`。 */
export const REPORT_TEMPLATE_VERSION = '1.0' as const
export type ReportTemplateVersion = typeof REPORT_TEMPLATE_VERSION

/**
 * V1 白名单模板。任何非本列表值都必须在 Validator 层被拒绝
 * （见 spec 需求「V1 报表模板白名单」）。
 */
export const REPORT_TEMPLATES = ['progress', 'delay', 'workload', 'milestone'] as const
export type ReportTemplate = (typeof REPORT_TEMPLATES)[number]

/**
 * 运行时守卫：判定任意字符串是否为白名单模板。
 */
export function isReportTemplate(value: string): value is ReportTemplate {
  return (REPORT_TEMPLATES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// V2 内置模板 ID
// ---------------------------------------------------------------------------

/**
 * V2 内置模板 ID 全集（含 V1 等价模板）。
 * V1 reportType 到 V2 templateId 的映射见 `v1ToV2TemplateId`。
 */
export const V2_REPORT_TEMPLATES = [
  // V1 等价模板
  'progress',
  'delay',
  'workload',
  'milestone',
  // V2 新增模板
  'project-weekly',
  'project-monthly',
  'milestone-tracking',
  'resource-summary',
  'risk-summary',
  'health-summary',
  'stakeholder-briefing',
  // V2 AI 周期报表模板
  'weekly-ai-summary',
  'monthly-ai-summary',
] as const

export type V2ReportTemplateId = (typeof V2_REPORT_TEMPLATES)[number]

/** V1 reportType → V2 templateId 映射。 */
export const V1_TO_V2_TEMPLATE_ID: Record<string, V2ReportTemplateId> = {
  progress: 'progress',
  delay: 'delay',
  workload: 'workload',
  milestone: 'milestone',
}

/** V2 templateId → V1 reportType 反向映射（仅 V1 等价模板有映射）。 */
export const V2_TO_V1_TEMPLATE_TYPE: Partial<Record<V2ReportTemplateId, ReportTemplate>> = {
  progress: 'progress',
  delay: 'delay',
  workload: 'workload',
  milestone: 'milestone',
}

/** AI 周期报表模板子集。 */
export const AI_PERIODIC_TEMPLATES: readonly V2ReportTemplateId[] = [
  'weekly-ai-summary',
  'monthly-ai-summary',
] as const

export type AiPeriodicTemplateId = (typeof AI_PERIODIC_TEMPLATES)[number]

/** 运行时守卫：判定是否为 AI 周期报表模板。 */
export function isAiPeriodicTemplate(value: string): value is AiPeriodicTemplateId {
  return (AI_PERIODIC_TEMPLATES as readonly string[]).includes(value)
}

/** 周期类型。 */
export const PERIOD_TYPES = ['weekly', 'monthly'] as const
export type PeriodType = (typeof PERIOD_TYPES)[number]

/** 模板 ID → 周期类型映射。 */
export const TEMPLATE_TO_PERIOD_TYPE: Partial<Record<V2ReportTemplateId, PeriodType>> = {
  'weekly-ai-summary': 'weekly',
  'monthly-ai-summary': 'monthly',
}

/**
 * 运行时守卫：判定任意字符串是否为 V2 内置模板。
 */
export function isV2ReportTemplate(value: string): value is V2ReportTemplateId {
  return (V2_REPORT_TEMPLATES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// 导出格式（V1 + V2）
// ---------------------------------------------------------------------------

/** V1 仅支持 Markdown 与 CSV。 */
export const REPORT_EXPORT_FORMATS = ['markdown', 'csv'] as const
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number]

/** V2 新增 PDF 与 XLSX。 */
export const V2_REPORT_EXPORT_FORMATS = ['markdown', 'csv', 'pdf', 'xlsx'] as const
export type V2ReportExportFormat = (typeof V2_REPORT_EXPORT_FORMATS)[number]

export function isReportExportFormat(value: string): value is ReportExportFormat {
  return (REPORT_EXPORT_FORMATS as readonly string[]).includes(value)
}

export function isV2ReportExportFormat(value: string): value is V2ReportExportFormat {
  return (V2_REPORT_EXPORT_FORMATS as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// 报表任务状态
// ---------------------------------------------------------------------------

export const REPORT_JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const
export type ReportJobStatus = (typeof REPORT_JOB_STATUSES)[number]

export function isReportJobStatus(value: string): value is ReportJobStatus {
  return (REPORT_JOB_STATUSES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// 数据源状态
// ---------------------------------------------------------------------------

export const REPORT_DATASOURCE_STATUSES = [
  'available',
  'unavailable',
  'forbidden',
  'timeout',
] as const
export type ReportDataSourceStatus = (typeof REPORT_DATASOURCE_STATUSES)[number]

// ---------------------------------------------------------------------------
// AI 审核状态
// ---------------------------------------------------------------------------

export const REPORT_AI_REVIEW_STATUSES = [
  'pending_review',
  'editing',
  'confirmed',
  'rejected',
] as const
export type ReportAiReviewStatus = (typeof REPORT_AI_REVIEW_STATUSES)[number]

// ---------------------------------------------------------------------------
// 机器可读 warning code（V2）
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AI 成本摘要
// ---------------------------------------------------------------------------

export interface AiCostSummary {
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  estimatedCost: number
  latencyMs: number
  /** 预算判决：'passed' | 'hard_blocked' | 'soft_warning' */
  budgetVerdict: 'passed' | 'hard_blocked' | 'soft_warning'
}

/** 模型性能摘要。 */
export interface AiModelSummary {
  provider: string
  model: string
  finishReason: string | null
}

// ---------------------------------------------------------------------------
// 周期报表 AI 草稿章节
// ---------------------------------------------------------------------------

/**
 * AiDraftSection —— AI 周报/月报表的一个结构化章节。
 */
export interface AiDraftSection {
  sectionKey: string
  title: string
  content: string
  htmlContent?: string
}

/**
 * AiPeriodicDraft —— AI 周期报表草稿结构化输出契约。
 */
export interface AiPeriodicDraft {
  /** 管理摘要 */
  executiveSummary: string
  /** 亮点（本期最重要 3-5 件事） */
  highlights: string[]
  /** 进度叙述 */
  progressNarrative: string
  /** 风险与问题 */
  riskAndIssues: string
  /** 资源说明 */
  resourceNotes: string
  /** 变更说明 */
  changeNotes: string
  /** 建议行动 */
  suggestedActions: string[]
  /** 数据限制说明 */
  dataWarningsNarrative: string
  /** 其他自定义章节 */
  additionalSections?: AiDraftSection[]
}

// ---------------------------------------------------------------------------
// 周期范围与对比
// ---------------------------------------------------------------------------

/**
 * PeriodRange —— 一个周期的起止范围。
 */
export interface PeriodRange {
  fromDate: string
  toDate: string
}

/**
 * PeriodComparison —— 当前周期与上一周期的确定性对比输出。
 * 用于周报/月报的趋势展示。
 */
export interface PeriodComparison {
  /** 完成项数变化（正数=增加） */
  completedDelta: number
  /** 延期项数变化 */
  overdueDelta: number
  /** 风险项数变化 */
  riskDelta: number
  /** 资源分配人数变化 */
  resourceDelta: number
  /** 变更请求数变化 */
  changeDelta: number
  /** 活动/评论数变化 */
  activityDelta: number
  /** 当前周期完成率 */
  currentCompletionRate: number
  /** 上一周期完成率 */
  previousCompletionRate: number
}

// ---------------------------------------------------------------------------
// AI 审核操作类型
// ---------------------------------------------------------------------------

export const AI_REVIEW_ACTIONS = ['confirm', 'return', 'edit'] as const
export type AiReviewAction = (typeof AI_REVIEW_ACTIONS)[number]

// ---------------------------------------------------------------------------
// 周期报表预览/生成输入扩展
// ---------------------------------------------------------------------------

export interface AiPeriodicPreviewRequest {
  templateId: AiPeriodicTemplateId
  title?: string
  /** 周期范围起始日期 ISO-8601 */
  fromDate: string
  /** 周期范围结束日期 ISO-8601 */
  toDate: string
  /** 上一周期范围起始日期 ISO-8601（可选，由后端推算） */
  prevFromDate?: string
  /** 上一周期范围结束日期 ISO-8601（可选，由后端推算） */
  prevToDate?: string
}

export interface AiPeriodicGenerateRequest {
  templateId: AiPeriodicTemplateId
  title?: string
  fromDate: string
  toDate: string
  previewSnapshotHash: string
  idempotencyKey?: string
  enableAiDraft?: boolean
}

// ---------------------------------------------------------------------------
// AI 周期报表审核操作请求
// ---------------------------------------------------------------------------

export interface AiReviewPeriodicRequest {
  action: AiReviewAction
  /** 编辑后的草稿正文（仅 edit 动作需要） */
  editedDraft?: AiPeriodicDraft
  /** 退回原因（仅 return 动作需要） */
  returnReason?: string
}

export interface AiReviewPeriodicResponse {
  versionId: number
  reviewStatus: ReportAiReviewStatus
  confirmedAt: string | null
  confirmedBy: number | null
}

// ---------------------------------------------------------------------------
// 机器可读 warning code（V2）
// ---------------------------------------------------------------------------

export const REPORT_WARNING_CODES = {
  // 数据源相关
  DATASOURCE_UNAVAILABLE: 'REPORT_DATASOURCE_UNAVAILABLE',
  DATASOURCE_FORBIDDEN: 'REPORT_DATASOURCE_FORBIDDEN',
  DATASOURCE_TIMEOUT: 'REPORT_DATASOURCE_TIMEOUT',
  DATASOURCE_EMPTY: 'REPORT_DATASOURCE_EMPTY',
  DATASOURCE_RECONCILIATION: 'REPORT_DATASOURCE_RECONCILIATION',
  // 聚合相关
  AGGREGATION_PARTIAL: 'REPORT_AGGREGATION_PARTIAL',
  AGGREGATION_FAILED: 'REPORT_AGGREGATION_FAILED',
  // AI 相关
  AI_BUDGET_HARD: 'REPORT_AI_BUDGET_HARD',
  AI_BUDGET_SOFT: 'REPORT_AI_BUDGET_SOFT',
  AI_BUDGET_BLOCKED: 'REPORT_AI_BUDGET_BLOCKED',
  AI_OUTPUT_EMPTY: 'REPORT_AI_OUTPUT_EMPTY',
  AI_OUTPUT_TRUNCATED: 'REPORT_AI_OUTPUT_TRUNCATED',
  AI_OUTPUT_SCHEMA_FAILURE: 'REPORT_AI_OUTPUT_SCHEMA_FAILURE',
  AI_OUTPUT_FAILED: 'REPORT_AI_OUTPUT_FAILED',
  AI_PARSE_FAILED: 'REPORT_AI_PARSE_FAILED',
  AI_DRAFT_FAILED: 'REPORT_AI_DRAFT_FAILED',
  // 导出相关
  EXPORT_RENDER_FAILED: 'REPORT_EXPORT_RENDER_FAILED',
  // 健康诊断
  HEALTH_DIAGNOSIS_UNAVAILABLE: 'HEALTH_DIAGNOSIS_UNAVAILABLE',
  HEALTH_DIAGNOSIS_STALE: 'HEALTH_DIAGNOSIS_STALE',
} as const

export type ReportWarningCode = (typeof REPORT_WARNING_CODES)[keyof typeof REPORT_WARNING_CODES]

// ---------------------------------------------------------------------------
// 筛选条件（用于生成入口和历史列表）
// ---------------------------------------------------------------------------

/**
 * ReportGenerateFilters —— 触发一次报表生成时的筛选条件。
 * 均为可选；缺省时聚合器使用项目全量正式数据。
 */
export interface ReportGenerateFilters {
  /** 时间范围起点 ISO-8601（含）；用于统计任务/里程碑落点 */
  fromDate?: string
  /** 时间范围终点 ISO-8601（含） */
  toDate?: string
  /** 限定负责人 user id（workload 模板常用） */
  assigneeIds?: number[]
  /** 限定 WBS 分支（progress/milestone 常用） */
  wbsNodeIds?: number[]
  /** 限定里程碑 id（milestone 模板常用） */
  milestoneIds?: number[]
}

/**
 * ReportListFilters —— 历史报表分页列表的过滤条件。
 */
export interface ReportListFilters {
  template?: ReportTemplate
  generatedBy?: number
  fromDate?: string
  toDate?: string
  sort?: string
  page?: number
  perPage?: number
}

// ---------------------------------------------------------------------------
// 快照公共元信息
// ---------------------------------------------------------------------------

/**
 * ReportWarningLevel —— 快照 warnings 严重度：
 *   - info    信息提示（例如"当前项目暂无里程碑"）
 *   - warning 数据缺失或统计降级（例如"资源模块未启用，负载数据缺失"）
 *   - critical 数据不一致或强异常（例如"依赖存在环路，延期依赖分析已跳过"）
 */
export const REPORT_WARNING_LEVELS = ['info', 'warning', 'critical'] as const
export type ReportWarningLevel = (typeof REPORT_WARNING_LEVELS)[number]

export interface ReportWarning {
  level: ReportWarningLevel
  /** 简体中文短语，直接向用户展示 */
  message: string
  /** 可选：出现该 warning 的实体上下文（任务 id、模块名等） */
  context?: Record<string, unknown>
}

/**
 * ReportWarningV2 —— V2 带 code 的 warning（继承 V1 结构）。
 */
export interface ReportWarningV2 extends ReportWarning {
  /** 机器可读 warning code。 */
  code: ReportWarningCode
}

/**
 * ReportSnapshotMetadata —— 每份快照必须携带的可追溯元信息。
 * 对应 spec 需求「快照可追溯」。
 */
export interface ReportSnapshotMetadata {
  templateVersion: ReportTemplateVersion
  /** 快照生成时间 ISO-8601 */
  generatedAt: string
  /** 触发生成的用户 id；系统自动生成时为 null */
  generatedBy: number | null
  /** 生成时应用的筛选条件（等价于 config） */
  sourceRange: ReportGenerateFilters
  /** 源数据快照指纹（SHA-256 前 32 位），用于识别陈旧 */
  sourceDataHash: string
  /** 源数据最新时间戳 ISO-8601（用于识别陈旧的人可读维度） */
  sourceDataTimestamp?: string
  /** 快照期间累计 warnings */
  warnings: ReportWarning[]
}

// ---------------------------------------------------------------------------
// V2 扩展：数据源聚合结果
// ---------------------------------------------------------------------------

/**
 * ReportDataSourceResult —— 报表数据源聚合输出。
 * 每个数据源适配器必须返回该形状。
 */
export interface ReportDataSourceResult<T = unknown> {
  sourceKey: string
  status: ReportDataSourceStatus
  generatedAt: string
  data: T | null
  warnings: ReportWarningV2[]
  sourceHash: string
  /** 数据源口径版本（如 Dashboard metricVersion） */
  metricVersion?: string
  /** 口径计算时间 */
  calculatedAt?: string
}

// ---------------------------------------------------------------------------
// V2 扩展：报表文档中间结构
// ---------------------------------------------------------------------------

/**
 * ReportDocumentSection —— 报表文档中的单个节。
 */
export interface ReportDocumentSection {
  title: string
  type: 'summary' | 'table' | 'list' | 'text' | 'warnings'
  content: string | Record<string, unknown> | unknown[]
  dataSourceKey?: string
}

/**
 * ReportDocument —— 中间报表文档结构，供渲染器消费。
 */
export interface ReportDocument {
  title: string
  templateId: V2ReportTemplateId
  templateVersion: string
  projectId: number
  projectName: string
  organizationId: number
  generatedAt: string
  generatedBy: number | null
  dateRange: { fromDate?: string; toDate?: string }
  sections: ReportDocumentSection[]
  warnings: ReportWarningV2[]
  /** AI 草稿正文（仅 AI 模板有） */
  aiDraft?: string | null
  aiReviewStatus?: ReportAiReviewStatus | null
  aiCostSummary?: {
    provider: string
    model: string
    promptTokens: number
    completionTokens: number
    estimatedCost: number
    latencyMs: number
  } | null
}

// ---------------------------------------------------------------------------
// V1 四类快照结构（完整保留）
// ---------------------------------------------------------------------------

export interface ProgressTaskStatusBucket {
  status: string
  count: number
  ratio: number
}

export interface ProgressWbsSummary {
  wbsNodeId: number
  code: string
  name: string
  totalTasks: number
  completedTasks: number
  progressPercent: number
}

export interface ProgressCriticalTask {
  taskId: number
  title: string
  status: string
  progressPercent: number
  assigneeName?: string
  dueDate?: string
}

export interface ProgressBlocker {
  taskId: number
  title: string
  reason: string
}

export interface ProgressSnapshot {
  template: 'progress'
  summary: {
    projectId: number
    projectName: string
    overallProgressPercent: number
    totalTasks: number
    completedTasks: number
    inProgressTasks: number
    notStartedTasks: number
    blockedTasks: number
  }
  statusDistribution: ProgressTaskStatusBucket[]
  wbsSummaries: ProgressWbsSummary[]
  criticalTasks: ProgressCriticalTask[]
  blockers: ProgressBlocker[]
  snapshotMetadata: ReportSnapshotMetadata
}

export interface DelayOverdueTask {
  taskId: number
  title: string
  assigneeName?: string
  plannedEndDate: string | null
  actualEndDate: string | null
  overdueDays: number
  onCriticalPath: boolean
}

export interface DelayUpcomingTask {
  taskId: number
  title: string
  assigneeName?: string
  plannedEndDate: string | null
  daysUntilDue: number
}

export interface DelayDependencyWarning {
  fromTaskId: number
  toTaskId: number
  reason: string
}

export interface DelaySnapshot {
  template: 'delay'
  summary: {
    projectId: number
    projectName: string
    totalTasksWithDueDate: number
    overdueTasks: number
    upcomingTasks: number
    delayRatePercent: number
    averageOverdueDays: number
    maxOverdueDays: number
  }
  overdueTasks: DelayOverdueTask[]
  upcomingTasks: DelayUpcomingTask[]
  dependencyWarnings: DelayDependencyWarning[]
  snapshotMetadata: ReportSnapshotMetadata
}

export interface WorkloadAssigneeBucket {
  userId: number
  displayName: string
  totalTasks: number
  completedTasks: number
  inProgressTasks: number
  notStartedTasks: number
  plannedHours: number
  actualHours: number
  overloadHint: boolean
}

export interface WorkloadUnassignedBucket {
  totalTasks: number
  plannedHours: number
}

export interface WorkloadSnapshot {
  template: 'workload'
  summary: {
    projectId: number
    projectName: string
    totalAssignees: number
    totalPlannedHours: number
    totalActualHours: number
    unassigned: WorkloadUnassignedBucket
  }
  byAssignee: WorkloadAssigneeBucket[]
  snapshotMetadata: ReportSnapshotMetadata
}

export interface MilestoneEntry {
  milestoneId: number
  name: string
  plannedDate: string
  status: string
  linkedTaskCount: number
  linkedTaskCompletedCount: number
  linkedTaskProgressPercent: number
  overdueDays: number
  autoCalculated: boolean
}

export interface MilestoneRiskItem {
  milestoneId: number
  name: string
  reason: string
}

export interface MilestoneSnapshot {
  template: 'milestone'
  summary: {
    projectId: number
    projectName: string
    totalMilestones: number
    completedMilestones: number
    overdueMilestones: number
    upcomingMilestones: number
  }
  milestones: MilestoneEntry[]
  risks: MilestoneRiskItem[]
  snapshotMetadata: ReportSnapshotMetadata
}

export type ReportSnapshot = ProgressSnapshot | DelaySnapshot | WorkloadSnapshot | MilestoneSnapshot

// ---------------------------------------------------------------------------
// 报表记录（后端存储实体的领域视图）
// ---------------------------------------------------------------------------

/**
 * Report —— 后端 `reports` 表的领域视图（快照持久化后回读的形状）。
 */
export interface Report {
  id: number
  organizationId: number
  projectId: number
  template: ReportTemplate
  title: string
  config: ReportGenerateFilters
  formatConfig: ReportFormatConfig | null
  dataSnapshot: ReportSnapshot
  fileFormat: ReportExportFormat | null
  /** 导出文件已生成时的服务端相对路径，仅后端使用；API 响应不外泄真实路径 */
  filePath?: string | null
  generatedAt: string | null
  generatedBy: number | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface ReportFormatConfig {
  /** 是否包含明细分节（默认 true） */
  includeDetails?: boolean
  /** 是否包含 warnings（默认 true） */
  includeWarnings?: boolean
  /** 语言：V1 固定 'zh-CN'，预留接口 */
  locale?: 'zh-CN'
}

// ---------------------------------------------------------------------------
// V2 扩展：报表版本、任务、导出、模板
// ---------------------------------------------------------------------------

/**
 * ReportVersion —— 报表版本记录。
 * V2 扩展支持周期报表和 AI 草稿审核 metadata。
 */
export interface ReportVersion {
  id: number
  organizationId: number
  projectId: number
  /** 关联的 V1 reports.id（如有） */
  reportId: number | null
  templateId: V2ReportTemplateId
  templateVersion: string
  title: string
  dateRange: { fromDate?: string; toDate?: string }
  /** 周期报表字段 */
  periodType?: PeriodType | null
  prevDateRange?: { fromDate?: string; toDate?: string } | null
  filters: ReportGenerateFilters
  /** 数据源 sourceHash 集合 */
  dataSourceHashes: Record<string, string>
  /** 版本快照 hash */
  snapshotHash: string
  warnings: ReportWarningV2[]
  /** 文档引用（JSONB，存储文档部分或全文） */
  documentRef: Record<string, unknown> | null
  /** AI 草稿引用 */
  aiDraft: string | null
  aiReviewStatus: ReportAiReviewStatus | null
  aiDraftRef: string | null
  inputSourceHashes: string[] | null
  modelSummary: AiModelSummary | null
  costSummary: AiCostSummary | null
  aiCostRef: Record<string, unknown> | null
  attempt: number | null
  idempotencyKey: string | null
  reviewNotes: string | null
  reviewAction: AiReviewAction | null
  generatedBy: number | null
  generatedAt: string
  confirmedAt: string | null
  confirmedBy: number | null
  returnedAt: string | null
  returnedBy: number | null
  createdAt: string
  updatedAt: string
}

/**
 * ReportJob —— 报表生成任务记录。
 */
export interface ReportJob {
  id: number
  organizationId: number
  projectId: number
  reportId: number | null
  versionId: number | null
  templateId: V2ReportTemplateId
  requestedBy: number
  status: ReportJobStatus
  attempt: number
  idempotencyKey: string | null
  progress: string | null
  errorCategory: string | null
  errorDetail: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * ReportExport —— 报表导出记录。
 */
export interface ReportExport {
  id: number
  organizationId: number
  projectId: number
  reportId: number
  versionId: number | null
  format: V2ReportExportFormat
  status: 'pending' | 'processing' | 'completed' | 'failed'
  fileHash: string | null
  fileSize: number | null
  mimeType: string | null
  filePath: string | null
  errorCategory: string | null
  createdBy: number
  createdAt: string
  completedAt: string | null
}

/**
 * ReportTemplateEntry —— 模板目录条目（API 响应用）。
 */
export interface ReportTemplateEntry {
  templateId: V2ReportTemplateId
  name: string
  description: string
  supportedFormats: V2ReportExportFormat[]
  requiredDataSources: string[]
  optionalDataSources: string[]
  defaultDateRange: 'all' | 'week' | 'month' | 'quarter'
  permission: string
}

// ---------------------------------------------------------------------------
// V1 API 请求/响应载荷
// ---------------------------------------------------------------------------

/** POST /api/v1/projects/:projectId/reports 请求体 */
export interface CreateReportRequest {
  template: ReportTemplate
  title?: string
  filters?: ReportGenerateFilters
  formatConfig?: ReportFormatConfig
}

/** POST /api/v1/projects/:projectId/reports 响应 */
export interface CreateReportResponse {
  data: Report
}

/** GET /api/v1/projects/:projectId/reports 分页响应 */
export interface ListReportsResponse {
  data: Report[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

/** GET /api/v1/projects/:projectId/reports/:reportId 响应 */
export interface GetReportResponse {
  data: Report
}

/** POST /api/v1/projects/:projectId/reports/:reportId/exports 请求体 */
export interface ExportReportRequest {
  format: ReportExportFormat
  formatConfig?: ReportFormatConfig
}

/** POST /api/v1/projects/:projectId/reports/:reportId/exports 响应 */
export interface ExportReportResponse {
  data: {
    reportId: number
    format: ReportExportFormat
    downloadUrl: string
    filename: string
    size: number
    generatedAt: string
  }
}

// ---------------------------------------------------------------------------
// V2 API 请求/响应载荷
// ---------------------------------------------------------------------------

/** GET /api/v1/projects/:projectId/reports/v2/templates 响应 */
export interface V2ListTemplatesResponse {
  data: ReportTemplateEntry[]
}

/** POST /api/v1/projects/:projectId/reports/v2/preview 请求体 */
export interface V2PreviewRequest {
  templateId: V2ReportTemplateId
  title?: string
  filters?: ReportGenerateFilters
  enableAiDraft?: boolean
}

/** POST /api/v1/projects/:projectId/reports/v2/preview 响应 */
export interface V2PreviewResponse {
  data: {
    templateId: V2ReportTemplateId
    templateVersion: string
    title: string
    dateRange: { fromDate?: string; toDate?: string }
    dataSources: ReportDataSourceResult[]
    warnings: ReportWarningV2[]
    blocking: boolean
    exportFormats: V2ReportExportFormat[]
    aiEnabled: boolean
    aiEstimated: boolean
  }
}

/** POST /api/v1/projects/:projectId/reports/v2/versions 请求体 */
export interface V2CreateVersionRequest {
  templateId: V2ReportTemplateId
  title?: string
  filters?: ReportGenerateFilters
  enableAiDraft?: boolean
  previewSnapshotHash: string
  idempotencyKey?: string
}

/** POST /api/v1/projects/:projectId/reports/v2/versions 响应 */
export interface V2CreateVersionResponse {
  data: {
    version: ReportVersion
    job: ReportJob
  }
}

/** GET /api/v1/projects/:projectId/reports/v2/versions 查询参数 */
export interface V2ListVersionsFilters {
  templateId?: V2ReportTemplateId
  page?: number
  perPage?: number
  sort?: string
}

/** GET /api/v1/projects/:projectId/reports/v2/versions 响应 */
export interface V2ListVersionsResponse {
  data: ReportVersion[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

/** GET /api/v1/projects/:projectId/reports/v2/jobs/:jobId 响应 */
export interface V2GetJobResponse {
  data: ReportJob
}

/** POST /api/v1/projects/:projectId/reports/v2/jobs/:jobId/retry 响应 */
export interface V2RetryJobResponse {
  data: ReportJob
}

/** POST /api/v1/projects/:projectId/reports/v2/versions/:versionId/exports 请求体 */
export interface V2CreateExportRequest {
  format: V2ReportExportFormat
}

/** POST /api/v1/projects/:projectId/reports/v2/versions/:versionId/exports 响应 */
export interface V2CreateExportResponse {
  data: {
    exportId: number
    format: V2ReportExportFormat
    status: string
  }
}

/** GET /api/v1/projects/:projectId/reports/v2/versions/:versionId/exports 响应 */
export interface V2ListExportsResponse {
  data: ReportExport[]
}

/** GET /api/v1/projects/:projectId/reports/v2/exports/:exportId/download 重定向/流 */
export interface V2DownloadExportResponse {
  url: string
  filename: string
  mimeType: string
  size: number
}

/** PATCH /api/v1/projects/:projectId/reports/v2/versions/:versionId/ai-review 请求体 */
export interface V2AiReviewRequest {
  aiDraft?: string
  reviewStatus: ReportAiReviewStatus
}

/** PATCH /api/v1/projects/:projectId/reports/v2/versions/:versionId/ai-review 响应 */
export interface V2AiReviewResponse {
  data: {
    versionId: number
    aiReviewStatus: ReportAiReviewStatus
    confirmedAt: string | null
  }
}
