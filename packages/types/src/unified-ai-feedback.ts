/**
 * v3-unified-ai-feedback-ledger —— 统一 AI 反馈账本共享契约。
 *
 * 跨全部 AI 能力面的人类反馈账本：
 * - 统一反馈事件形状，沿用既有五态语义（accepted/rejected/modified/skipped/pending）；
 * - modified 与 accepted 必须分开统计，任何复合采纳率必须同时给出分量；
 * - 拒绝原因产品化枚举，比分数更有用；
 * - 改动以字段名 + 幅度档 + hash 表达，禁存正文；
 * - 采纳率口径写死在契约层（分母排除 pending，skipped 计入但单独可见）；
 * - 复用 unified-ai-invocation-ledger 的禁止键类别实现低敏 sanitizer；
 * - 禁止隐式反馈推断。
 *
 * 纯静态类型 + const 数组 + 确定性纯函数，零运行时/DB/网络依赖。
 */

import {
  LEDGER_FORBIDDEN_KEY_CATEGORIES,
  LEDGER_FORBIDDEN_KEY_PATTERNS,
  LEDGER_METADATA_ALLOWLIST,
  type LedgerForbiddenKeyCategory,
} from './unified-ai-invocation-ledger.js'

// ===========================================================================
// §2.2 反馈类型枚举 —— 沿用既有五态语义，不新造第六种
// ===========================================================================

/**
 * 反馈类型枚举。直接沿用 `ai_draft_layer_changes.review_status` 的五态语义。
 * 不引入第六种状态。
 */
export const FEEDBACK_TYPES = [
  'accepted', // 按原样接受
  'rejected', // 拒绝
  'modified', // 修改后接受（方向对、细节错）
  'skipped', // 跳过（轻量否决）
  'pending', // 待决（未判断）
] as const
export type FeedbackType = (typeof FEEDBACK_TYPES)[number]

export function isFeedbackType(v: unknown): v is FeedbackType {
  return typeof v === 'string' && (FEEDBACK_TYPES as readonly string[]).includes(v)
}

export function assertFeedbackType(v: unknown): FeedbackType {
  if (!isFeedbackType(v)) {
    throw new Error(`Invalid FeedbackType: ${String(v)}`)
  }
  return v
}

// ===========================================================================
// §2.4 被反馈对象引用类型
// ===========================================================================

/**
 * 被反馈对象的类型标识。覆盖所有 AI 能力面的输出。
 */
export const EVALUATED_ARTIFACT_KINDS = [
  'draft_layer_change', // 草案层变更
  'copilot_action', // Copilot 动作
  'suggestion', // 建议
  'prediction_explanation', // 预测解释
  'triz_rationale', // TRIZ 理由
  'report_draft', // 报告草案
] as const
export type EvaluatedArtifactKind = (typeof EVALUATED_ARTIFACT_KINDS)[number]

export function isEvaluatedArtifactKind(v: unknown): v is EvaluatedArtifactKind {
  return typeof v === 'string' && (EVALUATED_ARTIFACT_KINDS as readonly string[]).includes(v)
}

// ===========================================================================
// §2.2 能力面标识
// ===========================================================================

/**
 * 能力面标识。反馈来自哪个 AI 能力面。
 */
export const FEEDBACK_CAPABILITY_SURFACES = [
  'draft', // AI 草案生成
  'copilot', // Copilot 编排
  'triz', // TRIZ 分析
  'compiler', // Compiler 编排
  'ocr', // OCR 文档处理
  'evaluation', // AI 评测
  'ranking', // AI 排序
  'general', // 通用问答
] as const
export type FeedbackCapabilitySurface = (typeof FEEDBACK_CAPABILITY_SURFACES)[number]

// ===========================================================================
// §2.5 拒绝原因产品化枚举
// ===========================================================================

/**
 * 拒绝原因枚举。以项目管理术语表达，比分数更有用。
 * 「38% 的拒绝里有一半是粒度不合适」→ 改什么。
 */
export const REJECTION_REASONS = [
  'factual_error', // 事实错误
  'not_applicable', // 不适用本项目
  'wrong_granularity', // 粒度不合适
  'better_option_exists', // 已有更好方案
  'wrong_timing', // 时机不对
  'did_not_understand', // 不理解建议
  'other', // 其他
] as const
export type RejectionReason = (typeof REJECTION_REASONS)[number]

export function isRejectionReason(v: unknown): v is RejectionReason {
  return typeof v === 'string' && (REJECTION_REASONS as readonly string[]).includes(v)
}

export function rejectionReasonLabel(reason: RejectionReason): string {
  const labels: Record<RejectionReason, string> = {
    factual_error: '事实错误',
    not_applicable: '不适用本项目',
    wrong_granularity: '粒度不合适',
    better_option_exists: '已有更好方案',
    wrong_timing: '时机不对',
    did_not_understand: '不理解建议',
    other: '其他',
  }
  return labels[reason]
}

// ===========================================================================
// §2.6 修改指纹类型 —— 禁含正文
// ===========================================================================

/**
 * 修改幅度档位。用于归类改动大小，不存原始值。
 */
export const MODIFICATION_MAGNITUDE_BANDS = [
  'trivial', // 微调（<10% 变化）
  'minor', // 小改（10-30% 变化）
  'medium', // 中等（30-60% 变化）
  'major', // 大改（>60% 变化）
  'structural', // 结构性改动（实体类型或关系变更）
] as const
export type ModificationMagnitudeBand = (typeof MODIFICATION_MAGNITUDE_BANDS)[number]

/**
 * 修改指纹。记录「改了什么字段、改动幅度档」而非改前改后正文。
 * 正文以 hash 与引用表达（继承禁存全文红线）。
 *
 * 红线：proposedValueHash 和 finalValueHash 是对正文内容的哈希，
 * 而非正文本身。proposedValue 和 finalValue 字段不存在。
 */
export interface ModificationFingerprint {
  /** 被改动的字段名 */
  readonly changedField: string
  /** 改动幅度档 */
  readonly magnitudeBand: ModificationMagnitudeBand
  /** AI 提议值的 hash（SHA-256 截断 16 位） */
  readonly proposedValueHash: string
  /** 用户最终取值的 hash（SHA-256 截断 16 位） */
  readonly finalValueHash: string
}

/**
 * 校验修改指纹不包含正文。
 * 返回 true 表示指纹合法（无正文字段）。
 */
export function isValidModificationFingerprint(fp: unknown): fp is ModificationFingerprint {
  if (!fp || typeof fp !== 'object') return false
  const obj = fp as Record<string, unknown>
  return (
    typeof obj.changedField === 'string' &&
    typeof obj.proposedValueHash === 'string' &&
    typeof obj.finalValueHash === 'string' &&
    (MODIFICATION_MAGNITUDE_BANDS as readonly string[]).includes(obj.magnitudeBand as string)
  )
}

// ===========================================================================
// §2.8 可选有界备注字段
// ===========================================================================

/** 备注最大长度（schema 级约束）。 */
export const FEEDBACK_NOTE_MAX_LENGTH = 500 as const

/**
 * 校验备注字段：可选，但不得替代拒绝原因枚举。
 * 如果反馈类型是 rejected 且有 note，则 rejectionReason 必须同时存在。
 */
export function validateFeedbackNote(
  note: string | null | undefined,
  feedbackType: FeedbackType,
  rejectionReason: RejectionReason | null | undefined,
): { valid: boolean; error?: string } {
  if (note != null && note.length > FEEDBACK_NOTE_MAX_LENGTH) {
    return { valid: false, error: `Note exceeds max length of ${FEEDBACK_NOTE_MAX_LENGTH}` }
  }
  if (feedbackType === 'rejected' && !rejectionReason && note) {
    return {
      valid: false,
      error: 'Rejection must carry an enumerated reason; note cannot substitute',
    }
  }
  return { valid: true }
}

// ===========================================================================
// §2.10 采纳率指标契约 —— 口径写死
// ===========================================================================

/**
 * 采纳率计算结果。
 *
 * 口径写死在契约层：
 * - 分母排除 pending（未判断不算判断）
 * - skipped 计入分母但单独可见（轻量否决）
 * - modified 与 accepted 永远分开
 */
export interface AdoptionRateResult {
  /** 被接受（按原样）的数量 */
  readonly accepted: number
  /** 修改后接受的数量（方向对、细节错） */
  readonly modified: number
  /** 被拒绝的数量 */
  readonly rejected: number
  /** 被跳过的数量（轻量否决） */
  readonly skipped: number
  /** 待决的数量（不计入分母） */
  readonly pending: number

  /**
   * 采纳率 = (accepted + modified) / (accepted + modified + rejected + skipped)
   * 分母排除 pending。null 表示分母为零（无决策）。
   */
  readonly adoptionRate: number | null

  /**
   * 覆盖率 = 分母 / (分母 + pending)
   * 使低样本量的采纳率可见其弱。
   */
  readonly coverage: number

  /** 分母实际决策数 */
  readonly denominator: number
}

/**
 * 计算采纳率。纯函数，口径写死。
 *
 * 分母 = accepted + modified + rejected + skipped（排除 pending）
 * 采纳率 = (accepted + modified) / 分母
 * 覆盖率 = 分母 / (分母 + pending)
 */
export function computeAdoptionRate(
  accepted: number,
  modified: number,
  rejected: number,
  skipped: number,
  pending: number,
): AdoptionRateResult {
  const denominator = accepted + modified + rejected + skipped
  const total = denominator + pending
  return {
    accepted,
    modified,
    rejected,
    skipped,
    pending,
    adoptionRate: denominator > 0 ? (accepted + modified) / denominator : null,
    coverage: total > 0 ? denominator / total : 0,
    denominator,
  }
}

// ===========================================================================
// §2.11 拒绝原因分布
// ===========================================================================

/** 拒绝原因分布。每个原因对应的计数。 */
export interface RejectionReasonDistribution {
  readonly reason: RejectionReason
  readonly count: number
  /** 占总拒绝数的比例 */
  readonly proportion: number
}

// ===========================================================================
// §2.1 反馈事件主接口
// ===========================================================================

/**
 * 统一反馈事件。跨全部 AI 能力面的 per-decision 反馈记录。
 *
 * 红线：
 * - 不存 AI 提议正文、用户输入正文、prompt、模型输出、凭据
 * - modified 与 accepted 永远分开
 * - 只记显式决策，禁止隐式反馈推断
 */
export interface UnifiedFeedbackEvent {
  /** 主键 */
  readonly id: number
  /** 组织 ID（组织隔离） */
  readonly organizationId: number
  /** 项目 ID（可选） */
  readonly projectId: number | null

  // ── 被反馈对象引用 ──
  /** 被反馈对象类型 */
  readonly artifactKind: EvaluatedArtifactKind
  /** 被反馈对象 ID */
  readonly artifactId: string
  /** 能力面 */
  readonly capabilitySurface: FeedbackCapabilitySurface

  // ── 反馈内容 ──
  /** 反馈类型（五态） */
  readonly feedbackType: FeedbackType
  /** 拒绝原因（仅 rejected 时必填） */
  readonly rejectionReason: RejectionReason | null
  /** 修改指纹（仅 modified 时必填） */
  readonly modificationFingerprint: ModificationFingerprint | null
  /** 可选有界备注 */
  readonly note: string | null

  // ── 指纹（禁存正文） ──
  /** AI 提议内容的 hash */
  readonly proposedContentHash: string | null
  /** 用户最终取值的 hash */
  readonly finalContentHash: string | null

  // ── 来源与追踪 ──
  /** 操作者 ID */
  readonly actorId: number
  /** 幂等键（防止重复记录） */
  readonly idempotencyKey: string
  /** 来源标识（标识反馈来自哪个端点/通道） */
  readonly sourceEndpoint: string
  /** 来源引用（如 draft_layer_change_id、run_id 等） */
  readonly sourceRef: string | null
  /** 去重键（同一决策只计一次） */
  readonly deduplicationKey: string | null

  // ── 时间 ──
  /** 反馈发生时间 */
  readonly occurredAt: string
  /** 记录创建时间 */
  readonly createdAt: string
}

// ===========================================================================
// §2.12 低敏 sanitizer —— 复用账本禁止键类别
// ===========================================================================

/**
 * 反馈事件禁止键类别。直接复用 unified-ai-invocation-ledger 的定义。
 * 反馈账本同样禁存：prompt/system instructions/模型输出全文/messages/
 * tool 参数结果/检索正文/原始 provider 载荷/token/secret/apiKey/Authorization。
 */
export const FEEDBACK_FORBIDDEN_KEY_CATEGORIES = LEDGER_FORBIDDEN_KEY_CATEGORIES

/**
 * 深度扫描反馈事件中的禁止内容键。
 * 复用账本的 ledgerDetectForbiddenKeys 逻辑。
 */
export function feedbackDetectForbiddenKeys(
  input: Record<string, unknown> | null | undefined,
): LedgerForbiddenKeyCategory[] {
  if (!input) return []
  const found = new Set<LedgerForbiddenKeyCategory>()
  const walk = (value: unknown, keyPrefix: string): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, keyPrefix)
      return
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const fullKey = keyPrefix ? `${keyPrefix}.${k}` : k
        for (const entry of LEDGER_FORBIDDEN_KEY_PATTERNS) {
          if (entry.pattern.test(fullKey)) {
            found.add(entry.category)
            break
          }
        }
        walk(v, fullKey)
      }
    }
  }
  walk(input, '')
  return [...found].sort()
}

/** 断言反馈事件无禁止内容键。返回布尔（不抛错）。 */
export function feedbackHasForbiddenKeys(
  input: Record<string, unknown> | null | undefined,
): boolean {
  return feedbackDetectForbiddenKeys(input).length > 0
}

/**
 * 低敏 sanitizer：过滤反馈事件，移除任何禁止内容键。
 * 返回新对象，绝不修改入参。
 */
export function sanitizeFeedbackEvent<T extends Record<string, unknown>>(event: T): T {
  const allowed = new Set<string>(LEDGER_METADATA_ALLOWLIST)
  // 添加反馈事件特有的允许键
  const feedbackAllowedKeys = new Set([
    'id',
    'organizationId',
    'projectId',
    'artifactKind',
    'artifactId',
    'capabilitySurface',
    'feedbackType',
    'rejectionReason',
    'note',
    'proposedContentHash',
    'finalContentHash',
    'actorId',
    'idempotencyKey',
    'sourceEndpoint',
    'sourceRef',
    'deduplicationKey',
    'occurredAt',
    'createdAt',
    'changedField',
    'magnitudeBand',
    'proposedValueHash',
    'finalValueHash',
  ])
  const merged = new Set([...allowed, ...feedbackAllowedKeys])
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event)) {
    if (merged.has(key)) safe[key] = value
  }
  return safe as T
}

// ===========================================================================
// §2.10 下游读接口形状（评测 / 排序消费）
// ===========================================================================

/**
 * 下游读接口返回的反馈摘要。
 * 只暴露 references、fingerprints、enumerated values 和 counts。
 * 不暴露存储内容。
 */
export interface FeedbackDownstreamSummary {
  /** 反馈类型计数 */
  readonly typeCounts: {
    readonly accepted: number
    readonly modified: number
    readonly rejected: number
    readonly skipped: number
    readonly pending: number
  }
  /** 采纳率 */
  readonly adoptionRate: AdoptionRateResult
  /** 拒绝原因分布 */
  readonly rejectionDistribution: readonly RejectionReasonDistribution[]
  /** 按能力面切分 */
  readonly bySurface: ReadonlyArray<{
    readonly surface: FeedbackCapabilitySurface
    readonly rate: AdoptionRateResult
  }>
}

// ===========================================================================
// §6.1 显式决策守卫 —— 禁止隐式反馈
// ===========================================================================

/**
 * 反馈记录守卫：只接受显式决策。
 * 未操作不被推断为负反馈。超时不产生隐式拒绝事件。
 * pending 就是 pending，不是 rejected。
 */
export function isExplicitDecision(feedbackType: FeedbackType): boolean {
  // 所有五态都是显式决策——pending 也是显式记录（用户明确标记为待决）
  return (FEEDBACK_TYPES as readonly string[]).includes(feedbackType)
}

/**
 * 校验反馈事件不包含隐式反馈标志。
 * 如果事件试图把 inaction/timeout 标记为 rejected，返回 false。
 */
export function rejectImplicitFeedback(
  event: Pick<UnifiedFeedbackEvent, 'feedbackType' | 'sourceEndpoint'>,
): { allowed: boolean; reason?: string } {
  // sourceEndpoint 为 'implicit_inaction' 或 'implicit_timeout' 的事件一律拒绝
  if (event.sourceEndpoint === 'implicit_inaction' || event.sourceEndpoint === 'implicit_timeout') {
    return {
      allowed: false,
      reason: 'Implicit feedback from inaction or timeout is forbidden',
    }
  }
  return { allowed: true }
}

// ===========================================================================
// §4.5 / §5 投影去重键
// ===========================================================================

/**
 * 生成去重键。同一决策只计一次。
 * 由 artifactKind + artifactId + organizationId 派生。
 */
export function computeFeedbackDeduplicationKey(
  artifactKind: EvaluatedArtifactKind,
  artifactId: string,
  organizationId: number,
): string {
  return `${organizationId}:${artifactKind}:${artifactId}`
}

// ===========================================================================
// §8.1 失败姿态 —— 观测可降级但用户决策不丢
// ===========================================================================

/**
 * 反馈记录失败时的降级策略。
 * 用户决策由业务路径持久化，本账本只是其观测投影。
 * 降级不丢数据——决策仍存在业务表中，投影可重新计算。
 */
export const FEEDBACK_RECORDING_DEGRADATION = {
  /** 反馈记账失败不得阻断业务决策路径 */
  mustNotBlockDecision: true as const,
  /** 反馈记账失败不得改变终态 */
  mustNotAlterTerminalState: true as const,
  /** 反馈记账失败不得丢弃用户决策 */
  mustNotLoseDecision: true as const,
} as const
