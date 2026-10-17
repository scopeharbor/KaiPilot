/**
 * @aiproj/backend —— CompilerBudgetPolicyResolver（tasks 3.1, 3.6）。
 *
 * 预算策略解析器。支持按 organization/user/project/compiler run/
 * stage type/stage id/model tier 合并预算策略，按优先级排序。
 *
 * 设计 D3：预算守卫基于解析后的策略做 preflight/postflight 判断。
 *
 * @aiproj/backend
 */

import {
  budgetPolicySchema,
  type BudgetDecisionStatus,
  type BudgetPolicy,
  type BudgetPolicyInput,
  type BudgetScope,
} from '@aiproj/compiler-spec'

export interface PolicyResolutionScope {
  organizationId: number
  userId?: number
  projectId?: string
  compilerRunId?: number
  stageType?: string
  stageId?: string
  modelTier?: string
}

export interface ResolvedPolicy {
  /** 软预算上限（估算成本）。 */
  softLimit?: number
  /** 硬预算上限（估算成本）。 */
  hardLimit?: number
  /** 软预算上限 token。 */
  softLimitTokens?: number
  /** 硬预算上限 token。 */
  hardLimitTokens?: number
  /** 超出软预算后执行的操作。 */
  onSoftLimit: 'warn' | 'require_review' | 'continue'
  /** 超出硬预算后执行的操作。 */
  onHardLimit: 'block' | 'block_stage' | 'block_run'
  /** 币种。 */
  currency: string
  /** 已应用策略列表。 */
  appliedPolicies: string[]
}

/**
 * CompilerBudgetPolicyResolver —— 预算策略解析器。
 *
 * 按作用域粒度从宽到窄合并策略（organization -> user -> project -> run -> stage -> model_tier）。
 * 更高优先级策略覆盖低优先级策略的相同字段。
 */
export class CompilerBudgetPolicyResolver {
  /** 系统级默认策略（可用作兜底）。 */
  static readonly DEFAULT_POLICY: ResolvedPolicy = {
    softLimit: undefined,
    hardLimit: undefined,
    softLimitTokens: undefined,
    hardLimitTokens: undefined,
    onSoftLimit: 'warn',
    onHardLimit: 'block',
    currency: 'CNY',
    appliedPolicies: [],
  }

  /** 策略存储。实际应用应从数据库加载。 */
  readonly #policies: Map<string, BudgetPolicy>

  constructor(initialPolicies?: BudgetPolicyInput[]) {
    this.#policies = new Map()
    if (initialPolicies) {
      for (const p of initialPolicies) {
        this.register(p)
      }
    }
  }

  /**
   * 注册一条策略。
   */
  register(policy: BudgetPolicyInput): void {
    const parsed = budgetPolicySchema.parse(policy)
    this.#policies.set(parsed.name, parsed)
  }

  /**
   * 批量注册策略。
   */
  registerMany(policies: BudgetPolicyInput[]): void {
    for (const p of policies) {
      this.register(p)
    }
  }

  /**
   * 清除所有策略。
   */
  clear(): void {
    this.#policies.clear()
  }

  /**
   * 获取所有策略。
   */
  getAll(): BudgetPolicy[] {
    return [...this.#policies.values()]
  }

  /**
   * 从 org active profile 加载策略集（v2-5-compiler-config-management-api, task 5.1）。
   * 无 profile 时保持既有 DEFAULT_POLICY 行为（零行为变化）。
   * 不改变预算执行语义（归 cost-controls）。
   */
  loadFromPolicies(policies: BudgetPolicyInput[]): void {
    if (policies.length === 0) return
    for (const p of policies) {
      this.register(p)
    }
  }

  /**
   * 解析给定 scope 的合并预算策略。
   *
   * 合并规则：
   * 1. 收集所有匹配 scope 的已启用策略
   * 2. 按优先级排序（数字越大优先级越高）
   * 3. 合并字段：后合并的策略的字段覆盖先前的（如果存在）
   */
  resolve(scope: PolicyResolutionScope): ResolvedPolicy {
    const matched = this.#findMatchingPolicies(scope)

    if (matched.length === 0) {
      return { ...CompilerBudgetPolicyResolver.DEFAULT_POLICY }
    }

    // 按优先级排序（升序：低优先级先合并，高优先级后合并覆盖）
    const sorted = matched.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      return this.#scopeGranularity(a.scope) - this.#scopeGranularity(b.scope)
    })

    const result: ResolvedPolicy = {
      ...CompilerBudgetPolicyResolver.DEFAULT_POLICY,
      appliedPolicies: [],
    }

    for (const policy of sorted) {
      result.appliedPolicies.push(policy.name)
      if (policy.softLimit !== undefined) result.softLimit = policy.softLimit
      if (policy.hardLimit !== undefined) result.hardLimit = policy.hardLimit
      if (policy.softLimitTokens !== undefined) result.softLimitTokens = policy.softLimitTokens
      if (policy.hardLimitTokens !== undefined) result.hardLimitTokens = policy.hardLimitTokens
      if (policy.onSoftLimit) result.onSoftLimit = policy.onSoftLimit
      if (policy.onHardLimit) result.onHardLimit = policy.onHardLimit
      if (policy.currency) result.currency = policy.currency
    }

    return result
  }

  /**
   * 检查当前累计成本是否超出预算。
   */
  checkBudget(
    policy: ResolvedPolicy,
    currentEstimatedCost: number,
    currentTotalTokens: number,
  ): { status: BudgetDecisionStatus; softExceeded: boolean; hardExceeded: boolean } {
    let hardExceeded = false
    let softExceeded = false

    // 成本上限检查
    if (policy.hardLimit !== undefined && currentEstimatedCost >= policy.hardLimit) {
      hardExceeded = true
    }
    if (policy.hardLimitTokens !== undefined && currentTotalTokens >= policy.hardLimitTokens) {
      hardExceeded = true
    }

    // 软预算检查（即使硬超出也应报告软超出）
    if (policy.softLimit !== undefined && currentEstimatedCost >= policy.softLimit) {
      softExceeded = true
    }
    if (policy.softLimitTokens !== undefined && currentTotalTokens >= policy.softLimitTokens) {
      softExceeded = true
    }

    const status: BudgetDecisionStatus = hardExceeded
      ? 'hard_exceeded'
      : softExceeded
        ? 'soft_exceeded'
        : 'within_budget'

    return { status, softExceeded, hardExceeded }
  }

  /**
   * 获取匹配 scope 的策略。
   */
  #findMatchingPolicies(scope: PolicyResolutionScope): BudgetPolicy[] {
    const matched: BudgetPolicy[] = []

    for (const policy of this.#policies.values()) {
      if (!policy.enabled) continue

      // 检查 stage type 匹配
      if (policy.applicableStageTypes?.length && scope.stageType) {
        if (!policy.applicableStageTypes.includes(scope.stageType as any)) continue
      }

      // 检查 stage id 匹配
      if (policy.applicableStageIds?.length && scope.stageId) {
        if (!policy.applicableStageIds.includes(scope.stageId)) continue
      }

      // 检查 model tier 匹配
      if (policy.applicableModelTiers?.length && scope.modelTier) {
        if (!policy.applicableModelTiers.includes(scope.modelTier)) continue
      }

      // 按 scope 匹配
      switch (policy.scope) {
        case 'organization':
          if (policy.scopeValue === String(scope.organizationId)) matched.push(policy)
          break
        case 'user':
          if (scope.userId && policy.scopeValue === String(scope.userId)) matched.push(policy)
          break
        case 'project':
          if (scope.projectId && policy.scopeValue === scope.projectId) matched.push(policy)
          break
        case 'compiler_run':
          if (scope.compilerRunId && policy.scopeValue === String(scope.compilerRunId))
            matched.push(policy)
          break
        case 'stage_type':
          if (scope.stageType && policy.scopeValue === scope.stageType) matched.push(policy)
          break
        case 'stage_id':
          if (scope.stageId && policy.scopeValue === scope.stageId) matched.push(policy)
          break
        case 'model_tier':
          if (scope.modelTier && policy.scopeValue === scope.modelTier) matched.push(policy)
          break
      }
    }

    return matched
  }

  /**
   * 作用域粒度分数（数字越大越窄、优先级越高）。
   */
  #scopeGranularity(scope: BudgetScope): number {
    const map: Record<BudgetScope, number> = {
      organization: 1,
      user: 2,
      project: 3,
      compiler_run: 4,
      stage_type: 5,
      stage_id: 6,
      model_tier: 7,
    }
    return map[scope] ?? 0
  }
}
