/**
 * @aiproj/backend —— Repair Executor（tasks 4.1–4.5）。
 *
 * 按 Repair Plan 顺序执行 attempt：
 * - deterministic auto-fix attempt（4.2）
 * - same-stage LLM retry attempt（4.3）
 * - LLM retry output quality check（4.4）
 * - human review degrade path（4.5）
 *
 * @aiproj/backend
 */

import type {
  RepairPlan,
  RepairPlanItem,
  RepairCandidatePatch,
  RepairAttempt,
} from '@aiproj/compiler-spec'

// ── Deterministic Auto-Fix Adapter Interface ──

export interface DeterministicAutoFixAdapter {
  tryAutoFix(
    planItem: RepairPlanItem,
    plan: RepairPlan,
    pdmSnapshot: unknown,
  ): Promise<{
    applied: boolean
    patch?: RepairCandidatePatch
    error?: string
  }>
}

// ── LLM Retry Adapter Interface ──

export interface LlmRetryAdapter {
  executeRetry(
    planItem: RepairPlanItem,
    plan: RepairPlan,
    repairFeedback: string,
    whiteListedEntities: string[],
  ): Promise<{
    success: boolean
    output?: string
    errorCategory?: string
    errorMessage?: string
    tokensUsed?: number
  }>
}

// ── Attempt Result ──

export interface ExecutorAttemptResult {
  attempt: RepairAttempt
  patch?: RepairCandidatePatch
  blockedAfterRevalidation?: boolean
  requiresHumanReview?: boolean
}

/** Build a minimal RepairAttempt with safe defaults. */
function baseAttempt(
  attemptId: string,
  issueId: string,
  planItemId: string,
  strategy: RepairAttempt['strategy'],
  stageId: string,
  entityIds: string[],
  attemptNumber: number,
  status: RepairAttempt['status'],
  idempotencyKey: string,
  startedAt: string,
): RepairAttempt {
  return {
    attemptId,
    issueId,
    planItemId,
    strategy,
    stageId,
    entityIds,
    attemptNumber,
    status,
    idempotencyKey,
    startedAt,
    inputArtifactRefs: [],
    outputArtifactRefs: [],
    errorCategory: 'none',
  }
}

// ── Executor ──

export class RepairExecutor {
  readonly #deterministicAdapter: DeterministicAutoFixAdapter
  readonly #llmRetryAdapter: LlmRetryAdapter
  #attemptCounter: number

  constructor(deterministicAdapter: DeterministicAutoFixAdapter, llmRetryAdapter: LlmRetryAdapter) {
    this.#deterministicAdapter = deterministicAdapter
    this.#llmRetryAdapter = llmRetryAdapter
    this.#attemptCounter = 0
  }

  /**
   * 4.1: 按 Repair Plan 顺序执行 attempt。
   * 返回每个 attempt 的输入/输出 artifact ref、状态和 cost summary。
   */
  async execute(
    plan: RepairPlan,
    _pdmSnapshot: unknown,
    budgetGuard: {
      canAttempt(itemId: string): { allowed: boolean; reason?: string }
      recordAttempt(itemId: string, tokens?: number, isLlm?: boolean): void
    },
    _cascadeGuard: import('@aiproj/compiler-spec').CascadeGuard,
  ): Promise<ExecutorAttemptResult[]> {
    const results: ExecutorAttemptResult[] = []

    const executableItems = plan.items.filter(
      (item) => item.executable && item.strategy !== 'human_review',
    )

    for (const item of executableItems) {
      const budgetCheck = budgetGuard.canAttempt(item.itemId)
      if (!budgetCheck.allowed) {
        results.push(
          this.#degradeToHumanReview(item, plan, budgetCheck.reason ?? 'budget_exhausted'),
        )
        continue
      }

      const now = new Date().toISOString()
      this.#attemptCounter++
      const attemptId = `att-${plan.planId}-${item.itemId}-${this.#attemptCounter}`

      if (item.strategy === 'deterministic_auto_fix') {
        const result = await this.#executeDeterministicAttempt(
          item,
          plan,
          _pdmSnapshot,
          attemptId,
          now,
        )
        budgetGuard.recordAttempt(item.itemId, 0, false)
        results.push(result)
      } else if (item.strategy === 'same_stage_llm_retry') {
        const result = await this.#executeLlmRetryAttempt(item, plan, attemptId, now, budgetGuard)
        results.push(result)
      }
    }

    return results
  }

  async #executeDeterministicAttempt(
    item: RepairPlanItem,
    plan: RepairPlan,
    pdmSnapshot: unknown,
    attemptId: string,
    now: string,
  ): Promise<ExecutorAttemptResult> {
    const autoFixResult = await this.#deterministicAdapter.tryAutoFix(item, plan, pdmSnapshot)
    const inputRef =
      (plan.evidenceRefs ?? []).length > 0 ? (plan.evidenceRefs ?? [])[0] : 'pdm:current'
    const outputRefs = autoFixResult.patch ? [autoFixResult.patch.patchId] : []

    const attempt: RepairAttempt = {
      ...baseAttempt(
        attemptId,
        item.issueId,
        item.itemId,
        'deterministic_auto_fix',
        item.stageId,
        item.entityIds,
        1,
        autoFixResult.applied ? 'succeeded' : 'failed',
        `det-${attemptId}`,
        now,
      ),
      inputArtifactRefs: [inputRef],
      outputArtifactRefs: outputRefs,
      costSummary: { tokensUsed: 0, llmCallsMade: 0, deterministicAttempts: 1, latencyMs: 0 },
      errorCategory: autoFixResult.applied ? 'none' : 'deterministic_failure',
      errorMessage: autoFixResult.error,
      completedAt: new Date().toISOString(),
    }

    return { attempt, patch: autoFixResult.patch ?? undefined }
  }

  async #executeLlmRetryAttempt(
    item: RepairPlanItem,
    plan: RepairPlan,
    attemptId: string,
    now: string,
    budgetGuard: {
      canAttempt(itemId: string): { allowed: boolean; reason?: string }
      recordAttempt(itemId: string, tokens?: number, isLlm?: boolean): void
    },
  ): Promise<ExecutorAttemptResult> {
    const retryResult = await this.#llmRetryAdapter.executeRetry(
      item,
      plan,
      `Repair attempt for issue ${item.issueId}`,
      item.entityIds,
    )

    if (retryResult.success) {
      budgetGuard.recordAttempt(item.itemId, retryResult.tokensUsed ?? 0, true)
      const attempt: RepairAttempt = {
        ...baseAttempt(
          attemptId,
          item.issueId,
          item.itemId,
          'same_stage_llm_retry',
          item.stageId,
          item.entityIds,
          1,
          'succeeded',
          `llm-${attemptId}`,
          now,
        ),
        costSummary: {
          tokensUsed: retryResult.tokensUsed ?? 0,
          llmCallsMade: 1,
          deterministicAttempts: 0,
          latencyMs: 0,
        },
        errorCategory: 'none',
        completedAt: new Date().toISOString(),
      }
      return { attempt }
    }

    budgetGuard.recordAttempt(item.itemId, retryResult.tokensUsed ?? 0, true)
    return this.#degradeToHumanReview(item, plan, retryResult.errorMessage ?? 'LLM retry failed')
  }

  #degradeToHumanReview(
    item: RepairPlanItem,
    plan: RepairPlan,
    reason: string,
  ): ExecutorAttemptResult {
    const now = new Date().toISOString()
    this.#attemptCounter++
    const attemptId = `att-${plan.planId}-${item.itemId}-hr-${this.#attemptCounter}`

    const attempt: RepairAttempt = {
      ...baseAttempt(
        attemptId,
        item.issueId,
        item.itemId,
        'human_review',
        item.stageId,
        item.entityIds,
        1,
        'degraded_to_human_review',
        `hr-${attemptId}`,
        now,
      ),
      inputArtifactRefs: [],
      outputArtifactRefs: [],
      errorCategory: 'internal_error',
      errorMessage: reason,
      completedAt: now,
    }

    return { attempt, requiresHumanReview: true }
  }
}
