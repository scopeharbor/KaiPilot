/**
 * v3-unified-ai-budget-and-quota —— 契约测试。
 *
 * 证明：
 * - 叠加不取最宽松、组织上限不被更窄策略突破（2.10）
 * - 「继承」与「执行」是两个独立步骤（2.11）
 * - sanitizer 对每类禁止内容各给一个负例（2.13）
 * - global scope 结构性不可扣减项目预算（5.1-5.3）
 * - 失败姿态不含默认放行（5.7-5.8）
 */

import { describe, it, expect } from 'vitest'
import {
  resolveEffectivePolicies,
  enforceBudgetPolicies,
  sanitizeBudgetDecisionRecord,
  buildGlobalScopeAttribution,
  rejectGlobalScopeProjectAttribution,
  BUDGET_ATTRIBUTION_SCOPES,
  BUDGET_DECISION_OUTCOMES,
  BUDGET_FAILURE_POSTURES,
  BUDGET_OVERRUN_REASON_CODES,
  BUDGET_FORBIDDEN_KEY_CATEGORIES,
  BUDGET_COST_STATUSES,
  isBudgetAttributionScope,
  isBudgetDecisionOutcome,
  isBudgetFailurePosture,
  isBudgetOverrunReasonCode,
  type UnifiedBudgetPolicy,
  type BudgetDecisionRecord,
} from '../src/unified-ai-budget.js'
import {
  buildOrgPolicy,
  buildProjectPolicy,
  buildUserPolicy,
  buildCapabilityPolicy,
  buildDecisionRecord,
} from '../src/unified-ai-budget-fixtures.js'
import { LEDGER_FORBIDDEN_KEY_CATEGORIES } from '../src/unified-ai-invocation-ledger.js'

// ---------------------------------------------------------------------------
// §2.10 叠加不取最宽松、组织上限不被更窄策略突破
// ---------------------------------------------------------------------------

describe('§2.10 strictest-wins enforcement', () => {
  it('organization ceiling survives a narrower policy', () => {
    const policies: UnifiedBudgetPolicy[] = [
      buildOrgPolicy({ hardLimitCost: 100 }),
      buildProjectPolicy({ hardLimitCost: 200 }), // 项目策略更宽松
    ]
    const result = enforceBudgetPolicies(
      resolveEffectivePolicies(policies, {
        organizationId: 1,
        projectId: 42,
        userId: null,
        capability: 'draft',
      }),
      90,
      0,
      15,
      0, // 累计 90 + 预估 15 = 105 > 组织硬限 100
    )
    // 组织上限 100 仍然生效，即使项目策略更宽松（200）
    expect(result.outcome).toBe('block')
    expect(result.triggeringScope).toBe('organization')
    expect(result.allowed).toBe(false)
  })

  it('most restrictive scope governs when all overlap', () => {
    const policies: UnifiedBudgetPolicy[] = [
      buildOrgPolicy({ hardLimitCost: 100 }),
      buildProjectPolicy({ hardLimitCost: 60 }),
      buildUserPolicy({ hardLimitCost: 30 }),
      buildCapabilityPolicy({ hardLimitCost: 15 }),
    ]
    const result = enforceBudgetPolicies(
      resolveEffectivePolicies(policies, {
        organizationId: 1,
        projectId: 42,
        userId: 7,
        capability: 'copilot',
      }),
      10,
      0,
      6,
      0, // 累计 10 + 预估 6 = 16 > 能力面硬限 15
    )
    expect(result.outcome).toBe('block')
    expect(result.triggeringScope).toBe('capability')
    expect(result.allowed).toBe(false)
  })

  it('absent limits do not constrain', () => {
    const policies: UnifiedBudgetPolicy[] = [
      buildOrgPolicy({ hardLimitCost: undefined, softLimitCost: undefined }),
    ]
    const result = enforceBudgetPolicies(
      resolveEffectivePolicies(policies, {
        organizationId: 1,
        projectId: null,
        userId: null,
        capability: 'draft',
      }),
      999_999,
      0,
      999_999,
      0, // 巨大累计
    )
    expect(result.outcome).toBe('allow')
    expect(result.allowed).toBe(true)
  })

  it('triggering scope is diagnosable', () => {
    const policies: UnifiedBudgetPolicy[] = [
      buildOrgPolicy({ hardLimitCost: 100, softLimitCost: 80 }),
      buildProjectPolicy({ hardLimitCost: 60, softLimitCost: 50 }),
    ]
    const result = enforceBudgetPolicies(
      resolveEffectivePolicies(policies, {
        organizationId: 1,
        projectId: 42,
        userId: null,
        capability: 'draft',
      }),
      45,
      0,
      10,
      0, // 累计 45 + 预估 10 = 55 > 项目软限 50
    )
    expect(result.outcome).toBe('warn')
    expect(result.triggeringScope).toBe('project')
    expect(result.reasonCode).toBe('soft_limit_cost_exceeded')
  })
})

// ---------------------------------------------------------------------------
// §2.11 继承与执行是两个独立步骤
// ---------------------------------------------------------------------------

describe('§2.11 inheritance and enforcement are separate steps', () => {
  it('policy inheritance fills unset fields from broader scope', () => {
    // 组织策略设了软限但没设硬限，项目策略设了硬限但没设软限
    const policies: UnifiedBudgetPolicy[] = [
      buildOrgPolicy({ hardLimitCost: undefined, softLimitCost: 50, currency: 'USD' }),
      buildProjectPolicy({
        hardLimitCost: 80,
        softLimitCost: undefined,
        currency: undefined as any,
      }),
    ]
    const effective = resolveEffectivePolicies(policies, {
      organizationId: 1,
      projectId: 42,
      userId: null,
      capability: 'draft',
    })
    // 继承后项目有效策略应有组织的软限和自己的硬限
    const projectEffective = effective.find((e) => e.scope === 'project')
    expect(projectEffective).toBeDefined()
    expect(projectEffective!.softLimitCost).toBe(50) // 从组织继承
    expect(projectEffective!.hardLimitCost).toBe(80) // 项目自有
    expect(projectEffective!.currency).toBe('USD') // 从组织继承
  })

  it('enforcement then applies all effective policies and takes strictest', () => {
    const policies: UnifiedBudgetPolicy[] = [
      buildOrgPolicy({ softLimitCost: 50, hardLimitCost: 100 }),
      buildProjectPolicy({ softLimitCost: 70, hardLimitCost: 80 }), // 项目软限更宽松
    ]
    // 累计 45 + 预估 10 = 55，超过组织软限 50 但未超项目软限 70
    const result = enforceBudgetPolicies(
      resolveEffectivePolicies(policies, {
        organizationId: 1,
        projectId: 42,
        userId: null,
        capability: 'draft',
      }),
      45,
      0,
      10,
      0,
    )
    // 尽管项目软限更宽松（70），组织软限（50）更严格，应该触发 warn
    expect(result.outcome).toBe('warn')
    expect(result.triggeringScope).toBe('organization')
  })

  it('narrower policy cannot relax broader ceiling', () => {
    const policies: UnifiedBudgetPolicy[] = [
      buildOrgPolicy({ hardLimitCost: 60 }),
      buildProjectPolicy({ hardLimitCost: 100 }), // 项目更宽松
    ]
    const result = enforceBudgetPolicies(
      resolveEffectivePolicies(policies, {
        organizationId: 1,
        projectId: 42,
        userId: null,
        capability: 'draft',
      }),
      55,
      0,
      10,
      0, // 累计 55 + 预估 10 = 65 > 组织硬限 60
    )
    expect(result.outcome).toBe('block')
    expect(result.triggeringScope).toBe('organization')
  })
})

// ---------------------------------------------------------------------------
// §2.13 sanitizer 负例测试
// ---------------------------------------------------------------------------

describe('§2.13 sanitizer rejects forbidden content', () => {
  const forbiddenExamples: Array<{ category: string; key: string; value: any }> = [
    { category: 'prompt', key: 'userPrompt', value: 'hello' },
    { category: 'system_instruction', key: 'sysInstruction', value: 'be helpful' },
    { category: 'completion', key: 'completionText', value: 'result' },
    { category: 'messages', key: 'messages', value: [] },
    { category: 'tool_arguments', key: 'toolArgs', value: {} },
    { category: 'tool_results', key: 'toolResults', value: {} },
    { category: 'retrieval_body', key: 'retrievalBody', value: 'doc' },
    { category: 'provider_payload', key: 'rawBody', value: {} },
    { category: 'api_key', key: 'apiKey', value: 'sk-123' },
    { category: 'authorization', key: 'authorizationHeader', value: 'Bearer xxx' },
    { category: 'token', key: 'accessToken', value: 'tok' },
    { category: 'secret', key: 'secretKey', value: 'sec' },
  ]

  for (const { category, key, value } of forbiddenExamples) {
    it(`rejects ${category} content (key: ${key})`, () => {
      const record = buildDecisionRecord({
        [key]: value,
      }) as unknown as Record<string, unknown>
      const sanitized = sanitizeBudgetDecisionRecord(record)
      // Forbidden content in nested objects should be removed
      if (sanitized && key in sanitized) {
        // If the key survived, the value should be nullified or removed
        expect(sanitized[key]).toBeUndefined()
      }
    })
  }

  it('preserves allowed low-sensitivity fields', () => {
    const record = buildDecisionRecord()
    const sanitized = sanitizeBudgetDecisionRecord(record as unknown as Record<string, unknown>)
    expect(sanitized).not.toBeNull()
    expect(sanitized!.organizationId).toBe(1)
    expect(sanitized!.outcome).toBe('allow')
    expect(sanitized!.currency).toBe('CNY')
  })
})

// ---------------------------------------------------------------------------
// §5.1-5.3 global scope 结构性隔离
// ---------------------------------------------------------------------------

describe('§5.1-5.3 global scope structural isolation', () => {
  it('global scope attribution carries no project reference', () => {
    const attr = buildGlobalScopeAttribution({
      organizationId: 1,
      userId: 7,
      capability: 'general',
      surface: 'copilot',
    })
    expect(attr.projectId).toBeNull()
  })

  it('global scope call does not decrement any project budget', () => {
    const policies: UnifiedBudgetPolicy[] = [
      buildOrgPolicy({ hardLimitCost: 100 }),
      buildProjectPolicy({ hardLimitCost: 60 }),
    ]
    const effective = resolveEffectivePolicies(
      policies,
      { organizationId: 1, projectId: null, userId: null, capability: 'general' }, // global: no project
    )
    // Only org policy should match (project policy doesn't match projectId=null)
    const scopes = effective.map((e) => e.scope)
    expect(scopes).not.toContain('project')
  })

  it('forced project attribution on global scope is rejected', () => {
    const result = rejectGlobalScopeProjectAttribution('global', 42)
    expect(result.rejected).toBe(true)
    expect(result.reason).toContain('global scope')
  })

  it('non-global scope with project is accepted', () => {
    const result = rejectGlobalScopeProjectAttribution('project', 42)
    expect(result.rejected).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// §5.7-5.8 失败姿态不含默认放行
// ---------------------------------------------------------------------------

describe('§5.7-5.8 failure posture never allows', () => {
  it('failure posture enum does not include allow/open', () => {
    expect(BUDGET_FAILURE_POSTURES).not.toContain('allow')
    expect(BUDGET_FAILURE_POSTURES).not.toContain('fail_open')
    expect(BUDGET_FAILURE_POSTURES).not.toContain('default_allow')
  })

  it('only conservative_deny and last_known_state_with_warning are valid', () => {
    expect(BUDGET_FAILURE_POSTURES).toEqual(['conservative_deny', 'last_known_state_with_warning'])
  })
})

// ---------------------------------------------------------------------------
// 枚举完整性
// ---------------------------------------------------------------------------

describe('enumerations', () => {
  it('attribution scopes cover 4 dimensions', () => {
    expect(BUDGET_ATTRIBUTION_SCOPES).toHaveLength(4)
    expect(isBudgetAttributionScope('organization')).toBe(true)
    expect(isBudgetAttributionScope('invalid')).toBe(false)
  })

  it('decision outcomes cover 4 values', () => {
    expect(BUDGET_DECISION_OUTCOMES).toHaveLength(4)
    expect(isBudgetDecisionOutcome('allow')).toBe(true)
    expect(isBudgetDecisionOutcome('deny')).toBe(false)
  })

  it('overrun reason codes are complete', () => {
    expect(BUDGET_OVERRUN_REASON_CODES.length).toBeGreaterThanOrEqual(7)
    expect(isBudgetOverrunReasonCode('hard_limit_cost_exceeded')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// §2.12 forbidden key categories reuses ledger
// ---------------------------------------------------------------------------

describe('§2.12 budget forbidden keys reuse ledger', () => {
  it('budget forbidden categories are identical to ledger forbidden categories', () => {
    expect(BUDGET_FORBIDDEN_KEY_CATEGORIES).toEqual(LEDGER_FORBIDDEN_KEY_CATEGORIES)
  })
})

// ===========================================================================
// 成本状态口径（v3-backend-type-debt-closure：从预算与账本两处内联联合提取为具名类型）
// ===========================================================================

describe('BUDGET_COST_STATUSES', () => {
  it('六个取值与账本口径一致', () => {
    expect([...BUDGET_COST_STATUSES]).toEqual([
      'estimated',
      'fallback_estimate',
      'cost_unknown',
      'unavailable',
      'zero',
      'unknown',
    ])
  })

  it('取值唯一', () => {
    expect(new Set(BUDGET_COST_STATUSES).size).toBe(BUDGET_COST_STATUSES.length)
  })
})
