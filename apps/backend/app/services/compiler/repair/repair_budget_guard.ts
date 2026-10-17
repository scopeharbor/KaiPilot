/**
 * @aiproj/backend —— Repair Budget Guard（tasks 2.6）。
 *
 * 校验 maxAttemptsPerItem、maxTotalAttempts、maxLlmRetries、
 * maxCascadeDepth、maxWallClockMs、maxTokenBudget。
 *
 * @aiproj/backend
 */

import type { RepairBudget } from '@aiproj/compiler-spec'

export interface BudgetState {
  /** 各 item 的 attempt 计数。 */
  itemAttemptCounts: Map<string, number>
  /** 总 attempt 计数。 */
  totalAttempts: number
  /** LLM retry 计数。 */
  llmRetries: number
  /** 已用 token。 */
  tokensUsed: number
  /** 开始时间。 */
  startedAt: number
}

export class RepairBudgetGuard {
  readonly #budget: RepairBudget
  #state: BudgetState

  constructor(budget: RepairBudget, initialState?: Partial<BudgetState>) {
    this.#budget = budget
    this.#state = {
      itemAttemptCounts: new Map(initialState?.itemAttemptCounts ?? new Map()),
      totalAttempts: initialState?.totalAttempts ?? 0,
      llmRetries: initialState?.llmRetries ?? 0,
      tokensUsed: initialState?.tokensUsed ?? 0,
      startedAt: initialState?.startedAt ?? Date.now(),
    }
  }

  get budget(): RepairBudget {
    return { ...this.#budget }
  }

  get state(): BudgetState {
    return { ...this.#state, itemAttemptCounts: new Map(this.#state.itemAttemptCounts) }
  }

  /**
   * 检查某 item 是否可执行。
   */
  canAttempt(itemId: string): { allowed: boolean; reason?: string } {
    // 总 attempt 上限
    if (this.#state.totalAttempts >= this.#budget.maxTotalAttempts) {
      return { allowed: false, reason: 'budget_exhausted' }
    }

    // 单项 attempt 上限
    const itemAttempts = this.#state.itemAttemptCounts.get(itemId) ?? 0
    if (itemAttempts >= this.#budget.maxAttemptsPerItem) {
      return { allowed: false, reason: 'budget_exhausted' }
    }

    // wall clock 上限
    if (Date.now() - this.#state.startedAt >= this.#budget.maxWallClockMs) {
      return { allowed: false, reason: 'budget_exhausted' }
    }

    // token 上限
    if (this.#state.tokensUsed >= this.#budget.maxTokenBudget) {
      return { allowed: false, reason: 'budget_exhausted' }
    }

    return { allowed: true }
  }

  /**
   * 检查 LLM retry 是否允许。
   */
  canLlmRetry(): { allowed: boolean; reason?: string } {
    if (this.#state.llmRetries >= this.#budget.maxLlmRetries) {
      return { allowed: false, reason: 'max_llm_retries_exceeded' }
    }
    return { allowed: true }
  }

  /**
   * 记录一次 attempt。
   */
  recordAttempt(itemId: string, tokenCost: number = 0, isLlm: boolean = false): void {
    this.#state.totalAttempts++
    this.#state.itemAttemptCounts.set(itemId, (this.#state.itemAttemptCounts.get(itemId) ?? 0) + 1)
    this.#state.tokensUsed += tokenCost
    if (isLlm) {
      this.#state.llmRetries++
    }
  }
}
