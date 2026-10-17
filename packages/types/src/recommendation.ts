// @aiproj/types — V2 AI 智能推荐共享契约（前后端共享）
// v2-ai-smart-recommendations

// ---------------------------------------------------------------------------
// 推荐来源
// ---------------------------------------------------------------------------

export const RECOMMENDATION_SOURCES = [
  'resource',
  'risk',
  'change_impact',
  'dashboard',
  'report',
  'health_diagnosis',
  'prediction',
  'weekly_report',
  'monthly_report',
  'manual',
] as const
export type RecommendationSource = (typeof RECOMMENDATION_SOURCES)[number]

export const RECOMMENDATION_SOURCE_LABELS: Record<RecommendationSource, string> = {
  resource: '资源管理',
  risk: '风险管理',
  change_impact: '变更影响分析',
  dashboard: 'Dashboard 指标',
  report: '报表数据',
  health_diagnosis: '健康诊断',
  prediction: '风险与进度预测',
  weekly_report: '周报',
  monthly_report: '月报',
  manual: '手动触发',
}

// ---------------------------------------------------------------------------
// 推荐状态
// ---------------------------------------------------------------------------

export const RECOMMENDATION_STATUSES = [
  'new',
  'reviewing',
  'accepted',
  'dismissed',
  'snoozed',
  'converted',
  'expired',
] as const
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number]

export const RECOMMENDATION_STATUS_LABELS: Record<RecommendationStatus, string> = {
  new: '新推荐',
  reviewing: '审查中',
  accepted: '已采纳',
  dismissed: '已忽略',
  snoozed: '稍后处理',
  converted: '已转换',
  expired: '已过期',
}

/** 允许的状态流转 */
export const RECOMMENDATION_TRANSITIONS: Record<RecommendationStatus, RecommendationStatus[]> = {
  new: ['reviewing', 'accepted', 'dismissed', 'snoozed', 'expired'],
  reviewing: ['accepted', 'dismissed', 'snoozed', 'converted', 'expired'],
  accepted: ['converted', 'expired'],
  dismissed: ['new', 'expired'], // 可重新打开
  snoozed: ['new', 'reviewing', 'accepted', 'dismissed', 'expired'],
  converted: ['expired'],
  expired: ['new'], // 可重新激活
}

// ---------------------------------------------------------------------------
// 严重度
// ---------------------------------------------------------------------------

export const RECOMMENDATION_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const
export type RecommendationSeverity = (typeof RECOMMENDATION_SEVERITIES)[number]

export const RECOMMENDATION_SEVERITY_ORDER: RecommendationSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
]

export function recommendationSeverityScore(severity: RecommendationSeverity): number {
  const idx = RECOMMENDATION_SEVERITY_ORDER.indexOf(severity)
  return idx >= 0 ? RECOMMENDATION_SEVERITY_ORDER.length - idx : 0
}

export const RECOMMENDATION_SEVERITY_LABELS: Record<RecommendationSeverity, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  info: '信息',
}

// ---------------------------------------------------------------------------
// 置信度
// ---------------------------------------------------------------------------

export const RECOMMENDATION_CONFIDENCES = ['high', 'medium', 'low'] as const
export type RecommendationConfidence = (typeof RECOMMENDATION_CONFIDENCES)[number]

// ---------------------------------------------------------------------------
// 推荐动作类型
// ---------------------------------------------------------------------------

export const RECOMMENDATION_ACTION_TYPES = [
  'navigate', // 跳转到来源详情
  'create_draft', // 创建领域草稿
  'open_preview', // 打开 preview/diff
  'draft_layer', // 进入 Draft Layer
] as const
export type RecommendationActionType = (typeof RECOMMENDATION_ACTION_TYPES)[number]

// ---------------------------------------------------------------------------
// 权限降级状态
// ---------------------------------------------------------------------------

export const RECOMMENDATION_VISIBILITY = ['full', 'summary_only', 'forbidden'] as const
export type RecommendationVisibility = (typeof RECOMMENDATION_VISIBILITY)[number]

// ---------------------------------------------------------------------------
// Warning
// ---------------------------------------------------------------------------

export interface RecommendationWarning {
  code: string
  message: string
  blocking: boolean
  source?: RecommendationSource
}

// ---------------------------------------------------------------------------
// 证据引用（低敏）
// ---------------------------------------------------------------------------

export interface RecommendationEvidenceRef {
  entityType: string
  entityId: number
  summaryHash: string
  displaySummary: string
  visibility: RecommendationVisibility
}

// ---------------------------------------------------------------------------
// AI 元数据
// ---------------------------------------------------------------------------

export interface RecommendationAiMetadata {
  provider: string | null
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  totalCost: number | null
  currency: string
  latencyMs: number | null
  inputSignature: string | null
  outputHash: string | null
  status: 'pending' | 'approved' | 'rejected' | 'failed'
  failureCode: string | null
  failureMessage: string | null
  narrative: string | null
  focusPoints: string[]
  suggestedActions: string[]
  assumptions: string[]
  confidence: number
  approvedBy: number | null
  approvedAt: string | null
  rejectedBy: number | null
  rejectedAt: string | null
  rejectReason: string | null
  generatedAt: string | null
}

// ---------------------------------------------------------------------------
// 目标引用
// ---------------------------------------------------------------------------

export interface RecommendationTargetRef {
  entityType: string
  entityId: number | null
  displayName: string | null
  url: string | null
}

// ---------------------------------------------------------------------------
// 核心类型
// ---------------------------------------------------------------------------

/** 推荐候选（Adapter 输出 → Service 输入） */
export interface RecommendationCandidate {
  sourceType: RecommendationSource
  sourceId: string
  projectId: number
  targetRef: RecommendationTargetRef
  title: string
  summary: string
  recommendedAction: string
  actionType: RecommendationActionType
  severity: RecommendationSeverity
  urgency: number // 1-10
  confidence: RecommendationConfidence
  impactScope: 'project' | 'milestone' | 'task' | 'resource' | 'risk'
  evidenceRefs: RecommendationEvidenceRef[]
  dedupeKey: string
  expiresAt: string | null
  metadata?: Record<string, unknown>
}

/** 推荐记录（持久化） */
export interface RecommendationRecord {
  id: number
  organizationId: number
  projectId: number
  sourceType: RecommendationSource
  sourceId: string
  targetRef: RecommendationTargetRef
  title: string
  summary: string
  recommendedAction: string
  actionType: RecommendationActionType
  severity: RecommendationSeverity
  priority: number // 确定性评分结果
  confidence: RecommendationConfidence
  status: RecommendationStatus
  dedupeKey: string
  inputSignature: string
  evidenceHash: string
  evidenceRefs: RecommendationEvidenceRef[]
  warnings: RecommendationWarning[]
  aiMetadata: RecommendationAiMetadata | null
  expiresAt: string | null
  stale: boolean
  staleReason: string | null
  createdBy: number
  handledBy: number | null
  handledAt: string | null
  createdAt: string
  updatedAt: string
}

/** 推荐列表项（瘦版本） */
export interface RecommendationListItem {
  id: number
  projectId: number
  sourceType: RecommendationSource
  title: string
  summary: string
  severity: RecommendationSeverity
  priority: number
  status: RecommendationStatus
  dedupeKey: string
  stale: boolean
  expiresAt: string | null
  createdBy: number
  createdAt: string
  handledBy: number | null
  handledAt: string | null
}

/** 推荐摘要（用于 Dashboard/通知） */
export interface RecommendationSummary {
  totalCount: number
  criticalCount: number
  highCount: number
  mediumCount: number
  newCount: number
  acceptedCount: number
  topRecommendations: RecommendationListItem[]
  maxSeverity: RecommendationSeverity | null
  updatedAt: string | null
  available: boolean
  warnings: RecommendationWarning[]
}

/** 推荐动作（导航/创建草稿/打开 preview/进入 Draft Layer） */
export interface RecommendationAction {
  actionType: RecommendationActionType
  label: string
  url: string | null
  draftType: string | null
  draftParams: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// API 请求/响应类型
// ---------------------------------------------------------------------------

export interface ListRecommendationsQuery {
  status?: RecommendationStatus
  sourceType?: RecommendationSource
  severity?: RecommendationSeverity
  targetType?: string
  relatedToMe?: boolean
  stale?: boolean
  q?: string
  page?: number
  perPage?: number
  sort?: string
}

export interface ListRecommendationsResponse {
  data: RecommendationListItem[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
  summary: RecommendationSummary
}

export interface GetRecommendationResponse {
  data: RecommendationRecord
}

export interface RefreshRecommendationsRequest {
  sources?: RecommendationSource[] // 指定来源刷新；不指定则全部
}

export interface RefreshRecommendationsResponse {
  data: RecommendationRecord[]
  warnings: RecommendationWarning[]
  created: number
  merged: number
}

export interface UpdateRecommendationStatusRequest {
  status: RecommendationStatus
  reason?: string
}

export interface UpdateRecommendationStatusResponse {
  data: RecommendationRecord
}

export interface GenerateAiExplanationRequest {
  idempotencyKey?: string
}

export interface GenerateAiExplanationResponse {
  data: RecommendationAiMetadata
}

export interface ApproveAiExplanationRequest {
  notes?: string
}

export interface ApproveAiExplanationResponse {
  data: RecommendationRecord
}

export interface RejectAiExplanationRequest {
  reason: string
}

export interface RejectAiExplanationResponse {
  data: RecommendationRecord
}

export interface ConvertRecommendationRequest {
  /** 转换目标类型：'risk' | 'change_request' | 'resource_preview' | 'draft_layer' */
  convertTo: string
  params?: Record<string, unknown>
}

export interface ConvertRecommendationResponse {
  data: {
    conversionType: string
    targetId: number | null
    targetUrl: string | null
    draftSessionId: number | null
    recommendation: RecommendationRecord
  }
}

// ---------------------------------------------------------------------------
// Dashboard 摘要类型
// ---------------------------------------------------------------------------

export interface DashboardRecommendationSummary {
  pendingCount: number
  criticalCount: number
  maxSeverity: RecommendationSeverity | null
  topRecommendations: Pick<
    RecommendationListItem,
    'id' | 'title' | 'severity' | 'priority' | 'status'
  >[]
  updatedAt: string | null
  available: boolean
  warnings: RecommendationWarning[]
}

// ---------------------------------------------------------------------------
// 通知/活动低敏摘要
// ---------------------------------------------------------------------------

export interface NotificationRecommendationPayload {
  recommendationId: number
  projectId: number
  title: string
  sourceType: RecommendationSource
  severity: RecommendationSeverity
  status: RecommendationStatus
  actionType: RecommendationActionType
  stale: boolean
}

export interface ActivityRecommendationEvent {
  recommendationId: number
  projectId: number
  title: string
  sourceType: RecommendationSource
  action:
    | 'generated'
    | 'merged'
    | 'accepted'
    | 'dismissed'
    | 'snoozed'
    | 'converted'
    | 'expired'
    | 'ai_explanation'
  severity: RecommendationSeverity
}
