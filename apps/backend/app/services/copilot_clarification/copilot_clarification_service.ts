/**
 * Copilot 澄清与假设编排服务（主入口）
 *
 * 组合字段注册表、槽位状态机和假设生成器，
 * 提供完整的多轮澄清流程编排。
 *
 * 本模块是纯函数编排层，不依赖 AdonisJS 容器、数据库或 HTTP。
 * 它消费路由层的槽位缺口输出，向侧栏与动作边界供给插槽内容。
 */
import {
  type RegisteredClarificationField,
  type SlotFillState,
  type ClarificationRoundExit,
  canSlotTransition,
  type RELIES_ON_SUBSTITUTED_DEFAULT,
  deriveConfidenceFromSourceStrength,
  reachedClarificationRoundBound,
  CLARIFICATION_DEFAULT_MAX_ROUNDS,
} from '@aiproj/types'
import {
  getRegisteredFields,
  getRegisteredDestinations,
  adaptProjectIntakeCatalog,
  registerClarificationFields,
  clearClarificationRegistry,
} from './copilot_clarification_registry.js'
import {
  runSlotStateMachine,
  preserveAnsweredSlots,
  isClarificationActionAllowed,
  type SlotStateMachineInput,
  type SlotStateMachineOutput,
} from './copilot_slot_state_machine.js'
import {
  generateAssumptionList,
  editAssumption,
  markDownstreamForReReview,
  type AssumptionGenerationInput,
  type AssumptionListOutput,
  type AssumptionEditInput,
  type DownstreamReviewMark,
} from './copilot_assumption_generator.js'

// ── 类型 ──

export interface ClarificationRoundInput {
  /** 目标 destination。 */
  readonly destination: string
  /** 当前槽位状态。 */
  readonly slotStates: Readonly<Record<string, SlotFillState>>
  /** 已经过的轮数。 */
  readonly roundsElapsed: number
  /** 最大轮数。 */
  readonly maxRounds?: number
}

export interface ClarificationRoundOutput {
  /** 需要询问的槽位（按 severity 排序）。 */
  readonly pendingSlots: readonly RegisteredClarificationField[]
  /** critical 缺口是否阻断。 */
  readonly isBlocked: boolean
  /** 被阻断的 critical 槽位。 */
  readonly blockedCriticalSlots: readonly RegisteredClarificationField[]
  /** recommended 槽位的默认值替代。 */
  readonly defaultSubstitutions: readonly {
    readonly field: RegisteredClarificationField
    readonly reason: string
    readonly sourceStrength: string
    readonly value: string | number | readonly (string | number)[]
    readonly confidence: number
  }[]
  /** 假设条目列表。 */
  readonly assumptions: AssumptionListOutput
  /** 是否达到轮数上界。 */
  readonly reachedRoundBound: boolean
  /** 达到上界后的两条出路。 */
  readonly roundExits: readonly ClarificationRoundExit[]
  /** 是否可以继续追问。 */
  readonly canContinueAsking: boolean
  /** 必须停止追问。 */
  readonly mustStopAsking: boolean
  /** 确定性键（用于缓存/幂等判定）。 */
  readonly determinismKey: string
}

export interface ClarificationServiceResult {
  /** 本轮澄清输出。 */
  readonly round: ClarificationRoundOutput
  /** 更新后的槽位状态。 */
  readonly updatedSlotStates: Record<string, SlotFillState>
  /** 动作守卫：澄清阶段是否允许产生变更动作。 */
  readonly actionGuard: {
    readonly allowed: boolean
    readonly reason: string
  }
  /** 「依赖替代默认值」标记（供动作边界消费）。 */
  readonly relianceMarker: typeof RELIES_ON_SUBSTITUTED_DEFAULT | null
}

// ── 编排服务 ──

/**
 * 处理一轮澄清：运行状态机、生成假设、产出决策。
 *
 * 确定性保证：相同输入（归一化后）产出相同输出（任务 8.1/8.2）。
 */
export function processClarificationRound(
  input: ClarificationRoundInput,
): ClarificationServiceResult {
  const { destination, slotStates, roundsElapsed, maxRounds } = input

  // 1. 获取注册字段
  const fields = getRegisteredFields(destination)
  if (fields.length === 0) {
    return makeEmptyResult(input)
  }

  // 2. 运行槽位状态机
  const smInput: SlotStateMachineInput = {
    fields,
    slotStates,
    roundsElapsed,
    maxRounds,
  }
  const smOutput = runSlotStateMachine(smInput)

  // 3. 为 recommended 槽位的默认值替代生成假设
  const assumptionInputs: AssumptionGenerationInput[] = smOutput.defaultSubstitutions.map(
    (sub) => ({
      field: sub.field,
      reason: sub.reason,
      sourceStrength: sub.sourceStrength as any,
      value: sub.value,
    }),
  )
  const assumptions = generateAssumptionList(assumptionInputs)

  // 4. 更新槽位状态（recommended 替代默认值后标记为 filled_with_default）
  const updatedSlotStates = { ...slotStates }
  for (const sub of smOutput.defaultSubstitutions) {
    updatedSlotStates[sub.field.fieldId] = 'filled_with_default'
  }
  // 被阻断的 critical 槽位标记为 blocked
  for (const crit of smOutput.blockedCriticalSlots) {
    if (updatedSlotStates[crit.fieldId] !== 'answered') {
      updatedSlotStates[crit.fieldId] = 'blocked'
    }
  }

  // 5. 动作守卫：critical 未补齐时禁止产生变更动作
  const actionGuard = smOutput.isBlocked
    ? { allowed: false, reason: 'critical 槽位未补齐，不得产出变更类动作' }
    : { allowed: true, reason: '所有 critical 槽位已补齐' }

  // 6. 确定性键
  const determinismKey = computeRoundDeterminismKey(input, smOutput)

  return {
    round: {
      pendingSlots: smOutput.pendingSlots,
      isBlocked: smOutput.isBlocked,
      blockedCriticalSlots: smOutput.blockedCriticalSlots,
      defaultSubstitutions: smOutput.defaultSubstitutions.map((sub) => ({
        ...sub,
        confidence: deriveConfidenceFromSourceStrength(sub.sourceStrength as any),
      })),
      assumptions,
      reachedRoundBound: smOutput.reachedRoundBound,
      roundExits: smOutput.roundExits,
      canContinueAsking: smOutput.canContinueAsking,
      mustStopAsking: smOutput.mustStopAsking,
      determinismKey,
    },
    updatedSlotStates,
    actionGuard,
    relianceMarker: assumptions.relianceMarker,
  }
}

/**
 * 处理用户的澄清回答，更新槽位状态。
 */
export function applyClarificationAnswer(
  currentStates: Readonly<Record<string, SlotFillState>>,
  fieldId: string,
  answer: 'answered' | 'skipped' | 'filled_with_default',
): Record<string, SlotFillState> {
  const newState = { ...currentStates }
  const currentState = newState[fieldId] ?? 'unasked'

  // 验证 transition 合法性
  if (!canSlotTransition(currentState, answer)) {
    throw new Error(`槽位 ${fieldId} 非法迁移：${currentState} → ${answer}`)
  }

  newState[fieldId] = answer
  return newState
}

/**
 * 处理多轮间的槽位保持。
 */
export function mergeSlotStatesAcrossRounds(
  previousStates: Readonly<Record<string, SlotFillState>>,
  currentStates: Readonly<Record<string, SlotFillState>>,
): Record<string, SlotFillState> {
  return preserveAnsweredSlots(previousStates, currentStates)
}

/**
 * 编辑假设并标记下游重审。
 */
export function handleAssumptionEdit(
  input: AssumptionEditInput,
  downstreamRecommendations: readonly { id: string; assumptions: readonly { fieldId: string }[] }[],
): {
  updatedAssumption: ReturnType<typeof editAssumption>
  downstreamMarks: readonly DownstreamReviewMark[]
} {
  const updatedAssumption = editAssumption(input)
  const downstreamMarks = markDownstreamForReReview(updatedAssumption, downstreamRecommendations)
  return { updatedAssumption, downstreamMarks }
}

/**
 * 检查一个操作是否在澄清阶段被允许（任务 4.12）。
 */
export { isClarificationActionAllowed }

// ── 内部辅助 ──

function makeEmptyResult(input: ClarificationRoundInput): ClarificationServiceResult {
  return {
    round: {
      pendingSlots: [],
      isBlocked: false,
      blockedCriticalSlots: [],
      defaultSubstitutions: [],
      assumptions: {
        records: [],
        entries: [],
        relianceMarker: null,
        truncated: false,
        omittedCount: 0,
      },
      reachedRoundBound: reachedClarificationRoundBound(
        input.roundsElapsed,
        input.maxRounds ?? CLARIFICATION_DEFAULT_MAX_ROUNDS,
      ),
      roundExits: reachedClarificationRoundBound(
        input.roundsElapsed,
        input.maxRounds ?? CLARIFICATION_DEFAULT_MAX_ROUNDS,
      )
        ? ['proceed_with_defaults', 'end_turn']
        : [],
      canContinueAsking: false,
      mustStopAsking: false,
      determinismKey: 'empty',
    },
    updatedSlotStates: { ...input.slotStates },
    actionGuard: { allowed: true, reason: '无澄清字段' },
    relianceMarker: null,
  }
}

/**
 * 计算确定性键（任务 8.1）。
 */
function computeRoundDeterminismKey(
  input: ClarificationRoundInput,
  smOutput: SlotStateMachineOutput,
): string {
  // 简化确定性键：基于 destination + slotStates + roundsElapsed + pending 字段 ID 排序
  const pendingIds = smOutput.pendingSlots
    .map((f) => f.fieldId)
    .sort()
    .join(',')
  const blockedIds = smOutput.blockedCriticalSlots
    .map((f) => f.fieldId)
    .sort()
    .join(',')
  const subIds = smOutput.defaultSubstitutions
    .map((s) => s.field.fieldId)
    .sort()
    .join(',')
  return `${input.destination}:${input.roundsElapsed}:${pendingIds}:${blockedIds}:${subIds}`
}

// ── 重新导出注册函数（方便外部使用）──

export {
  registerClarificationFields,
  getRegisteredFields,
  getRegisteredDestinations,
  adaptProjectIntakeCatalog,
  clearClarificationRegistry,
}
