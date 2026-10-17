import { createHash } from 'node:crypto'
import type {
  ProjectSignalEvidence,
  ProjectSignalTier,
  ProjectSignalType,
  SignalHitCondition,
  SignalObservation,
  SignalObservationWindows,
  SignalTierConditionReason,
  SignalTierReasons,
  SignalWindowRange,
} from './signal_contracts.js'
import {
  SIGNAL_TIER_MIN_COMPOSITE_TYPES,
  SIGNAL_TIER_MIN_CONSECUTIVE_CYCLES,
} from './signal_thresholds.js'

/**
 * v3-triz-contradiction-copilot W3 任务 3.3 —— 置信分层与分层理由（纯函数，无 DB、无模型）。
 *
 * design D8：**高置信 = ① 显著幅度 ∧ ② 连续 ≥2 周期 ∧ ③ 关键字段完整 ∧ ④ 复合证据 ≥2 类**
 * （四条件缺一不可，缺一即低置信）。判定 MUST 可复算、可测试，MUST NOT 依赖模型打分。
 *
 * spec「置信分层与呈现路由」第 5 条：分层结果 MUST 随信号持久化，且理由字段 MUST 能读到
 * 四个条件各自的命中情况（`hit` + 机器可读 `detail`）。
 */

export interface SignalTierEvaluationInput {
  observation: SignalObservation
  /** 同一观测窗内命中的信号类型集合（含本条自身） */
  compositeTypes: readonly ProjectSignalType[]
  window: SignalWindowRange
  /** 分层变更痕迹：上一次落库的分层（首次为 null） */
  previousTier?: ProjectSignalTier | null
  evaluatedAt: string
}

export interface SignalTierEvaluation {
  tier: ProjectSignalTier
  reasons: SignalTierReasons
}

export function evaluateSignalTier(input: SignalTierEvaluationInput): SignalTierEvaluation {
  const { observation } = input
  const compositeTypes = [...new Set(input.compositeTypes)].sort()
  const replayUnsupported = observation.readings.replaySupported === false

  const amplitude: SignalTierConditionReason = {
    hit: observation.significant,
    detail: observation.significant ? 'significant_amplitude_met' : 'amplitude_below_significant',
  }

  const consecutive: SignalTierConditionReason = {
    hit: observation.consecutiveCycles >= SIGNAL_TIER_MIN_CONSECUTIVE_CYCLES,
    detail:
      `consecutive_cycles_${observation.consecutiveCycles}_of_${SIGNAL_TIER_MIN_CONSECUTIVE_CYCLES}` +
      (replayUnsupported ? ',replay_unsupported' : ''),
  }

  const completeness: SignalTierConditionReason = {
    hit: observation.fieldsComplete,
    detail: observation.fieldsComplete
      ? 'key_fields_complete'
      : `missing:${observation.completenessGap ?? 'UNKNOWN'}`,
  }

  const composite: SignalTierConditionReason = {
    hit: compositeTypes.length >= SIGNAL_TIER_MIN_COMPOSITE_TYPES,
    detail:
      `composite_types_${compositeTypes.length}_of_${SIGNAL_TIER_MIN_COMPOSITE_TYPES}` +
      (compositeTypes.length > 0 ? `(${compositeTypes.join(',')})` : ''),
  }

  const tier: ProjectSignalTier =
    amplitude.hit && consecutive.hit && completeness.hit && composite.hit ? 'high' : 'low'

  return {
    tier,
    reasons: {
      amplitude,
      consecutive,
      completeness,
      composite,
      window: input.window.key,
      evaluatedAt: input.evaluatedAt,
      compositeTypes,
      previousTier: input.previousTier ?? null,
    },
  }
}

/**
 * 低敏证据组装：只落指标名、读数、阈值、基期与实体 ID（数值 / 枚举，无长文本、无个人维度）。
 * `coveredCycles` 由检测器给出（1–3：本周期 + 可比基期），并按窗口总数封顶。
 */
export function buildSignalEvidence(input: {
  observation: SignalObservation
  windows: SignalObservationWindows
  compositeTypes: readonly ProjectSignalType[]
}): ProjectSignalEvidence {
  const { observation, windows } = input
  const compositeTypes = [...new Set(input.compositeTypes)].sort()
  const rawCovered = Number(observation.readings.coveredCycles ?? 1)
  const coveredCycles = Math.min(
    Math.max(Number.isFinite(rawCovered) ? Math.floor(rawCovered) : 1, 1),
    windows.all.length,
  )

  return {
    metric: String(observation.readings.metric ?? observation.signalType),
    window: {
      from: windows.current.from,
      to: windows.current.to,
      previousFrom: windows.previous.from,
      previousTo: windows.previous.to,
      days: windows.days,
    },
    readings: observation.readings,
    thresholds: observation.thresholds,
    coveredCycles,
    hitConditions: [...observation.hitConditions] as SignalHitCondition[],
    compositeTypes,
    entityRefs: {
      ...(observation.entityRefs.risks ? { risks: [...observation.entityRefs.risks] } : {}),
      ...(observation.entityRefs.issues ? { issues: [...observation.entityRefs.issues] } : {}),
      ...(observation.entityRefs.milestones
        ? { milestones: [...observation.entityRefs.milestones] }
        : {}),
    },
    truncated: observation.truncated,
    ...(observation.dataInsufficient
      ? {
          dataInsufficient: true,
          insufficientReason: observation.insufficientReason,
        }
      : {}),
  }
}

/**
 * 幂等 / 去重键：项目 + 类型 + 观测窗 + 关键实体集合稳定摘要的 SHA-256。
 * 全部输入为确定性值（无随机数、无「当前时间」参与唯一性），同一输入两次调用结果完全一致。
 */
export function buildSignalIdempotencyKey(input: {
  organizationId: number
  projectId: number
  signalType: ProjectSignalType
  window: SignalWindowRange
  entityRefs: SignalObservation['entityRefs']
}): string {
  const entities: string[] = []
  for (const id of input.entityRefs.risks ?? []) entities.push(`risk:${id}`)
  for (const id of input.entityRefs.issues ?? []) entities.push(`issue:${id}`)
  for (const id of input.entityRefs.milestones ?? []) entities.push(`milestone:${id}`)
  entities.sort()

  const canonical = [
    'project_signal.v1',
    `org=${input.organizationId}`,
    `project=${input.projectId}`,
    `type=${input.signalType}`,
    `window=${input.window.key}`,
    `entities=${entities.join(',')}`,
  ].join('|')

  return createHash('sha256').update(canonical).digest('hex')
}
