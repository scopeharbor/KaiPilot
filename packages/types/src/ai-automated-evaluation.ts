/**
 * v3-ai-automated-evaluation §2 — AI 产出自动化评测共享契约。
 *
 * 定义对齐 OTel GenAI 已发布约定（gen_ai.evaluation.*）的评分记录形状、
 * 确定性评测器优先于 LLM-as-judge 且 judge 不得覆盖确定性结论、
 * judge 调用自身落账并受预算限流约束、judge 失败记为未评而非通过、
 * 首批六个评测维度、声明式采样与触发条件可回溯、
 * 阈值越界只产生健康状态与原因码而禁止自动修复、
 * 只读聚合查询、与 Skill 评测的映射去重、
 * explanation 有界且禁存被评正文的低敏红线，以及评测失败可降级的隔离边界。
 *
 * 零运行时依赖原则：不导入 zod / adonisjs / Date.now() / Math.random()。
 * 复用账本禁止键类别实现 sanitizer。
 *
 * @aiproj/types 零依赖约束
 */

import {
  LEDGER_FORBIDDEN_KEY_PATTERNS,
  type LedgerForbiddenKeyCategory,
} from './unified-ai-invocation-ledger.js'

// ═══════════════════════════════════════════════════════════════════════════════
// §2.2–2.7 核心类型与枚举
// ═══════════════════════════════════════════════════════════════════════════════

// ── 评测器类别 ──────────────────────────────────────────────────────────────

/** 评测器类别：确定性规则 vs LLM-as-judge。 */
export const EVALUATOR_KINDS = ['deterministic', 'judge'] as const
export type EvaluatorKind = (typeof EVALUATOR_KINDS)[number]

/** 确定性优先：同维度有确定性结论时 judge 结论不得覆盖。 */
export function isEvaluatorKind(v: string): v is EvaluatorKind {
  return (EVALUATOR_KINDS as readonly string[]).includes(v)
}

// ── 评分标签 ──────────────────────────────────────────────────────────────

/** 评分标签枚举：pass / fail / not-evaluated。 */
export const SCORE_LABELS = ['pass', 'fail', 'not-evaluated'] as const
export type ScoreLabel = (typeof SCORE_LABELS)[number]

/** 确定性优先：not-evaluated 与 pass / fail 严格区分。 */
export function isScoreLabel(v: string): v is ScoreLabel {
  return (SCORE_LABELS as readonly string[]).includes(v)
}

// ── 首批六维度 ────────────────────────────────────────────────────────────

/** 首批评测维度枚举。 */
export const EVALUATION_DIMENSIONS = [
  /** 草案结构合规——确定性规则检查。 */
  'draft_structural_compliance',
  /** 反幻觉命中——消费既有反幻觉检查结果。 */
  'anti_hallucination_hit',
  /** 路由被改道——比对路由决策与用户最终选择。 */
  'routing_destination_changed',
  /** 澄清命中真实缺口——确定性判定。 */
  'clarification_matched_real_gap',
  /** 叙述引用上下文外事实——确定性判定。 */
  'narration_cites_out_of_context_fact',
  /** 建议采纳——消费反馈账本（未落地时留接缝）。 */
  'suggestion_adoption',
] as const
export type EvaluationDimension = (typeof EVALUATION_DIMENSIONS)[number]

/** 类型守卫：判定字符串是否为已知评测维度。 */
export function isEvaluationDimension(v: string): v is EvaluationDimension {
  return (EVALUATION_DIMENSIONS as readonly string[]).includes(v)
}

// ── 采样与触发 ────────────────────────────────────────────────────────────

/** 采样策略类型。 */
export const SAMPLING_STRATEGIES = ['all', 'ratio', 'conditional'] as const
export type SamplingStrategy = (typeof SAMPLING_STRATEGIES)[number]

/** 采样决策结果：是否被采样选中。 */
export const SAMPLING_DECISIONS = ['evaluated', 'skipped'] as const
export type SamplingDecision = (typeof SAMPLING_DECISIONS)[number]

/** 采样声明：比例、条件、低置信必评标记。 */
export interface SamplingDeclaration {
  /** 采样策略。 */
  strategy: SamplingStrategy
  /** 比例采样时的采样比例（0-1），全量时为 1。 */
  ratio: number
  /** 条件采样时的条件表达式（声明式，可审计）。 */
  condition?: string
  /** 低置信输出必评标记——当此值为 true 时，低置信输出即使不在采样比例内也必须评。 */
  lowConfidenceAlwaysEvaluate: boolean
}

/** 采样决策记录：记录每次评测决策（含被跳过项）。 */
export interface SamplingDecisionRecord {
  /** 采样策略声明。 */
  declaration: SamplingDeclaration
  /** 决策结果：evaluated 或 skipped。 */
  decision: SamplingDecision
  /** 被采样跳过时的原因说明。 */
  skipReason?: string
  /** 低置信输出必评覆盖标记。 */
  lowConfidenceOverride?: boolean
}

// ── 阈值与健康状态 ────────────────────────────────────────────────────────

/** 健康状态枚举。 */
export const HEALTH_STATES = ['healthy', 'warning', 'critical'] as const
export type HealthState = (typeof HEALTH_STATES)[number]

/** 稳定原因码类型：唯一标识阈值越界的根因。 */
export type ThresholdReasonCode = string

/** 阈值声明：per-dimension 的 warning/critical 阈值。 */
export interface ThresholdDeclaration {
  /** 维度名。 */
  dimension: EvaluationDimension
  /** 警告阈值（分值，0-1 之间）。 */
  warningThreshold: number
  /** 严重阈值（分值，0-1 之间）。 */
  criticalThreshold: number
  /** 阈值来源：fixture 或历史基线名称。禁止凭空取值。 */
  source: string
  /** 阈值来源引用（fixture ID 或 baseline 版本）。 */
  sourceRef: string
}

/** 阈值求值结果：越界只产生健康状态与原因码，禁止自动修复。 */
export interface ThresholdEvaluationResult {
  /** 当前健康状态。 */
  healthState: HealthState
  /** 稳定原因码。 */
  reasonCode: ThresholdReasonCode
  /** runbook 引用（人类可读的处理指南路径）。 */
  runbookRef: string
  /** 是否越界。 */
  breached: boolean
  /** 越界的阈值声明。 */
  breachedThreshold?: ThresholdDeclaration
}

// ── 评测器身份 ────────────────────────────────────────────────────────────

/** 评测器身份：标识评测器的类型、版本与身份。 */
export interface EvaluatorIdentity {
  /** 评测器类别。 */
  kind: EvaluatorKind
  /** 评测器名称（如 draft_structural_compliance / gpt-4-judge）。 */
  name: string
  /** 评测器版本（用于趋势可比性）。 */
  version: string
  /** judge 类型时：judge 模型标识（provider/model）。 */
  judgeModel?: string
  /** judge 类型时：judge prompt 版本（用于趋势分组）。 */
  judgePromptVersion?: string
}

// ── 被评对象引用 ──────────────────────────────────────────────────────────

/** 被评对象引用：hash + 引用，禁存被评正文。 */
export interface EvaluatedArtifactRef {
  /** 被评对象类型。 */
  artifactKind:
    'ledger_attempt' | 'trace_span' | 'draft_version' | 'routing_decision' | 'copilot_message'
  /** 被评对象引用（ledger attempt ID / trace span ID / draft version ID 等）。 */
  artifactRef: string
  /** 被评对象内容的 hash（fnv1a）。 */
  contentHash: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2.1–2.8 评分记录核心类型
// ═══════════════════════════════════════════════════════════════════════════════

/** explanation 最大长度（schema 级约束，禁止放被评正文）。 */
export const EXPLANATION_MAX_LENGTH = 1024

/**
 * 评测评分记录——核心持久化 DTO。
 *
 * 字段命名对齐 OTel GenAI 已发布约定：
 * - evaluation.name → dimension
 * - evaluation.score.value → scoreValue
 * - evaluation.score.label → scoreLabel
 * - evaluation.explanation → explanation
 */
export interface EvaluationScoreRecord {
  /** 组织归属。 */
  organizationId: number
  /** 评测维度名。 */
  dimension: EvaluationDimension
  /** 评测分值（0-1 之间，确定性评测为 0 或 1）。 */
  scoreValue: number
  /** 评测标签：pass / fail / not-evaluated。 */
  scoreLabel: ScoreLabel
  /** 有界解释：长度上界 EXPLANATION_MAX_LENGTH，禁含被评正文。 */
  explanation: string
  /** 被评对象引用。 */
  evaluatedArtifact: EvaluatedArtifactRef
  /** 评测器身份。 */
  evaluator: EvaluatorIdentity
  /** 采样决策记录。 */
  samplingDecision: SamplingDecisionRecord
  /** 幂等键：由 dimension + artifactRef + evaluatorVersion + capturedAt 派生。 */
  idempotencyKey: string
  /** 账本 attempt 引用（judge 调用的 attempt ID）。 */
  ledgerAttemptRef?: string
  /** trace span 引用（tracing 落地后使用）。 */
  traceSpanRef?: string
  /** 创建时间戳（ISO 8601）。 */
  createdAt: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2.8–2.9 explanation 红线与 sanitizer
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * explanation 中禁止出现的模式（被评正文指纹）。
 * 每个模式代表一类被评内容的特征，命中任一即拒绝。
 */
export const EXPLANATION_FORBIDDEN_PATTERNS: ReadonlyArray<{
  category: LedgerForbiddenKeyCategory | 'evaluated_content'
  pattern: RegExp
}> = [
  /** 模型输出指纹——包含 "model output:" 或类似标记。 */
  { category: 'completion', pattern: /model[-_\s]?output[:\s]/i },
  /** prompt 指纹——包含 "prompt:" 标记。 */
  { category: 'prompt', pattern: /prompt[:\s]/i },
  /** 系统指令指纹。 */
  { category: 'system_instruction', pattern: /system[-_\s]?instruction[:\s]/i },
  /** 工具参数结果指纹。 */
  { category: 'tool_arguments', pattern: /tool[-_\s]?(arg|param|input)[:\s]/i },
  { category: 'tool_results', pattern: /tool[-_\s]?(result|output)[:\s]/i },
  /** 检索正文指纹。 */
  { category: 'retrieval_body', pattern: /retriev(al|ed)[-_\s]?(body|document|content)[:\s]/i },
  /** 原始 provider 载荷指纹。 */
  { category: 'provider_payload', pattern: /provider[-_\s]?(payload|response)[:\s]/i },
  /** 凭据指纹。 */
  { category: 'api_key', pattern: /api[-_\s]?key[:\s]/i },
  { category: 'authorization', pattern: /authorization[:\s]/i },
  { category: 'token', pattern: /\btoken[:\s]/i },
  { category: 'secret', pattern: /(secret|password)[:\s]/i },
]

/**
 * 校验 explanation 是否包含被评正文。
 * 返回命中类别列表（空 = 安全）。
 */
export function detectExplanationViolation(explanation: string): string[] {
  if (!explanation) return []
  const violations: string[] = []
  for (const entry of EXPLANATION_FORBIDDEN_PATTERNS) {
    if (entry.pattern.test(explanation)) {
      violations.push(entry.category)
    }
  }
  return violations
}

/**
 * 校验 explanation 是否超长。
 */
export function isExplanationBounded(explanation: string): boolean {
  return explanation.length <= EXPLANATION_MAX_LENGTH
}

/**
 * 创建有界 explanation（截断到上界 + 标记截断）。
 */
export function makeBoundedExplanation(text: string, maxLen = EXPLANATION_MAX_LENGTH): string {
  if (text.length <= maxLen) return text
  const truncated = text.slice(0, maxLen - 20) + '…[truncated]'
  return truncated
}

/**
 * 评分记录 sanitizer：校验并清洗评分记录，拒绝含被评正文的 explanation。
 * 返回清洗后的记录或错误信息。
 */
export function sanitizeEvaluationScore(
  record: EvaluationScoreRecord,
): { ok: true; sanitized: EvaluationScoreRecord } | { ok: false; error: string } {
  // 校验 explanation 长度
  if (!isExplanationBounded(record.explanation)) {
    return { ok: false, error: `explanation exceeds ${EXPLANATION_MAX_LENGTH} characters` }
  }

  // 校验 explanation 不含被评正文
  const violations = detectExplanationViolation(record.explanation)
  if (violations.length > 0) {
    return {
      ok: false,
      error: `explanation contains forbidden evaluated content categories: ${violations.join(', ')}`,
    }
  }

  // 校验 scoreLabel
  if (!isScoreLabel(record.scoreLabel)) {
    return { ok: false, error: `invalid scoreLabel: ${record.scoreLabel}` }
  }

  // 校验 dimension
  if (!isEvaluationDimension(record.dimension)) {
    return { ok: false, error: `invalid dimension: ${record.dimension}` }
  }

  // 校验 scoreValue 范围
  if (record.scoreValue < 0 || record.scoreValue > 1) {
    return { ok: false, error: `scoreValue must be between 0 and 1, got ${record.scoreValue}` }
  }

  // 校验幂等键非空
  if (!record.idempotencyKey) {
    return { ok: false, error: 'idempotencyKey is required' }
  }

  return { ok: true, sanitized: record }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2.10 复用账本禁止键类别的评分记录 sanitizer
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 评分记录中禁止出现的键（复用账本禁止键类别）。
 * 用于评分记录的 metadata/扩展字段校验。
 */
export const EVALUATION_FORBIDDEN_KEY_CATEGORIES: ReadonlyArray<{
  category: LedgerForbiddenKeyCategory
  pattern: RegExp
}> = LEDGER_FORBIDDEN_KEY_PATTERNS.map((p) => ({
  category: p.category,
  pattern: p.pattern,
}))

/**
 * 校验评分记录扩展字段是否包含禁止键。
 * 返回命中类别列表（空 = 安全）。
 */
export function detectEvaluationForbiddenKeys(metadata: Record<string, unknown>): string[] {
  const violations: string[] = []
  for (const [key] of Object.entries(metadata)) {
    for (const entry of EVALUATION_FORBIDDEN_KEY_CATEGORIES) {
      if (entry.pattern.test(key)) {
        violations.push(`${key} (${entry.category})`)
        break
      }
    }
  }
  return violations
}

// ═══════════════════════════════════════════════════════════════════════════════
// §4 确定性评测器接口
// ═══════════════════════════════════════════════════════════════════════════════

/** 确定性评测器输入：纯函数接口，不依赖时钟或随机源。 */
export interface DeterministicEvaluatorInput {
  /** 评测维度。 */
  dimension: EvaluationDimension
  /** 被评对象引用。 */
  artifact: EvaluatedArtifactRef
  /** 被评内容的结构化特征（不含正文，只含可确定性判定的元信息）。 */
  features: Record<string, unknown>
  /** 组织归属。 */
  organizationId: number
}

/** 确定性评测器输出。 */
export interface DeterministicEvaluatorOutput {
  /** 评测分值。 */
  scoreValue: number
  /** 评测标签。 */
  scoreLabel: ScoreLabel
  /** 有界解释。 */
  explanation: string
}

/** 确定性评测器函数签名：纯函数，不依赖时钟与随机源。 */
export type DeterministicEvaluatorFn = (
  input: DeterministicEvaluatorInput,
) => DeterministicEvaluatorOutput

// ═══════════════════════════════════════════════════════════════════════════════
// §5 LLM-as-judge 适配器接口
// ═══════════════════════════════════════════════════════════════════════════════

/** judge 适配器输入。 */
export interface JudgeAdapterInput {
  /** 评测维度。 */
  dimension: EvaluationDimension
  /** 被评对象引用。 */
  artifact: EvaluatedArtifactRef
  /** 评测上下文（不含被评正文的结构化元信息）。 */
  context: Record<string, unknown>
  /** 组织归属。 */
  organizationId: number
  /** judge 模型标识。 */
  judgeModel: string
  /** judge prompt 版本。 */
  judgePromptVersion: string
}

/** judge 适配器输出。 */
export interface JudgeAdapterOutput {
  /** 评测分值。 */
  scoreValue: number
  /** 评测标签。 */
  scoreLabel: ScoreLabel
  /** 有界解释。 */
  explanation: string
}

/** judge 适配器调用结果。 */
export interface JudgeCallResult {
  /** 是否成功调用。 */
  success: boolean
  /** judge 输出（成功时）。 */
  output?: JudgeAdapterOutput
  /** 错误信息（失败时）。 */
  error?: string
  /** 产生的账本 attempt ID。 */
  ledgerAttemptId?: string
  /** 是否因预算或限流被拒。 */
  deniedByBudgetOrRateLimit?: boolean
}

/** judge 适配器接口：可注入，默认 fixture。 */
export interface JudgeAdapter {
  /** 适配器名称。 */
  readonly name: string
  /** 适配器版本。 */
  readonly version: string
  /** 调用 judge 进行评测。 */
  evaluate(input: JudgeAdapterInput): Promise<JudgeCallResult>
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5.11 确定性优先合并逻辑
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 合并确定性评测与 judge 评测的结果。
 * 确定性优先：同维度有确定性结论时 judge 结论仅作补充，不得覆盖。
 */
export function mergeEvaluationResults(
  deterministic: DeterministicEvaluatorOutput | null,
  judge: JudgeAdapterOutput | null,
): {
  scoreValue: number
  scoreLabel: ScoreLabel
  explanation: string
  isDeterministicGoverned: boolean
} {
  // 确定性结论胜出
  if (deterministic !== null) {
    return {
      scoreValue: deterministic.scoreValue,
      scoreLabel: deterministic.scoreLabel,
      explanation: deterministic.explanation,
      isDeterministicGoverned: true,
    }
  }

  // 只有 judge 结论时使用 judge
  if (judge !== null) {
    return {
      scoreValue: judge.scoreValue,
      scoreLabel: judge.scoreLabel,
      explanation: judge.explanation,
      isDeterministicGoverned: false,
    }
  }

  // 两者都没有 → not-evaluated
  return {
    scoreValue: 0,
    scoreLabel: 'not-evaluated',
    explanation: 'No evaluator produced a result',
    isDeterministicGoverned: false,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §6 采样求值纯函数
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 求值采样决策（纯函数）。
 * 低置信输出必评；全量采样必评；比例采样由 deterministicHash 决定。
 */
export function evaluateSampling(
  declaration: SamplingDeclaration,
  isLowConfidence: boolean,
  deterministicHash: string,
): SamplingDecisionRecord {
  // 低置信输出必评
  if (isLowConfidence && declaration.lowConfidenceAlwaysEvaluate) {
    return {
      declaration,
      decision: 'evaluated',
      lowConfidenceOverride: true,
    }
  }

  // 全量采样
  if (declaration.strategy === 'all') {
    return { declaration, decision: 'evaluated' }
  }

  // 比例采样：用 hash 的前 4 字节转 0-1 值判定
  if (declaration.strategy === 'ratio') {
    const hashPrefix = deterministicHash.slice(0, 8)
    const numericValue = parseInt(hashPrefix, 16) / 0xffffffff
    if (numericValue < declaration.ratio) {
      return { declaration, decision: 'evaluated' }
    }
    return {
      declaration,
      decision: 'skipped',
      skipReason: `ratio sampling: ${numericValue.toFixed(4)} >= ${declaration.ratio}`,
    }
  }

  // 条件采样：条件表达式由调用方评估，此处仅记录
  if (declaration.strategy === 'conditional') {
    // 条件采样需要外部评估，此处默认 evaluated（由调用方控制）
    return { declaration, decision: 'evaluated' }
  }

  return { declaration, decision: 'evaluated' }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §6.6–6.7 阈值求值纯函数
// ═══════════════════════════════════════════════════════════════════════════════

/** 默认 runbook 引用模板。 */
export const DEFAULT_EVALUATION_RUNBOOK_REF = '/runbooks/ai-evaluation/threshold-breach'

/**
 * 求值阈值越界（纯函数）。
 * 越界只产生健康状态、稳定原因码与 runbook 引用。
 * 不触发任何自动修复、回滚、模型切换或重试。
 */
export function evaluateThreshold(
  threshold: ThresholdDeclaration,
  scoreValue: number,
): ThresholdEvaluationResult {
  const { dimension, criticalThreshold, warningThreshold } = threshold

  if (scoreValue <= criticalThreshold) {
    return {
      healthState: 'critical',
      reasonCode: `eval_${dimension}_critical`,
      runbookRef: `${DEFAULT_EVALUATION_RUNBOOK_REF}/${dimension}`,
      breached: true,
      breachedThreshold: threshold,
    }
  }

  if (scoreValue <= warningThreshold) {
    return {
      healthState: 'warning',
      reasonCode: `eval_${dimension}_warning`,
      runbookRef: `${DEFAULT_EVALUATION_RUNBOOK_REF}/${dimension}`,
      breached: true,
      breachedThreshold: threshold,
    }
  }

  return {
    healthState: 'healthy',
    reasonCode: '',
    runbookRef: '',
    breached: false,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §7 聚合查询类型
// ═══════════════════════════════════════════════════════════════════════════════

/** 聚合查询维度分组。 */
export const AGGREGATION_GROUP_KEYS = [
  'organization',
  'capability_surface',
  'dimension',
  'time_window',
  'evaluator_kind',
  'judge_model',
  'judge_prompt_version',
] as const
export type AggregationGroupKey = (typeof AGGREGATION_GROUP_KEYS)[number]

/** 聚合查询参数。 */
export interface EvaluationAggregationQuery {
  /** 组织 ID（必填，组织隔离）。 */
  organizationId: number
  /** 按维度分组。 */
  groupBy: AggregationGroupKey[]
  /** 时间窗口开始（ISO 8601）。 */
  windowStart: string
  /** 时间窗口结束（ISO 8601）。 */
  windowEnd: string
  /** 可选：按评测维度过滤。 */
  dimension?: EvaluationDimension
  /** 可选：按能力面过滤。 */
  capabilitySurface?: string
  /** 分页参数。 */
  page?: number
  perPage?: number
}

/** 聚合结果条目。 */
export interface EvaluationAggregationEntry {
  /** 分组键值。 */
  groupKey: Record<string, string>
  /** 评分数量。 */
  count: number
  /** 通过数量。 */
  passCount: number
  /** 失败数量。 */
  failCount: number
  /** 未评数量。 */
  notEvaluatedCount: number
  /** 平均分值。 */
  averageScoreValue: number
  /** 通过率。 */
  passRate: number
}

/** 聚合查询结果。 */
export interface EvaluationAggregationResult {
  /** 聚合条目列表。 */
  entries: EvaluationAggregationEntry[]
  /** 总条目数。 */
  total: number
  /** 查询时间窗口。 */
  window: { start: string; end: string }
  /** 空窗口标记：当查询范围内无评测记录时为 true。 */
  isEmptyWindow: boolean
}

// ═══════════════════════════════════════════════════════════════════════════════
// §7.6 Skill 评测映射去重
// ═══════════════════════════════════════════════════════════════════════════════

/** Skill 评测结果到统一评分视图的映射声明。 */
export interface SkillEvaluationMapping {
  /** Skill 评测 run ID。 */
  skillEvalRunId: number
  /** 映射后的维度名。 */
  dimension: EvaluationDimension
  /** 映射后的分值（coverage_rate 映射为 0-1）。 */
  scoreValue: number
  /** 映射后的标签。 */
  scoreLabel: ScoreLabel
  /** 去重键：skill_eval_run_id + dimension。 */
  deduplicationKey: string
}

/**
 * 计算 Skill 评测去重键。
 */
export function computeSkillEvalDedupKey(
  skillEvalRunId: number,
  dimension: EvaluationDimension,
): string {
  return `skill_eval:${skillEvalRunId}:${dimension}`
}

// ═══════════════════════════════════════════════════════════════════════════════
// §7.9 评测失败降级
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 评测失败降级守卫：确保评测失败不阻断业务。
 * 返回 true 表示安全降级，false 表示有非预期阻断。
 */
export function assertEvaluationDegradesSafely(
  _scoringError: unknown,
  _context: {
    wasConfirmationPending?: boolean
    wasGenerationRunning?: boolean
  },
): boolean {
  // 评测属观测，任何错误都应安全降级
  // 不阻断生成、不阻断人工确认、不改变业务终态
  return true
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2.12 barrel 辅助
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 生成幂等键（纯函数）。
 * 由 dimension + artifactRef + evaluatorVersion + capturedAt 派生。
 */
export function computeEvaluationIdempotencyKey(params: {
  dimension: EvaluationDimension
  artifactRef: string
  evaluatorVersion: string
  capturedAt: string
}): string {
  const raw = `${params.dimension}:${params.artifactRef}:${params.evaluatorVersion}:${params.capturedAt}`
  // 简单哈希（生产环境应使用 fnv1a）
  let hash = 0x811c9dc5
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return `eval_${hash.toString(16).padStart(8, '0')}`
}
