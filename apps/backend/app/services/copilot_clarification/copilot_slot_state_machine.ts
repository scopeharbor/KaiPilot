/**
 * Copilot 跨回合槽位填充状态机（任务 4.1–4.12）
 *
 * 输入为路由层的槽位缺口输出（slotStates），输出为：
 * - 需要询问的槽位列表（按 severity 排序）
 * - critical 未补齐的阻断判定
 * - recommended 槽位的默认值替代决策
 * - 轮数上界判定与两条出路
 * - 已确认槽位的跨轮保持
 *
 * 本模块是纯函数，不依赖 AdonisJS、数据库或 HTTP。
 */
import {
  type SlotFillState,
  type RegisteredClarificationField,
  type ClarificationRoundExit,
  canSlotTransition,
  reachedClarificationRoundBound,
  CLARIFICATION_DEFAULT_MAX_ROUNDS,
} from '@aiproj/types'

// ── 类型 ──

export interface SlotStateMachineInput {
  /** 已注册的澄清字段目录。 */
  readonly fields: readonly RegisteredClarificationField[]
  /** 当前槽位状态（fieldId → state）。 */
  readonly slotStates: Readonly<Record<string, SlotFillState>>
  /** 已经过的轮数。 */
  readonly roundsElapsed: number
  /** 最大轮数（默认 3）。 */
  readonly maxRounds?: number
}

export interface SlotStateMachineOutput {
  /** 需要询问的槽位（按 severity 排序，只包含 asked_pending / unasked 的）。 */
  readonly pendingSlots: readonly RegisteredClarificationField[]
  /** critical 缺口是否阻断（未补齐）。 */
  readonly isBlocked: boolean
  /** 被阻断的 critical 槽位列表。 */
  readonly blockedCriticalSlots: readonly RegisteredClarificationField[]
  /** recommended 槽位中需要替代默认值的。 */
  readonly defaultSubstitutions: readonly DefaultSubstitution[]
  /** optional 槽位中已跳过的。 */
  readonly skippedOptional: readonly RegisteredClarificationField[]
  /** 是否达到轮数上界。 */
  readonly reachedRoundBound: boolean
  /** 达到上界后的两条出路。 */
  readonly roundExits: readonly ClarificationRoundExit[]
  /** 是否可以继续追问（未达上界且仍有未答槽位）。 */
  readonly canContinueAsking: boolean
  /** 轮数上界后禁止继续追问的判定。 */
  readonly mustStopAsking: boolean
}

export interface DefaultSubstitution {
  readonly field: RegisteredClarificationField
  /** 替代原因。 */
  readonly reason: string
  /** 来源强度。 */
  readonly sourceStrength: string
  /** 替代的值。 */
  readonly value: string | number | readonly (string | number)[]
  /** 派生的置信度。 */
  readonly confidence: number
}

// ── 核心状态机 ──

/**
 * 运行槽位填充状态机，产出本轮的澄清决策。
 *
 * 确定性保证：相同输入（归一化后）产出相同输出（任务 8.1/8.2）。
 */
export function runSlotStateMachine(input: SlotStateMachineInput): SlotStateMachineOutput {
  const { fields, slotStates, roundsElapsed, maxRounds = CLARIFICATION_DEFAULT_MAX_ROUNDS } = input

  // 1. 按 severity 排序所有字段
  const sorted = [...fields].sort((a, b) => {
    const severityA = maxSeverityRank(a)
    const severityB = maxSeverityRank(b)
    if (severityA !== severityB) return severityA - severityB
    const tierRank: Record<string, number> = { critical: 0, recommended: 1, optional: 2 }
    const tierDiff = (tierRank[a.tier] ?? 2) - (tierRank[b.tier] ?? 2)
    if (tierDiff !== 0) return tierDiff
    return a.fieldId.localeCompare(b.fieldId)
  })

  // 2. 分类槽位
  const pendingSlots: RegisteredClarificationField[] = []
  const blockedCriticalSlots: RegisteredClarificationField[] = []
  const defaultSubstitutions: DefaultSubstitution[] = []
  const skippedOptional: RegisteredClarificationField[] = []

  for (const field of sorted) {
    const state = slotStates[field.fieldId] ?? 'unasked'

    if (field.tier === 'critical') {
      if (state === 'answered') {
        // 已回答，不阻断
        continue
      }
      // critical 未补齐
      blockedCriticalSlots.push(field)
      if (state === 'unasked' || state === 'asked_pending') {
        pendingSlots.push(field)
      }
    } else if (field.tier === 'recommended') {
      if (state === 'answered') {
        continue
      }
      if (state === 'filled_with_default') {
        // 已用默认值，生成假设条目
        if (field.defaultValue) {
          defaultSubstitutions.push({
            field,
            reason: field.defaultValue.reason,
            sourceStrength: field.defaultValue.sourceStrength,
            value: field.defaultValue.value,
            confidence: 0, // 由调用方通过 deriveConfidenceFromSourceStrength 派生
          })
        }
        continue
      }
      // 未回答，需询问或替代默认值
      if (field.defaultValue && (state === 'unasked' || state === 'asked_pending')) {
        // 有默认值：可以替代（但先尝试询问）
        pendingSlots.push(field)
      } else if (state === 'unasked' || state === 'asked_pending') {
        pendingSlots.push(field)
      }
    } else {
      // optional
      if (state === 'skipped' || state === 'answered') {
        if (state === 'skipped') {
          skippedOptional.push(field)
        }
        continue
      }
      if (state === 'unasked' || state === 'asked_pending') {
        pendingSlots.push(field)
      }
    }
  }

  // 3. 轮数判定
  const reachedBound = reachedClarificationRoundBound(roundsElapsed, maxRounds)
  const roundExits: ClarificationRoundExit[] = reachedBound
    ? ['proceed_with_defaults', 'end_turn']
    : []
  const canContinue = !reachedBound && pendingSlots.length > 0
  const mustStop = reachedBound && pendingSlots.length > 0

  return {
    pendingSlots,
    isBlocked: blockedCriticalSlots.length > 0,
    blockedCriticalSlots,
    defaultSubstitutions,
    skippedOptional,
    reachedRoundBound: reachedBound,
    roundExits,
    canContinueAsking: canContinue,
    mustStopAsking: mustStop,
  }
}

// ── 辅助函数 ──

function maxSeverityRank(field: RegisteredClarificationField): number {
  const severityRank: Record<string, number> = { high: 0, medium: 1, low: 2 }
  if (field.impactScope.length === 0) return 2
  return Math.min(...field.impactScope.map((s) => severityRank[s.severity] ?? 2))
}

/**
 * 多轮间保持已确认槽位：将上一轮已回答的槽位状态保持，
 * 重复询问已答槽位视为缺陷（通过 transition 表钉死）。
 */
export function preserveAnsweredSlots(
  previousStates: Readonly<Record<string, SlotFillState>>,
  currentStates: Readonly<Record<string, SlotFillState>>,
): Record<string, SlotFillState> {
  const merged = { ...currentStates }
  for (const [fieldId, prevState] of Object.entries(previousStates)) {
    if (prevState === 'answered' || prevState === 'filled_with_default') {
      // 保持已确认状态，不允许回退
      if (merged[fieldId] !== 'answered' && merged[fieldId] !== 'filled_with_default') {
        merged[fieldId] = prevState
      }
    }
  }
  return merged
}

/**
 * 验证 transition 合法性：如果试图从 answered 回到 asked_pending，
 * 则视为缺陷（违反任务 4.10）。
 */
export function validateSlotTransitions(
  oldStates: Readonly<Record<string, SlotFillState>>,
  newStates: Readonly<Record<string, SlotFillState>>,
): { valid: boolean; violations: string[] } {
  const violations: string[] = []
  for (const [fieldId, oldState] of Object.entries(oldStates)) {
    const newState = newStates[fieldId]
    if (newState && !canSlotTransition(oldState, newState)) {
      violations.push(`槽位 ${fieldId} 非法迁移：${oldState} → ${newState}`)
    }
  }
  return { valid: violations.length === 0, violations }
}

/**
 * 不创建或修改任何正式项目数据的守卫（任务 4.12）。
 * 澄清阶段只产生槽位状态和假设条目，不得触发任何持久化写入。
 */
export const CLARIFICATION_GUARD = {
  /** 澄清阶段允许的操作类型。 */
  ALLOWED_ACTIONS: ['query', 'clarify', 'slot_update'] as const,
  /** 澄清阶段禁止的操作类型。 */
  FORBIDDEN_ACTIONS: [
    'create_task',
    'update_task',
    'delete_task',
    'create_wbs',
    'update_wbs',
    'create_milestone',
    'update_milestone',
    'create_risk',
    'update_risk',
    'create_resource',
    'update_resource',
    'create_dependency',
    'update_dependency',
    'create_project',
    'update_project',
  ] as const,
} as const

/**
 * 检查一个操作是否在澄清阶段被允许。
 */
export function isClarificationActionAllowed(action: string): boolean {
  return (CLARIFICATION_GUARD.ALLOWED_ACTIONS as readonly string[]).includes(action)
}
