// @aiproj/types — PMO AI 优先级推荐共享契约（前后端共享）。
// v3-pmo-ai-priority-recommendations §2: DTOs, candidate helpers, lifecycle, warnings, fixtures.

import type {
  RecommendationSource,
  RecommendationStatus,
  RecommendationSeverity,
  RecommendationAiMetadata,
  RecommendationTargetRef,
  RecommendationEvidenceRef,
  RecommendationActionType,
} from './recommendation.js'

// ---------------------------------------------------------------------------
// PMO 推荐来源（复用 RecommendationSource + 新增 PMO 专用来源）
// ---------------------------------------------------------------------------

/** PMO 专用推荐来源。 */
export const PMO_RECOMMENDATION_SOURCES = [
  'priority_scoring',
  'portfolio_dashboard',
  'traffic_light',
  'investment_distribution',
  'freshness_stale',
  'project_recommendation',
] as const
export type PmoRecommendationSource = (typeof PMO_RECOMMENDATION_SOURCES)[number]

export const PMO_RECOMMENDATION_SOURCE_LABELS: Record<PmoRecommendationSource, string> = {
  priority_scoring: '优先级评分',
  portfolio_dashboard: '组合 Dashboard',
  traffic_light: '交通灯',
  investment_distribution: '投入分布',
  freshness_stale: '数据新鲜度',
  project_recommendation: '项目推荐',
}

/** 合并来源（PMO 来源 + 项目级来源引用）。 */
export type PmoFullSource = PmoRecommendationSource | RecommendationSource

// ---------------------------------------------------------------------------
// AI 状态（PMO 推荐特有的 AI 状态维度）
// ---------------------------------------------------------------------------

export const PMO_AI_STATUSES = [
  'none',
  'generating',
  'available',
  'stale',
  'failed',
  'unavailable',
] as const
export type PmoAiStatus = (typeof PMO_AI_STATUSES)[number]

export const PMO_AI_STATUS_LABELS: Record<PmoAiStatus, string> = {
  none: '无 AI 理由',
  generating: '生成中',
  available: '可用',
  stale: '已过期',
  failed: '生成失败',
  unavailable: '不可用',
}

// ---------------------------------------------------------------------------
// 推荐生命周期状态（复用 RecommendationStatus，新增 PMO 语义）
// ---------------------------------------------------------------------------

export { RECOMMENDATION_STATUSES, RECOMMENDATION_STATUS_LABELS } from './recommendation.js'
export type PmoRecommendationStatus = RecommendationStatus

/** PMO 推荐允许的状态流转。 */
export const PMO_RECOMMENDATION_TRANSITIONS: Record<
  PmoRecommendationStatus,
  PmoRecommendationStatus[]
> = {
  new: ['reviewing', 'accepted', 'dismissed', 'snoozed', 'expired'],
  reviewing: ['accepted', 'dismissed', 'snoozed', 'converted', 'expired'],
  accepted: ['converted', 'expired'],
  dismissed: ['new', 'expired'],
  snoozed: ['new', 'reviewing', 'accepted', 'dismissed', 'expired'],
  converted: ['expired'],
  expired: ['new'],
}

// ---------------------------------------------------------------------------
// 审查动作类型
// ---------------------------------------------------------------------------

export const PMO_REVIEW_ACTIONS = [
  'accept',
  'dismiss',
  'snooze',
  'convert',
  'generate_ai_rationale',
  'regenerate_ai_rationale',
] as const
export type PmoReviewAction = (typeof PMO_REVIEW_ACTIONS)[number]

// ---------------------------------------------------------------------------
// Warning 代码
// ---------------------------------------------------------------------------

export const PMO_RECOMMENDATION_WARNING_CODES = {
  PRIORITY_SCORING_UNAVAILABLE: 'PRIORITY_SCORING_UNAVAILABLE',
  PRIORITY_SCORING_STALE: 'PRIORITY_SCORING_STALE',
  PRIORITY_SCORING_FORBIDDEN: 'PRIORITY_SCORING_FORBIDDEN',
  DASHBOARD_UNAVAILABLE: 'DASHBOARD_UNAVAILABLE',
  TRAFFIC_LIGHT_UNAVAILABLE: 'TRAFFIC_LIGHT_UNAVAILABLE',
  TRAFFIC_LIGHT_FORBIDDEN: 'TRAFFIC_LIGHT_FORBIDDEN',
  INVESTMENT_UNAVAILABLE: 'INVESTMENT_UNAVAILABLE',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  AI_FAILED: 'AI_FAILED',
  AI_BUDGET_EXCEEDED: 'AI_BUDGET_EXCEEDED',
  CANDIDATE_STALE: 'CANDIDATE_STALE',
  CANDIDATE_EXPIRED: 'CANDIDATE_EXPIRED',
  CANDIDATE_DUPLICATE: 'CANDIDATE_DUPLICATE',
  PORTFOLIO_EMPTY: 'PORTFOLIO_EMPTY',
  PERMISSION_REDACTED: 'PERMISSION_REDACTED',
  EVIDENCE_RESTRICTED: 'EVIDENCE_RESTRICTED',
  SCORE_UNAVAILABLE: 'SCORE_UNAVAILABLE',
  DIMENSION_REDACTED: 'DIMENSION_REDACTED',
} as const
export type PmoRecommendationWarningCode =
  (typeof PMO_RECOMMENDATION_WARNING_CODES)[keyof typeof PMO_RECOMMENDATION_WARNING_CODES]

export interface PmoRecommendationWarning {
  code: PmoRecommendationWarningCode
  message: string
  source?: PmoFullSource
  blocking: boolean
}

// ---------------------------------------------------------------------------
// 严重度上下文（PMO 增强）
// ---------------------------------------------------------------------------

export interface PmoPriorityContext {
  /** 确定性优先级评分（来自 priority scoring model，不可用时为 null）。 */
  priorityScore: number | null
  /** 优先级等级。 */
  priorityLevel: 'critical' | 'high' | 'medium' | 'low' | 'unavailable'
  /** 组织内排名（1-based，不可用时为 null）。 */
  rank: number | null
  /** 权重版本。 */
  weightVersion: string | null
  /** 最高贡献维度键列表。 */
  topDimensionContributors: string[]
  /** 评分来源是否可用。 */
  scoringAvailable: boolean
}

// ---------------------------------------------------------------------------
// 来源信号摘要
// ---------------------------------------------------------------------------

export interface PmoSourceSignal {
  source: PmoFullSource
  /** 低敏信号摘要文本。 */
  summary: string
  /** 信号严重度。 */
  severity: RecommendationSeverity
  /** 是否可用。 */
  available: boolean
  /** 受限时返回的 warning。 */
  warnings: PmoRecommendationWarning[]
  /** 来源数据新鲜度时间戳。 */
  refreshedAt: string | null
  /** 是否过期。 */
  stale: boolean
}

// ---------------------------------------------------------------------------
// PMO 推荐候选（Adapter 输出 → Service 输入）
// ---------------------------------------------------------------------------

export interface PmoRecommendationCandidate {
  /** 候选类型。 */
  candidateType: PmoRecommendationSource
  /** 目标项目 ID。 */
  projectId: number
  /** 目标引用（可选，用于跳转）。 */
  targetRef: RecommendationTargetRef | null
  /** 推荐标题。 */
  title: string
  /** 推荐摘要（低敏）。 */
  summary: string
  /** 建议动作说明文本。 */
  suggestedAction: string
  /** 动作类型。 */
  actionType: RecommendationActionType
  /** 严重度。 */
  severity: RecommendationSeverity
  /** 优先级上下文。 */
  priorityContext: PmoPriorityContext
  /** 来源信号列表。 */
  sourceSignals: PmoSourceSignal[]
  /** 证据引用。 */
  evidenceRefs: RecommendationEvidenceRef[]
  /** 去重键。 */
  dedupeKey: string
  /** 输入签名。 */
  inputSignature: string
  /** 候选版本。 */
  candidateVersion: string
  /** 过期时间。 */
  expiresAt: string | null
  /** 生成的警告。 */
  warnings: PmoRecommendationWarning[]
}

// ---------------------------------------------------------------------------
// PMO 推荐记录（持久化）
// ---------------------------------------------------------------------------

export interface PmoRecommendationRecord {
  id: number
  organizationId: number
  projectId: number
  sourceType: PmoRecommendationSource
  sourceId: string
  title: string
  summary: string
  suggestedAction: string
  actionType: RecommendationActionType
  severity: RecommendationSeverity
  priorityContext: PmoPriorityContext
  sourceSignals: PmoSourceSignal[]
  evidenceRefs: RecommendationEvidenceRef[]
  status: PmoRecommendationStatus
  dedupeKey: string
  inputSignature: string
  candidateVersion: string
  warnings: PmoRecommendationWarning[]
  aiMetadata: RecommendationAiMetadata | null
  aiStatus: PmoAiStatus
  expiresAt: string | null
  stale: boolean
  staleReason: string | null
  createdBy: number
  handledBy: number | null
  handledAt: string | null
  snoozedUntil: string | null
  reviewReason: string | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// PMO 推荐列表项（瘦版本，用于队列展示）
// ---------------------------------------------------------------------------

export interface PmoRecommendationQueueItem {
  id: number
  projectId: number
  projectName: string
  sourceType: PmoRecommendationSource
  title: string
  summary: string
  severity: RecommendationSeverity
  priorityContext: PmoPriorityContext
  status: PmoRecommendationStatus
  aiStatus: PmoAiStatus
  sourceSignalCount: number
  warningCount: number
  stale: boolean
  expiresAt: string | null
  createdAt: string
  handledBy: number | null
  handledAt: string | null
}

// ---------------------------------------------------------------------------
// PMO 推荐摘要
// ---------------------------------------------------------------------------

export interface PmoRecommendationSummary {
  totalCount: number
  newCount: number
  reviewingCount: number
  acceptedCount: number
  dismissedCount: number
  convertedCount: number
  criticalCount: number
  highCount: number
  staleCount: number
  aiAvailableCount: number
  maxSeverity: RecommendationSeverity | null
  scoringAvailable: boolean
  scoringStale: boolean
  topRecommendations: PmoRecommendationQueueItem[]
  warnings: PmoRecommendationWarning[]
  generatedAt: string | null
}

// ---------------------------------------------------------------------------
// PMO 推荐详情
// ---------------------------------------------------------------------------

export interface PmoRecommendationDetail {
  record: PmoRecommendationRecord
  sourceWarnings: PmoRecommendationWarning[]
  conversionIntents: PmoConversionIntent[]
}

// ---------------------------------------------------------------------------
// AI 理由元数据（PMO 增强版）
// ---------------------------------------------------------------------------

export interface PmoAiRationaleMetadata {
  /** 底层 AI 元数据（来自 AIGateway）。 */
  aiMetadata: RecommendationAiMetadata
  /** AI 生成的简体中文理由文本。 */
  rationaleText: string | null
  /** AI 生成的追问问题列表。 */
  followUpQuestions: string[]
  /** AI 建议的行动文案草案。 */
  suggestedActionDrafts: string[]
  /** 输入签名（用于校验输入未被篡改）。 */
  inputSignature: string
  /** 输出哈希。 */
  outputHash: string
  /** 生成状态。 */
  status: 'none' | 'generating' | 'available' | 'stale' | 'failed'
  /** 生成警告。 */
  warnings: PmoRecommendationWarning[]
  /** 生成时间。 */
  generatedAt: string | null
}

// ---------------------------------------------------------------------------
// 转换意图
// ---------------------------------------------------------------------------

export const PMO_CONVERSION_TARGETS = [
  'risk',
  'change_request',
  'resource_preview',
  'draft_layer',
  'project_priority_review',
] as const
export type PmoConversionTarget = (typeof PMO_CONVERSION_TARGETS)[number]

export interface PmoConversionIntent {
  id: number
  recommendationId: number
  target: PmoConversionTarget
  params: Record<string, unknown>
  status: 'pending' | 'completed' | 'cancelled'
  createdBy: number
  createdAt: string
  completedAt: string | null
}

// ---------------------------------------------------------------------------
// API 查询类型
// ---------------------------------------------------------------------------

/** 队列列表查询参数。 */
export interface PmoRecommendationListQuery {
  status?: PmoRecommendationStatus
  severity?: RecommendationSeverity
  sourceType?: PmoRecommendationSource
  aiStatus?: PmoAiStatus
  stale?: boolean
  priorityLevel?: 'critical' | 'high' | 'medium' | 'low'
  projectId?: number
  q?: string
  page?: number
  perPage?: number
  sort?: PmoRecommendationSortKey
  order?: 'asc' | 'desc'
}

export const PMO_RECOMMENDATION_SORT_KEYS = [
  'priority_score',
  'severity',
  'status',
  'created_at',
  'updated_at',
  'ai_status',
  'project_name',
] as const
export type PmoRecommendationSortKey = (typeof PMO_RECOMMENDATION_SORT_KEYS)[number]

/** 摘要查询参数。 */
export interface PmoRecommendationSummaryQuery {
  includeWarnings?: boolean
  includeTop?: number
}

/** AI 理由请求体。 */
export interface PmoAiRationaleRequest {
  /** 幂等键（可选）。 */
  idempotencyKey?: string
}

/** AI 理由响应体。 */
export interface PmoAiRationaleResponse {
  data: PmoAiRationaleMetadata
}

/** 审查动作请求体。 */
export interface PmoReviewActionRequest {
  action: PmoReviewAction
  reason?: string
  snoozeUntil?: string // ISO date string for snooze
  /** 转换目标（仅 action=convert 时需要）。 */
  convertTarget?: PmoConversionTarget
  /** 转换参数（仅 action=convert 时需要）。 */
  convertParams?: Record<string, unknown>
}

/** 审查动作响应体。 */
export interface PmoReviewActionResponse {
  data: PmoRecommendationRecord
  conversionIntent?: PmoConversionIntent | null
}

// ---------------------------------------------------------------------------
// API 响应信封类型
// ---------------------------------------------------------------------------

/** 队列列表响应。 */
export interface PmoRecommendationListResponse {
  data: PmoRecommendationQueueItem[]
  meta: PmoRecommendationPaginationMeta
  summary: PmoRecommendationSummary
}

/** 推荐详情响应。 */
export interface PmoRecommendationDetailResponse {
  data: PmoRecommendationDetail
}

/** 分页元数据。 */
export interface PmoRecommendationPaginationMeta {
  page: number
  perPage: number
  total: number
  totalPages: number
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const PMO_RECOMMENDATION_MAX_PER_PAGE = 100
export const PMO_RECOMMENDATION_DEFAULT_PER_PAGE = 20
export const PMO_RECOMMENDATION_CANDIDATE_VERSION = 'pmo-ai-priority-recommendations.v1'
export const PMO_RECOMMENDATION_MAX_CANDIDATES_PER_REFRESH = 500
export const PMO_RECOMMENDATION_STALE_THRESHOLD_MINUTES = 60
export const PMO_RECOMMENDATION_DEFAULT_SNOOZE_HOURS = 24
export const PMO_RECOMMENDATION_MAX_AI_RATIONALE_CHARS = 2000
export const PMO_RECOMMENDATION_TOP_DIMENSION_COUNT = 3

// ---------------------------------------------------------------------------
// 确定性候选辅助函数
// ---------------------------------------------------------------------------

/**
 * 计算 PMO 推荐候选的去重键。
 * 基于候选类型、项目 ID、项目上下文生成稳定键。
 */
export function computePmoCandidateDedupeKey(
  candidateType: PmoRecommendationSource,
  projectId: number,
  contextHash: string,
): string {
  return `${PMO_RECOMMENDATION_CANDIDATE_VERSION}:${candidateType}:${projectId}:${contextHash}`
}

/**
 * 计算 PMO 推荐输入签名。
 * 基于所有来源输入的规范化摘要，确保输入未被篡改。
 */
export function computePmoInputSignature(inputs: {
  sourceType: PmoRecommendationSource
  sourceId: string
  projectId: number
  priorityScore: number | null
  signals: string[] // 低敏信号摘要文本列表
}): string {
  const normalized = [
    inputs.sourceType,
    inputs.sourceId,
    String(inputs.projectId),
    inputs.priorityScore?.toFixed(1) ?? 'null',
    ...inputs.signals.map((s) => s.slice(0, 120)),
  ]
    .join('|')
    .toLowerCase()

  // 简单哈希（不可逆、低敏）
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return `sig_${Math.abs(hash).toString(36)}_${inputs.projectId}`
}

/**
 * 判断候选是否过期。
 */
export function isPmoCandidateExpired(_createdAt: string, expiresAt: string | null): boolean {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() <= Date.now()
}

/**
 * 判断候选是否过期（基于生成时间）。
 */
export function isPmoCandidateStale(
  generatedAt: string | null,
  thresholdMinutes: number = PMO_RECOMMENDATION_STALE_THRESHOLD_MINUTES,
): boolean {
  if (!generatedAt) return true
  const generated = new Date(generatedAt).getTime()
  return Date.now() - generated > thresholdMinutes * 60 * 1000
}

// ---------------------------------------------------------------------------
// No-auto-execute 守护函数
// ---------------------------------------------------------------------------

/**
 * 确认推荐处理不会自动修改正式项目事实。
 * 所有返回 true 的动作都是只读或仅影响推荐记录自身的操作。
 */
export function isPmoReadOnlyAction(_action: PmoReviewAction): boolean {
  // accept/dismiss/snooze/convert 只更新推荐状态，不修改项目事实
  // generate_ai_rationale/regenerate_ai_rationale 只触发 AI 生成
  return true
}

/**
 * 确认转换只创建 pending intent，不执行正式写操作。
 */
export function isPmoConversionSafe(_target: PmoConversionTarget): boolean {
  // 所有转换目标都只创建 intent/draft/preview
  return true
}

/**
 * 构建受限维度的占位 warning。
 */
export function pmoDimensionRedactedWarning(dimension: string): PmoRecommendationWarning {
  return {
    code: PMO_RECOMMENDATION_WARNING_CODES.DIMENSION_REDACTED,
    message: `维度 ${dimension} 因权限不足已脱敏`,
    blocking: false,
  }
}

/**
 * 构建来源不可用 warning。
 */
export function pmoSourceUnavailableWarning(source: PmoFullSource): PmoRecommendationWarning {
  return {
    code: PMO_RECOMMENDATION_WARNING_CODES.PRIORITY_SCORING_UNAVAILABLE,
    message: `来源 ${source} 不可用或未启用`,
    source,
    blocking: false,
  }
}

// ---------------------------------------------------------------------------
// 低敏 fixture builders（供测试和开发使用）
// ---------------------------------------------------------------------------

/** 创建可见的、权限正常、无警告的 fixture 候选。 */
export function makeVisiblePmoCandidate(
  projectId: number,
  overrides?: Partial<PmoRecommendationCandidate>,
): PmoRecommendationCandidate {
  return {
    candidateType: 'priority_scoring',
    projectId,
    targetRef: {
      entityType: 'project',
      entityId: projectId,
      displayName: `项目${projectId}`,
      url: `/projects/${projectId}`,
    },
    title: `项目${projectId}需要关注`,
    summary: `基于优先级评分的推荐关注项目${projectId}`,
    suggestedAction: '查看项目详情并评估风险',
    actionType: 'navigate',
    severity: projectId % 3 === 0 ? 'critical' : projectId % 2 === 0 ? 'high' : 'medium',
    priorityContext: {
      priorityScore: 75 - projectId * 0.5,
      priorityLevel: projectId < 3 ? 'critical' : projectId < 6 ? 'high' : 'medium',
      rank: projectId + 1,
      weightVersion: 'priority-scoring.v1',
      topDimensionContributors: ['delivery_urgency', 'risk_exposure'],
      scoringAvailable: true,
    },
    sourceSignals: [
      {
        source: 'priority_scoring',
        summary: `项目${projectId}优先级评分 ${75 - projectId * 0.5}`,
        severity: 'medium',
        available: true,
        warnings: [],
        refreshedAt: new Date().toISOString(),
        stale: false,
      },
    ],
    evidenceRefs: [],
    dedupeKey: `pmo-ai-priority-recommendations.v1:priority_scoring:${projectId}:visible`,
    inputSignature: `sig_visible_${projectId}`,
    candidateVersion: PMO_RECOMMENDATION_CANDIDATE_VERSION,
    expiresAt: null,
    warnings: [],
    ...overrides,
  }
}

/** 创建权限受限的 fixture 候选。 */
export function makeRestrictedPmoCandidate(projectId: number): PmoRecommendationCandidate {
  return {
    candidateType: 'portfolio_dashboard',
    projectId,
    targetRef: {
      entityType: 'project',
      entityId: projectId,
      displayName: null, // 受限：隐藏项目名
      url: null,
    },
    title: '受限项目',
    summary: '因权限不足，部分信息已脱敏',
    suggestedAction: '联系项目负责人获取更多信息',
    actionType: 'navigate',
    severity: 'info',
    priorityContext: {
      priorityScore: null,
      priorityLevel: 'unavailable',
      rank: null,
      weightVersion: null,
      topDimensionContributors: [],
      scoringAvailable: false,
    },
    sourceSignals: [],
    evidenceRefs: [],
    dedupeKey: `pmo-ai-priority-recommendations.v1:portfolio_dashboard:${projectId}:restricted`,
    inputSignature: `sig_restricted_${projectId}`,
    candidateVersion: PMO_RECOMMENDATION_CANDIDATE_VERSION,
    expiresAt: null,
    warnings: [pmoDimensionRedactedWarning('risk'), pmoDimensionRedactedWarning('resource')],
  }
}

/** 创建过期候选 fixture。 */
export function makeStalePmoCandidate(projectId: number): PmoRecommendationCandidate {
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  return {
    ...makeVisiblePmoCandidate(projectId),
    sourceSignals: [
      {
        source: 'priority_scoring',
        summary: '数据已过期',
        severity: 'info',
        available: true,
        warnings: [
          {
            code: PMO_RECOMMENDATION_WARNING_CODES.CANDIDATE_STALE,
            message: '推荐候选数据已超过新鲜度阈值',
            source: 'priority_scoring',
            blocking: false,
          },
        ],
        refreshedAt: past,
        stale: true,
      },
    ],
    warnings: [
      {
        code: PMO_RECOMMENDATION_WARNING_CODES.CANDIDATE_STALE,
        message: '推荐候选数据已超过新鲜度阈值',
        blocking: false,
      },
    ],
    dedupeKey: `pmo-ai-priority-recommendations.v1:priority_scoring:${projectId}:stale`,
  }
}

/** 创建 AI 不可用 fixture 候选。 */
export function makeAiUnavailablePmoCandidate(projectId: number): PmoRecommendationCandidate {
  return {
    ...makeVisiblePmoCandidate(projectId),
    dedupeKey: `pmo-ai-priority-recommendations.v1:priority_scoring:${projectId}:ai-unavailable`,
    warnings: [
      {
        code: PMO_RECOMMENDATION_WARNING_CODES.AI_UNAVAILABLE,
        message: 'AI 服务不可用，无法生成推荐理由',
        blocking: false,
      },
    ],
  }
}

/** 创建重复候选 fixture（用于测试去重）。 */
export function makeDuplicatePmoCandidate(
  projectId: number,
  variant: number,
): PmoRecommendationCandidate {
  return {
    ...makeVisiblePmoCandidate(projectId),
    candidateType: variant % 2 === 0 ? 'priority_scoring' : 'portfolio_dashboard',
    title: `重复候选 v${variant}`,
    dedupeKey: `pmo-ai-priority-recommendations.v1:priority_scoring:${projectId}:visible`,
  }
}

/** 批量创建大组合 fixture 候选。 */
export function makeLargePortfolioPmoCandidates(count: number): PmoRecommendationCandidate[] {
  return Array.from({ length: count }, (_, i) => makeVisiblePmoCandidate(i + 1))
}
