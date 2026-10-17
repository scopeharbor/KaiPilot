import type { AiMarker } from './ai-m0.js'

/**
 * risk-register-and-ai-suggestions —— 风险登记册与 AI 建议前后端共享类型。
 *
 * 纯静态类型 + const 数组，零运行时依赖。
 */

// ---------------------------------------------------------------------------
// 风险类别（八枚举）
// ---------------------------------------------------------------------------

export const RISK_CATEGORIES = [
  'technical',
  'schedule',
  'cost',
  'resource',
  'external',
  'organizational',
  'legal',
  'other',
] as const
export type RiskCategory = (typeof RISK_CATEGORIES)[number]

// ---------------------------------------------------------------------------
// 风险状态（六枚举）+ 合法转换表
// ---------------------------------------------------------------------------

export const RISK_STATUSES = [
  'identified',
  'analyzing',
  'mitigating',
  'resolved',
  'accepted',
  'closed',
] as const
export type RiskStatus = (typeof RISK_STATUSES)[number]

/**
 * 显式合法状态转换表（design D4）。
 * 值为目标状态数组；空数组表示终态。
 */
export const RISK_ALLOWED_TRANSITIONS: Record<RiskStatus, readonly RiskStatus[]> = {
  identified: ['analyzing', 'accepted', 'closed'],
  analyzing: ['mitigating', 'accepted', 'closed'],
  mitigating: ['resolved', 'analyzing', 'closed'],
  resolved: ['closed', 'mitigating'],
  accepted: ['closed', 'analyzing'],
  closed: [],
}

// ---------------------------------------------------------------------------
// 风险来源
// ---------------------------------------------------------------------------

export const RISK_SOURCES = ['manual', 'ai_suggestion', 'ai_draft', 'rule_engine'] as const
export type RiskSource = (typeof RISK_SOURCES)[number]

// ---------------------------------------------------------------------------
// V2 风险等级
// ---------------------------------------------------------------------------

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const
export type RiskLevel = (typeof RISK_LEVELS)[number]

// ---------------------------------------------------------------------------
// V2 优先级
// ---------------------------------------------------------------------------

export const RISK_PRIORITIES = ['low', 'medium', 'high', 'critical', 'normal'] as const
export type RiskPriority = (typeof RISK_PRIORITIES)[number]

// ---------------------------------------------------------------------------
// V2 关闭原因
// ---------------------------------------------------------------------------

export const RISK_CLOSED_REASONS = [
  'resolved',
  'accepted',
  'mitigated',
  'obsolete',
  'transferred',
  'other',
] as const
export type RiskClosedReason = (typeof RISK_CLOSED_REASONS)[number]

// ---------------------------------------------------------------------------
// V2 应对计划策略类型
// ---------------------------------------------------------------------------

export const RESPONSE_STRATEGY_TYPES = [
  'avoid',
  'mitigate',
  'transfer',
  'accept',
  'contingency',
  'escalate',
] as const
export type ResponseStrategyType = (typeof RESPONSE_STRATEGY_TYPES)[number]

// ---------------------------------------------------------------------------
// V2 应对计划状态
// ---------------------------------------------------------------------------

export const RESPONSE_PLAN_STATUSES = [
  'planned',
  'in_progress',
  'completed',
  'cancelled',
  'overdue',
] as const
export type ResponsePlanStatus = (typeof RESPONSE_PLAN_STATUSES)[number]

// ---------------------------------------------------------------------------
// V2 风险历史事件类型
// ---------------------------------------------------------------------------

export const RISK_HISTORY_EVENT_TYPES = [
  'created',
  'field_changed',
  'status_changed',
  'risk_level_changed',
  'reviewed',
  'response_plan_created',
  'response_plan_updated',
  'response_plan_completed',
  'candidate_accepted',
  'candidate_rejected',
  'closed',
  'reopened',
] as const
export type RiskHistoryEventType = (typeof RISK_HISTORY_EVENT_TYPES)[number]

// ---------------------------------------------------------------------------
// V2 候选状态
// ---------------------------------------------------------------------------

export const RISK_CANDIDATE_STATUSES = ['pending', 'accepted', 'rejected', 'expired'] as const
export type RiskCandidateStatus = (typeof RISK_CANDIDATE_STATUSES)[number]

// ---------------------------------------------------------------------------
// V2 风险矩阵配置默认分区
// ---------------------------------------------------------------------------

export const DEFAULT_MATRIX_ZONES = [
  {
    name: 'low',
    probabilityFrom: 1,
    probabilityTo: 2,
    impactFrom: 1,
    impactTo: 2,
    color: '#22c55e',
    level: 'low',
  },
  {
    name: 'medium',
    probabilityFrom: 2,
    probabilityTo: 4,
    impactFrom: 2,
    impactTo: 4,
    color: '#eab308',
    level: 'medium',
  },
  {
    name: 'high',
    probabilityFrom: 3,
    probabilityTo: 5,
    impactFrom: 3,
    impactTo: 5,
    color: '#f97316',
    level: 'high',
  },
  {
    name: 'critical',
    probabilityFrom: 4,
    probabilityTo: 5,
    impactFrom: 4,
    impactTo: 5,
    color: '#ef4444',
    level: 'critical',
  },
] as const

// ---------------------------------------------------------------------------
// AI 元数据（risks.ai_metadata JSON 结构）
// ---------------------------------------------------------------------------

export interface RiskAiMetadata {
  aiMarker?: AiMarker
  suggestionBatchId?: string
  sourceDraftId?: string
  sourceDraftVersion?: number
  /**
   * @deprecated 使用 prompt-version-registry 替代。保留此字段以兼容历史数据；
   * 新代码应通过注册表查询 prompt 版本，不再在此处写入。
   */
  promptVersion?: string
}

// ---------------------------------------------------------------------------
// Risk 实体（对齐 sec7.2.1 + stage2d 表定义）
// ---------------------------------------------------------------------------

export interface Risk {
  id: number
  organizationId: number
  projectId: number
  riskCode: string | null
  title: string
  description: string
  category: RiskCategory
  probability: number
  impact: number
  score: number
  status: RiskStatus
  mitigationStrategy: string | null
  contingencyPlan: string | null
  ownerId: number | null
  triggerEvent: string | null
  residualProbability: number | null
  residualImpact: number | null
  residualScore: number | null
  // V2 扩展字段
  riskLevel: string
  priority: string
  triggerCondition: string | null
  nextReviewAt: string | null
  lastReviewAt: string | null
  closedReason: string | null
  closedNotes: string | null
  identifiedAt: string
  targetResolutionDate: string | null
  resolvedAt: string | null
  relatedTaskId: number | null
  aiMetadata: RiskAiMetadata | null
  createdBy: number
  updatedBy: number | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// AI 风险建议候选（RiskSuggestionService 响应体）
// ---------------------------------------------------------------------------

export interface RiskAiSuggestion {
  title: string
  description: string
  category: RiskCategory
  probability: number
  impact: number
  suggestedMitigation: string
  aiMarker: AiMarker
  suggestionBatchId: string
}

// ---------------------------------------------------------------------------
// 5×5 矩阵聚合
// ---------------------------------------------------------------------------

export const RISK_MATRIX_BASIS = ['inherent', 'residual'] as const
export type RiskMatrixBasis = (typeof RISK_MATRIX_BASIS)[number]

export interface RiskMatrixCell {
  probability: number
  impact: number
  count: number
  topRiskIds: number[]
}

// ---------------------------------------------------------------------------
// 互转类型：RiskHintPayload ↔ Risk（ai-draft-generation 侧使用）
// ---------------------------------------------------------------------------

export interface RiskHintPayload {
  id: string
  title: string
  description: string
  category: RiskCategory
  probability: number
  impact: number
  mitigation: string
  aiMarker: AiMarker
  sourceDraftId?: string
  sourceDraftVersion?: number
}

// ---------------------------------------------------------------------------
// V2 风险应对计划
// ---------------------------------------------------------------------------

export interface RiskResponsePlan {
  id: number
  organizationId: number
  projectId: number
  riskId: number
  strategyType: ResponseStrategyType
  actionDescription: string
  ownerId: number | null
  targetDate: string | null
  status: ResponsePlanStatus
  relatedTaskId: number | null
  completionEvidence: string | null
  completedAt: string | null
  auditLogId: number | null
  createdBy: number
  updatedBy: number | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// V2 风险历史
// ---------------------------------------------------------------------------

export interface RiskHistory {
  id: number
  organizationId: number
  projectId: number
  riskId: number
  eventType: RiskHistoryEventType
  actorId: number | null
  summary: Record<string, unknown> | null
  sourceType: string
  sourceRef: string | null
  occurredAt: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// V2 风险矩阵配置
// ---------------------------------------------------------------------------

export interface RiskMatrixZone {
  name: string
  probabilityFrom: number
  probabilityTo: number
  impactFrom: number
  impactTo: number
  color: string
  level: RiskLevel
}

export interface RiskMatrixConfig {
  id: number
  organizationId: number
  projectId: number
  probabilityLevels: number
  impactLevels: number
  zones: RiskMatrixZone[]
  defaultBasis: 'inherent' | 'residual'
  cellLimit: number
  isActive: boolean
  createdBy: number | null
  updatedBy: number | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// V2 风险信号候选
// ---------------------------------------------------------------------------

export interface RiskSignalCandidate {
  id: number
  organizationId: number
  projectId: number
  ruleId: string
  ruleVersion: string
  severity: RiskLevel
  evidence: Record<string, unknown>[]
  recommendedAction: string
  confidence: number
  source: string
  templateId: number | null
  idempotencyKey: string
  expiresAt: string
  status: RiskCandidateStatus
  resolvedBy: number | null
  resolvedAt: string | null
  acceptedRiskId: number | null
  auditLogId: number | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// V2 风险知识库模板
// ---------------------------------------------------------------------------

export interface RiskKnowledgeTemplate {
  id: number
  organizationId: number | null
  title: string
  description: string
  category: RiskCategory
  applicableProjectTypes: string[] | null
  triggerConditions: Record<string, unknown> | null
  suggestedProbability: number | null
  suggestedImpact: number | null
  suggestedResponse: Record<string, unknown> | null
  source: string
  isActive: boolean
  templateType: 'system' | 'organization'
  createdBy: number | null
  updatedBy: number | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// V2 风险工作台摘要
// ---------------------------------------------------------------------------

export interface RiskWorkbenchSummary {
  totalRisks: number
  openRisks: number
  highRiskCount: number
  criticalRiskCount: number
  overdueReviewCount: number
  incompleteResponsePlans: number
  trend30d: { created: number; closed: number }
  healthScore: number | null
  topRisks: Array<{ id: number; title: string; riskLevel: RiskLevel; score: number }>
}

// ---------------------------------------------------------------------------
// V2 风险趋势
// ---------------------------------------------------------------------------

export interface RiskTrendPoint {
  date: string
  created: number
  closed: number
  totalOpen: number
}

// ---------------------------------------------------------------------------
// V2 复查队列
// ---------------------------------------------------------------------------

export interface RiskReviewItem {
  id: number
  title: string
  riskLevel: RiskLevel
  score: number
  nextReviewAt: string | null
  lastReviewAt: string | null
  ownerId: number | null
}
