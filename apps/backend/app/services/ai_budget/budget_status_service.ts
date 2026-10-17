/**
 * v3-unified-ai-budget-and-quota §7 — 只读预算状态查询服务。
 *
 * 提供当前余量、窗口用量、近期决策的只读查询。
 * 全部路径附加 organization_id 过滤。
 * 成本值标注为估算。
 */

import type { BudgetStatusResponse, BudgetDecisionRecord, UnifiedBudgetPolicy } from '@aiproj/types'

/** 预算决策查询接口（由 repository 层注入）。 */
export interface BudgetDecisionRepository {
  listByOrganization(organizationId: number, limit: number): Promise<BudgetDecisionRecord[]>
  accumulateInWindow(
    organizationId: number,
    projectId: number | null,
    userId: number | null,
    capability: string | null,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<{ totalCost: number; totalTokens: number; currency: string }>
}

/** 窗口计算接口。 */
export interface WindowCalculator {
  getWindow(now: Date): { start: Date; end: Date; type: string }
}

function defaultMonthlyWindow(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999))
  return { start, end, type: 'monthly' }
}

/**
 * BudgetStatusService —— 只读预算状态查询。
 *
 * 组织隔离：全部查询路径附加 organization_id 过滤。
 * 跨组织访问返回不泄露错误。
 */
export class BudgetStatusService {
  readonly #repository: BudgetDecisionRepository
  readonly #policies: UnifiedBudgetPolicy[]
  readonly #windowCalculator: WindowCalculator

  constructor(options: {
    repository: BudgetDecisionRepository
    policies: UnifiedBudgetPolicy[]
    windowCalculator?: WindowCalculator
  }) {
    this.#repository = options.repository
    this.#policies = options.policies
    this.#windowCalculator = options.windowCalculator ?? { getWindow: defaultMonthlyWindow }
  }

  /**
   * 查询指定组织的预算状态。
   * 组织隔离：organizationId 是必填的过滤条件。
   */
  async getStatus(input: {
    organizationId: number
    projectId?: number | null
    userId?: number | null
    capability?: string | null
    recentDecisionsLimit?: number
    now?: Date
  }): Promise<BudgetStatusResponse> {
    const now = input.now ?? new Date()
    const { start, end, type } = this.#windowCalculator.getWindow(now)

    // 查询窗口内累计用量
    const accumulated = await this.#repository.accumulateInWindow(
      input.organizationId,
      input.projectId ?? null,
      input.userId ?? null,
      input.capability ?? null,
      start,
      end,
    )

    // 查找匹配的策略
    const matchingPolicy = this.#findMatchingPolicy(input)

    // 查询近期决策
    const recentDecisions = await this.#repository.listByOrganization(
      input.organizationId,
      input.recentDecisionsLimit ?? 10,
    )

    // 构建响应
    const limits = matchingPolicy
      ? {
          softCost: matchingPolicy.softLimitCost ?? null,
          hardCost: matchingPolicy.hardLimitCost ?? null,
          softTokens: matchingPolicy.softLimitTokens ?? null,
          hardTokens: matchingPolicy.hardLimitTokens ?? null,
        }
      : null

    const remaining = limits
      ? {
          cost:
            limits.hardCost !== null ? Math.max(0, limits.hardCost - accumulated.totalCost) : null,
          tokens:
            limits.hardTokens !== null
              ? Math.max(0, limits.hardTokens - accumulated.totalTokens)
              : null,
        }
      : null

    return {
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      userId: input.userId ?? null,
      capability: input.capability ?? null,
      window: {
        type: type as any,
        start: start.toISOString(),
        end: end.toISOString(),
      },
      accumulated: {
        cost: accumulated.totalCost,
        tokens: accumulated.totalTokens,
        currency: accumulated.currency,
      },
      limits,
      remaining,
      recentDecisions,
      costLabel: 'estimate',
      policySet: matchingPolicy !== null,
    }
  }

  #findMatchingPolicy(input: {
    organizationId: number
    projectId?: number | null
    userId?: number | null
    capability?: string | null
  }): UnifiedBudgetPolicy | null {
    // 从最具体到最宽查找匹配的策略
    for (const policy of this.#policies) {
      if (!policy.enabled) continue
      switch (policy.scope) {
        case 'capability':
          if (input.capability && policy.scopeValue === input.capability) return policy
          break
        case 'user':
          if (input.userId && policy.scopeValue === String(input.userId)) return policy
          break
        case 'project':
          if (input.projectId && policy.scopeValue === String(input.projectId)) return policy
          break
        case 'organization':
          if (policy.scopeValue === String(input.organizationId)) return policy
          break
      }
    }
    return null
  }
}
