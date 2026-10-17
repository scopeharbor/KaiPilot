// @aiproj/types — V3 AI-TRIZ 助手共享契约（前后端共享）
// v3-ai-triz-assistant / §2.1–§2.9
//
// 设计要点：
// - AI-TRIZ 助手是项目级会话式引导层，编排 TRIZ 各审查面
// - 确定性优先：ContextCollector → IntentClassifier → ToolRouter → ActionBuilder → OptionalNarrativeDraft → ResponseAssembler
// - 全部「只建议、不自动执行」；AI 解释可选且可降级；handoff 只停在 preview
// - 不自动写正式项目数据（任务/WBS/依赖/资源/风险/里程碑/排程/范围/项目字段/知识/Skill/决策日志）
// - 低敏：不存完整 prompt、模型输出、原始证据、secret、token、Authorization header、不可访问实体详情

import { deterministicHash } from './triz-contradiction.js'

// ---------------------------------------------------------------------------
// 常量 — 运行状态
// ---------------------------------------------------------------------------

export const AI_TRIZ_ASSISTANT_RUN_STATUSES = [
  'active',
  'completed',
  'completed_with_warnings',
  'failed',
  'archived',
] as const
export type AiTrizAssistantRunStatus = (typeof AI_TRIZ_ASSISTANT_RUN_STATUSES)[number]

// ---------------------------------------------------------------------------
// 常量 — 消息角色
// ---------------------------------------------------------------------------

export const AI_TRIZ_ASSISTANT_MESSAGE_ROLES = ['user', 'assistant', 'system'] as const
export type AiTrizAssistantMessageRole = (typeof AI_TRIZ_ASSISTANT_MESSAGE_ROLES)[number]

// ---------------------------------------------------------------------------
// 常量 — 助手目的地枚举
// ---------------------------------------------------------------------------

export const AI_TRIZ_ASSISTANT_DESTINATIONS = [
  'clarification_cards',
  'contradiction_matrix',
  'technical_contradiction_analyzer',
  'physical_contradiction_analyzer',
  'ifr_visualization',
  'function_analysis_diagram',
  'resource_analyzer',
  'evolution_trend_analysis',
  'recommendation_rationale',
  'innovation_workbench',
  'decision_center',
  'draft_preview',
] as const
export type AiTrizAssistantDestination = (typeof AI_TRIZ_ASSISTANT_DESTINATIONS)[number]

export const AI_TRIZ_ASSISTANT_DESTINATION_LABELS: Record<AiTrizAssistantDestination, string> = {
  clarification_cards: '澄清卡片',
  contradiction_matrix: '矛盾矩阵',
  technical_contradiction_analyzer: '技术矛盾分析器',
  physical_contradiction_analyzer: '物理矛盾分析器',
  ifr_visualization: 'IFR 可视化',
  function_analysis_diagram: '功能分析图',
  resource_analyzer: '资源分析器',
  evolution_trend_analysis: '进化趋势分析',
  recommendation_rationale: '推荐理由',
  innovation_workbench: '创新工作台',
  decision_center: '决策中心',
  draft_preview: 'Draft 预览',
}

// ---------------------------------------------------------------------------
// 常量 — 用户意图
// ---------------------------------------------------------------------------

export const AI_TRIZ_ASSISTANT_INTENTS = [
  'technical_contradiction',
  'physical_contradiction',
  'missing_information',
  'evidence_review',
  'workbench',
  'decision',
  'draft_preview',
  'general_guidance',
] as const
export type AiTrizAssistantIntent = (typeof AI_TRIZ_ASSISTANT_INTENTS)[number]

// ---------------------------------------------------------------------------
// 常量 — 路由决策置信度
// ---------------------------------------------------------------------------

export const AI_TRIZ_ASSISTANT_CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'fallback'] as const
export type AiTrizAssistantConfidenceLevel = (typeof AI_TRIZ_ASSISTANT_CONFIDENCE_LEVELS)[number]

// ---------------------------------------------------------------------------
// 常量 — 警告代码
// ---------------------------------------------------------------------------

export const AI_TRIZ_ASSISTANT_WARNING_CODES = [
  'SOURCE_UNAVAILABLE',
  'SOURCE_STALE',
  'SOURCE_PERMISSION_DENIED',
  'CONTEXT_TRUNCATED',
  'MISSING_INFORMATION',
  'AMBIGUOUS_INTENT',
  'DESTINATION_UNAVAILABLE',
  'AI_FALLBACK',
  'AI_HALLUCINATION_DETECTED',
  'AI_BUDGET_EXCEEDED',
  'AI_PROVIDER_ERROR',
  'STALE_ACTION_BLOCKED',
  'FEATURE_FLAG_DISABLED',
  'CROSS_ORGANIZATION_BLOCKED',
  'INACCESSIBLE_TARGET',
] as const
export type AiTrizAssistantWarningCode = (typeof AI_TRIZ_ASSISTANT_WARNING_CODES)[number]

// ---------------------------------------------------------------------------
// 常量 — 反馈理由
// ---------------------------------------------------------------------------

export const AI_TRIZ_ASSISTANT_FEEDBACK_REASONS = [
  'helpful',
  'not_helpful',
  'incorrect_route',
  'missing_context',
  'outdated',
  'other',
] as const
export type AiTrizAssistantFeedbackReason = (typeof AI_TRIZ_ASSISTANT_FEEDBACK_REASONS)[number]

// ---------------------------------------------------------------------------
// 常量 — AI 退化原因
// ---------------------------------------------------------------------------

export const AI_TRIZ_ASSISTANT_DEGRADED_REASONS = [
  'budget_exceeded',
  'provider_error',
  'hallucination_detected',
  'permission_denied',
  'feature_flag_disabled',
  'timeout',
  'invalid_output',
] as const
export type AiTrizAssistantDegradedReason = (typeof AI_TRIZ_ASSISTANT_DEGRADED_REASONS)[number]

// ---------------------------------------------------------------------------
// 常量 — 排序字段（列表用）
// ---------------------------------------------------------------------------

export const AI_TRIZ_ASSISTANT_SORT_FIELDS = ['createdAt', 'updatedAt', 'status'] as const
export type AiTrizAssistantSortField = (typeof AI_TRIZ_ASSISTANT_SORT_FIELDS)[number]

// ---------------------------------------------------------------------------
// 常量 — 来源类型（与既有 TRIZ 模块对齐）
// ---------------------------------------------------------------------------

export const AI_TRIZ_ASSISTANT_SOURCE_KINDS = [
  'contradiction',
  'contradiction_matrix',
  'technical_contradiction_analysis',
  'physical_contradiction_analysis',
  'ifr_snapshot',
  'function_analysis_snapshot',
  'resource_analysis',
  'evolution_trend_run',
  'recommendation_rationale',
  'innovation_workbench_scheme',
  'decision_log',
  'clarification_card',
  'compiler_triz_artifact',
  'draft_layer',
  'knowledge_summary',
  'skill_summary',
] as const
export type AiTrizAssistantSourceKind = (typeof AI_TRIZ_ASSISTANT_SOURCE_KINDS)[number]

// ---------------------------------------------------------------------------
// DTO — 来源摘要
// ---------------------------------------------------------------------------

export interface AiTrizAssistantSourceSummary {
  readonly sourceKind: AiTrizAssistantSourceKind
  readonly sourceRef: string
  readonly sourceHash: string
  readonly lowSensitivitySummary: string
  readonly freshness: AiTrizAssistantSourceFreshness
  readonly routeHints: AiTrizAssistantDestination[]
  readonly warnings: AiTrizAssistantWarningCode[]
}

export interface AiTrizAssistantSourceFreshness {
  readonly lastUpdatedAt: string
  readonly isStale: boolean
  readonly staleReason?: string
}

// ---------------------------------------------------------------------------
// DTO — 上下文数据包
// ---------------------------------------------------------------------------

export interface AiTrizAssistantContextPacket {
  readonly contextHash: string
  readonly sources: AiTrizAssistantSourceSummary[]
  readonly sourceOrdering: AiTrizAssistantSourceKind[]
  readonly truncated: boolean
  readonly truncationWarning?: string
  readonly permissions: AiTrizAssistantActorPermissions
  readonly featureFlags: AiTrizAssistantFeatureFlags
}

export interface AiTrizAssistantActorPermissions {
  readonly canViewTriz: boolean
  readonly canManageTriz: boolean
  readonly canTriggerAi: boolean
  readonly sourcePermissions: Partial<Record<AiTrizAssistantSourceKind, boolean>>
}

export interface AiTrizAssistantFeatureFlags {
  readonly evolutionTrendAvailable: boolean
  readonly knowledgeBaseAvailable: boolean
  readonly skillSystemAvailable: boolean
}

// ---------------------------------------------------------------------------
// DTO — 路由决策
// ---------------------------------------------------------------------------

export interface AiTrizAssistantRouteDecision {
  readonly routeId: string
  readonly destination: AiTrizAssistantDestination
  readonly confidence: AiTrizAssistantConfidenceLevel
  readonly reason: string
  readonly sourceRefs: string[]
  readonly sourceHashes: string[]
  readonly warnings: AiTrizAssistantWarningCode[]
  readonly order: number
}

// ---------------------------------------------------------------------------
// DTO — 推荐动作
// ---------------------------------------------------------------------------

export interface AiTrizAssistantRecommendedAction {
  readonly actionId: string
  readonly destination: AiTrizAssistantDestination
  readonly actionType: AiTrizAssistantActionType
  readonly label: string
  readonly description: string
  readonly sourceRefs: string[]
  readonly sourceHashes: string[]
  readonly requiredPermissions: string[]
  readonly requiresUserConfirmation: boolean
  readonly isStale: boolean
  readonly staleReason?: string
  readonly idempotencyKey: string
  readonly lowSensitivitySummary: string
  readonly navigationRef?: AiTrizAssistantNavigationRef
  readonly handoffInput?: Record<string, unknown>
}

export const AI_TRIZ_ASSISTANT_ACTION_TYPES = [
  'navigate',
  'open_review',
  'add_to_workbench',
  'generate_preview',
  'record_decision',
  'view_evidence',
  'clarify',
] as const
export type AiTrizAssistantActionType = (typeof AI_TRIZ_ASSISTANT_ACTION_TYPES)[number]

export interface AiTrizAssistantNavigationRef {
  readonly path: string
  readonly label: string
  readonly params?: Record<string, string>
}

// ---------------------------------------------------------------------------
// DTO — 澄清提示
// ---------------------------------------------------------------------------

export interface AiTrizAssistantClarificationPrompt {
  readonly promptId: string
  readonly question: string
  readonly purpose: string
  readonly quickOptions?: string[]
  readonly relatedIntent: AiTrizAssistantIntent
  readonly sourceRefs: string[]
}

// ---------------------------------------------------------------------------
// DTO — AI 叙述（可选）
// ---------------------------------------------------------------------------

export interface AiTrizAssistantAiNarrative {
  readonly text: string
  readonly isFallback: boolean
  readonly degradedReason?: AiTrizAssistantDegradedReason
  readonly provider?: string
  readonly model?: string
  readonly costSummary?: AiTrizAssistantCostSummary
  readonly validationStatus: 'valid' | 'hallucination_rejected' | 'not_validated'
}

export interface AiTrizAssistantCostSummary {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly estimatedCost: number
  readonly latencyMs: number
}

// ---------------------------------------------------------------------------
// DTO — 助手响应
// ---------------------------------------------------------------------------

export interface AiTrizAssistantResponse {
  readonly runId: string
  readonly messageId: string
  readonly intent: AiTrizAssistantIntent
  readonly routeDecisions: AiTrizAssistantRouteDecision[]
  readonly recommendedActions: AiTrizAssistantRecommendedAction[]
  readonly clarificationPrompts: AiTrizAssistantClarificationPrompt[]
  readonly aiNarrative?: AiTrizAssistantAiNarrative
  readonly warnings: AiTrizAssistantWarningCode[]
  readonly fallback: boolean
  readonly degradedReason?: AiTrizAssistantDegradedReason
  readonly costSummary?: AiTrizAssistantCostSummary
  readonly reviewRequired: boolean
  readonly auditRefs: AiTrizAssistantAuditRefs
  readonly createdAt: string
}

export interface AiTrizAssistantAuditRefs {
  readonly runId: string
  readonly routeIds: string[]
  readonly actionIds: string[]
  readonly sourceRefKinds: AiTrizAssistantSourceKind[]
  readonly sourceHashPrefixes: string[]
  readonly warningCodes: AiTrizAssistantWarningCode[]
  readonly fallbackState: boolean
}

// ---------------------------------------------------------------------------
// DTO — 运行摘要（列表用）
// ---------------------------------------------------------------------------

export interface AiTrizAssistantRunSummary {
  readonly runId: string
  readonly status: AiTrizAssistantRunStatus
  readonly intentSummary: string
  readonly messageCount: number
  readonly destinationTypes: AiTrizAssistantDestination[]
  readonly warningCodes: AiTrizAssistantWarningCode[]
  readonly fallback: boolean
  readonly costSummary?: AiTrizAssistantCostSummary
  readonly createdAt: string
  readonly updatedAt: string
}

// ---------------------------------------------------------------------------
// DTO — 消息
// ---------------------------------------------------------------------------

export interface AiTrizAssistantMessage {
  readonly messageId: string
  readonly runId: string
  readonly role: AiTrizAssistantMessageRole
  readonly content: string
  readonly sourceRefs: string[]
  readonly createdAt: string
}

// ---------------------------------------------------------------------------
// DTO — 提交消息请求
// ---------------------------------------------------------------------------

export interface AiTrizAssistantSubmitRequest {
  readonly message: string
  readonly selectedSourceRefs?: string[]
  readonly idempotencyKey?: string
  readonly enableAi?: boolean
}

// ---------------------------------------------------------------------------
// DTO — 反馈
// ---------------------------------------------------------------------------

export interface AiTrizAssistantFeedbackRequest {
  readonly reason: AiTrizAssistantFeedbackReason
  readonly comment?: string
}

export interface AiTrizAssistantFeedbackResponse {
  readonly feedbackId: string
  readonly runId: string
  readonly messageId: string
  readonly reason: AiTrizAssistantFeedbackReason
  readonly recorded: boolean
}

// ---------------------------------------------------------------------------
// DTO — 预览/移交输入
// ---------------------------------------------------------------------------

export interface AiTrizAssistantPreviewRequest {
  readonly actionId: string
  readonly sourceHashes: string[]
}

export interface AiTrizAssistantPreviewResponse {
  readonly actionId: string
  readonly destination: AiTrizAssistantDestination
  readonly staleBlocked: boolean
  readonly staleReason?: string
  readonly previewData: Record<string, unknown>
  readonly sourceRefs: string[]
  readonly sourceHashes: string[]
  readonly requiresUserConfirmation: boolean
}

// ---------------------------------------------------------------------------
// DTO — API 信封
// ---------------------------------------------------------------------------

export interface AiTrizAssistantListRunsResponse {
  readonly data: AiTrizAssistantRunSummary[]
  readonly meta: AiTrizAssistantPaginationMeta
}

export interface AiTrizAssistantRunDetailResponse {
  readonly data: AiTrizAssistantRunDetail
}

export interface AiTrizAssistantRunDetail {
  readonly runId: string
  readonly status: AiTrizAssistantRunStatus
  readonly messages: AiTrizAssistantMessage[]
  readonly latestResponse?: AiTrizAssistantResponse
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AiTrizAssistantSubmitResponse {
  readonly data: AiTrizAssistantResponse
}

export interface AiTrizAssistantPaginationMeta {
  readonly total: number
  readonly page: number
  readonly perPage: number
  readonly totalPages: number
}

export interface AiTrizAssistantListRunsQuery {
  readonly page?: number
  readonly perPage?: number
  readonly status?: AiTrizAssistantRunStatus
  readonly sort?: string
}

// ---------------------------------------------------------------------------
// 纯函数 — ID/哈希生成
// ---------------------------------------------------------------------------

const ID_PREFIX = 'ata'
const MSG_PREFIX = 'atam'
const ROUTE_PREFIX = 'atar'
const ACTION_PREFIX = 'ataa'
const PROMPT_PREFIX = 'atap'
const FEEDBACK_PREFIX = 'ataf'

export function generateAssistantRunId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${ID_PREFIX}_${ts}_${rand}`
}

export function generateAssistantMessageId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${MSG_PREFIX}_${ts}_${rand}`
}

export function generateAssistantRouteDecisionId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${ROUTE_PREFIX}_${ts}_${rand}`
}

export function generateAssistantActionId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${ACTION_PREFIX}_${ts}_${rand}`
}

export function generateAssistantPromptId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${PROMPT_PREFIX}_${ts}_${rand}`
}

export function generateAssistantFeedbackId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${FEEDBACK_PREFIX}_${ts}_${rand}`
}

export function computeAssistantIdempotencyKey(
  input: string,
  sourceHashes: string[],
  actorId: number,
): string {
  const sorted = [...sourceHashes].sort()
  const payload = `${input}|${sorted.join(',')}|${actorId}`
  return deterministicHash(payload)
}

export function computeAssistantSourceHash(summary: string, kind: string): string {
  return deterministicHash(`${kind}:${summary}`)
}

export function computeAssistantOutputHash(response: AiTrizAssistantResponse): string {
  const routeIds = response.routeDecisions
    .map((r) => r.routeId)
    .sort()
    .join(',')
  const actionIds = response.recommendedActions
    .map((a) => a.actionId)
    .sort()
    .join(',')
  const payload = `${response.runId}|${response.intent}|${routeIds}|${actionIds}`
  return deterministicHash(payload)
}

export function computeAssistantContextPacketHash(sources: AiTrizAssistantSourceSummary[]): string {
  const hashes = sources.map((s) => s.sourceHash).sort()
  return deterministicHash(hashes.join(','))
}

// ---------------------------------------------------------------------------
// 纯函数 — 稳定排序键
// ---------------------------------------------------------------------------

export function computeAssistantStableSortKey(
  destination: AiTrizAssistantDestination,
  confidence: AiTrizAssistantConfidenceLevel,
  order: number,
): string {
  const confidenceRank: Record<AiTrizAssistantConfidenceLevel, number> = {
    high: 0,
    medium: 1,
    low: 2,
    fallback: 3,
  }
  return `${String(confidenceRank[confidence]).padStart(2, '0')}_${String(order).padStart(4, '0')}_${destination}`
}

export function compareAssistantRouteDecisions(
  a: AiTrizAssistantRouteDecision,
  b: AiTrizAssistantRouteDecision,
): number {
  const sortA = computeAssistantStableSortKey(a.destination, a.confidence, a.order)
  const sortB = computeAssistantStableSortKey(b.destination, b.confidence, b.order)
  return sortA.localeCompare(sortB)
}

// ---------------------------------------------------------------------------
// 纯函数 — 上下文数据包脱敏
// ---------------------------------------------------------------------------

const SENSITIVE_FIELD_PATTERNS = [
  /prompt/i,
  /modelOutput/i,
  /completion/i,
  /rawEvidence/i,
  /rawBody/i,
  /rawPayload/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /authHeader/i,
  /apiKey/i,
  /password/i,
  /credential/i,
  /hiddenCount/i,
  /hiddenId/i,
  /inaccessibleTitle/i,
  /sensitivePath/i,
  /privateKey/i,
  /certificate/i,
]

const SENSITIVE_PATH_PATTERNS = [
  /^\/etc\//,
  /^C:\\Windows\\/i,
  /^\/home\/[^/]+\/\.(ssh|gnupg|aws|azure|config\/gcloud)/,
  /\\(\.ssh|\.gnupg|\.aws|\.azure|AppData)\\/i,
  /\/\.env$/,
  /\\\.env$/,
]

export function isFieldSensitive(fieldName: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((p) => p.test(fieldName))
}

export function isPathSensitive(filePath: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some((p) => p.test(filePath))
}

export function redactSensitiveFields<T extends Record<string, unknown>>(
  obj: T,
  fieldNames: string[],
): { redacted: T; rejectedFields: string[] } {
  const rejected: string[] = []
  const redacted = { ...obj }
  for (const key of fieldNames) {
    if (isFieldSensitive(key)) {
      delete redacted[key]
      rejected.push(key)
    }
  }
  return { redacted, rejectedFields: rejected }
}

export function rejectSensitivePayload(fields: Record<string, unknown>): {
  safe: boolean
  rejectedKeys: string[]
} {
  const rejectedKeys: string[] = []
  for (const key of Object.keys(fields)) {
    if (isFieldSensitive(key)) {
      rejectedKeys.push(key)
    }
    const val = fields[key]
    if (typeof val === 'string' && isPathSensitive(val)) {
      rejectedKeys.push(key)
    }
  }
  return { safe: rejectedKeys.length === 0, rejectedKeys }
}

export function buildTruncationWarning(
  totalSources: number,
  includedSources: number,
  budgetBytes: number,
): string {
  return `上下文截断：共 ${totalSources} 个来源，仅纳入 ${includedSources} 个（预算 ${budgetBytes} 字节）`
}

// ---------------------------------------------------------------------------
// 纯函数 — 意图规范化
// ---------------------------------------------------------------------------

const INTENT_KEYWORD_MAP: Record<AiTrizAssistantIntent, string[]> = {
  technical_contradiction: [
    '改善',
    '恶化',
    '技术矛盾',
    '参数冲突',
    'trade-off',
    '权衡',
    '提升',
    '降低',
    '增加',
    '减少',
    '参数',
  ],
  physical_contradiction: [
    '物理矛盾',
    '对立状态',
    '相反',
    '既要',
    '又要',
    '同时需要',
    '不同条件下',
    '分离',
    '矛盾要求',
  ],
  missing_information: [
    '缺少',
    '不知道',
    '不确定',
    '需要更多',
    '信息不足',
    '不清楚',
    '缺失',
    '不完整',
    '补充',
  ],
  evidence_review: ['审查', '检查', '核实', '验证', '确认', '依据', '证据', '来源', '溯源', '可靠'],
  workbench: ['方案', '创新', '点子', '想法', '候选', '备选', '选项', '比较', '评估', '工作台'],
  decision: ['决定', '决策', '选择', '判断', '取舍', '裁定', '拍板', '定下来', '选定'],
  draft_preview: ['预览', '草稿', '草案', '生成', '输出', '文档', '蓝图', '计划书', '章程'],
  general_guidance: ['帮助', '指导', '建议', '怎么', '如何', '什么', '为什么', '引导', '指南'],
}

export function normalizeAssistantIntent(input: string): AiTrizAssistantIntent {
  const lower = input.toLowerCase()
  const scores: Record<AiTrizAssistantIntent, number> = {
    technical_contradiction: 0,
    physical_contradiction: 0,
    missing_information: 0,
    evidence_review: 0,
    workbench: 0,
    decision: 0,
    draft_preview: 0,
    general_guidance: 0,
  }

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORD_MAP)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        scores[intent as AiTrizAssistantIntent] += 1
      }
    }
  }

  // 按分数降序排列；同分时按意图优先级排序（decision > workbench > evidence_review > draft_preview > missing_information > technical_contradiction > physical_contradiction > general_guidance）
  const INTENT_PRIORITY: AiTrizAssistantIntent[] = [
    'decision',
    'workbench',
    'evidence_review',
    'draft_preview',
    'missing_information',
    'technical_contradiction',
    'physical_contradiction',
    'general_guidance',
  ]

  let best: AiTrizAssistantIntent = 'general_guidance'
  let bestScore = -1
  let bestPriority = INTENT_PRIORITY.length
  for (const intent of INTENT_PRIORITY) {
    const score = scores[intent]
    if (
      score > bestScore ||
      (score === bestScore && INTENT_PRIORITY.indexOf(intent) < bestPriority)
    ) {
      bestScore = score
      bestPriority = INTENT_PRIORITY.indexOf(intent)
      best = intent
    }
  }

  // 所有 intent 分数都为 0 时回退到 general_guidance
  if (bestScore <= 0) {
    return 'general_guidance'
  }

  return best
}

// ---------------------------------------------------------------------------
// 纯函数 — 确定性路由评分
// ---------------------------------------------------------------------------

export interface AssistantRouteScoringInput {
  readonly intent: AiTrizAssistantIntent
  readonly sourceKinds: AiTrizAssistantSourceKind[]
  readonly permissions: AiTrizAssistantActorPermissions
  readonly featureFlags: AiTrizAssistantFeatureFlags
}

export function computeAssistantRouteScores(
  input: AssistantRouteScoringInput,
): AiTrizAssistantRouteDecision[] {
  const decisions: AiTrizAssistantRouteDecision[] = []

  const DESTINATION_SOURCE_MAP: Partial<
    Record<AiTrizAssistantDestination, AiTrizAssistantSourceKind[]>
  > = {
    contradiction_matrix: ['contradiction', 'contradiction_matrix'],
    technical_contradiction_analyzer: ['technical_contradiction_analysis', 'contradiction'],
    physical_contradiction_analyzer: ['physical_contradiction_analysis', 'contradiction'],
    ifr_visualization: ['ifr_snapshot'],
    function_analysis_diagram: ['function_analysis_snapshot'],
    resource_analyzer: ['resource_analysis'],
    evolution_trend_analysis: ['evolution_trend_run'],
    recommendation_rationale: ['recommendation_rationale'],
    innovation_workbench: ['innovation_workbench_scheme'],
    decision_center: ['decision_log'],
    clarification_cards: ['clarification_card'],
    draft_preview: ['draft_layer', 'compiler_triz_artifact'],
  }

  const INTENT_DESTINATION_BOOST: Record<AiTrizAssistantIntent, AiTrizAssistantDestination[]> = {
    technical_contradiction: [
      'technical_contradiction_analyzer',
      'contradiction_matrix',
      'physical_contradiction_analyzer',
    ],
    physical_contradiction: [
      'physical_contradiction_analyzer',
      'technical_contradiction_analyzer',
      'contradiction_matrix',
    ],
    missing_information: ['clarification_cards'],
    evidence_review: ['recommendation_rationale', 'decision_center', 'innovation_workbench'],
    workbench: ['innovation_workbench', 'decision_center'],
    decision: ['decision_center', 'recommendation_rationale'],
    draft_preview: ['draft_preview'],
    general_guidance: [],
  }

  for (const destination of AI_TRIZ_ASSISTANT_DESTINATIONS) {
    // 功能标志门控
    if (destination === 'evolution_trend_analysis' && !input.featureFlags.evolutionTrendAvailable) {
      decisions.push({
        routeId: generateAssistantRouteDecisionId(),
        destination,
        confidence: 'fallback',
        reason: '进化趋势分析模块当前不可用',
        sourceRefs: [],
        sourceHashes: [],
        warnings: ['FEATURE_FLAG_DISABLED'],
        order: 99,
      })
      continue
    }

    // 来源权限检查
    const requiredSources = DESTINATION_SOURCE_MAP[destination] ?? []
    const hasSourcePermission = requiredSources.every(
      (sk) => input.permissions.sourcePermissions[sk] !== false,
    )
    if (!hasSourcePermission) {
      decisions.push({
        routeId: generateAssistantRouteDecisionId(),
        destination,
        confidence: 'fallback',
        reason: '缺少必要来源的访问权限',
        sourceRefs: [],
        sourceHashes: [],
        warnings: ['SOURCE_PERMISSION_DENIED'],
        order: 99,
      })
      continue
    }

    // 来源数据可用性
    const availableSources = requiredSources.filter((sk) => input.sourceKinds.includes(sk))

    // 置信度计算
    let confidence: AiTrizAssistantConfidenceLevel = 'low'
    const boost = INTENT_DESTINATION_BOOST[input.intent] ?? []
    const isBoosted = boost.includes(destination)

    if (isBoosted && availableSources.length > 0) {
      confidence = 'high'
    } else if (isBoosted || availableSources.length > 0) {
      confidence = 'medium'
    } else if (requiredSources.length === 0) {
      confidence = 'low'
    } else {
      confidence = 'fallback'
    }

    const warnings: AiTrizAssistantWarningCode[] = []
    if (availableSources.length < requiredSources.length) {
      warnings.push('SOURCE_UNAVAILABLE')
    }

    decisions.push({
      routeId: generateAssistantRouteDecisionId(),
      destination,
      confidence,
      reason: buildRouteReason(destination, confidence),
      sourceRefs: [],
      sourceHashes: [],
      warnings,
      order: AI_TRIZ_ASSISTANT_DESTINATIONS.indexOf(destination),
    })
  }

  // 稳定排序
  decisions.sort(compareAssistantRouteDecisions)
  return decisions
}

function buildRouteReason(
  destination: AiTrizAssistantDestination,
  confidence: AiTrizAssistantConfidenceLevel,
): string {
  const label = AI_TRIZ_ASSISTANT_DESTINATION_LABELS[destination]
  if (confidence === 'high') return `强烈推荐打开${label}`
  if (confidence === 'medium') return `可考虑${label}`
  if (confidence === 'fallback') return `${label}暂不可用`
  return `${label}可用但关联度较低`
}

// ---------------------------------------------------------------------------
// 纯函数 — 推荐动作构建器
// ---------------------------------------------------------------------------

export function buildAssistantRecommendedAction(params: {
  destination: AiTrizAssistantDestination
  actionType: AiTrizAssistantActionType
  sourceRefs: string[]
  sourceHashes: string[]
  requiredPermissions: string[]
  requiresUserConfirmation: boolean
  lowSensitivitySummary: string
  navigationRef?: AiTrizAssistantNavigationRef
  handoffInput?: Record<string, unknown>
}): AiTrizAssistantRecommendedAction {
  const actionId = generateAssistantActionId()
  return {
    actionId,
    destination: params.destination,
    actionType: params.actionType,
    label: buildActionLabel(params.destination, params.actionType),
    description: params.lowSensitivitySummary,
    sourceRefs: params.sourceRefs,
    sourceHashes: params.sourceHashes,
    requiredPermissions: params.requiredPermissions,
    requiresUserConfirmation: params.requiresUserConfirmation,
    isStale: false,
    idempotencyKey: computeAssistantIdempotencyKey(
      actionId,
      params.sourceHashes,
      0, // actorId 在运行时注入
    ),
    lowSensitivitySummary: params.lowSensitivitySummary,
    navigationRef: params.navigationRef,
    handoffInput: params.handoffInput,
  }
}

function buildActionLabel(
  destination: AiTrizAssistantDestination,
  actionType: AiTrizAssistantActionType,
): string {
  const destLabel = AI_TRIZ_ASSISTANT_DESTINATION_LABELS[destination]
  switch (actionType) {
    case 'navigate':
      return `打开${destLabel}`
    case 'open_review':
      return `审查${destLabel}`
    case 'add_to_workbench':
      return `加入方案篮子`
    case 'generate_preview':
      return `生成预览`
    case 'record_decision':
      return `记录决策`
    case 'view_evidence':
      return `查看依据`
    case 'clarify':
      return `补充信息`
    default:
      return `打开${destLabel}`
  }
}

// ---------------------------------------------------------------------------
// 纯函数 — source hash 陈旧检测
// ---------------------------------------------------------------------------

export function isAssistantSourceHashStale(currentHash: string, storedHashes: string[]): boolean {
  return !storedHashes.includes(currentHash)
}

export function detectStaleActions(
  actions: AiTrizAssistantRecommendedAction[],
  currentHashesByRef: Map<string, string>,
): AiTrizAssistantRecommendedAction[] {
  return actions.map((action) => {
    const isStale = action.sourceHashes.some(
      (hash) => ![...currentHashesByRef.values()].includes(hash),
    )
    return {
      ...action,
      isStale,
      staleReason: isStale ? '来源数据已变更，建议刷新后重新审查' : undefined,
    }
  })
}

// ---------------------------------------------------------------------------
// 类型守卫
// ---------------------------------------------------------------------------

export function isAiTrizAssistantDestination(v: string): v is AiTrizAssistantDestination {
  return (AI_TRIZ_ASSISTANT_DESTINATIONS as readonly string[]).includes(v)
}

export function isAiTrizAssistantIntent(v: string): v is AiTrizAssistantIntent {
  return (AI_TRIZ_ASSISTANT_INTENTS as readonly string[]).includes(v)
}

export function isAiTrizAssistantWarningCode(v: string): v is AiTrizAssistantWarningCode {
  return (AI_TRIZ_ASSISTANT_WARNING_CODES as readonly string[]).includes(v)
}

export function isAiTrizAssistantActionType(v: string): v is AiTrizAssistantActionType {
  return (AI_TRIZ_ASSISTANT_ACTION_TYPES as readonly string[]).includes(v)
}

export function isAiTrizAssistantSourceKind(v: string): v is AiTrizAssistantSourceKind {
  return (AI_TRIZ_ASSISTANT_SOURCE_KINDS as readonly string[]).includes(v)
}

export function isAiTrizAssistantRunStatus(v: string): v is AiTrizAssistantRunStatus {
  return (AI_TRIZ_ASSISTANT_RUN_STATUSES as readonly string[]).includes(v)
}

export function isAiTrizAssistantSortField(v: string): v is AiTrizAssistantSortField {
  return (AI_TRIZ_ASSISTANT_SORT_FIELDS as readonly string[]).includes(v)
}

// ---------------------------------------------------------------------------
// 验证函数
// ---------------------------------------------------------------------------

export function validateAssistantSubmitRequest(req: AiTrizAssistantSubmitRequest): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  if (!req.message || req.message.trim().length === 0) {
    errors.push('消息不能为空')
  }
  if (req.message && req.message.length > 5000) {
    errors.push('消息长度不能超过 5000 个字符')
  }
  return { valid: errors.length === 0, errors }
}

export function validateAssistantContextPacket(packet: AiTrizAssistantContextPacket): {
  valid: boolean
  warnings: string[]
} {
  const warnings: string[] = []
  if (packet.sources.length === 0) {
    warnings.push('无可用来源数据')
  }
  if (packet.truncated) {
    warnings.push('上下文数据已截断')
  }
  return { valid: true, warnings }
}
