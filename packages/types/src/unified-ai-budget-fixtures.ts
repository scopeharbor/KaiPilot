/**
 * v3-unified-ai-budget-and-quota —— 八态 Fixtures。
 *
 * 覆盖：放行、软越界、硬阻断、降级、耗尽、评估器不可用、多层叠加、通用问答归属。
 */

import type {
  UnifiedBudgetPolicy,
  BudgetDecisionRecord,
  BudgetPreflightResult,
  BudgetPostflightResult,
  BudgetEnforcementResult,
  BudgetDegradationStep,
} from './unified-ai-budget.js'

// ---------------------------------------------------------------------------
// 基础策略 Fixtures
// ---------------------------------------------------------------------------

/** 基础组织级策略（有软硬限制）。 */
export function buildOrgPolicy(overrides?: Partial<UnifiedBudgetPolicy>): UnifiedBudgetPolicy {
  return {
    name: 'org-default',
    enabled: true,
    scope: 'organization',
    scopeValue: '1',
    softLimitCost: 80,
    hardLimitCost: 100,
    softLimitTokens: 800_000,
    hardLimitTokens: 1_000_000,
    currency: 'CNY',
    windowType: 'monthly',
    onSoftLimit: 'warn',
    onHardLimit: 'block',
    failurePosture: 'conservative_deny',
    priority: 1,
    ...overrides,
  }
}

/** 项目级策略（更严格）。 */
export function buildProjectPolicy(overrides?: Partial<UnifiedBudgetPolicy>): UnifiedBudgetPolicy {
  return {
    name: 'project-alpha',
    enabled: true,
    scope: 'project',
    scopeValue: '42',
    softLimitCost: 50,
    hardLimitCost: 60,
    softLimitTokens: 500_000,
    hardLimitTokens: 600_000,
    currency: 'CNY',
    windowType: 'monthly',
    onSoftLimit: 'warn',
    onHardLimit: 'block',
    failurePosture: 'conservative_deny',
    priority: 2,
    ...overrides,
  }
}

/** 用户级策略。 */
export function buildUserPolicy(overrides?: Partial<UnifiedBudgetPolicy>): UnifiedBudgetPolicy {
  return {
    name: 'user-alice',
    enabled: true,
    scope: 'user',
    scopeValue: '7',
    softLimitCost: 20,
    hardLimitCost: 30,
    softLimitTokens: 200_000,
    hardLimitTokens: 300_000,
    currency: 'CNY',
    windowType: 'monthly',
    onSoftLimit: 'warn',
    onHardLimit: 'block',
    failurePosture: 'conservative_deny',
    priority: 3,
    ...overrides,
  }
}

/** 能力面级策略。 */
export function buildCapabilityPolicy(
  overrides?: Partial<UnifiedBudgetPolicy>,
): UnifiedBudgetPolicy {
  return {
    name: 'cap-copilot',
    enabled: true,
    scope: 'capability',
    scopeValue: 'copilot',
    softLimitCost: 10,
    hardLimitCost: 15,
    softLimitTokens: 100_000,
    hardLimitTokens: 150_000,
    currency: 'CNY',
    windowType: 'monthly',
    onSoftLimit: 'warn',
    onHardLimit: 'block',
    failurePosture: 'conservative_deny',
    priority: 4,
    ...overrides,
  }
}

/** 降级链步骤。 */
export function buildDegradationStep(
  overrides?: Partial<BudgetDegradationStep>,
): BudgetDegradationStep {
  return {
    targetModel: 'deepseek-v3',
    reasonCode: 'hard_limit_cost_exceeded',
    visible: true,
    reason: '硬预算超出，降级到更便宜的模型',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 八态 Fixture：Preflight / Postflight / Enforcement
// ---------------------------------------------------------------------------

/** 态 1：放行（未超限）。 */
export function fixtureAllow(): {
  policies: UnifiedBudgetPolicy[]
  enforcement: BudgetEnforcementResult
} {
  return {
    policies: [buildOrgPolicy()],
    enforcement: {
      outcome: 'allow',
      triggeringScope: 'organization',
      triggeringPolicyName: 'org-default',
      reasonCode: null,
      reason: null,
      allowed: true,
      appliedPolicies: ['org-default'],
    },
  }
}

/** 态 2：软越界（超过软限制，未超硬限制）。 */
export function fixtureSoftOverrun(): {
  policies: UnifiedBudgetPolicy[]
  enforcement: BudgetEnforcementResult
} {
  return {
    policies: [buildOrgPolicy()],
    enforcement: {
      outcome: 'warn',
      triggeringScope: 'organization',
      triggeringPolicyName: 'org-default',
      reasonCode: 'soft_limit_cost_exceeded',
      reason: '软预算成本超出: 85.0000 >= 80',
      allowed: true,
      appliedPolicies: ['org-default'],
    },
  }
}

/** 态 3：硬阻断（超过硬限制）。 */
export function fixtureHardBlock(): {
  policies: UnifiedBudgetPolicy[]
  enforcement: BudgetEnforcementResult
} {
  return {
    policies: [buildOrgPolicy()],
    enforcement: {
      outcome: 'block',
      triggeringScope: 'organization',
      triggeringPolicyName: 'org-default',
      reasonCode: 'hard_limit_cost_exceeded',
      reason: '硬预算成本超出: 105.0000 >= 100',
      allowed: false,
      appliedPolicies: ['org-default'],
    },
  }
}

/** 态 4：降级（超过硬限制但有降级链）。 */
export function fixtureDegrade(): {
  policies: UnifiedBudgetPolicy[]
  enforcement: BudgetEnforcementResult
  degradation: BudgetDegradationStep
} {
  const degradation = buildDegradationStep()
  return {
    policies: [
      buildOrgPolicy({
        degradationChain: [degradation],
      }),
    ],
    enforcement: {
      outcome: 'block',
      triggeringScope: 'organization',
      triggeringPolicyName: 'org-default',
      reasonCode: 'hard_limit_cost_exceeded',
      reason: '硬预算成本超出: 105.0000 >= 100',
      allowed: false,
      appliedPolicies: ['org-default'],
    },
    degradation,
  }
}

/** 态 5：耗尽（quota exhausted）。 */
export function fixtureExhausted(): {
  policies: UnifiedBudgetPolicy[]
  enforcement: BudgetEnforcementResult
} {
  return {
    policies: [buildOrgPolicy()],
    enforcement: {
      outcome: 'block',
      triggeringScope: 'organization',
      triggeringPolicyName: 'org-default',
      reasonCode: 'quota_exhausted',
      reason: '配额耗尽',
      allowed: false,
      appliedPolicies: ['org-default'],
    },
  }
}

/** 态 6：评估器不可用。 */
export function fixtureEvaluatorUnavailable(): {
  policies: UnifiedBudgetPolicy[]
  failurePosture: 'conservative_deny' | 'last_known_state_with_warning'
} {
  return {
    policies: [buildOrgPolicy()],
    failurePosture: 'conservative_deny',
  }
}

/** 态 7：多层叠加（组织 + 项目 + 用户 + 能力面，最严格者裁决）。 */
export function fixtureMultiScopeOverlay(): {
  policies: UnifiedBudgetPolicy[]
  enforcement: BudgetEnforcementResult
} {
  return {
    policies: [
      buildOrgPolicy({ hardLimitCost: 100 }),
      buildProjectPolicy({ hardLimitCost: 60 }),
      buildUserPolicy({ hardLimitCost: 30 }),
      buildCapabilityPolicy({ hardLimitCost: 15 }),
    ],
    enforcement: {
      outcome: 'block',
      triggeringScope: 'capability',
      triggeringPolicyName: 'cap-copilot',
      reasonCode: 'hard_limit_cost_exceeded',
      reason: '硬预算成本超出: 16.0000 >= 15',
      allowed: false,
      appliedPolicies: ['org-default', 'project-alpha', 'user-alice', 'cap-copilot'],
    },
  }
}

/** 态 8：通用问答归属（global scope，不扣减项目预算）。 */
export function fixtureGlobalScopeAttribution(): {
  attribution: {
    organizationId: number
    projectId: null
    userId: number | null
    capability: string
    surface: string
  }
  policies: UnifiedBudgetPolicy[]
} {
  return {
    attribution: {
      organizationId: 1,
      projectId: null, // 结构性不含项目引用
      userId: 7,
      capability: 'general',
      surface: 'copilot',
    },
    policies: [buildOrgPolicy({ scopeValue: '1' })],
  }
}

// ---------------------------------------------------------------------------
// Decision Record Fixtures
// ---------------------------------------------------------------------------

/** 构建一个预设的决策记录（用于测试）。 */
export function buildDecisionRecord(
  overrides?: Partial<BudgetDecisionRecord>,
): BudgetDecisionRecord {
  return {
    id: 1,
    organizationId: 1,
    projectId: 42,
    userId: 7,
    capability: 'copilot',
    surface: 'copilot',
    policyRefs: ['org-default'],
    triggeringScope: 'organization',
    triggeringPolicyName: 'org-default',
    decisionType: 'preflight',
    outcome: 'allow',
    reasonCode: null,
    reason: null,
    windowStart: '2026-08-01T00:00:00.000Z',
    windowEnd: '2026-08-31T23:59:59.999Z',
    estimatedCost: 5.0,
    actualCost: null,
    estimatedTokens: 50_000,
    actualTokens: null,
    accumulatedCost: 30.0,
    accumulatedTokens: 300_000,
    currency: 'CNY',
    costStatus: 'estimated',
    idempotencyKey: 'ik:test:001',
    ledgerAttemptRef: null,
    degradation: null,
    bridgeRef: null,
    decidedAt: '2026-08-17T12:00:00.000Z',
    ...overrides,
  }
}

/** Preflight 结果 fixture（允许）。 */
export function buildPreflightAllowResult(): BudgetPreflightResult {
  return {
    allowed: true,
    outcome: 'allow',
    reasonCode: null,
    reason: null,
    triggeringScope: null,
    triggeringPolicyName: null,
    appliedPolicies: [],
    degradation: null,
    decisionRecord: {
      ...buildDecisionRecord(),
      outcome: 'allow',
    },
  }
}

/** Preflight 结果 fixture（阻断）。 */
export function buildPreflightBlockResult(): BudgetPreflightResult {
  return {
    allowed: false,
    outcome: 'block',
    reasonCode: 'hard_limit_cost_exceeded',
    reason: '硬预算成本超出: 105.0000 >= 100',
    triggeringScope: 'organization',
    triggeringPolicyName: 'org-default',
    appliedPolicies: ['org-default'],
    degradation: null,
    decisionRecord: {
      ...buildDecisionRecord(),
      outcome: 'block',
      reasonCode: 'hard_limit_cost_exceeded',
      reason: '硬预算成本超出: 105.0000 >= 100',
    },
  }
}

/** Postflight 结果 fixture（警告）。 */
export function buildPostflightWarnResult(): BudgetPostflightResult {
  return {
    outcome: 'warn',
    warnings: ['软预算成本超出: 85.0000 >= 80'],
    reasonCode: 'soft_limit_cost_exceeded',
    triggeringScope: 'organization',
    appliedPolicies: ['org-default'],
    decisionRecord: {
      ...buildDecisionRecord(),
      decisionType: 'postflight',
      outcome: 'warn',
      actualCost: 5.0,
      actualTokens: 48_000,
      reasonCode: 'soft_limit_cost_exceeded',
    },
  }
}
