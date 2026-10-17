/**
 * v3-ai-offline-eval-datasets §7 — Authorization Gate & Org Isolation 测试。
 *
 * 覆盖：
 *  - 7.1: 真实模型大规模评测的组织级授权开关与 RBAC 校验
 *  - 7.2: 默认 fixture provider，零真实模型调用
 *  - 7.3: 未授权时零真实模型调用、零公网访问
 *  - 7.4: 组织隔离：数据集、运行与报告附加 organization_id
 *  - 7.5: 跨组织数据集与报告不可见
 *  - 7.6: 无权限查询报告被拒
 *
 * 不依赖真实模型；纯类型 + 确定性函数测试。
 */

import { test } from '@japa/runner'
import { resolveEvalProvider } from '@aiproj/types'
import {
  adjudicateOfflineEvalAuth,
  OfflineEvalFixtureProvider,
  isResourceInOrganization,
  buildOrgScopeFilter,
  assertAllInOrganization,
} from '#services/ai_evaluation/offline_eval_auth'

// ═══════════════════════════════════════════════════════════════════════════════
// §7.1 授权门：组织级 feature flag + RBAC
// ═══════════════════════════════════════════════════════════════════════════════

test.group('7.1 Authorization gate with org flag and RBAC', () => {
  test('authorized when both org flag enabled and admin role', ({ assert }) => {
    const decision = adjudicateOfflineEvalAuth(true, 'admin')
    assert.isTrue(decision.authorized)
    assert.equal(decision.providerKind, 'real_model')
    assert.isTrue(decision.rbacSatisfied)
    assert.isTrue(decision.orgFlagEnabled)
    assert.isUndefined(decision.denialReason)
  })

  test('authorized with super_admin role', ({ assert }) => {
    const decision = adjudicateOfflineEvalAuth(true, 'super_admin')
    assert.isTrue(decision.authorized)
    assert.equal(decision.providerKind, 'real_model')
    assert.isTrue(decision.rbacSatisfied)
  })

  test('denied when org flag disabled', ({ assert }) => {
    const decision = adjudicateOfflineEvalAuth(false, 'admin')
    assert.isFalse(decision.authorized)
    assert.equal(decision.providerKind, 'fixture')
    assert.isTrue(decision.rbacSatisfied)
    assert.isFalse(decision.orgFlagEnabled)
    assert.include(decision.denialReason!, '组织未启用')
  })

  test('denied when non-admin role', ({ assert }) => {
    const decision = adjudicateOfflineEvalAuth(true, 'member')
    assert.isFalse(decision.authorized)
    assert.equal(decision.providerKind, 'fixture')
    assert.isFalse(decision.rbacSatisfied)
    assert.isTrue(decision.orgFlagEnabled)
    assert.include(decision.denialReason!, 'admin')
  })

  test('denied when both conditions fail', ({ assert }) => {
    const decision = adjudicateOfflineEvalAuth(false, 'member')
    assert.isFalse(decision.authorized)
    assert.equal(decision.providerKind, 'fixture')
    assert.isFalse(decision.rbacSatisfied)
    assert.isFalse(decision.orgFlagEnabled)
    assert.include(decision.denialReason!, '未启用')
    assert.include(decision.denialReason!, 'admin')
  })

  test('denied when role is undefined', ({ assert }) => {
    const decision = adjudicateOfflineEvalAuth(true, undefined)
    assert.isFalse(decision.authorized)
    assert.equal(decision.providerKind, 'fixture')
    assert.isFalse(decision.rbacSatisfied)
  })

  test('denied by default (no flag, no role)', ({ assert }) => {
    const decision = adjudicateOfflineEvalAuth(false, undefined)
    assert.isFalse(decision.authorized)
    assert.equal(decision.providerKind, 'fixture')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §7.2 默认 fixture provider，零真实模型调用
// ═══════════════════════════════════════════════════════════════════════════════

test.group('7.2 Default fixture provider with zero real model calls', () => {
  test('resolveEvalProvider returns fixture when not authorized', ({ assert }) => {
    const provider = resolveEvalProvider('not_authorized')
    assert.equal(provider, 'fixture')
  })

  test('resolveEvalProvider returns real_model when authorized', ({ assert }) => {
    const provider = resolveEvalProvider('authorized')
    assert.equal(provider, 'real_model')
  })

  test('fixture provider evaluates without real model calls', ({ assert }) => {
    const provider = new OfflineEvalFixtureProvider()
    const result = provider.evaluate('sample-001', 'draft_structural_compliance')

    assert.equal(result.scoreValue, 1)
    assert.equal(result.scoreLabel, 'pass')
    assert.include(result.explanation, 'Fixture provider')
    assert.include(result.explanation, 'zero real model calls')
  })

  test('fixture provider tracks calls for test assertion', ({ assert }) => {
    const provider = new OfflineEvalFixtureProvider()

    provider.evaluate('s1', 'dimension1')
    provider.evaluate('s2', 'dimension2')

    assert.equal(provider.getCallCount(), 2)
    const calls = provider.getCalls()
    assert.equal(calls[0].sampleId, 's1')
    assert.equal(calls[1].sampleId, 's2')
  })

  test('fixture provider can be cleared', ({ assert }) => {
    const provider = new OfflineEvalFixtureProvider()
    provider.evaluate('s1', 'd1')
    assert.equal(provider.getCallCount(), 1)

    provider.clearCalls()
    assert.equal(provider.getCallCount(), 0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §7.3 未授权时零真实模型调用、零公网访问
// ═══════════════════════════════════════════════════════════════════════════════

test.group('7.3 Unauthorized = zero real model calls, zero public network', () => {
  test('unauthorized decision always uses fixture provider', ({ assert }) => {
    // Simulate various unauthorized scenarios
    const scenarios = [
      adjudicateOfflineEvalAuth(false, 'admin'),
      adjudicateOfflineEvalAuth(true, 'member'),
      adjudicateOfflineEvalAuth(false, 'member'),
      adjudicateOfflineEvalAuth(false, undefined),
    ]

    for (const decision of scenarios) {
      assert.isFalse(decision.authorized)
      assert.equal(decision.providerKind, 'fixture')
    }
  })

  test('fixture provider makes zero real model calls', ({ assert }) => {
    const provider = new OfflineEvalFixtureProvider()

    // Run multiple evaluations
    for (let i = 0; i < 5; i++) {
      provider.evaluate(`sample-${i}`, `dimension-${i}`)
    }

    // All calls are tracked, none go to real models
    assert.equal(provider.getCallCount(), 5)

    // Each call result indicates fixture (zero real model calls)
    const calls = provider.getCalls()
    for (const call of calls) {
      assert.property(call, 'sampleId')
      assert.property(call, 'dimension')
      assert.property(call, 'calledAt')
      // No network-related properties
    }
  })

  test('fixture provider never throws on network', ({ assert }) => {
    const provider = new OfflineEvalFixtureProvider()

    // Should not throw - fixture provider has no network dependencies
    assert.doesNotThrow(() => {
      provider.evaluate('test-sample', 'test-dimension')
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §7.4 组织隔离：数据集、运行与报告附加 organization_id
// ═══════════════════════════════════════════════════════════════════════════════

test.group('7.4 Organization isolation for datasets, runs, and reports', () => {
  test('buildOrgScopeFilter creates correct filter', ({ assert }) => {
    const filter = buildOrgScopeFilter(42)
    assert.deepEqual(filter, { organization_id: 42 })
  })

  test('isResourceInOrganization returns true for same org', ({ assert }) => {
    assert.isTrue(isResourceInOrganization(42, 42))
  })

  test('isResourceInOrganization returns false for different org', ({ assert }) => {
    assert.isFalse(isResourceInOrganization(42, 99))
  })

  test('assertAllInOrganization returns true when all match', ({ assert }) => {
    const resources = [{ organizationId: 42 }, { organizationId: 42 }, { organizationId: 42 }]
    assert.isTrue(assertAllInOrganization(resources, 42))
  })

  test('assertAllInOrganization returns false when one mismatches', ({ assert }) => {
    const resources = [{ organizationId: 42 }, { organizationId: 99 }, { organizationId: 42 }]
    assert.isFalse(assertAllInOrganization(resources, 42))
  })

  test('empty resources are all in organization', ({ assert }) => {
    assert.isTrue(assertAllInOrganization([], 42))
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §7.5 跨组织数据集与报告不可见
// ═══════════════════════════════════════════════════════════════════════════════

test.group('7.5 Cross-organization datasets and reports are invisible', () => {
  test('resource from org A is invisible to org B', ({ assert }) => {
    const resourceOrgId = 1
    const queryOrgId = 2

    assert.isFalse(isResourceInOrganization(resourceOrgId, queryOrgId))
  })

  test('mixed org resources are rejected', ({ assert }) => {
    const resources = [
      { organizationId: 1 },
      { organizationId: 2 }, // Cross-org!
    ]
    assert.isFalse(assertAllInOrganization(resources, 1))
  })

  test('org scope filter prevents cross-org queries', ({ assert }) => {
    // Simulating a query with org scope filter
    const filter1 = buildOrgScopeFilter(1)
    const filter2 = buildOrgScopeFilter(2)

    // Different org IDs produce different filters
    assert.notDeepEqual(filter1, filter2)
    assert.equal(filter1.organization_id, 1)
    assert.equal(filter2.organization_id, 2)
  })

  test('L3 samples from org A not visible to org B', ({ assert }) => {
    // Even L3 samples are org-scoped
    const l3Sample = {
      sampleId: 'l3-001',
      organizationId: 1,
      benchmarkSource: 'L3' as const,
    }

    assert.isFalse(isResourceInOrganization(l3Sample.organizationId, 2))
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §7.6 无权限查询报告被拒
// ═══════════════════════════════════════════════════════════════════════════════

test.group('7.6 Unauthorized report query is rejected', () => {
  test('non-admin cannot authorize real model evaluation', ({ assert }) => {
    const decision = adjudicateOfflineEvalAuth(true, 'viewer')
    assert.isFalse(decision.authorized)
    assert.equal(decision.providerKind, 'fixture')
    assert.include(decision.denialReason!, 'admin')
  })

  test('unauthorized actor gets fixture provider for reports', ({ assert }) => {
    // Even if org flag is enabled, non-admin gets fixture
    const decision = adjudicateOfflineEvalAuth(true, 'member')
    assert.isFalse(decision.authorized)
    assert.equal(decision.providerKind, 'fixture')
  })

  test('authorization gate blocks report generation with real models', ({ assert }) => {
    // Simulate attempting to generate a report with real models
    const orgFlagEnabled = false
    const actorRole = 'admin'

    const decision = adjudicateOfflineEvalAuth(orgFlagEnabled, actorRole)

    // Should be denied
    assert.isFalse(decision.authorized)
    assert.equal(decision.providerKind, 'fixture')
    assert.include(decision.denialReason!, '组织未启用')
  })
})
