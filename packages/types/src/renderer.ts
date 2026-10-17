/**
 * renderer —— V2 确定性 UI Renderer 共享契约（前后端共享，§1.1 P0）。
 *
 * 定义 ProjectViewConfig、ViewConfig、DashboardWidgetConfig、DataQueryConfig、
 * UserViewOverride、fallback、source 元数据与 validation 结果类型。
 *
 * ⚠️ AI 输出只能约束为这些类型，不能输出组件代码、CSS、HTML 或事件处理。
 */

// ─── 视图类型枚举 ─────────────────────────────────────
export type RendererViewType =
  | 'dashboard'
  | 'list'
  | 'kanban'
  | 'gantt'
  | 'wbs'
  | 'calendar'
  | 'timeline'
  | 'risk-matrix'
  | 'resource'
  | 'dependency'
  | 'custom'

// ─── Fallback 层级 ────────────────────────────────────
export type FallbackLevel = 'last_known_good' | 'system_default' | 'error'

export interface FallbackState {
  level: FallbackLevel
  reason: string
  /** 人类可读的中文说明 */
  message: string
  /** 原始 config ref（若可获取） */
  originalConfigRef?: string
}

// ─── Source 元数据 ────────────────────────────────────
export type ConfigSourceType =
  | 'ai_recommendation'
  | 'deterministic'
  | 'user_manual'
  | 'compiler'
  | 'migration'
  | 'system_default'

export interface ConfigSourceMetadata {
  type: ConfigSourceType
  /** 产生此配置的 stage/流程标识 */
  stage?: string
  /** AI provider/model（仅 AI 源） */
  provider?: string
  model?: string
  /** 确定性引擎版本 */
  engineVersion?: string
  /** 来源 artifact ref */
  artifactRef?: string
  /** Compiler runId */
  runId?: string
  /** 输入 refs 列表 */
  inputRefs?: string[]
  createdAt?: string
}

// ─── 数据查询 DSL（安全字段白名单驱动） ─────────────────
export type DataQuerySource =
  | 'dashboard_metrics'
  | 'task_summary'
  | 'gantt_facts'
  | 'wbs_nodes'
  | 'kanban_columns'
  | 'risk_summary'
  | 'resource_summary'
  | 'change_impact_summary'
  | 'timeline_facts'
  | 'report_summary'

export interface DataQueryFilter {
  field: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains'
  value: string | number | boolean | (string | number)[]
}

export interface DataQuerySort {
  field: string
  direction: 'asc' | 'desc'
}

export interface DataQueryConfig {
  source: DataQuerySource
  /** 仅白名单字段可用 */
  fields?: string[]
  filters?: DataQueryFilter[]
  sort?: DataQuerySort[]
  limit?: number
  /** 安全白名单聚合：count / sum / avg / min / max */
  aggregate?: 'count' | 'sum' | 'avg' | 'min' | 'max'
  /** 分组字段 */
  groupBy?: string
}

// ─── Widget 配置 ───────────────────────────────────────
export type WidgetType =
  | 'completion_rate'
  | 'task_distribution'
  | 'risk_health'
  | 'resource_load'
  | 'overdue_tasks'
  | 'recent_activity'
  | 'milestone_progress'
  | 'budget_summary'
  | 'change_impact'
  | 'report_snapshot'
  | 'custom'

export interface DashboardWidgetConfig {
  id: string
  type: WidgetType
  title: string
  /** 安全图标名称白名单 */
  icon?: string
  /** 可选数据查询 */
  dataQuery?: DataQueryConfig
  /** Grid 布局 tokens */
  width?: 1 | 2 | 3 | 4 | 6 | 12
  height?: 1 | 2 | 3 | 4
  /** 是否在权限不足时隐藏 */
  redactOnPermission?: string[]
  /** Widget 级源元数据 */
  sourceMetadata?: ConfigSourceMetadata
}

// ─── 视图特定配置 ──────────────────────────────────────
export interface DashboardViewConfig {
  widgets: DashboardWidgetConfig[]
}

export interface ListViewConfig {
  columns?: string[]
  groupBy?: string
  showSearch?: boolean
  defaultSort?: DataQuerySort
}

export interface KanbanViewConfig {
  columnField?: string
  swimlaneField?: string
  collapsedColumns?: string[]
  showEmptyColumns?: boolean
}

export interface GanttViewConfig {
  showDependencies?: boolean
  showCriticalPath?: boolean
  showBaseline?: boolean
  showProgress?: boolean
  showWeekends?: boolean
  timeScale?: 'day' | 'week' | 'month' | 'quarter'
}

export interface WbsViewConfig {
  showFields?: string[]
  expandedLevel?: number
  showCompletion?: boolean
}

export interface CalendarViewConfig {
  mode?: 'month' | 'week' | 'day'
  showWeekends?: boolean
}

export interface TimelineViewConfig {
  timeScale?: 'day' | 'week' | 'month'
  showMilestones?: boolean
  showDependencies?: boolean
}

export interface RiskMatrixViewConfig {
  showLevel?: 'all' | 'critical' | 'high'
  groupBy?: 'probability' | 'impact'
}

export interface ResourceViewConfig {
  mode?: 'matrix' | 'requirements' | 'conflicts'
  showOverallocation?: boolean
}

export interface DependencyViewConfig {
  showCycles?: boolean
  showAllLevels?: boolean
}

// ─── ViewConfig 联合 ──────────────────────────────────
export type ViewSpecificConfig =
  | { type: 'dashboard'; config: DashboardViewConfig }
  | { type: 'list'; config: ListViewConfig }
  | { type: 'kanban'; config: KanbanViewConfig }
  | { type: 'gantt'; config: GanttViewConfig }
  | { type: 'wbs'; config: WbsViewConfig }
  | { type: 'calendar'; config: CalendarViewConfig }
  | { type: 'timeline'; config: TimelineViewConfig }
  | { type: 'risk-matrix'; config: RiskMatrixViewConfig }
  | { type: 'resource'; config: ResourceViewConfig }
  | { type: 'dependency'; config: DependencyViewConfig }
  | { type: 'custom'; config: Record<string, unknown> }

// ─── ViewConfig ────────────────────────────────────────
export interface ViewConfig {
  id: string
  type: RendererViewType
  title: string
  /** 安全图标名称 */
  icon?: string
  /** 视图特定配置 */
  config: ViewSpecificConfig
  /** 可选数据查询 */
  dataQuery?: DataQueryConfig
  /** 可选的可见性权限门槛 */
  requiresPermission?: string[]
  /** 源元数据 */
  sourceMetadata?: ConfigSourceMetadata
}

// ─── ProjectViewConfig（顶层） ─────────────────────────
export interface ProjectViewConfig {
  schemaVersion: number
  projectId: number
  defaultViewId: string
  views: ViewConfig[]
  /** 顶层源元数据 */
  sourceMetadata?: ConfigSourceMetadata
}

// ─── UserViewOverride（差量覆盖） ──────────────────────
export interface UserViewOverrideEntry {
  viewId: string
  schemaVersion: number
  /** JSON Pointer 风格路径：/config/widgets/0/width */
  path: string
  value: unknown
  actorUserId: number
  timestamp: string
}

export interface UserViewOverride {
  id: string
  organizationId: number
  projectId: number
  userId: number
  baseViewId: string
  overrides: UserViewOverrideEntry[]
  createdAt: string
  updatedAt: string
}

// ─── Validation ─────────────────────────────────────────
export type ValidationSeverity = 'error' | 'warning' | 'info'

export interface ValidationResult {
  valid: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  /** 验证后计算出的 config hash */
  configHash?: string
}

export interface ValidationIssue {
  severity: ValidationSeverity
  code: string
  message: string
  /** JSON Pointer 定位到具体字段 */
  path?: string
  /** 建议修复值 */
  suggestedValue?: unknown
}

// ─── AI 候选配置 ───────────────────────────────────────
export type CandidateStatus = 'pending_review' | 'approved' | 'rejected' | 'expired'

export interface AiRendererCandidate {
  id: string
  config: ViewConfig
  schemaVersion: number
  sourceMetadata: ConfigSourceMetadata
  confidence: number
  status: CandidateStatus
  validationResult: ValidationResult
  fallbackConfig?: ViewConfig
  humanReviewNote?: string
  createdAt: string
  reviewdAt?: string
  reviewedByUserId?: number
}

// ─── 配置哈希（确定性） ────────────────────────────────
export interface ConfigHash {
  algorithm: 'sha256'
  hash: string
  /** 参与 hash 的字段路径列表 */
  includedPaths: string[]
}

// ─── 默认入口解析结果 ─────────────────────────────────
export interface DefaultEntryResolveResult {
  viewConfig: ProjectViewConfig | null
  targetView: ViewConfig | null
  usedFallback: boolean
  fallbackReason?: string
  fallbackMessage?: string
  validationWarnings?: ValidationIssue[]
}

// ─── Dashboard 推荐摘要（renderer 用） ─────────────────
export interface RendererDashboardSummary {
  hasRecommendation: boolean
  candidateCount: number
  savedViewCount: number
}
