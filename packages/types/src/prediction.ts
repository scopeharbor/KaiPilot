// @aiproj/types — AI 风险与进度预测共享契约（前后端共享）
// v2-ai-risk-progress-prediction

// ---------------------------------------------------------------------------
// 预测窗口
// ---------------------------------------------------------------------------

export const PREDICTION_WINDOWS = [7, 14, 30, 60, 90] as const
export type PredictionWindow = (typeof PREDICTION_WINDOWS)[number]

// ---------------------------------------------------------------------------
// 预测状态
// ---------------------------------------------------------------------------

export const PREDICTION_SNAPSHOT_STATUSES = ['pending', 'confirmed', 'dismissed', 'stale'] as const
export type PredictionSnapshotStatus = (typeof PREDICTION_SNAPSHOT_STATUSES)[number]

// ---------------------------------------------------------------------------
// 信号类型
// ---------------------------------------------------------------------------

export const PREDICTION_SIGNAL_TYPES = [
  'schedule_risk',
  'critical_path_drift',
  'milestone_pressure',
  'dependency_block',
  'resource_bottleneck',
  'risk_escalation',
  'change_impact',
  'data_staleness',
  'data_quality',
] as const
export type PredictionSignalType = (typeof PREDICTION_SIGNAL_TYPES)[number]

export const PREDICTION_SIGNAL_TYPE_LABELS: Record<PredictionSignalType, string> = {
  schedule_risk: '排期风险',
  critical_path_drift: '关键路径漂移',
  milestone_pressure: '里程碑压力',
  dependency_block: '依赖阻塞',
  resource_bottleneck: '资源瓶颈',
  risk_escalation: '风险升级',
  change_impact: '变更影响',
  data_staleness: '数据过期',
  data_quality: '数据质量',
}

// ---------------------------------------------------------------------------
// 严重度
// ---------------------------------------------------------------------------

export const PREDICTION_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const
export type PredictionSeverity = (typeof PREDICTION_SEVERITIES)[number]

export const PREDICTION_SEVERITY_ORDER: PredictionSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
]

export function predictionSeverityScore(severity: PredictionSeverity): number {
  const idx = PREDICTION_SEVERITY_ORDER.indexOf(severity)
  return idx >= 0 ? PREDICTION_SEVERITY_ORDER.length - idx : 0
}

// ---------------------------------------------------------------------------
// 置信区间
// ---------------------------------------------------------------------------

export const PREDICTION_CONFIDENCE_BANDS = ['high', 'medium', 'low'] as const
export type PredictionConfidenceBand = (typeof PREDICTION_CONFIDENCE_BANDS)[number]

// ---------------------------------------------------------------------------
// 审核状态（AI 解释）
// ---------------------------------------------------------------------------

export const AI_EXPLANATION_STATUSES = ['pending', 'approved', 'rejected', 'failed'] as const
export type AiExplanationStatus = (typeof AI_EXPLANATION_STATUSES)[number]

// ---------------------------------------------------------------------------
// 错误分类（AI 解释失败）
// ---------------------------------------------------------------------------

export const AI_EXPLANATION_FAILURE_CODES = [
  'budget_blocked',
  'provider_timeout',
  'schema_invalid',
  'rate_limited',
  'unauthorized',
  'unknown',
] as const
export type AiExplanationFailureCode = (typeof AI_EXPLANATION_FAILURE_CODES)[number]

// ---------------------------------------------------------------------------
// 数据源可见性
// ---------------------------------------------------------------------------

export const EVIDENCE_VISIBILITY = ['full', 'summary_only', 'forbidden'] as const
export type EvidenceVisibility = (typeof EVIDENCE_VISIBILITY)[number]

// ---------------------------------------------------------------------------
// Warning
// ---------------------------------------------------------------------------

export interface PredictionDataWarning {
  code: string
  message: string
  blocking: boolean
  signalType?: PredictionSignalType
}

// ---------------------------------------------------------------------------
// 证据引用（低敏化）
// ---------------------------------------------------------------------------

export interface PredictionEvidenceRef {
  entityType: string
  entityId: number
  summaryHash: string
  displaySummary: string
  visibility: EvidenceVisibility
}

// ---------------------------------------------------------------------------
// 预测信号
// ---------------------------------------------------------------------------

export interface PredictionSignal {
  id: number
  snapshotId: number
  signalType: PredictionSignalType
  severity: PredictionSeverity
  score: number
  confidenceBand: PredictionConfidenceBand
  confidenceLower?: number
  confidenceUpper?: number
  ruleId: string
  ruleVersion: string
  description: string
  evidenceRefs: PredictionEvidenceRef[]
  expiresAt: string
  createdAt: string
}

export interface PredictionSignalInput {
  signalType: PredictionSignalType
  severity: PredictionSeverity
  score: number
  confidenceBand: PredictionConfidenceBand
  confidenceLower?: number
  confidenceUpper?: number
  ruleId: string
  ruleVersion: string
  description: string
  evidenceRefs: PredictionEvidenceRef[]
}

// ---------------------------------------------------------------------------
// AI 解释
// ---------------------------------------------------------------------------

export interface PredictionAiExplanation {
  narrative: string
  focusPoints: string[]
  suggestedActions: string[]
  assumptions: string[]
  confidence: number
  provider: string | null
  model: string | null
  status: AiExplanationStatus
  failureCode: AiExplanationFailureCode | null
  failureMessage: string | null
  outputHash: string | null
  costSummary: AiCostSummary | null
  approvedBy: number | null
  approvedAt: string | null
  rejectedBy: number | null
  rejectedAt: string | null
  rejectReason: string | null
  generatedAt: string | null
}

export interface AiCostSummary {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  totalCost: number
  currency: string
  latencyMs: number
}

// ---------------------------------------------------------------------------
// 确认信息
// ---------------------------------------------------------------------------

export interface PredictionConfirmation {
  status: PredictionSnapshotStatus
  confirmedBy: number | null
  confirmedAt: string | null
  confirmedNotes: string | null
  dismissedBy: number | null
  dismissedAt: string | null
  dismissReason: string | null
}

// ---------------------------------------------------------------------------
// 快照完整实体
// ---------------------------------------------------------------------------

export interface PredictionSnapshot {
  id: number
  organizationId: number
  projectId: number
  window: PredictionWindow
  status: PredictionSnapshotStatus
  ruleVersion: string
  inputSignature: string
  outputHash: string
  sourceHash: string
  signals: PredictionSignal[]
  warnings: PredictionDataWarning[]
  aiExplanation: PredictionAiExplanation | null
  confirmation: PredictionConfirmation
  generatedBy: number
  generatedAt: string
  stale: boolean
  staleReason: string | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// 列表项（瘦版本）
// ---------------------------------------------------------------------------

export interface PredictionSnapshotListItem {
  id: number
  projectId: number
  window: PredictionWindow
  status: PredictionSnapshotStatus
  signalCount: number
  criticalCount: number
  highCount: number
  maxSeverity: PredictionSeverity
  ruleVersion: string
  inputSignature: string
  stale: boolean
  generatedBy: number
  generatedAt: string
  confirmedBy: number | null
  confirmedAt: string | null
}

// ---------------------------------------------------------------------------
// Dashboard 摘要（轻量，只读）
// ---------------------------------------------------------------------------

export interface DashboardPredictionSummary {
  snapshotId: number | null
  window: PredictionWindow | null
  status: PredictionSnapshotStatus | null
  signalCount: number
  criticalCount: number
  highCount: number
  maxSeverity: PredictionSeverity | null
  stale: boolean
  staleReason: string | null
  warnings: PredictionDataWarning[]
  available: boolean
  confirmedAt: string | null
  hasAiExplanation: boolean
}

// ---------------------------------------------------------------------------
// API 请求/响应类型
// ---------------------------------------------------------------------------

export interface CreatePredictionRequest {
  window: PredictionWindow
}

export interface CreatePredictionResponse {
  data: PredictionSnapshot
  warnings: PredictionDataWarning[]
}

export interface ListPredictionsQuery {
  status?: PredictionSnapshotStatus
  window?: PredictionWindow
  page?: number
  perPage?: number
  sort?: string
}

export interface ListPredictionsResponse {
  data: PredictionSnapshotListItem[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface GetPredictionResponse {
  data: PredictionSnapshot
}

export interface ConfirmPredictionRequest {
  notes?: string
}

export interface ConfirmPredictionResponse {
  data: PredictionSnapshot
}

export interface DismissPredictionRequest {
  reason: string
}

export interface DismissPredictionResponse {
  data: PredictionSnapshot
}

export interface GenerateAiExplanationRequest {
  idempotencyKey?: string
}

export interface GenerateAiExplanationResponse {
  data: PredictionAiExplanation
}

export interface ApproveAiExplanationRequest {
  notes?: string
}

export interface ApproveAiExplanationResponse {
  data: PredictionSnapshot
}

export interface RejectAiExplanationRequest {
  reason: string
}

export interface RejectAiExplanationResponse {
  data: PredictionSnapshot
}
