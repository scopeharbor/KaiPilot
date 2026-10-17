/**
 * v2-triz-recommendation-rationale-ui —— TRIZ 推荐理由共享契约（前后端共享）。
 *
 * 定义 TRIZ 推荐理由的统一数据契约：包括 DTO、来源 ref、证据 ref、验证状态、
 * AI/fallback 元数据、成本摘要、用户反馈、Draft Layer handoff 状态。
 *
 * 红线：
 * - 不包含完整 prompt、完整模型输出、敏感文件路径、API Key、无权限目标详情或跨组织数据
 * - 只读聚合 DTO，不是新的事实表
 * - AI 解释草稿必须与确定性规则依据分离展示
 */

// ---------------------------------------------------------------------------
// 来源类型枚举
// ---------------------------------------------------------------------------

/** 推荐理由来源类型 */
export const RATIONALE_SOURCE_TYPES = [
  'contradiction',
  'analysis_artifact',
  'recommendation',
] as const
export type RationaleSourceType = (typeof RATIONALE_SOURCE_TYPES)[number]

/** 证据链中的来源标签 */
export const RATIONALE_SOURCE_LABELS: Record<RationaleSourceType, string> = {
  contradiction: 'TRIZ 矛盾',
  analysis_artifact: 'TRIZ 分析 Artifact',
  recommendation: 'AI 智能推荐',
}

// ---------------------------------------------------------------------------
// Warning codes
// ---------------------------------------------------------------------------

export const RATIONALE_WARNING_CODES = [
  'STALE_SOURCE_HASH',
  'SOURCE_UNAVAILABLE',
  'AI_VALIDATION_FAILED',
  'AI_FALLBACK',
  'BUDGET_BLOCKED',
  'MODEL_FAILURE',
  'RECOMMENDATION_UNAVAILABLE',
  'PERMISSION_RESTRICTED',
  'HALLUCINATION_WARNING',
  'EMPTY_EVIDENCE_CHAIN',
] as const
export type RationaleWarningCode = (typeof RATIONALE_WARNING_CODES)[number]

/** Warning 条目 */
export interface RationaleWarning {
  code: RationaleWarningCode
  message: string
  details?: string | null
}

// ---------------------------------------------------------------------------
// 反馈枚举
// ---------------------------------------------------------------------------

/** 反馈原因枚举 */
export const RATIONALE_FEEDBACK_REASONS = [
  'helpful',
  'not_relevant',
  'insufficient_evidence',
  'stale_source',
  'converted_to_draft',
] as const
export type RationaleFeedbackReason = (typeof RATIONALE_FEEDBACK_REASONS)[number]

/** 反馈原因中文标签 */
export const RATIONALE_FEEDBACK_LABELS: Record<RationaleFeedbackReason, string> = {
  helpful: '有帮助',
  not_relevant: '不相关',
  insufficient_evidence: '证据不足',
  stale_source: '来源已过期',
  converted_to_draft: '已转草稿',
}

// ---------------------------------------------------------------------------
// 结构化 refs
// ---------------------------------------------------------------------------

/** 来源 ref（低敏：指向某个可追溯来源） */
export interface RationaleSourceRef {
  /** 来源类型 */
  sourceType: RationaleSourceType
  /** 稳定 ID */
  id: string
  /** 版本或 hash */
  hash: string
  /** 低敏摘要 */
  summary: string
}

/** 证据 ref（低敏：指向具体证据条目） */
export interface RationaleEvidenceRef {
  /** 证据类型标签（如 parameter / principle / artifact / file） */
  label: string
  /** 低敏描述 */
  description: string
  /** 来源 hash */
  sourceHash: string
  /** 可导航的 URL（后端生成，前端直接使用） */
  navigationUrl?: string | null
}

/** 参数 tension 描述 */
export interface RationaleParameterTension {
  /** 改善参数 key */
  improvingParameter: string
  /** 改善参数中文名 */
  improvingParameterName: string
  /** 恶化参数 key（物理矛盾时为同一参数） */
  worseningParameter: string
  /** 恶化参数中文名 */
  worseningParameterName: string
  /** 严重度 */
  severity: string
}

/** 发明原理映射条目 */
export interface PrincipleMappingEntry {
  /** 原理 ID */
  principleId: string
  /** 中文权威名 */
  principleName: string
  /** 映射理由 */
  rationale: string
  /** 相关度分数（high / medium / low） */
  relevance: string
  /** 适用性说明 */
  applicability: string
  /** 不适用性说明 */
  nonApplicability: string
}

// ---------------------------------------------------------------------------
// AI / Fallback 元数据
// ---------------------------------------------------------------------------

/** AI 解释元数据 */
export interface RationaleAiMetadata {
  /** 是否 AI 生成（false = 确定性 fallback） */
  isAiGenerated: boolean
  /** 验证状态：passed / failed / pending / skipped */
  validationStatus: string
  /** provider（仅真实调用时） */
  provider: string | null
  /** model（仅真实调用时） */
  model: string | null
  /** input hash */
  inputHash: string | null
  /** output ref 或 hash */
  outputRef: string | null
}

/** 成本摘要 */
export interface RationaleCostSummary {
  /** provider（仅真实调用时） */
  provider: string | null
  /** model（仅真实调用时） */
  model: string | null
  /** token 总数 */
  tokens: number
  /** 估算成本（美元） */
  estimatedCost: number | null
  /** 延迟（毫秒） */
  latencyMs: number | null
  /** 预算决策 */
  budgetDecision: string
}

// ---------------------------------------------------------------------------
// 验证状态
// ---------------------------------------------------------------------------

/** 验证摘要 */
export interface RationaleValidationSummary {
  /** overall 状态：passed / failed / warning / pending */
  status: string
  /** 反幻觉校验是否通过 */
  antiHallucinationPassed: boolean
  /** 来源 ref 校验是否通过 */
  sourceRefsValid: boolean
  /** warning 列表 */
  warnings: RationaleWarning[]
}

// ---------------------------------------------------------------------------
// UI 可用段标记
// ---------------------------------------------------------------------------

/** 可用 UI section 标记 */
export const RATIONALE_SECTIONS = [
  'source_summary',
  'parameter_tensions',
  'principle_mapping',
  'evidence_chain',
  'ai_explanation',
  'fallback_summary',
  'validation_state',
  'cost_summary',
  'feedback',
  'handoff',
] as const
export type RationaleSection = (typeof RATIONALE_SECTIONS)[number]

// ---------------------------------------------------------------------------
// 主要 DTO
// ---------------------------------------------------------------------------

/** TRIZ 推荐理由 DTO（只读聚合） */
export interface TrizRecommendationRationale {
  /** 稳定标识 */
  id: string
  /** 组织 ID */
  organizationId: number
  /** 项目 ID */
  projectId: number

  /** 来源类型 */
  sourceType: RationaleSourceType
  /** 来源 refs */
  sourceRefs: RationaleSourceRef[]
  /** 来源 hash 列表（用于过期检测） */
  sourceHashes: string[]

  /** 矛盾摘要（低敏） */
  contradictionSummary: string | null
  /** 参数 tension 列表 */
  parameterTensions: RationaleParameterTension[]
  /** 候选发明原理映射 */
  principleMappings: PrincipleMappingEntry[]

  /** 证据链 refs */
  evidenceRefs: RationaleEvidenceRef[]
  /** 验证摘要 */
  validationSummary: RationaleValidationSummary
  /** warning 摘要 */
  warningSummary: string | null

  /** AI/fallback 元数据 */
  aiMetadata: RationaleAiMetadata | null
  /** 成本摘要 */
  costSummary: RationaleCostSummary | null

  /** 确定性规则摘要 */
  deterministicSummary: string
  /** AI 解释草稿（仅当 AI 生成且验证通过时） */
  aiExplanationDraft: string | null
  /** Fallback 摘要（AI 不可用或验证失败时） */
  fallbackSummary: string | null

  /** 可用 UI section 数组 */
  availableSections: RationaleSection[]
  /** 人工审查要求文本 */
  humanReviewRequirement: string | null

  /** 可选 Draft Layer handoff 状态 */
  handoffState: RationaleHandoffState | null

  /** 创建/更新时间 */
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Draft Layer Handoff
// ---------------------------------------------------------------------------

/** Handoff 状态 */
export const RATIONALE_HANDOFF_STATUSES = [
  'none',
  'candidate_created',
  'stale',
  'handed_off',
] as const
export type RationaleHandoffStatus = (typeof RATIONALE_HANDOFF_STATUSES)[number]

/** Handoff 状态 */
export interface RationaleHandoffState {
  status: RationaleHandoffStatus
  /** Draft session ID（若已创建） */
  draftSessionId: number | null
  /** 已选发明原理或解决路径 */
  selectedPrinciple: string | null
  /** Warning 摘要 */
  warningSummary: string | null
}

// ---------------------------------------------------------------------------
// 反馈 DTO
// ---------------------------------------------------------------------------

/** 反馈请求 */
export interface RationaleFeedbackRequest {
  reason: RationaleFeedbackReason
  note?: string | null
}

/** 反馈响应 */
export interface RationaleFeedbackResponse {
  id: number
  rationaleTarget: string
  reason: RationaleFeedbackReason
  note: string | null
  createdBy: number
  createdAt: string
}

/** 反馈记录（持久化） */
export interface RationaleFeedbackRecord {
  id: number
  organizationId: number
  projectId: number
  userId: number
  targetType: string
  targetId: string
  reason: RationaleFeedbackReason
  note: string | null
  sourceRefs: RationaleSourceRef[]
  createdAt: string
}

// ---------------------------------------------------------------------------
// Draft Layer Handoff 请求/响应
// ---------------------------------------------------------------------------

/** Handoff 请求 */
export interface RationaleHandoffRequest {
  selectedPrinciple?: string | null
}

/** Handoff 响应 */
export interface RationaleHandoffResponse {
  data: {
    draftSessionId: number | null
    handoffStatus: RationaleHandoffStatus
    warnings: RationaleWarning[]
  }
}

// ---------------------------------------------------------------------------
// API 响应
// ---------------------------------------------------------------------------

/** 单条 rationale 详情响应 */
export interface RationaleDetailResponse {
  data: TrizRecommendationRationale
}

/** 反馈提交响应 */
export interface RationaleFeedbackSubmitResponse {
  data: RationaleFeedbackResponse
}

// ---------------------------------------------------------------------------
// Dashboard 摘要
// ---------------------------------------------------------------------------

/** Dashboard 摘要 */
export interface DashboardRationaleSummary {
  /** 有理由的目标数 */
  targetCount: number
  /** 有 stale warning 的目标数 */
  staleCount: number
  /** Top 条目低敏摘要 */
  topItems: Array<{
    id: string
    sourceType: RationaleSourceType
    summary: string
    severity: string
    warningCode: string | null
  }>
  /** 可用性标记 */
  available: boolean
  /** warning 列表 */
  warnings: RationaleWarning[]
}

// ---------------------------------------------------------------------------
// 活动事件
// ---------------------------------------------------------------------------

/** 活动事件 payload */
export interface RationaleActivityEvent {
  rationaleTarget: string
  action: 'viewed' | 'feedback' | 'stale_detected' | 'handoff_initiated'
  actor: number
  feedbackReason?: RationaleFeedbackReason | null
  projectId: number
  organizationId: number
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 对 evidence refs 按标签稳定排序。
 */
export function sortEvidenceRefs(refs: RationaleEvidenceRef[]): RationaleEvidenceRef[] {
  return [...refs].sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * 脱敏备注文本：替换疑似敏感内容。
 */
export function redactNoteText(text: string): string {
  return text
    .replace(/[A-Za-z0-9+/=]{32,}/g, '[REDACTED]')
    .replace(/(?:\/[a-zA-Z0-9_\-./]+)+/g, '[REDACTED_PATH]')
    .replace(/(bearer|token|auth)\s*[:=]?\s*[A-Za-z0-9\-_.+/=]{8,}/gi, '$1 [REDACTED]')
}

/**
 * 根据 DTO 内容推导可用 UI section。
 */
export function deriveAvailableSections(rationale: {
  sourceRefs: unknown[]
  parameterTensions: unknown[]
  principleMappings: unknown[]
  evidenceRefs: unknown[]
  aiExplanationDraft: string | null
  fallbackSummary: string | null
  aiMetadata: unknown | null
  costSummary: unknown | null
  handoffState: unknown | null
}): RationaleSection[] {
  const sections: RationaleSection[] = []

  if (rationale.sourceRefs.length > 0) sections.push('source_summary')
  if (rationale.parameterTensions.length > 0) sections.push('parameter_tensions')
  if (rationale.principleMappings.length > 0) sections.push('principle_mapping')
  if (rationale.evidenceRefs.length > 0) sections.push('evidence_chain')
  if (rationale.aiExplanationDraft) sections.push('ai_explanation')
  if (rationale.fallbackSummary) sections.push('fallback_summary')
  if (rationale.aiMetadata) sections.push('validation_state')
  if (rationale.costSummary) sections.push('cost_summary')

  // feedback 和 handoff 始终可用（后端控制前端是否展示）
  sections.push('feedback', 'handoff')

  return sections
}

/**
 * 检测来源 hash 是否过期：当前 hash 不在 sourceHashes 列表中即为过期。
 */
export function isSourceHashStale(currentHash: string, sourceHashes: string[]): boolean {
  return !sourceHashes.includes(currentHash)
}
