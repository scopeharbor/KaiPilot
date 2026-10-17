/**
 * @aiproj/types — V3 Copilot 澄清与假设表达层契约（前后端共享）
 * v3-copilot-clarification-and-assumptions —— Copilot 的「我不知道什么」与「我假设了什么」表达层。
 *
 * 依赖轻量约束：纯类型 + 确定性纯函数，只依赖同包 `copilot-shared-contracts.js`
 * （共享契约的假设条目 / 置信度带类型与稳定序列化 / hash，消费不重定义）与
 * `triz-contradiction.js` 的 `deterministicHash`（同为纯 TS 零依赖）。禁止依赖
 * AdonisJS、React、数据库客户端、HTTP 客户端、外部网络、provider 凭证或真实模型 SDK。
 *
 * 红线（本契约在类型层承载，配合后端/前端聚焦测试钉死）：
 * - 三档语义全局统一：critical 阻断（未补齐不产出变更动作、不推荐下游分析）、
 *   recommended 可替代记录在案的默认值（必须伴随假设条目）、optional 可跳过
 * - 置信度由声明的来源强度档派生，禁止自由取值 / 模型自报
 * - 替代默认值而无声明的假设条目 = 静默默认路径，禁止（无 silent-default 路径）
 * - 假设逐条可编辑，编辑后下游建议必须标记需重新审查，不得静默改写已审查过的差异
 * - 澄清轮数有上界，到界必须给出两条明确出路（以默认值继续 / 结束本轮），禁止无界追问
 * - 澄清问题 / 假设文案不得命名、计数或暗示 actor 不可访问实体的存在；
 *   权限缺失致缺口只能表述为通用能力受限
 * - 同输入（归一化输入 + 槽位状态 + 来源 hash + 目录版本）产出完全确定
 */

import { deterministicHash } from './triz-contradiction.js'
import type { CopilotAssumptionEntry } from './copilot-shared-contracts.js'
import { copilotStableSerialize } from './copilot-shared-contracts.js'

// ===========================================================================
// 2.3 三档枚举与语义
// ===========================================================================

export const CLARIFICATION_TIERS = ['critical', 'recommended', 'optional'] as const
export type ClarificationTier = (typeof CLARIFICATION_TIERS)[number]

export interface ClarificationTierSemantics {
  readonly label: string
  readonly meaning: string
}

/** 三档语义全局统一（与既有 ai_intent 目录及 AiProjectIntentWorkspace 中文文案对齐）。 */
export const CLARIFICATION_TIER_SEMANTICS: Record<ClarificationTier, ClarificationTierSemantics> = {
  critical: {
    label: '关键必答',
    meaning: '未补齐时阻断：不得产出变更类动作、不得推荐下游分析。',
  },
  recommended: {
    label: '建议补充',
    meaning: '可替代记录在案的默认值，但必须伴随一条可审计的假设条目。',
  },
  optional: {
    label: '可选优化',
    meaning: '可跳过且不产生假设条目，仅用于贴近偏好。',
  },
}

export function isClarificationTier(v: unknown): v is ClarificationTier {
  return typeof v === 'string' && (CLARIFICATION_TIERS as readonly string[]).includes(v)
}

export function clarificationTierSemantics(tier: ClarificationTier): ClarificationTierSemantics {
  return CLARIFICATION_TIER_SEMANTICS[tier]
}

// ===========================================================================
// 2.2 影响范围（域 + severity）与问题类型
// ===========================================================================

export const CLARIFICATION_IMPACT_SEVERITIES = ['high', 'medium', 'low'] as const
export type ClarificationImpactSeverity = (typeof CLARIFICATION_IMPACT_SEVERITIES)[number]

export function isClarificationImpactSeverity(v: unknown): v is ClarificationImpactSeverity {
  return typeof v === 'string' && (CLARIFICATION_IMPACT_SEVERITIES as readonly string[]).includes(v)
}

export interface ClarificationImpactScope {
  readonly domain: string
  readonly severity: ClarificationImpactSeverity
}

/** 与既有 `ai-intent` 的 CopilotClarificationQuestionType 对齐（text/date/single_choice/multi_choice/number）。 */
export const COPILOT_CLARIFICATION_QUESTION_TYPES = [
  'text',
  'single_choice',
  'multi_choice',
  'number',
  'date',
] as const
export type CopilotClarificationQuestionType = (typeof COPILOT_CLARIFICATION_QUESTION_TYPES)[number]

export function isClarificationQuestionType(v: unknown): v is CopilotClarificationQuestionType {
  return (
    typeof v === 'string' && (COPILOT_CLARIFICATION_QUESTION_TYPES as readonly string[]).includes(v)
  )
}

export interface CopilotClarificationQuickOption {
  readonly label: string
  readonly value: string | number
  readonly description?: string
  /** 推荐项标记（选择策略优先 quickOptions 且推荐项优先）。 */
  readonly recommended?: boolean
}

// ===========================================================================
// 2.5 来源强度档 + 2.6 置信度派生（纯函数，禁止自由取值）
// ===========================================================================

export const CLARIFICATION_SOURCE_STRENGTHS = [
  'domain_standard', // 领域标准
  'organization_config', // 组织配置
  'project_history', // 项目历史
  'catalog_median', // 目录中位
  'unsupported_guess', // 无依据推测
] as const
export type ClarificationSourceStrength = (typeof CLARIFICATION_SOURCE_STRENGTHS)[number]

export function isClarificationSourceStrength(v: unknown): v is ClarificationSourceStrength {
  return typeof v === 'string' && (CLARIFICATION_SOURCE_STRENGTHS as readonly string[]).includes(v)
}

/**
 * 来源强度 → 置信度（0–100）的**唯一**映射表。
 * 置信度不得由模型估计或调用方自由取值；相同来源强度产出相同置信度（契约测试钉死）。
 * 档位语义：domain_standard 90（高） / organization_config 80（高） /
 * project_history 70（中） / catalog_median 55（中） / unsupported_guess 25（低）。
 */
export const CLARIFICATION_CONFIDENCE_BY_SOURCE_STRENGTH: Readonly<
  Record<ClarificationSourceStrength, number>
> = {
  domain_standard: 90,
  organization_config: 80,
  project_history: 70,
  catalog_median: 55,
  unsupported_guess: 25,
}

export function deriveConfidenceFromSourceStrength(strength: ClarificationSourceStrength): number {
  return CLARIFICATION_CONFIDENCE_BY_SOURCE_STRENGTH[strength]
}

// ===========================================================================
// 2.1 / 2.2 可注册澄清字段形状
// ===========================================================================

export interface ClarificationDefaultValue {
  readonly value: string | number | readonly (string | number)[]
  readonly sourceStrength: ClarificationSourceStrength
  /** 为什么采用这个默认值（替代原因，进入假设条目的 substitutionReason）。 */
  readonly reason: string
}

export interface RegisteredClarificationField {
  /** 字段 ID（destination 内唯一；全目录内唯一）。 */
  readonly fieldId: string
  /** 所属 destination（共享契约注册表；消费不重定义）。 */
  readonly destination: string
  readonly tier: ClarificationTier
  readonly title: string
  readonly description: string
  readonly impactScope: readonly ClarificationImpactScope[]
  readonly questionType: CopilotClarificationQuestionType
  readonly quickOptions: readonly CopilotClarificationQuickOption[]
  readonly defaultValue?: ClarificationDefaultValue
}

// ===========================================================================
// 2.4 槽位填充状态机
// ===========================================================================

export const SLOT_FILL_STATES = [
  'unasked', // 未询问
  'asked_pending', // 已询问待答
  'answered', // 已回答
  'filled_with_default', // 已用默认值
  'skipped', // 已跳过
  'blocked', // 已阻断（critical 未补齐 / 权限缺失）
] as const
export type SlotFillState = (typeof SLOT_FILL_STATES)[number]

export function isSlotFillState(v: unknown): v is SlotFillState {
  return typeof v === 'string' && (SLOT_FILL_STATES as readonly string[]).includes(v)
}

/** 合法迁移表：无「unasked → answered」直跳（未问即答视为缺陷）。 */
export const SLOT_FILL_TRANSITIONS: Readonly<Record<SlotFillState, readonly SlotFillState[]>> = {
  unasked: ['asked_pending'],
  asked_pending: ['answered', 'filled_with_default', 'skipped', 'blocked'],
  answered: ['answered'], // 已确认保持（多轮间不重复询问已答槽位）
  filled_with_default: ['answered', 'filled_with_default'], // 可被用户编辑为 answered
  skipped: ['skipped'],
  blocked: ['blocked'],
}

export function canSlotTransition(from: SlotFillState, to: SlotFillState): boolean {
  return SLOT_FILL_TRANSITIONS[from].includes(to)
}

export interface ClarificationSlotState {
  readonly fieldId: string
  readonly state: SlotFillState
}

// ===========================================================================
// 2.10 不确定三分类（与上下文层分类一致，供澄清文案安全选词）
// ===========================================================================

export const UNCERTAINTY_KINDS = [
  'nothing_exists', // 不存在
  'not_accessible_to_actor', // 对本 actor 不可访问
  'no_match', // 未匹配查询
] as const
export type ClarificationUncertaintyKind = (typeof UNCERTAINTY_KINDS)[number]

export function isClarificationUncertaintyKind(v: unknown): v is ClarificationUncertaintyKind {
  return typeof v === 'string' && (UNCERTAINTY_KINDS as readonly string[]).includes(v)
}

/**
 * 不确定分类 → 澄清文案选词。
 * 非泄露关键：`not_accessible_to_actor` 只表述为通用能力受限，
 * 不得命名、计数或暗示存在不可访问的实体。
 */
export function uncertaintyKindWording(kind: ClarificationUncertaintyKind): string {
  switch (kind) {
    case 'nothing_exists':
      return '当前范围内不存在相关信息'
    case 'not_accessible_to_actor':
      return genericCapabilityNotice()
    case 'no_match':
      return '未检索到与查询匹配的信息'
  }
}

/** 权限缺失致缺口时的通用能力受限表述（唯一文案，两个 actor 的差异仅此一条）。 */
export function genericCapabilityNotice(): string {
  return '当前环境的信息访问能力受限，无法确认该项'
}

// ===========================================================================
// 2.11 澄清轮数上界与两条出路
// ===========================================================================

/**
 * 澄清默认最大轮数——必须 ≥ 意图目录的 COPILOT_INTENT_MAX_CLARIFICATION_ROUNDS，
 * 否则澄清状态机先于意图路由收束。2026 随其上调至 99（同语义：实际上不限制）。
 */
export const CLARIFICATION_DEFAULT_MAX_ROUNDS = 99 as const

export const CLARIFICATION_ROUND_EXITS = ['proceed_with_defaults', 'end_turn'] as const
export type ClarificationRoundExit = (typeof CLARIFICATION_ROUND_EXITS)[number]

export function isClarificationRoundExit(v: unknown): v is ClarificationRoundExit {
  return typeof v === 'string' && (CLARIFICATION_ROUND_EXITS as readonly string[]).includes(v)
}

/** 达到（或超过）声明的轮数上界后禁止继续追问。 */
export function reachedClarificationRoundBound(
  roundsElapsed: number,
  maxRounds: number = CLARIFICATION_DEFAULT_MAX_ROUNDS,
): boolean {
  return roundsElapsed >= maxRounds
}

// ===========================================================================
// 2.8 假设条目构造器（消费共享契约 CopilotAssumptionEntry，不重定义）
// ===========================================================================

export interface ClarificationAssumptionInput {
  readonly fieldId: string
  /** 低敏陈述（不得含 prompt / 模型输出全文 / 证据正文 / 凭据；写入前应过 sanitizer）。 */
  readonly statement: string
  readonly sourceStrength: ClarificationSourceStrength
  readonly substitutionReason: string
  readonly editable?: boolean
}

/**
 * 假设条目 + 本层元数据的伴随记录。
 * 共享契约条目（CopilotAssumptionEntry）承载假设身份与派生置信度；
 * 来源强度与替代原因等本层语义放在伴随记录里，**不重定义共享条目类型**。
 */
export interface ClarificationAssumptionRecord {
  readonly entry: CopilotAssumptionEntry
  readonly fieldId: string
  readonly sourceStrength: ClarificationSourceStrength
  readonly substitutionReason: string
}

/**
 * 稳定 ID 派生：相同（fieldId, statement, sourceStrength）输入产出相同 ID（可复现、互不冲突），
 * 键序无关（经 copilotStableSerialize）。确定性测试 2.13 / 5.4 钉死。
 */
export function makeClarificationAssumptionId(input: {
  fieldId: string
  statement: string
  sourceStrength: ClarificationSourceStrength
}): string {
  const serialized = copilotStableSerialize({
    fieldId: input.fieldId,
    statement: input.statement,
    sourceStrength: input.sourceStrength,
  })
  return `cla_${deterministicHash(serialized)}`
}

export function makeClarificationAssumption(
  input: ClarificationAssumptionInput,
): ClarificationAssumptionRecord {
  const entry: CopilotAssumptionEntry = {
    assumptionId: makeClarificationAssumptionId(input),
    statement: input.statement,
    source: 'default', // 与 ai_intent/catalog defaultMarker.source 对齐
    confidence: deriveConfidenceFromSourceStrength(input.sourceStrength),
    usedDefault: true,
    needsConfirmation: true,
    editable: input.editable ?? true,
  }
  return {
    entry,
    fieldId: input.fieldId,
    sourceStrength: input.sourceStrength,
    substitutionReason: input.substitutionReason,
  }
}

// ===========================================================================
// 2.9 「依赖替代默认值」标记（供动作边界的确认阻断消费）
// ===========================================================================

export const RELIES_ON_SUBSTITUTED_DEFAULT = 'relies_on_substituted_default' as const

/**
 * 由假设条目集合派生「依赖替代默认值」标记：
 * 任一条目 usedDefault 即视为该建议依赖了替代默认值。
 * 动作边界（copilot-action-boundary）据此在假设清单未接入时阻断确认。
 */
export function deriveRelianceMarker(
  assumptions: readonly CopilotAssumptionEntry[],
): typeof RELIES_ON_SUBSTITUTED_DEFAULT | null {
  return assumptions.some((a) => a.usedDefault) ? RELIES_ON_SUBSTITUTED_DEFAULT : null
}

// ===========================================================================
// 3.5 按影响 severity 排序（高影响在前；同 severity 按档位、再按字段 ID 保持确定）
// ===========================================================================

const CLARIFICATION_SEVERITY_RANK: Record<ClarificationImpactSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

const CLARIFICATION_TIER_RANK: Record<ClarificationTier, number> = {
  critical: 0,
  recommended: 1,
  optional: 2,
}

function maxSeverityRank(field: RegisteredClarificationField): number {
  if (field.impactScope.length === 0) return 2
  return Math.min(...field.impactScope.map((s) => CLARIFICATION_SEVERITY_RANK[s.severity]))
}

export function sortClarificationQuestionsByImpact(
  fields: readonly RegisteredClarificationField[],
): RegisteredClarificationField[] {
  return [...fields].sort((a, b) => {
    const bySeverity = maxSeverityRank(a) - maxSeverityRank(b)
    if (bySeverity !== 0) return bySeverity
    const byTier = CLARIFICATION_TIER_RANK[a.tier] - CLARIFICATION_TIER_RANK[b.tier]
    if (byTier !== 0) return byTier
    return a.fieldId.localeCompare(b.fieldId)
  })
}

// ===========================================================================
// 2.13 字段注册完整性校验（未知档位拒绝 + 必填属性无遗漏）
// ===========================================================================

export interface ClarificationRegistryValidation {
  readonly valid: boolean
  readonly issues: readonly string[]
}

export function validateClarificationFieldRegistry(
  fields: readonly RegisteredClarificationField[],
): ClarificationRegistryValidation {
  const issues: string[] = []
  const seen = new Set<string>()
  fields.forEach((field, i) => {
    const at = `字段[${i}](${field?.fieldId ?? '?'})`
    if (!field || typeof field.fieldId !== 'string' || field.fieldId.length === 0) {
      issues.push(`${at} 缺少 fieldId`)
      return
    }
    if (seen.has(field.fieldId)) {
      issues.push(`${at} fieldId 重复`)
    }
    seen.add(field.fieldId)
    if (typeof field.destination !== 'string' || field.destination.length === 0) {
      issues.push(`${at} 缺少所属 destination`)
    }
    if (!isClarificationTier(field.tier)) {
      issues.push(`${at} 档位未知（拒绝）：${String(field.tier)}`)
    }
    if (typeof field.title !== 'string' || field.title.length === 0) {
      issues.push(`${at} 缺少标题`)
    }
    if (typeof field.description !== 'string' || field.description.length === 0) {
      issues.push(`${at} 缺少说明`)
    }
    if (!Array.isArray(field.impactScope) || field.impactScope.length === 0) {
      issues.push(`${at} 缺少影响范围`)
    } else {
      field.impactScope.forEach((scope, j) => {
        if (!scope || typeof scope.domain !== 'string' || scope.domain.length === 0) {
          issues.push(`${at} impactScope[${j}] 缺少域`)
        }
        if (!isClarificationImpactSeverity(scope?.severity)) {
          issues.push(`${at} impactScope[${j}] severity 未知：${String(scope?.severity)}`)
        }
      })
    }
    if (!isClarificationQuestionType(field.questionType)) {
      issues.push(`${at} questionType 未知：${String(field.questionType)}`)
    }
    if (!Array.isArray(field.quickOptions)) {
      issues.push(`${at} 缺少 quickOptions`)
    } else {
      field.quickOptions.forEach((option, j) => {
        if (!option || typeof option.label !== 'string' || option.label.length === 0) {
          issues.push(`${at} quickOptions[${j}] 缺少 label`)
        }
        const vt = typeof option?.value
        if (vt !== 'string' && vt !== 'number') {
          issues.push(`${at} quickOptions[${j}] value 类型非法：${vt}`)
        }
      })
    }
    if (field.defaultValue !== undefined && field.defaultValue !== null) {
      if (!isClarificationSourceStrength(field.defaultValue.sourceStrength)) {
        issues.push(
          `${at} defaultValue.sourceStrength 未知：${String(field.defaultValue.sourceStrength)}`,
        )
      }
      if (typeof field.defaultValue.reason !== 'string' || field.defaultValue.reason.length === 0) {
        issues.push(`${at} defaultValue 缺少替代原因`)
      }
    }
  })
  return { valid: issues.length === 0, issues }
}

// ===========================================================================
// 8.1 确定性输入元组
// ===========================================================================

export interface ClarificationDeterminismInput {
  /** 归一化输入（不含原始 prompt 全文，只含低敏归一化摘要）。 */
  readonly normalizedInput: string
  /** 槽位状态（键序无关）。 */
  readonly slotStates: Readonly<Record<string, SlotFillState>>
  /** 来源 hash（稳定排序后参与）。 */
  readonly sourceHash: string
  /** 目录版本。 */
  readonly catalogVersion: string
}

/** 确定性键：相同输入元组（键序无关）产出相同键。 */
export function computeClarificationDeterminismKey(input: ClarificationDeterminismInput): string {
  return deterministicHash(copilotStableSerialize(input))
}

// ===========================================================================
// 5.8 假设条目 / 澄清文案的低敏约束（sanitizer）
// ===========================================================================

const CLARIFICATION_SENSITIVE_TEXT_PATTERNS: Readonly<{ pattern: RegExp; reason: string }[]> = [
  { pattern: /authorization\s*:/i, reason: 'Authorization 头' },
  { pattern: /bearer\s+[a-z0-9._-]{16,}/i, reason: 'Bearer token' },
  { pattern: /\bsk-[a-z0-9]{16,}/i, reason: 'API key（sk- 前缀）' },
  { pattern: /\bpassword\s*[:=]/i, reason: '口令' },
  { pattern: /\bapi[_-]?key\s*[:=]/i, reason: 'API key 声明' },
  { pattern: /system\s*prompt\s*:/i, reason: 'prompt 全文' },
  { pattern: /model\s*output\s*:/i, reason: '模型输出全文' },
  { pattern: /\bevidence\s*body\s*:/i, reason: '证据正文' },
  { pattern: /raw\s*payload\s*:/i, reason: '原始载荷' },
  { pattern: /private\s*key\s*:/i, reason: '私钥' },
]

export function rejectClarificationSensitiveText(text: string): {
  safe: boolean
  reasons: readonly string[]
} {
  const reasons: string[] = []
  if (typeof text !== 'string') return { safe: false, reasons: ['非字符串内容'] }
  if (text.length === 0) return { safe: true, reasons }
  for (const entry of CLARIFICATION_SENSITIVE_TEXT_PATTERNS) {
    if (entry.pattern.test(text)) {
      reasons.push(entry.reason)
    }
  }
  return { safe: reasons.length === 0, reasons }
}
