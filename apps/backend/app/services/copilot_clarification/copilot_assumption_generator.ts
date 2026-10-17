/**
 * Copilot 假设生成器（任务 5.1–5.9）
 *
 * 核心约束：
 * - 无假设条目不得替代默认值（无 silent-default 路径）
 * - 假设逐条可编辑，编辑后下游建议必须标记需重新审查
 * - 置信度由声明的来源强度档派生，禁止自由取值
 * - 假设条目数量上界与省略计数，禁止静默截断
 * - 低敏约束：不得含 prompt、模型输出全文、证据正文或凭据
 *
 * 本模块是纯函数，不依赖 AdonisJS、数据库或 HTTP。
 */
import {
  type RegisteredClarificationField,
  type ClarificationAssumptionRecord,
  type ClarificationSourceStrength,
  makeClarificationAssumption,
  rejectClarificationSensitiveText,
  RELIES_ON_SUBSTITUTED_DEFAULT,
} from '@aiproj/types'
import type { CopilotAssumptionEntry } from '@aiproj/types'

// ── 类型 ──

export interface AssumptionGenerationInput {
  /** 需要替代默认值的字段。 */
  readonly field: RegisteredClarificationField
  /** 替代原因（来自字段的 defaultValue.reason）。 */
  readonly reason: string
  /** 来源强度。 */
  readonly sourceStrength: ClarificationSourceStrength
  /** 替代的值。 */
  readonly value: string | number | readonly (string | number)[]
}

export interface AssumptionGenerationOutput {
  /** 生成的假设记录。 */
  readonly record: ClarificationAssumptionRecord
  /** 低敏检查是否通过。 */
  readonly sanitizerPassed: boolean
  /** sanitizer 拦截的原因（如有）。 */
  readonly sanitizerReasons: readonly string[]
}

export interface AssumptionListOutput {
  /** 所有假设记录。 */
  readonly records: readonly ClarificationAssumptionRecord[]
  /** 对应的 CopilotAssumptionEntry 数组（供动作边界消费）。 */
  readonly entries: readonly CopilotAssumptionEntry[]
  /** 依赖替代默认值标记（供动作边界的确认阻断消费）。 */
  readonly relianceMarker: typeof RELIES_ON_SUBSTITUTED_DEFAULT | null
  /** 假设条目数量是否超出上界。 */
  readonly truncated: boolean
  /** 被省略的假设条目数量。 */
  readonly omittedCount: number
}

export interface AssumptionEditInput {
  /** 原始假设记录。 */
  readonly original: ClarificationAssumptionRecord
  /** 编辑后的陈述。 */
  readonly newStatement: string
  /** 编辑后的来源强度。 */
  readonly newSourceStrength: ClarificationSourceStrength
  /** 编辑后的替代原因。 */
  readonly newReason: string
}

// ── 常量 ──

/** 假设条目数量上界（单个推荐动作）。 */
export const ASSUMPTION_LIST_MAX_ENTRIES = 20

/** 假设条目数量上界（单轮）。 */
export const ASSUMPTION_TURN_MAX_ENTRIES = 50

// ── 假设条目生成 ──

/**
 * 为单个字段生成假设条目（任务 5.1）。
 * 每个假设条目包含：陈述、来源、来源强度、派生置信度、替代原因、需确认标记、可编辑标记、稳定 ID。
 */
export function generateAssumption(input: AssumptionGenerationInput): AssumptionGenerationOutput {
  const { field, reason, sourceStrength } = input

  // 构造陈述
  const statement = buildAssumptionStatement(field, input.value, sourceStrength)

  // 低敏检查
  const sanitizer = rejectClarificationSensitiveText(statement)

  // 构造假设条目
  const record = makeClarificationAssumption({
    fieldId: field.fieldId,
    statement,
    sourceStrength,
    substitutionReason: reason,
    editable: true,
  })

  return {
    record,
    sanitizerPassed: sanitizer.safe,
    sanitizerReasons: sanitizer.reasons,
  }
}

/**
 * 构造假设陈述文案。
 * 不泄露不可访问实体信息（非泄露规则由上层保证）。
 */
function buildAssumptionStatement(
  field: RegisteredClarificationField,
  value: string | number | readonly (string | number)[],
  _sourceStrength: ClarificationSourceStrength,
): string {
  const valueStr = Array.isArray(value) ? value.join('、') : String(value)
  return `未明确${field.title.replace(/[？?]$/u, '')}，使用默认值 ${valueStr}。`
}

// ── 假设列表生成（任务 5.2–5.5）──

/**
 * 为多个字段生成假设条目列表。
 *
 * 约束（任务 5.2）：无假设条目不得替代默认值——
 * 本函数是唯一允许替代默认值的路径。
 *
 * 约束（任务 5.5）：数量上界与省略计数。
 */
export function generateAssumptionList(
  inputs: readonly AssumptionGenerationInput[],
  maxEntries: number = ASSUMPTION_LIST_MAX_ENTRIES,
): AssumptionListOutput {
  const records: ClarificationAssumptionRecord[] = []
  let totalOmitted = 0

  for (const input of inputs) {
    if (records.length >= maxEntries) {
      totalOmitted++
      continue
    }

    const output = generateAssumption(input)
    if (output.sanitizerPassed) {
      records.push(output.record)
    } else {
      // sanitizer 拦截：不产生假设条目，也不替代默认值
      // 这保证了"无假设条目不得替代默认值"的约束
      totalOmitted++
    }
  }

  const entries = records.map((r) => r.entry)
  const relianceMarker = entries.some((e) => e.usedDefault) ? RELIES_ON_SUBSTITUTED_DEFAULT : null

  return {
    records,
    entries,
    relianceMarker,
    truncated: totalOmitted > 0,
    omittedCount: totalOmitted,
  }
}

// ── 假设编辑（任务 5.6–5.7）──

/**
 * 编辑单条假设，不丢弃其余（任务 7.3）。
 * 编辑后重算置信度，标记需重新审查。
 */
export function editAssumption(input: AssumptionEditInput): ClarificationAssumptionRecord {
  const { original, newStatement, newSourceStrength, newReason } = input

  // 低敏检查
  const sanitizer = rejectClarificationSensitiveText(newStatement)
  if (!sanitizer.safe) {
    throw new Error(`假设陈述包含敏感内容：${sanitizer.reasons.join('、')}`)
  }

  // 重新生成假设条目（新 ID 可能不同）
  return makeClarificationAssumption({
    fieldId: original.fieldId,
    statement: newStatement,
    sourceStrength: newSourceStrength,
    substitutionReason: newReason,
    editable: true,
  })
}

/**
 * 标记下游建议需重新审查（任务 5.6）。
 * 当假设编辑后，所有依赖该假设的下游建议必须标记为需重新审查。
 */
export interface DownstreamReviewMark {
  /** 建议 ID。 */
  readonly recommendationId: string
  /** 是否需重新审查。 */
  readonly needsReReview: boolean
  /** 原因。 */
  readonly reason: string
}

/**
 * 判断一个下游建议是否依赖于被编辑的假设。
 * 简化实现：如果建议的 assumptions 列表中包含被编辑假设的 fieldId，
 * 则标记需重新审查。
 */
export function markDownstreamForReReview(
  editedAssumption: ClarificationAssumptionRecord,
  downstreamRecommendations: readonly { id: string; assumptions: readonly { fieldId: string }[] }[],
): readonly DownstreamReviewMark[] {
  return downstreamRecommendations.map((rec) => {
    const dependsOnEdited = rec.assumptions.some((a) => a.fieldId === editedAssumption.fieldId)
    return {
      recommendationId: rec.id,
      needsReReview: dependsOnEdited,
      reason: dependsOnEdited ? `假设 ${editedAssumption.fieldId} 已编辑，需重新审查` : '不受影响',
    }
  })
}

// ── 无静默默认路径约束（任务 5.2）──

/**
 * 验证所有默认值替代路径都伴随假设条目。
 * 返回未伴随假设的替代路径（应为空数组才合规）。
 */
export function auditSilentDefaults(
  substitutions: readonly { fieldId: string; hasAssumption: boolean }[],
): readonly { fieldId: string }[] {
  return substitutions.filter((s) => !s.hasAssumption).map((s) => ({ fieldId: s.fieldId }))
}
