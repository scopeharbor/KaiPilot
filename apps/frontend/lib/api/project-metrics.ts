/**
 * 项目度量只读 API SDK（v3-chart-gallery-tier2-timeseries-metrics W1 · task 1.1）。
 *
 * 对接 `ProjectMetricsController` 已就绪的 4 个只读聚合端点（RL-06 零写库）：
 * EVM 指标卡 / EVM S 曲线 / 燃尽燃起图 / SPC 控制图。响应信封均为 `{ data: T }`，
 * `apiFetch` 已统一解包，此处直接声明解包后的数据形状（与后端服务类型逐字对齐）。
 */
import { apiFetch } from '@/lib/api-client'

// ---------------------------------------------------------------------------
// EVM 实值管理
// ---------------------------------------------------------------------------

export type EvmScheduleStatus = 'ahead' | 'on_track' | 'delayed'
export type EvmCostStatus = 'under_budget' | 'on_track' | 'over_budget'

/** EVM 当前绩效指标卡。金额单位为「分」；比率保留 3 位小数（后端口径）。 */
export interface EvmIndicators {
  projectId: number
  asOfDate: string
  hasBaseline: boolean
  bac: number
  pv: number
  ev: number
  ac: number
  cv: number
  sv: number
  cpi: number
  spi: number
  etc: number
  eac: number
  vac: number
  tcpi: number
  scheduleStatus: EvmScheduleStatus
  costStatus: EvmCostStatus
}

/** S 曲线单采样点。未来点 ev/ac 为 null；历史点与评估日 eacForecast 为 null。 */
export interface EvmSCurvePoint {
  date: string
  pv: number
  ev: number | null
  ac: number | null
  eacForecast: number | null
}

export interface EvmSCurveResult {
  projectId: number
  asOfDate: string
  startDate: string
  endDate: string
  hasBaseline: boolean
  points: EvmSCurvePoint[]
}

export interface EvmQueryParams {
  asOfDate?: string
}

// ---------------------------------------------------------------------------
// 燃尽 / 燃起图
// ---------------------------------------------------------------------------

export type BurndownGranularity = 'day' | 'week'
export type BurndownMetric = 'task' | 'hour'

export interface BurndownPoint {
  date: string
  idealRemaining: number
  remainingTasks: number
  remainingHours: number
  completedTasks: number
  completedHours: number
  totalScopeTasks: number
  totalScopeHours: number
}

export interface BurndownResult {
  projectId: number
  startDate: string
  endDate: string
  granularity: BurndownGranularity
  metric: BurndownMetric
  initialScopeTasks: number
  initialScopeHours: number
  points: BurndownPoint[]
}

export interface BurndownQueryParams {
  granularity?: BurndownGranularity
  metric?: BurndownMetric
  startDate?: string
  endDate?: string
}

// ---------------------------------------------------------------------------
// SPC 控制图
// ---------------------------------------------------------------------------

export type SpcMetricKind = 'cycle_time' | 'lead_time'

export interface SpcSample {
  taskId: number
  taskName: string
  completedAt: string
  value: number
  isOutlier: boolean
  violatedRules: string[]
}

export interface SpcSummary {
  metric: SpcMetricKind
  sampleCount: number
  mean: number | null
  sigma: number | null
  ucl: number | null
  lcl: number | null
  uwl: number | null
  lwl: number | null
}

export interface SpcResult {
  summary: SpcSummary
  samples: SpcSample[]
  warning: string | null
}

export interface ControlChartQueryParams {
  metric?: SpcMetricKind
  limit?: number
}

// ---------------------------------------------------------------------------
// 帕累托分析 (Pareto)
// ---------------------------------------------------------------------------

export type ParetoDimension = 'issue_type' | 'issue_severity' | 'risk_category' | 'change_type'

export interface ParetoItem {
  category: string
  label: string
  count: number
  percentage: number
  cumulativePercentage: number
  isVitalFew: boolean
}

export interface ParetoResult {
  dimension: ParetoDimension
  totalCount: number
  items: ParetoItem[]
}

export interface ParetoQueryParams {
  dimension?: ParetoDimension
}

// ---------------------------------------------------------------------------
// 线条平衡图 (LOB)
// ---------------------------------------------------------------------------

export interface LobActivity {
  taskId: number
  taskName: string
  unit: string
  stage: string
  plannedStart: string | null
  plannedEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  durationDays: number | null
  slopeRate: number | null
}

export interface LobRhythmSummaryRow {
  stage: string
  activityCount: number
  avgDurationDays: number | null
  avgTaktDays: number | null
  collision: boolean
  gap: boolean
  diagnostics: Array<'STAGE_COLLISION' | 'STAGE_GAP'>
}

export interface LobMetricsResponse {
  units: string[]
  stages: string[]
  activities: LobActivity[]
  rhythmSummary: LobRhythmSummaryRow[]
}

// ---------------------------------------------------------------------------
// RACI 责任分配矩阵 (v3-chart-gallery-tier2-governance-matrices W1 · task 1.1)
// ---------------------------------------------------------------------------

export type RaciRole = 'R' | 'A' | 'C' | 'I'

export interface RaciMember {
  id: number
  name: string | null
  email: string
  role: string | null
}

export interface RaciTaskSummary {
  id: number
  name: string
  status: string
}

export interface RaciMatrixResponse {
  members: RaciMember[]
  tasks: RaciTaskSummary[]
  /** matrix[taskId][userId] = 角色标签数组（同一任务同一人可兼有多角色） */
  matrix: Record<number, Record<number, RaciRole[]>>
}

// ---------------------------------------------------------------------------
// OBS 组织分解结构 (v3-chart-gallery-tier2-org-contract-plans W1 · task 1.1)
// ---------------------------------------------------------------------------

export interface ObsNodeMetrics {
  memberCount: number
  taskCount: number
  completedTaskCount: number
  totalEstimatedHours: number
}

export interface ObsTreeNode {
  id: number
  name: string
  code: string
  depth: number
  path: string
  leaderName: string | null
  metrics: ObsNodeMetrics
  children: ObsTreeNode[]
}

// ---------------------------------------------------------------------------
// 客户端
// ---------------------------------------------------------------------------

function buildQuery(params: Record<string, unknown>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  }
  return query.size ? `?${query.toString()}` : ''
}

const projectMetrics = (projectId: number) => `/projects/${projectId}/metrics`

export const projectMetricsApi = {
  evm: (projectId: number, params: EvmQueryParams = {}) =>
    apiFetch<EvmIndicators>(
      `${projectMetrics(projectId)}/evm${buildQuery(params as Record<string, unknown>)}`,
    ),
  evmSCurve: (projectId: number, params: EvmQueryParams = {}) =>
    apiFetch<EvmSCurveResult>(
      `${projectMetrics(projectId)}/evm/s-curve${buildQuery(params as Record<string, unknown>)}`,
    ),
  burndown: (projectId: number, params: BurndownQueryParams = {}) =>
    apiFetch<BurndownResult>(
      `${projectMetrics(projectId)}/burndown${buildQuery(params as Record<string, unknown>)}`,
    ),
  controlChart: (projectId: number, params: ControlChartQueryParams = {}) =>
    apiFetch<SpcResult>(
      `${projectMetrics(projectId)}/control-chart${buildQuery(params as Record<string, unknown>)}`,
    ),
  pareto: (projectId: number, params: ParetoQueryParams = {}) =>
    apiFetch<ParetoResult>(
      `${projectMetrics(projectId)}/pareto${buildQuery(params as Record<string, unknown>)}`,
    ),
  lob: (projectId: number) => apiFetch<LobMetricsResponse>(`${projectMetrics(projectId)}/lob`),
  raciMatrix: (projectId: number) =>
    apiFetch<RaciMatrixResponse>(`/projects/${projectId}/raci-matrix`),
  obsTree: (projectId: number) => apiFetch<ObsTreeNode[]>(`/projects/${projectId}/obs-tree`),
}

export const projectMetricsKeys = {
  all: ['project-metrics'] as const,
  evm: (projectId: number, params: EvmQueryParams) =>
    [...projectMetricsKeys.all, 'evm', projectId, params] as const,
  evmSCurve: (projectId: number, params: EvmQueryParams) =>
    [...projectMetricsKeys.all, 'evm-s-curve', projectId, params] as const,
  burndown: (projectId: number, params: BurndownQueryParams) =>
    [...projectMetricsKeys.all, 'burndown', projectId, params] as const,
  controlChart: (projectId: number, params: ControlChartQueryParams) =>
    [...projectMetricsKeys.all, 'control-chart', projectId, params] as const,
  pareto: (projectId: number, params: ParetoQueryParams = {}) =>
    [...projectMetricsKeys.all, 'pareto', projectId, params] as const,
  lob: (projectId: number) => [...projectMetricsKeys.all, 'lob', projectId] as const,
  raciMatrix: (projectId: number) => [...projectMetricsKeys.all, 'raci-matrix', projectId] as const,
  obsTree: (projectId: number) => [...projectMetricsKeys.all, 'obs-tree', projectId] as const,
}
