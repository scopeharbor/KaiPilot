/**
 * @aiproj/backend —— CompilerBudgetGuard（tasks 3.2, 3.3, 3.4）。
 *
 * 预算守卫：在 AIGateway 调用前执行 preflight 判断，
 * 在模型调用后根据真实 token 和估算成本更新累计预算状态和告警。
 *
 * 设计 D3：
 * - Preflight: 根据预算策略、已用成本和请求估算判断是否允许调用。
 * - Postflight: 按真实 token 更新 cost ledger，再次产生 budget decision。
 *
 * 硬预算阻止新的模型调用；软预算记录 warning 并可按策略进入人工复核或继续。
 *
 * @aiproj/backend
 */

import type { BudgetDecision } from '@aiproj/compiler-spec'
import type { CompilerObservabilityRecorder } from './observability_recorder.js'
import {
  type CompilerBudgetPolicyResolver,
  type PolicyResolutionScope,
  type ResolvedPolicy,
} from './budget_policy_resolver.js'
import { generateIdempotencyKey } from '@aiproj/compiler-spec'

export interface BudgetGuardContext {
  compilerRunId: number
  organizationId: number
  stageId: string
  attemptNumber: number
  /** 调用预估的 token 消耗（用于 preflight）。 */
  estimatedTokens: number
  /** 调用预估的成本（用于 preflight）。 */
  estimatedCost: number
  stageType?: string
  modelTier?: string
  userId?: number
  projectId?: string
}

export interface BudgetPreflightResult {
  /** 是否允许通过。 */
  allowed: boolean
  /** 预算决策。 */
  decision: BudgetDecision
  /** 拒绝原因（如果不允许）。 */
  reason?: string
}

export interface BudgetPostflightResult {
  /** 更新后的预算决策。 */
  decision: BudgetDecision
  /** 是否产生告警。 */
  warnings: string[]
}

/**
 * CompilerBudgetGuard —— 预算守卫。
 *
 * 在 Compiler LLM/hybrid Stage 的 AIGateway 调用前后执行。
 */
export class CompilerBudgetGuard {
  readonly #policyResolver: CompilerBudgetPolicyResolver
  readonly #recorder: CompilerObservabilityRecorder
  /** 累计成本状态（进程内）。实际持久化应基于 cost event 加载。 */
  #accumulatedCost: number = 0
  #accumulatedTokens: number = 0
  #callCount: number = 0

  constructor(
    policyResolver: CompilerBudgetPolicyResolver,
    recorder: CompilerObservabilityRecorder,
    initialAccumulatedCost?: number,
    initialAccumulatedTokens?: number,
  ) {
    this.#policyResolver = policyResolver
    this.#recorder = recorder
    this.#accumulatedCost = initialAccumulatedCost ?? 0
    this.#accumulatedTokens = initialAccumulatedTokens ?? 0
  }

  get accumulatedCost(): number {
    return this.#accumulatedCost
  }

  get accumulatedTokens(): number {
    return this.#accumulatedTokens
  }

  get callCount(): number {
    return this.#callCount
  }

  /**
   * AIGateway 调用前执行 preflight 判断。
   *
   * 根据预算策略、已用累积成本和本次调用估算判断是否允许调用。
   * 硬预算阻止新的模型调用，写入 budget decision artifact。
   */
  async preflight(ctx: BudgetGuardContext): Promise<BudgetPreflightResult> {
    const policy = this.#resolvePolicy(ctx)
    const totalEstimatedCost = this.#accumulatedCost + ctx.estimatedCost
    const totalEstimatedTokens = this.#accumulatedTokens + ctx.estimatedTokens

    const { status, softExceeded, hardExceeded } = this.#policyResolver.checkBudget(
      policy,
      totalEstimatedCost,
      totalEstimatedTokens,
    )

    const allowed = !hardExceeded
    let reason: string | undefined
    let suggestedAction: string | undefined

    if (hardExceeded) {
      reason = `硬预算超出: 累计估算 ${totalEstimatedCost.toFixed(4)} ${policy.currency} >= 硬预算上限 ${policy.hardLimit?.toFixed(4)} ${policy.currency}`
      suggestedAction = policy.onHardLimit
    } else if (softExceeded) {
      suggestedAction = policy.onSoftLimit
    }

    const decision: BudgetDecision = {
      organizationId: ctx.organizationId,
      compilerRunId: ctx.compilerRunId,
      decidedAt: new Date().toISOString(),
      decisionType: 'preflight',
      status,
      currentEstimatedCost: totalEstimatedCost,
      currentCallEstimatedCost: ctx.estimatedCost,
      softLimit: policy.softLimit,
      hardLimit: policy.hardLimit,
      totalTokens: totalEstimatedTokens,
      allowed,
      reason,
      suggestedAction,
      stageId: ctx.stageId,
      appliedPolicyName: policy.appliedPolicies.join(', '),
      idempotencyKey: generateIdempotencyKey('budget_write', {
        compilerRunId: ctx.compilerRunId,
        stageId: ctx.stageId,
        contractVersion: 1,
        manifestVersion: 1,
        attemptNumber: ctx.attemptNumber,
      }),
    }

    // 写入预算决策 artifact
    await this.#recorder.recordBudgetDecision(decision)

    return { allowed, decision, reason }
  }

  /**
   * AIGateway 调用后执行 postflight 判断。
   *
   * 根据真实 token 和估算成本更新累计预算状态，再次产生 budget decision。
   */
  async postflight(
    ctx: BudgetGuardContext & { actualTokens: number; actualCost: number },
  ): Promise<BudgetPostflightResult> {
    // 更新累计状态
    this.#accumulatedCost += ctx.actualCost
    this.#accumulatedTokens += ctx.actualTokens
    this.#callCount++

    const policy = this.#resolvePolicy(ctx)
    const { status, softExceeded, hardExceeded } = this.#policyResolver.checkBudget(
      policy,
      this.#accumulatedCost,
      this.#accumulatedTokens,
    )

    const warnings: string[] = []

    if (hardExceeded) {
      warnings.push(
        `硬预算超出: 累计 ${this.#accumulatedCost.toFixed(4)} ${policy.currency} >= ${policy.hardLimit?.toFixed(4)} ${policy.currency}`,
      )
    } else if (softExceeded) {
      warnings.push(
        `软预算超出: 累计 ${this.#accumulatedCost.toFixed(4)} ${policy.currency} >= ${policy.softLimit?.toFixed(4)} ${policy.currency}`,
      )
    }

    // 如果实际 token 远高于预估，也记录告警
    if (ctx.actualTokens > ctx.estimatedTokens * 2) {
      warnings.push(`实际 token (${ctx.actualTokens}) 超过预估 (${ctx.estimatedTokens}) 两倍以上`)
    }

    const decision: BudgetDecision = {
      organizationId: ctx.organizationId,
      compilerRunId: ctx.compilerRunId,
      decidedAt: new Date().toISOString(),
      decisionType: 'postflight',
      status,
      currentEstimatedCost: this.#accumulatedCost,
      currentCallEstimatedCost: ctx.actualCost,
      softLimit: policy.softLimit,
      hardLimit: policy.hardLimit,
      totalTokens: this.#accumulatedTokens,
      allowed: !hardExceeded,
      reason: hardExceeded ? `postflight 硬预算超出` : undefined,
      suggestedAction: hardExceeded
        ? policy.onHardLimit
        : softExceeded
          ? policy.onSoftLimit
          : undefined,
      stageId: ctx.stageId,
      appliedPolicyName: policy.appliedPolicies.join(', '),
      idempotencyKey: generateIdempotencyKey('budget_write', {
        compilerRunId: ctx.compilerRunId,
        stageId: ctx.stageId,
        contractVersion: 1,
        manifestVersion: 1,
        attemptNumber: ctx.attemptNumber,
      }),
    }

    await this.#recorder.recordBudgetDecision(decision)

    return { decision, warnings }
  }

  /**
   * 从给定 scope 解析预算策略。
   */
  #resolvePolicy(ctx: BudgetGuardContext): ResolvedPolicy {
    const scope: PolicyResolutionScope = {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      projectId: ctx.projectId,
      compilerRunId: ctx.compilerRunId,
      stageType: ctx.stageType,
      stageId: ctx.stageId,
      modelTier: ctx.modelTier,
    }
    return this.#policyResolver.resolve(scope)
  }
}
