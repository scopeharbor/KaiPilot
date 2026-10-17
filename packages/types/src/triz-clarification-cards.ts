// @aiproj/types — V2 TRIZ AI Clarification Cards 共享契约（前后端共享）
// v2-triz-ai-clarification-cards / D1–D9
//
// 设计要点：
// - TRIZ 卡片是现有 ClarificationCard 契约的来源扩展（source='triz'），不是新卡片模型。
// - 候选卡片由确定性规则从矛盾 snapshot 和 TRIZ analysis artifact refs 派生。
// - AI 只能润色文案，不能新增未出现在 refs 中的矛盾/参数/原理/事实。
// - cardId 包含 source hash，同一矛盾在同一 artifact 版本下不重复生成。
// - 所有类型禁止包含完整 prompt、完整模型输出、API Key 或敏感证据正文。

import type {
  ClarificationCategory,
  ClarificationValue,
  ClarificationQuestionType,
  ClarificationImpact,
  ClarificationQuickOption,
} from './ai-intent.js'
import type { AiMarker } from './ai-m0.js'
import type {
  ContradictionSeverity,
  ContradictionType,
  ContradictionStatus,
  InventivePrincipleId,
  ProjectParameterKey,
} from './triz-contradiction.js'
import type { TrizAnalysisWarningCode } from './triz-compiler-analysis.js'

// ---------------------------------------------------------------------------
// 枚举与常量
// ---------------------------------------------------------------------------

/** TRIZ 卡片类别 */
export const TRIZ_CLARIFICATION_CARD_CATEGORIES = [
  'trade_off',
  'priority',
  'constraint',
  'assumption',
  'solution_preference',
] as const
export type TrizClarificationCategory = (typeof TRIZ_CLARIFICATION_CARD_CATEGORIES)[number]

/** TRIZ 澄清 warning code（稳定标识，前端按 code 显式处理） */
export const TRIZ_CLARIFICATION_WARNING_CODES = [
  'TRIZ_ANALYSIS_UNAVAILABLE',
  'TRIZ_SOURCE_CONTRADICTION_STALE',
  'TRIZ_CANDIDATE_SOURCE_MISSING',
  'TRIZ_CANDIDATE_VALIDATION_FAILED',
  'TRIZ_AI_WORDING_FALLBACK',
  'TRIZ_BUDGET_BLOCKED',
  'TRIZ_HALLUCINATION_WARNING',
  'TRIZ_STALE_ANSWER',
  'TRIZ_SKIPPED_WITHOUT_ANSWER',
  'TRIZ_ADAPTER_UNAVAILABLE',
] as const
export type TrizClarificationWarningCode = (typeof TRIZ_CLARIFICATION_WARNING_CODES)[number]

/** 回答 action（扩展自基本 ClarificationAction） */
export const TRIZ_ANSWER_ACTIONS = ['answer', 'adopt_default', 'skip', 'defer_review'] as const
export type TrizAnswerAction = (typeof TRIZ_ANSWER_ACTIONS)[number]

/** TRIZ 卡片 answer effect 枚举 */
export const TRIZ_ANSWER_EFFECT_TYPES = [
  'schedule_priority',
  'quality_priority',
  'resource_tradeoff',
  'scope_decision',
  'risk_acceptance',
  'principle_selection',
  'constraint_relaxation',
  'default_adoption',
] as const
export type TrizAnswerEffectType = (typeof TRIZ_ANSWER_EFFECT_TYPES)[number]

/** TRIZ 卡片 impact scope domain 枚举 */
export const TRIZ_IMPACT_DOMAINS = [
  '工期/进度',
  '成本',
  '资源负载',
  '质量',
  '范围',
  '风险水平',
  '灵活性',
  '稳定性',
  '信息完整度',
  '可维护性',
  '不确定性',
  '交付吞吐',
] as const
export type TrizImpactDomain = (typeof TRIZ_IMPACT_DOMAINS)[number]

// ---------------------------------------------------------------------------
// 结构化类型
// ---------------------------------------------------------------------------

/** TRIZ 矛盾的稳定 low-sensitivity snapshot（给澄清消费） */
export interface TrizClarificationSourceRef {
  /** 矛盾 id（数据库记录） */
  contradictionId: number
  /** 矛盾 key */
  key: string
  /** 矛盾类型 */
  type: ContradictionType
  /** 当前状态 */
  status: ContradictionStatus
  /** 严重度 */
  severity: ContradictionSeverity
  /** 置信度（0-1） */
  confidence: number
  /** 是否过期 */
  stale: boolean
  /** 过期原因 */
  staleReason: string | null
  /** 改善参数 key（技术矛盾） */
  improvingParameterKey: ProjectParameterKey | null
  /** 恶化参数 key（技术矛盾） */
  worseningParameterKey: ProjectParameterKey | null
  /** 参数 key（物理矛盾） */
  parameterKey: ProjectParameterKey | null
  /** 低敏中文标题 */
  title: string
  /** 影响范围 */
  affectedScope: string[]
  /** 候选原理 refs（仅 id + 名称） */
  suggestedPrinciples: Array<{
    principleId: InventivePrincipleId
    name: string
  }>
  /** 输入签名 */
  inputSignature: string
  /** 输出 hash */
  outputHash: string | null
}

/** TRIZ analysis artifact 的 compact clarification hints */
export interface TrizAnalysisClarificationHint {
  /** artifact id */
  artifactId: string
  /** artifact 版本 */
  version: number
  /** 内容 hash */
  contentHash: string
  /** 来源矛盾 key 列表 */
  sourceKeys: string[]
  /** Top 参数张力（人读） */
  topTensions: string[]
  /** 候选原理 refs */
  principleRefs: Array<{
    principleId: InventivePrincipleId
    name: string
    relevance: string
  }>
  /** 建议型解决路径摘要 */
  resolutionPathHints: Array<{
    pathId: string
    name: string
    suggestionType: string
  }>
  /** warning codes */
  warningCodes: TrizAnalysisWarningCode[]
  /** 是否包含 AI 综合说明 */
  hasAiNarrative: boolean
}

/** TRIZ 卡片稳定身份信息 */
export interface TrizCardIdentity {
  /** Schema 版本 */
  schemaVersion: string
  /** 关联的 ClarificationField */
  field: string
  /** TRIZ 卡片类别 */
  category: TrizClarificationCategory
  /** 来源 = triz */
  source: 'triz'
  /** 矛盾 key */
  contradictionKey: string
  /** 分析 artifact hash（可选，有 artifact 时填充） */
  analysisHash: string | null
  /** 矛盾 source hash（artifact 不可用时使用） */
  contradictionSourceHash: string
  /** 问题目的 */
  questionPurpose: string
}

/** 单个 warning 条目（与 TRIZ analysis 兼容但独立） */
export interface TrizClarificationWarning {
  code: TrizClarificationWarningCode
  message: string
  source?: string
}

/** 回答效果描述 */
export interface TrizAnswerEffect {
  type: TrizAnswerEffectType
  /** 中文描述 */
  description: string
  /** 影响严重度 */
  severity: 'high' | 'medium' | 'low'
}

/** TRIZ 候选卡片（生成后、转为 ClarificationCard 前） */
export interface TrizClarificationCandidate {
  /** 稳定 cardId */
  cardId: string
  /** 来源矛盾 refs */
  sourceRefs: TrizClarificationSourceRef[]
  /** 分析 artifact hint（可选） */
  analysisHint: TrizAnalysisClarificationHint | null
  /** TRIZ 卡片类别 */
  trizCategory: TrizClarificationCategory
  /** 映射到的 ClarificationField */
  mappedField: string
  /** 中文标题 */
  title: string
  /** 中文描述 */
  description: string
  /** 影响范围 */
  impactScope: ClarificationImpact[]
  /** 问题类型 */
  questionType: ClarificationQuestionType
  /** 快速选项 */
  quickOptions: ClarificationQuickOption[]
  /** 默认值 */
  defaultValue: Exclude<ClarificationValue, null> | null
  /** 置信度 */
  confidence: number
  /** 推理说明 */
  reasoning: string
  /** 严重度（继承自矛盾） */
  severity: ContradictionSeverity
  /** 允许跳过 */
  allowSkip: boolean
  /** 是否必填 */
  isRequired: boolean
  /** warning codes */
  warningCodes: TrizClarificationWarningCode[]
  /** warnings */
  warnings: TrizClarificationWarning[]
  /** 回答效果 */
  answerEffect: TrizAnswerEffect
  /** source hash（用于去重/过期检测） */
  sourceHash: string
}

/** TRIZ 卡片 answer payload（提交到上下文） */
export interface TrizClarificationAnswer {
  cardId: string
  action: TrizAnswerAction
  value: ClarificationValue
  /** 是否采用默认 */
  adoptedDefault: boolean
  /** 来源 hash（提交时快照） */
  sourceHash: string
  /** AIMarker provenance */
  marker: AiMarker | null
  /** 可选备注 */
  note?: string
}

/** TRIZ 上下文合并输出（写入 ConfirmedProjectContext.trizClarifications） */
export interface TrizContextMergeOutput {
  cardId: string
  sourceRefs: Pick<TrizClarificationSourceRef, 'key' | 'type' | 'severity' | 'title'>[]
  analysisArtifactRef: string | null
  action: TrizAnswerAction
  value: ClarificationValue
  marker: AiMarker
  sourceHash: string
  stale: boolean
  warningCodes: TrizClarificationWarningCode[]
  answerEffect: TrizAnswerEffect | null
}

// ---------------------------------------------------------------------------
// API DTOs
// ---------------------------------------------------------------------------

/** TRIZ 卡片列表响应中的单个卡片 DTO */
export interface TrizClarificationCardDTO {
  cardId: string
  field: string
  category: ClarificationCategory
  trizCategory: TrizClarificationCategory
  source: 'triz'
  title: string
  description: string
  impactScope: ClarificationImpact[]
  questionType: ClarificationQuestionType
  quickOptions: ClarificationQuickOption[]
  defaultValue: Exclude<ClarificationValue, null> | null
  defaultValueMarker: AiMarker | null
  confidence: number
  reasoning: string
  allowSkip: boolean
  isRequired: boolean
  sourceRefs: Pick<TrizClarificationSourceRef, 'key' | 'type' | 'severity' | 'title'>[]
  analysisArtifactRef: string | null
  warningCodes: TrizClarificationWarningCode[]
  warnings: TrizClarificationWarning[]
  answerEffect: TrizAnswerEffect | null
  sourceHash: string
}

/** Draft Layer handoff 输入 */
export interface TrizDraftHandoffInput {
  answers: TrizClarificationAnswer[]
  sourceHashes: string[]
  context: TrizContextMergeOutput[]
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * TRIZ warning code 中文标签映射（前端展示用）。
 */
export function getTrizClarificationWarningLabel(code: TrizClarificationWarningCode): string {
  const labels: Record<TrizClarificationWarningCode, string> = {
    TRIZ_ANALYSIS_UNAVAILABLE: 'TRIZ 分析不可用',
    TRIZ_SOURCE_CONTRADICTION_STALE: '来源矛盾已过期',
    TRIZ_CANDIDATE_SOURCE_MISSING: '候选卡片来源缺失',
    TRIZ_CANDIDATE_VALIDATION_FAILED: '候选卡片校验失败',
    TRIZ_AI_WORDING_FALLBACK: 'AI 文案降级为确定性文本',
    TRIZ_BUDGET_BLOCKED: '预算阻断 — AI 文案已跳过',
    TRIZ_HALLUCINATION_WARNING: '反幻觉校验未通过',
    TRIZ_STALE_ANSWER: '回答已过期，需要重新确认',
    TRIZ_SKIPPED_WITHOUT_ANSWER: '已跳过未回答',
    TRIZ_ADAPTER_UNAVAILABLE: 'TRIZ 适配器不可用',
  }
  return labels[code] ?? code
}

/**
 * 计算 TRIZ 卡片稳定 cardId。
 *
 * 同一矛盾在同一 artifact/source hash 版本下产生相同 cardId。
 */
export function computeTrizCardId(identity: TrizCardIdentity): string {
  const parts = [
    identity.schemaVersion,
    'triz',
    identity.field,
    identity.category,
    identity.contradictionKey,
    identity.analysisHash ?? identity.contradictionSourceHash,
    identity.questionPurpose,
  ]
  return `triz-${parts.join('|')}`
}

/**
 * 计算 TRIZ 卡片 source hash（用于过期检测与去重）。
 */
export function computeTrizSourceHash(
  sourceRefs: Pick<
    TrizClarificationSourceRef,
    'key' | 'inputSignature' | 'outputHash' | 'status' | 'severity'
  >[],
  analysisHash: string | null,
): string {
  const parts: string[] = []
  for (const ref of [...sourceRefs].sort((a, b) => a.key.localeCompare(b.key))) {
    parts.push(
      `${ref.key}:${ref.inputSignature}:${ref.outputHash ?? ''}:${ref.status}:${ref.severity}`,
    )
  }
  if (analysisHash) {
    parts.push(`artifact:${analysisHash}`)
  }
  // 简单确定性 hash（非加密，仅用于身份/幂等判定）
  let hash = 0
  const input = parts.join('||')
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return `triz-sh-${Math.abs(hash).toString(16).padStart(8, '0')}`
}

/** 严重度排序映射 */
const SEVERITY_RANK: Record<ContradictionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

/**
 * TRIZ 候选卡片稳定排序比较器。
 * 排序规则：critical/recommended 类别 → 矛盾严重度 → 置信度 → 类别内顺序 → cardId。
 */
export function compareTrizCandidates(
  a: TrizClarificationCandidate,
  b: TrizClarificationCandidate,
): number {
  // 按严重度排序（critical > high > medium > low）
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  if (bySeverity !== 0) return bySeverity
  // 按置信度排序（高置信度优先）
  const byConf = (b.confidence ?? 0) - (a.confidence ?? 0)
  if (Math.abs(byConf) > 1e-9) return byConf
  // 按 cardId 稳定排序
  return a.cardId.localeCompare(b.cardId)
}

/**
 * 检测 TRIZ 回答是否过期（source hash 不匹配）。
 */
export function isTrizAnswerStale(
  answer: TrizClarificationAnswer,
  currentSourceHash: string,
): boolean {
  return answer.sourceHash !== currentSourceHash
}

/**
 * 按 cardId 去重：保留最新的（source hash 更高或更晚的）。
 * 相同 cardId 的条目中，如果 sourceHash 不同，保留 sourceHash 按字典序更大的那条。
 */
export function dedupeTrizCandidates(
  candidates: TrizClarificationCandidate[],
): TrizClarificationCandidate[] {
  const seen = new Map<string, TrizClarificationCandidate>()
  for (const c of candidates) {
    const existing = seen.get(c.cardId)
    if (!existing || c.sourceHash > existing.sourceHash) {
      seen.set(c.cardId, c)
    }
  }
  return Array.from(seen.values()).sort(compareTrizCandidates)
}

/**
 * 将 TRIZ 卡片类别映射到 ClarificationCategory。
 */
export function mapTrizCategoryToClarification(
  trizCategory: TrizClarificationCategory,
  severity: ContradictionSeverity,
): ClarificationCategory {
  if (trizCategory === 'trade_off' || trizCategory === 'constraint') {
    return severity === 'critical' || severity === 'high' ? 'critical' : 'recommended'
  }
  if (trizCategory === 'priority' || trizCategory === 'solution_preference') {
    return 'recommended'
  }
  // assumption
  return 'optional'
}

/**
 * 从 WarningCodes 数组去重并排序。
 */
export function sortTrizWarningCodes(
  codes: TrizClarificationWarningCode[],
): TrizClarificationWarningCode[] {
  return [...new Set(codes)].sort()
}
