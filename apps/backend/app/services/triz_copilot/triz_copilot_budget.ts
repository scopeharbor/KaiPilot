// v3-triz-contradiction-copilot W2 任务 2.3 —— Autonomy Budget 硬上限（design D7）。
//
// 上限（决定值，不留给实现放宽）：澄清追问 ≤ 2 轮、单次分析模型 Token ≤ 4000、
// 项目度量读取 ≤ 5 次；触顶即停机并交出**已有中间成果**与中文原因，不静默失败、不无限重试。
//
// 边界（本 change 的接线纪律）：
// - **不新建预算体系**：Token 维度直接复用 1.4 的确定性门 `createRunTokenBudgetGate`
//   （其默认值来自 `TRIZ_MAPPING_LIMITS.runTokenBudget` = 4000），既有 `UnifiedBudgetGuard`
//   经 `createUnifiedBudgetGate` 适配后与本门**取交**（任一拒绝即拒绝，fail-closed），
//   guard 自身的策略语义零改动；
// - 默认值只允许收紧（与 1.3 / 1.4 同口径）：构造入参传更大的值一律忽略；
// - 计数语义：澄清轮数在同一分析（= 澄清链）内累计；度量读取按**求解周期**计（一次求解或
//   一次改判重算 = 一个周期），记录字段反映最近周期的读数。

import {
  TRIZ_MAPPING_LIMITS,
  createRunTokenBudgetGate,
  type TrizMappingBudgetDecision,
  type TrizMappingBudgetGate,
} from './triz_contradiction_mapping_service.js'

/** 硬上限默认值：Token 维度与 1.4 的模型侧预算同源（单一事实来源，不复制字面量）。 */
export const TRIZ_AUTONOMY_BUDGET_DEFAULTS = Object.freeze({
  clarificationRounds: 2,
  metricReads: 5,
  runTokens: TRIZ_MAPPING_LIMITS.runTokenBudget,
})

export interface TrizAutonomyBudgetLimits {
  /** 单次分析的澄清追问轮数上限 */
  clarificationRounds: number
  /** 单次求解周期的项目度量读取次数上限 */
  metricReads: number
  /** 单次分析的模型侧 Token 预算上限 */
  runTokens: number
}

export const TRIZ_BUDGET_STATES = ['within_budget', 'exhausted'] as const
export type TrizBudgetState = (typeof TRIZ_BUDGET_STATES)[number]

export const TRIZ_BUDGET_REASON_CODES = {
  clarificationExhausted: 'clarification_budget_exhausted',
  metricReadsExhausted: 'metric_read_budget_exhausted',
  runTokensExhausted: 'run_token_budget_exhausted',
  gateUnavailable: 'budget_gate_unavailable',
} as const

export type TrizBudgetReasonCode =
  (typeof TRIZ_BUDGET_REASON_CODES)[keyof typeof TRIZ_BUDGET_REASON_CODES]

/** 触顶说明（中文，直接面向 PM；不含任何正文，可安全落库与回显）。 */
export function trizBudgetClarificationReason(limit: number): string {
  return `澄清追问已达上限 ${limit} 轮，本次不再发起第 ${limit + 1} 轮提问；请补充关键信息，或直接采用已给出的方案。`
}

export function trizBudgetMetricReadReason(limit: number): string {
  return `项目度量读取已达上限 ${limit} 次，本次不再继续读取数据；以下为已得到的中间成果，可先据其决策。`
}

export function trizBudgetRunTokenReason(limit: number): string {
  return `单次分析模型 Token 预算 ${limit} 不足，已停止模型调用并改用零 Token 的确定性规则路径；结果照常给出。`
}

export function trizBudgetGateUnavailableReason(): string {
  return '预算校验不可用，按保守姿态停止模型调用并改用确定性规则路径；结果照常给出。'
}

/**
 * 解析生效上限：默认值只允许**收紧**；传入更大的值一律忽略（不可上调）。
 * 非有限数、小于 1 的取值同样忽略，避免把链路压到不可用。
 */
export function resolveTrizAutonomyBudgetLimits(
  overrides?: Partial<TrizAutonomyBudgetLimits>,
): TrizAutonomyBudgetLimits {
  const resolved: TrizAutonomyBudgetLimits = { ...TRIZ_AUTONOMY_BUDGET_DEFAULTS }
  if (!overrides) return resolved
  for (const key of Object.keys(TRIZ_AUTONOMY_BUDGET_DEFAULTS) as Array<
    keyof TrizAutonomyBudgetLimits
  >) {
    const value = overrides[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const tightened = Math.floor(value)
    if (tightened < 1) continue
    if (tightened < resolved[key]) resolved[key] = tightened
  }
  return resolved
}

export interface TrizBudgetDecision {
  allowed: boolean
  code: TrizBudgetReasonCode | null
  reason: string | null
}

export interface TrizMetricReadGrant {
  granted: number
  denied: number
  reason: string | null
}

/** 分析记录上的预算字段投影（2.1 表列名 → 值）。 */
export interface TrizBudgetSnapshot {
  clarificationRounds: number
  metricReadCount: number
  tokenBudget: number
  estimatedTokens: number
  actualTokens: number | null
  state: TrizBudgetState
  reason: string | null
}

export interface TrizCopilotBudgetOptions {
  /** 上限收紧（默认值不可上调） */
  limits?: Partial<TrizAutonomyBudgetLimits>
  /** 同一分析已发生的澄清轮数（澄清链的后续轮次从父记录继承） */
  clarificationRounds?: number
  /** 同一求解周期已发生的度量读取次数（改判重算开启新周期时通常为 0） */
  metricReadCount?: number
}

/**
 * 单次分析的自主权预算账本：澄清轮数、度量读取次数与触顶原因。
 *
 * 纯内存、零 IO：调用方在读取/追问**之前**申请额度（`requestMetricReads` /
 * `requestClarification`），被拒时按 spec「澄清轮次与自主权预算硬上限」交出中间成果。
 */
export class TrizCopilotBudget {
  readonly #limits: TrizAutonomyBudgetLimits
  #clarificationRounds: number
  #metricReadCount: number
  #estimatedTokens = 0
  #actualTokens: number | null = null
  readonly #reasons: string[] = []
  #reason: string | null = null

  constructor(options: TrizCopilotBudgetOptions = {}) {
    this.#limits = resolveTrizAutonomyBudgetLimits(options.limits)
    this.#clarificationRounds = clampCounter(options.clarificationRounds)
    this.#metricReadCount = clampCounter(options.metricReadCount)
  }

  get limits(): TrizAutonomyBudgetLimits {
    return { ...this.#limits }
  }

  get clarificationRounds(): number {
    return this.#clarificationRounds
  }

  get metricReadCount(): number {
    return this.#metricReadCount
  }

  get state(): TrizBudgetState {
    return this.#reasons.length > 0 ? 'exhausted' : 'within_budget'
  }

  /** 触顶原因（中文，可能多条，按发生顺序去重）。 */
  get reasons(): string[] {
    return [...this.#reasons]
  }

  /** 首条触顶原因（未触顶为 null）。 */
  get reason(): string | null {
    return this.#reason
  }

  /**
   * 申请一轮澄清追问：第 1/2 轮放行，第 3 轮（超出上限）被拒并给出中文原因。
   */
  requestClarification(): TrizBudgetDecision {
    if (this.#clarificationRounds >= this.#limits.clarificationRounds) {
      const reason = trizBudgetClarificationReason(this.#limits.clarificationRounds)
      this.#pushReason(reason)
      return { allowed: false, code: TRIZ_BUDGET_REASON_CODES.clarificationExhausted, reason }
    }
    this.#clarificationRounds += 1
    return { allowed: true, code: null, reason: null }
  }

  /**
   * 申请 N 次项目度量读取（读取**之前**调用）：额度不足时只放行剩余部分，
   * 被拒部分不再读取，同时记入触顶原因（第 6 次读取即被拦截）。
   */
  requestMetricReads(count: number): TrizMetricReadGrant {
    const requested = clampCounter(count)
    const remaining = Math.max(0, this.#limits.metricReads - this.#metricReadCount)
    const granted = Math.min(requested, remaining)
    const denied = requested - granted
    this.#metricReadCount += granted
    if (denied === 0) return { granted, denied: 0, reason: null }
    const reason = trizBudgetMetricReadReason(this.#limits.metricReads)
    this.#pushReason(reason)
    return { granted, denied, reason }
  }

  /** 单次度量读取的便捷形态（等价于 `requestMetricReads(1)`）。 */
  requestMetricRead(): TrizBudgetDecision {
    const grant = this.requestMetricReads(1)
    return {
      allowed: grant.granted === 1,
      code: grant.denied > 0 ? TRIZ_BUDGET_REASON_CODES.metricReadsExhausted : null,
      reason: grant.reason,
    }
  }

  /** 记录模型侧 Token 估算（确定性估算，未走模型路径时为 0）。 */
  recordEstimatedTokens(tokens: number): void {
    this.#estimatedTokens = clampCounter(tokens)
  }

  /** 记录模型侧真实用量；未回报时传 null（未知不伪报为 0）。 */
  recordActualTokens(tokens: number | null): void {
    this.#actualTokens =
      typeof tokens === 'number' && Number.isFinite(tokens) ? clampCounter(tokens) : null
  }

  /** 由外部观测到预算拒绝（如映射服务回退原因 BUDGET_EXHAUSTED）时补记触顶原因。 */
  markExhausted(reason: string): void {
    this.#pushReason(reason)
  }

  /** 触顶中间成果说明：触顶原因非空，未触顶为 null（不返回空壳成果）。 */
  get suspensionReason(): string | null {
    return this.reason
  }

  snapshot(): TrizBudgetSnapshot {
    return {
      clarificationRounds: this.#clarificationRounds,
      metricReadCount: this.#metricReadCount,
      tokenBudget: this.#limits.runTokens,
      estimatedTokens: this.#estimatedTokens,
      actualTokens: this.#actualTokens,
      state: this.state,
      reason: this.#reason,
    }
  }

  /** 本地确定性 Token 门（复用 1.4 的门实现；上限只可能等于或低于 4000）。 */
  tokenGate(): TrizMappingBudgetGate {
    return createRunTokenBudgetGate(this.#limits.runTokens)
  }

  #pushReason(reason: string): void {
    if (!this.#reasons.includes(reason)) this.#reasons.push(reason)
    this.#reason = this.#reasons[0] ?? null
  }
}

/**
 * 组合预算门：依次过每一道门，任一拒绝即拒绝（AND 语义）；任一门抛错按 fail-closed 拒绝。
 *
 * 用途（2.3 的接线缝）：把本地 4000 确定性门与既有 `UnifiedBudgetGuard` 适配门
 * （`createUnifiedBudgetGate`）叠加，使「默认值不可上调」不受注入门放行影响。
 */
export function composeTrizBudgetGates(
  gates: readonly TrizMappingBudgetGate[],
): TrizMappingBudgetGate {
  return {
    async preflight(input): Promise<TrizMappingBudgetDecision> {
      const available = gates.filter((gate) => typeof gate?.preflight === 'function')
      if (available.length === 0) {
        return {
          allowed: false,
          outcome: 'block',
          reasonCode: TRIZ_BUDGET_REASON_CODES.gateUnavailable,
          reason: trizBudgetGateUnavailableReason(),
        }
      }
      let last: TrizMappingBudgetDecision = {
        allowed: true,
        outcome: 'allow',
        reasonCode: null,
        reason: null,
      }
      for (const gate of available) {
        let decision: TrizMappingBudgetDecision
        try {
          decision = await gate.preflight(input)
        } catch {
          return {
            allowed: false,
            outcome: 'block',
            reasonCode: TRIZ_BUDGET_REASON_CODES.gateUnavailable,
            reason: trizBudgetGateUnavailableReason(),
          }
        }
        if (!decision.allowed) return decision
        last = decision
      }
      return last
    },
  }
}

function clampCounter(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}
