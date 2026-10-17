/**
 * v3-unified-ai-budget-and-quota §4 — UnifiedBudgetGuard。
 *
 * 泛化 Compiler 已验证的两段式预算模型，去掉 run 绑定：
 * - Preflight: 按有效策略、累计用量与请求预估产出决策（allow/warn/block/degrade）
 * - Postflight: 按真实 token 更新累计并二次决策
 *
 * 关键约束：
 * - 硬预算阻断必须在 provider 调用之前生效
 * - 软越界记 warning 不得静默升级为 allow
 * - 幂等累计更新：同一 attempt 只扣减一次
 * - 记账写入失败可降级（不改变业务终态）
 * - 预算判定不可用时按 failurePosture 处理，禁止默认放行
 *
 * 接线位置：ai_m0/resolver.ts 与账本 recorder 并列接线
 */

import type {
  BudgetCostStatus,
  UnifiedBudgetPolicy,
  BudgetPreflightInput,
  BudgetPreflightResult,
  BudgetPostflightInput,
  BudgetPostflightResult,
  BudgetDecisionRecord,
  BudgetFailurePosture,
  BudgetDegradationStep,
  BudgetDecisionOutcome,
  BudgetOverrunReasonCode,
  BudgetBridgeRef,
} from '@aiproj/types'
import { resolveEffectivePolicies, enforceBudgetPolicies } from '@aiproj/types'

/** 累计用量查询接口（由 service 层注入）。 */
export interface AccumulatedUsageQuery {
  query(
    organizationId: number,
    projectId: number | null,
    userId: number | null,
    capability: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<{
    totalCost: number
    totalTokens: number
  }>
}

/** 决策记录持久化接口。 */
export interface BudgetDecisionRecorder {
  record(decision: Omit<BudgetDecisionRecord, 'id'>): Promise<void>
}

/** 窗口计算接口。 */
export interface WindowCalculator {
  getWindow(now: Date): { start: Date; end: Date }
}

/** 默认窗口计算：按月。 */
export function defaultMonthlyWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999))
  return { start, end }
}

/**
 * UnifiedBudgetGuard —— 跨全部 AI 能力面的预算守卫。
 */
export class UnifiedBudgetGuard {
  readonly #policies: UnifiedBudgetPolicy[]
  readonly #usageQuery: AccumulatedUsageQuery
  readonly #recorder: BudgetDecisionRecorder | null
  readonly #windowCalculator: WindowCalculator
  readonly #defaultFailurePosture: BudgetFailurePosture

  /** 已处理的 idempotency keys（内存级防重复）。 */
  readonly #processedKeys = new Set<string>()

  constructor(options: {
    policies: UnifiedBudgetPolicy[]
    usageQuery: AccumulatedUsageQuery
    recorder?: BudgetDecisionRecorder | null
    windowCalculator?: WindowCalculator
    defaultFailurePosture?: BudgetFailurePosture
  }) {
    this.#policies = options.policies
    this.#usageQuery = options.usageQuery
    this.#recorder = options.recorder ?? null
    this.#windowCalculator = options.windowCalculator ?? { getWindow: defaultMonthlyWindow }
    this.#defaultFailurePosture = options.defaultFailurePosture ?? 'conservative_deny'
  }

  /**
   * Preflight：调用前按策略与已用量判定是否放行。
   * 硬预算阻断必须在 provider 调用之前生效。
   */
  async preflight(input: BudgetPreflightInput): Promise<BudgetPreflightResult> {
    const now = input.now ?? new Date()
    const { start, end } = this.#windowCalculator.getWindow(now)

    // 解析有效策略
    const effectivePolicies = resolveEffectivePolicies(this.#policies, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      userId: input.userId,
      capability: input.capability,
    })

    // 查询窗口内累计用量
    let accumulatedCost = 0
    let accumulatedTokens = 0
    let usageQueryFailed = false
    try {
      const accumulated = await this.#usageQuery.query(
        input.organizationId,
        input.projectId,
        input.userId,
        input.capability,
        start,
        end,
      )
      accumulatedCost = accumulated.totalCost
      accumulatedTokens = accumulated.totalTokens
    } catch {
      // 用量查询失败 = 评估器不可用。**不能当成零累计**——那等于"看起来没花过钱"从而放行，
      // 与 §失败姿态「不含默认放行」相反。按 failurePosture 处理。
      usageQueryFailed = true
    }

    if (usageQueryFailed && this.#defaultFailurePosture === 'conservative_deny') {
      const decisionRecord = this.#buildDecisionRecord({
        ...input,
        decisionType: 'preflight',
        outcome: 'block',
        reasonCode: 'evaluator_unavailable',
        reason: '预算评估器不可用，按保守姿态阻断',
        triggeringScope: null,
        triggeringPolicyName: '',
        appliedPolicies: effectivePolicies.map((policy) => policy.name),
        accumulatedCost: 0,
        accumulatedTokens: 0,
        actualCost: null,
        actualTokens: null,
        windowStart: start,
        windowEnd: end,
        degradation: null,
        bridgeRef: null,
      })
      await this.#safeRecord(decisionRecord)
      return {
        allowed: false,
        outcome: 'block',
        reasonCode: 'evaluator_unavailable',
        reason: '预算评估器不可用，按保守姿态阻断',
        triggeringScope: null,
        triggeringPolicyName: null,
        appliedPolicies: effectivePolicies.map((policy) => policy.name),
        degradation: null,
        decisionRecord,
      }
    }

    // 叠加裁决
    const enforcement = enforceBudgetPolicies(
      effectivePolicies,
      accumulatedCost,
      accumulatedTokens,
      input.estimatedCost,
      input.estimatedTokens,
    )

    // 构建决策记录
    const outcome = enforcement.outcome
    const decisionRecord = this.#buildDecisionRecord({
      ...input,
      decisionType: 'preflight',
      outcome,
      reasonCode: enforcement.reasonCode,
      reason: enforcement.reason,
      triggeringScope: enforcement.triggeringScope,
      triggeringPolicyName: enforcement.triggeringPolicyName,
      appliedPolicies: enforcement.appliedPolicies,
      accumulatedCost,
      accumulatedTokens,
      actualCost: null,
      actualTokens: null,
      windowStart: start,
      windowEnd: end,
      degradation: null,
      bridgeRef: null,
    })

    // 持久化决策记录（失败可降级）
    await this.#safeRecord(decisionRecord)

    return {
      allowed: enforcement.allowed,
      outcome,
      reasonCode: enforcement.reasonCode,
      reason: enforcement.reason,
      triggeringScope: enforcement.triggeringScope,
      triggeringPolicyName: enforcement.triggeringPolicyName,
      appliedPolicies: enforcement.appliedPolicies,
      degradation: null,
      decisionRecord,
    }
  }

  /**
   * Postflight：按账本 attempt 的真实 token 更新累计并二次决策。
   * 幂等：同一 attempt 只扣减一次。
   */
  async postflight(input: BudgetPostflightInput): Promise<BudgetPostflightResult> {
    const now = input.now ?? new Date()
    const { start, end } = this.#windowCalculator.getWindow(now)

    // 幂等检查
    if (this.#processedKeys.has(input.idempotencyKey)) {
      // 已处理过——返回上次决策的简化结果
      return {
        outcome: 'allow',
        warnings: [],
        reasonCode: null,
        triggeringScope: null,
        appliedPolicies: [],
        decisionRecord: this.#buildDecisionRecord({
          ...input,
          decisionType: 'postflight',
          outcome: 'allow',
          reasonCode: null,
          reason: null,
          triggeringScope: null,
          triggeringPolicyName: '',
          appliedPolicies: [],
          accumulatedCost: 0,
          accumulatedTokens: 0,
          actualCost: input.actualCost,
          actualTokens: input.actualTokens,
          windowStart: start,
          windowEnd: end,
          degradation: null,
          bridgeRef: null,
        }),
      }
    }

    // 标记已处理
    this.#processedKeys.add(input.idempotencyKey)

    // 解析有效策略
    const effectivePolicies = resolveEffectivePolicies(this.#policies, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      userId: input.userId,
      capability: input.capability,
    })

    // 查询窗口内累计用量（加上本次实际消耗）
    let accumulatedCost = input.actualCost
    let accumulatedTokens = input.actualTokens
    try {
      const accumulated = await this.#usageQuery.query(
        input.organizationId,
        input.projectId,
        input.userId,
        input.capability,
        start,
        end,
      )
      accumulatedCost = accumulated.totalCost + input.actualCost
      accumulatedTokens = accumulated.totalTokens + input.actualTokens
    } catch {
      // 记账查询失败可降级——使用本次实际消耗做保守判定
    }

    // 叠加裁决
    const enforcement = enforceBudgetPolicies(
      effectivePolicies,
      accumulatedCost - input.actualCost, // 回退到本次之前的状态
      accumulatedTokens - input.actualTokens,
      input.actualCost,
      input.actualTokens,
    )

    const warnings: string[] = []
    if (enforcement.outcome === 'warn') {
      warnings.push(enforcement.reason ?? '软预算超出')
    } else if (enforcement.outcome === 'block') {
      warnings.push(enforcement.reason ?? '硬预算超出')
    }

    // 构建决策记录
    const decisionRecord = this.#buildDecisionRecord({
      ...input,
      decisionType: 'postflight',
      outcome: enforcement.outcome,
      reasonCode: enforcement.reasonCode,
      reason: enforcement.reason,
      triggeringScope: enforcement.triggeringScope,
      triggeringPolicyName: enforcement.triggeringPolicyName,
      appliedPolicies: enforcement.appliedPolicies,
      accumulatedCost,
      accumulatedTokens,
      actualCost: input.actualCost,
      actualTokens: input.actualTokens,
      windowStart: start,
      windowEnd: end,
      degradation: null,
      bridgeRef: null,
    })

    // 持久化决策记录（失败可降级）
    await this.#safeRecord(decisionRecord)

    return {
      outcome: enforcement.outcome,
      warnings,
      reasonCode: enforcement.reasonCode,
      triggeringScope: enforcement.triggeringScope,
      appliedPolicies: enforcement.appliedPolicies,
      decisionRecord,
    }
  }

  // ── 内部辅助 ──

  #buildDecisionRecord(input: {
    organizationId: number
    projectId: number | null
    userId: number | null
    capability: string
    surface: string
    decisionType: 'preflight' | 'postflight'
    outcome: BudgetDecisionOutcome
    reasonCode: BudgetOverrunReasonCode | null
    reason: string | null
    triggeringScope: import('@aiproj/types').BudgetAttributionScope | null
    triggeringPolicyName: string
    appliedPolicies: string[]
    accumulatedCost: number
    accumulatedTokens: number
    actualCost: number | null
    actualTokens: number | null
    windowStart: Date
    windowEnd: Date
    degradation: BudgetDegradationStep | null
    bridgeRef: BudgetBridgeRef | null
    idempotencyKey: string
    ledgerAttemptRef?: string | null
    estimatedCost?: number
    estimatedTokens?: number
    currency?: string
    costStatus?: BudgetCostStatus | null
  }): Omit<BudgetDecisionRecord, 'id'> {
    return {
      organizationId: input.organizationId,
      projectId: input.projectId,
      userId: input.userId,
      capability: input.capability,
      surface: input.surface,
      policyRefs: input.appliedPolicies,
      triggeringScope: input.triggeringScope ?? 'organization',
      triggeringPolicyName: input.triggeringPolicyName,
      decisionType: input.decisionType,
      outcome: input.outcome,
      reasonCode: input.reasonCode,
      reason: input.reason,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString(),
      estimatedCost: input.estimatedCost ?? null,
      actualCost: input.actualCost,
      estimatedTokens: input.estimatedTokens ?? null,
      actualTokens: input.actualTokens,
      accumulatedCost: input.accumulatedCost,
      accumulatedTokens: input.accumulatedTokens,
      currency: input.currency ?? 'CNY',
      costStatus: input.costStatus ?? null,
      idempotencyKey: input.idempotencyKey,
      ledgerAttemptRef: input.ledgerAttemptRef ?? null,
      degradation: input.degradation,
      bridgeRef: input.bridgeRef,
      decidedAt: new Date().toISOString(),
    }
  }

  /** 安全记录：失败可降级（不改变业务终态）。 */
  async #safeRecord(decision: Omit<BudgetDecisionRecord, 'id'>): Promise<void> {
    if (!this.#recorder) return
    try {
      await this.#recorder.record(decision)
    } catch {
      // §5.9 记账写入失败可降级：此处吞掉错误
    }
  }
}
