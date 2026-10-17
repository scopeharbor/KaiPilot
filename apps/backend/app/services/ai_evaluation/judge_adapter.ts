/**
 * v3-ai-automated-evaluation §5 — LLM-as-judge 适配器。
 *
 * 核心约束：
 * - 可注入且默认 fixture judge
 * - judge 调用本身落统一账本（它也是模型调用，有成本）
 * - judge 受预算与限流约束；被拒时不发起调用
 * - judge 不评自己的输出（自我认证禁止）
 * - judge 失败时评分记为 not-evaluated 而非 pass
 * - judge 模型身份与 prompt 版本必录
 * - 确定性优先：同维度有确定性结论时 judge 结论不得覆盖
 *
 * 依赖状态（2026-08-17）：
 * - unified-ai-invocation-ledger: ✅ 已 apply (66/66)
 * - unified-ai-budget-and-quota: ❌ 20/70 in-progress → judge 默认关闭, fallback
 * - global-ai-rate-limiting: ❌ 5/75 in-progress → judge 默认关闭, fallback
 * - ai-request-tracing: ❌ 0/71 in-progress → reference attempts only
 *
 * @aiproj/backend services — 零真实 provider 调用（默认 fixture judge）
 */

import type {
  JudgeAdapter,
  JudgeAdapterInput,
  JudgeCallResult,
  EvaluationDimension,
} from '@aiproj/types'

// ═══════════════════════════════════════════════════════════════════════════════
// §5.1 Fixture Judge（默认，零真实调用）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fixture judge 适配器：默认实现，零真实 provider 调用。
 * 用于测试和开发环境，不消耗任何模型资源。
 */
export class FixtureJudgeAdapter implements JudgeAdapter {
  readonly name = 'fixture-judge'
  readonly version = '1.0.0'

  async evaluate(input: JudgeAdapterInput): Promise<JudgeCallResult> {
    // Fixture judge 总是返回 pass（确定性优先：同维度有确定性结论时此结果不得覆盖）
    return {
      success: true,
      output: {
        scoreValue: 1,
        scoreLabel: 'pass',
        explanation: `Fixture judge: ${input.dimension} evaluated successfully`,
      },
      ledgerAttemptId: `fixture-judge:${input.dimension}:${Date.now()}`,
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5.2–5.3 Judge 调用与账本记录
// ═══════════════════════════════════════════════════════════════════════════════

/** Judge 调用记录接口（对接统一账本）。 */
export interface JudgeLedgerRecord {
  /** judge 模型标识。 */
  judgeModel: string
  /** judge prompt 版本。 */
  judgePromptVersion: string
  /** 评测维度。 */
  dimension: EvaluationDimension
  /** 被评对象引用。 */
  artifactRef: string
  /** 组织 ID。 */
  organizationId: number
  /** 调用开始时间（ISO 8601）。 */
  startedAt: string
  /** 调用结束时间（ISO 8601）。 */
  endedAt: string
  /** 调用状态。 */
  status: 'success' | 'failed' | 'denied'
  /** 错误信息（失败时）。 */
  error?: string
}

/**
 * 记录 judge 调用到统一账本（占位实现）。
 * 当 unified-ai-invocation-ledger recorder 可用时对接真实 recorder；
 * 未落地时记录到内存用于测试。
 */
export class JudgeLedgerRecorder {
  private records: JudgeLedgerRecord[] = []

  async record(record: JudgeLedgerRecord): Promise<string> {
    this.records.push(record)
    // 返回 attempt ID（生产环境由 recorder 生成）
    return `judge-attempt:${record.dimension}:${this.records.length}`
  }

  getRecords(): JudgeLedgerRecord[] {
    return [...this.records]
  }

  clear(): void {
    this.records = []
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5.4–5.5 预算与限流约束
// ═══════════════════════════════════════════════════════════════════════════════

/** 预算与限流决策接口。 */
export interface BudgetRateLimitDecision {
  /** 是否允许调用。 */
  allowed: boolean
  /** 拒绝原因（不允许时）。 */
  denialReason?: string
}

/**
 * Judge 预算与限流守卫。
 * 当 unified-ai-budget-and-quota 与 global-ai-rate-limiting 未落地时，
 * judge 默认关闭（allowed: false），fallback 记录。
 */
export class JudgeBudgetGuard {
  private enabled = false
  private fallbackReason = 'Budget and rate-limiting not yet landed'

  /**
   * 启用 judge（当预算与限流落地后调用）。
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * 判断 judge 调用是否被允许。
   */
  async adjudicate(_input: JudgeAdapterInput): Promise<BudgetRateLimitDecision> {
    if (!this.enabled) {
      return {
        allowed: false,
        denialReason: this.fallbackReason,
      }
    }

    // 预算与限流落地后的实际判定逻辑
    // 此处为占位实现，对接 unified-ai-budget-and-quota 与 global-ai-rate-limiting
    return { allowed: true }
  }

  isEnabled(): boolean {
    return this.enabled
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5.8 自我认证禁止
// ═══════════════════════════════════════════════════════════════════════════════

/** Judge 自我认证检查：judge 不评自己的输出。 */
export function isSelfEvaluation(
  judgeIdentity: { name: string; version: string; judgeModel?: string },
  artifactSource: { evaluatorName?: string; evaluatorModel?: string },
): boolean {
  // 如果 artifact 的来源就是这个 judge，则是自我认证
  if (artifactSource.evaluatorName === judgeIdentity.name) {
    return true
  }
  if (
    judgeIdentity.judgeModel &&
    artifactSource.evaluatorModel &&
    judgeIdentity.judgeModel === artifactSource.evaluatorModel
  ) {
    return true
  }
  return false
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5.6–5.7 失败 → not-evaluated
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 将 judge 调用结果转换为评分记录。
 * 关键约束：judge 失败时评分记为 not-evaluated 而非 pass。
 */
export function judgeResultToScore(
  result: JudgeCallResult,
  _input: JudgeAdapterInput,
): {
  scoreValue: number
  scoreLabel: 'pass' | 'fail' | 'not-evaluated'
  explanation: string
  ledgerAttemptId?: string
} {
  if (!result.success) {
    // 失败 → not-evaluated（而非 pass）
    return {
      scoreValue: 0,
      scoreLabel: 'not-evaluated',
      explanation: `Judge failed: ${result.error || 'unknown error'}`,
      ledgerAttemptId: result.ledgerAttemptId,
    }
  }

  if (result.deniedByBudgetOrRateLimit) {
    // 被预算/限流拒绝 → not-evaluated
    return {
      scoreValue: 0,
      scoreLabel: 'not-evaluated',
      explanation: 'Judge call denied by budget or rate limit',
      ledgerAttemptId: result.ledgerAttemptId,
    }
  }

  // 成功 → 使用 judge 输出
  return {
    scoreValue: result.output!.scoreValue,
    scoreLabel: result.output!.scoreLabel,
    explanation: result.output!.explanation,
    ledgerAttemptId: result.ledgerAttemptId,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §5.10–5.11 Judge 编排服务
// ═══════════════════════════════════════════════════════════════════════════════

/** Judge 编排服务：组合 judge adapter、预算守卫、账本记录与自我认证检查。 */
export class JudgeOrchestrationService {
  private adapter: JudgeAdapter
  private budgetGuard: JudgeBudgetGuard
  private ledgerRecorder: JudgeLedgerRecorder

  constructor(
    adapter: JudgeAdapter = new FixtureJudgeAdapter(),
    budgetGuard: JudgeBudgetGuard = new JudgeBudgetGuard(),
    ledgerRecorder: JudgeLedgerRecorder = new JudgeLedgerRecorder(),
  ) {
    this.adapter = adapter
    this.budgetGuard = budgetGuard
    this.ledgerRecorder = ledgerRecorder
  }

  /**
   * 执行 judge 评测。
   * 完整流程：预算检查 → 自我认证检查 → 调用 judge → 落账本 → 返回结果。
   */
  async evaluate(
    input: JudgeAdapterInput,
    selfEvaluationGuard?: {
      artifactEvaluatorName?: string
      artifactEvaluatorModel?: string
    },
  ): Promise<{
    score: {
      scoreValue: number
      scoreLabel: 'pass' | 'fail' | 'not-evaluated'
      explanation: string
    }
    ledgerAttemptId?: string
    deniedByBudgetOrRateLimit?: boolean
  }> {
    // §5.8 自我认证检查
    if (selfEvaluationGuard) {
      const isSelf = isSelfEvaluation(
        {
          name: this.adapter.name,
          version: this.adapter.version,
          judgeModel: input.judgeModel,
        },
        {
          evaluatorName: selfEvaluationGuard.artifactEvaluatorName,
          evaluatorModel: selfEvaluationGuard.artifactEvaluatorModel,
        },
      )
      if (isSelf) {
        return {
          score: {
            scoreValue: 0,
            scoreLabel: 'not-evaluated',
            explanation: 'Self-evaluation refused: judge cannot evaluate its own output',
          },
        }
      }
    }

    // §5.4 预算与限流检查
    const budgetDecision = await this.budgetGuard.adjudicate(input)
    if (!budgetDecision.allowed) {
      return {
        score: {
          scoreValue: 0,
          scoreLabel: 'not-evaluated',
          explanation: `Judge denied: ${budgetDecision.denialReason}`,
        },
        deniedByBudgetOrRateLimit: true,
      }
    }

    // §5.2 调用 judge
    const startedAt = new Date().toISOString()
    const callResult = await this.adapter.evaluate(input)
    const endedAt = new Date().toISOString()

    // §5.3 落账本
    const ledgerAttemptId = await this.ledgerRecorder.record({
      judgeModel: input.judgeModel,
      judgePromptVersion: input.judgePromptVersion,
      dimension: input.dimension,
      artifactRef: input.artifact.artifactRef,
      organizationId: input.organizationId,
      startedAt,
      endedAt,
      status: callResult.success ? 'success' : 'failed',
      error: callResult.error,
    })

    // §5.6 失败 → not-evaluated
    const score = judgeResultToScore(callResult, input)

    return {
      score: {
        scoreValue: score.scoreValue,
        scoreLabel: score.scoreLabel,
        explanation: score.explanation,
      },
      ledgerAttemptId,
    }
  }

  /** 获取适配器。 */
  getAdapter(): JudgeAdapter {
    return this.adapter
  }

  /** 获取预算守卫。 */
  getBudgetGuard(): JudgeBudgetGuard {
    return this.budgetGuard
  }
}
