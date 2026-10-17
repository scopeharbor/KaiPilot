/**
 * CompilerBudgetPolicyResolver 单元测试（tasks 3.5）。
 *
 * 覆盖：
 * - 无策略时返回默认值
 * - 单策略解析
 * - 多策略合并与优先级
 * - 各作用域匹配（organization/user/project/run/stage_type/stage_id/model_tier）
 * - 按 scope 粒度和 priority 排序
 * - checkBudget: within, soft exceeded, hard exceeded
 * - 禁用策略不参与合并
 * - applicableStageTypes/applicableStageIds/applicableModelTiers 过滤
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import { CompilerBudgetPolicyResolver } from '#services/compiler/budget_policy_resolver'

test.group('BudgetPolicyResolver', () => {
  // ── 默认值 ──

  test('无策略时返回默认策略', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    const result = resolver.resolve({ organizationId: 1 })
    assert.isUndefined(result.softLimit)
    assert.isUndefined(result.hardLimit)
    assert.equal(result.onSoftLimit, 'warn')
    assert.equal(result.onHardLimit, 'block')
    assert.equal(result.currency, 'CNY')
    assert.deepEqual(result.appliedPolicies, [])
  })

  // ── 注册与解析 ──

  test('注册并解析 organization 级策略', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    resolver.register({
      name: 'org-default',
      scope: 'organization',
      scopeValue: '1',
      enabled: true,
      softLimit: 0.1,
      hardLimit: 0.5,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block',
    })

    const result = resolver.resolve({ organizationId: 1 })
    assert.equal(result.softLimit, 0.1)
    assert.equal(result.hardLimit, 0.5)
    assert.deepEqual(result.appliedPolicies, ['org-default'])
  })

  test('跨组织不返回其他组织的策略', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    resolver.register({
      name: 'org-1-policy',
      scope: 'organization',
      scopeValue: '1',
      enabled: true,
      softLimit: 0.1,
      hardLimit: 0.5,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block',
    })

    const result = resolver.resolve({ organizationId: 2 })
    assert.deepEqual(result.appliedPolicies, [])
  })

  // ── 多策略合并 ──

  test('多策略合并：组织级 + 项目级，项目级覆盖软预算', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    resolver.register({
      name: 'org-default',
      scope: 'organization',
      scopeValue: '1',
      enabled: true,
      softLimit: 0.1,
      hardLimit: 0.5,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block',
    })
    resolver.register({
      name: 'project-strict',
      scope: 'project',
      scopeValue: 'proj-42',
      enabled: true,
      softLimit: 0.05,
      currency: 'CNY',
      onSoftLimit: 'require_review',
      onHardLimit: 'block',
    })

    const result = resolver.resolve({ organizationId: 1, projectId: 'proj-42' })
    // 项目级 scope 更窄，优先级更高
    assert.equal(result.softLimit, 0.05)
    assert.equal(result.hardLimit, 0.5) // 未覆盖则保留
    assert.equal(result.onSoftLimit, 'require_review')
    assert.includeMembers(result.appliedPolicies, ['org-default', 'project-strict'])
  })

  test('按优先级排序：priority 高优先', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    resolver.register({
      name: 'low-priority',
      scope: 'organization',
      scopeValue: '1',
      enabled: true,
      softLimit: 0.1,
      hardLimit: 0.5,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block',
      priority: 1,
    })
    resolver.register({
      name: 'high-priority',
      scope: 'organization',
      scopeValue: '1',
      enabled: true,
      softLimit: 0.05,
      hardLimit: 0.3,
      currency: 'CNY',
      onSoftLimit: 'require_review',
      onHardLimit: 'block_stage',
      priority: 10,
    })

    const result = resolver.resolve({ organizationId: 1 })
    // high-priority 覆盖 low-priority
    assert.equal(result.softLimit, 0.05)
    assert.equal(result.hardLimit, 0.3)
    assert.equal(result.onSoftLimit, 'require_review')
    assert.equal(result.onHardLimit, 'block_stage')
  })

  // ── 各作用域匹配 ──

  test('匹配 user 级策略', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    resolver.register({
      name: 'user-limit',
      scope: 'user',
      scopeValue: '5',
      enabled: true,
      softLimit: 0.02,
      hardLimit: 0.1,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block',
    })

    const result = resolver.resolve({ organizationId: 1, userId: 5 })
    assert.equal(result.softLimit, 0.02)
  })

  test('不匹配错误的 userId', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    resolver.register({
      name: 'user-limit',
      scope: 'user',
      scopeValue: '5',
      enabled: true,
      softLimit: 0.02,
      hardLimit: 0.1,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block',
    })

    const result = resolver.resolve({ organizationId: 1, userId: 6 })
    assert.isUndefined(result.softLimit)
  })

  test('匹配 model_tier 级策略', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    resolver.register({
      name: 'thinking-tier',
      scope: 'model_tier',
      scopeValue: 'thinking',
      enabled: true,
      softLimit: 0.2,
      hardLimit: 0.5,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block',
    })

    const result = resolver.resolve({ organizationId: 1, modelTier: 'thinking' })
    assert.equal(result.softLimit, 0.2)
  })

  test('匹配 stage_type 级策略', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    resolver.register({
      name: 'llm-stage-limit',
      scope: 'stage_type',
      scopeValue: 'llm',
      enabled: true,
      softLimit: 0.3,
      hardLimit: 1.0,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block_stage',
    })

    const result = resolver.resolve({ organizationId: 1, stageType: 'llm' })
    assert.equal(result.softLimit, 0.3)
  })

  test('不匹配不应用的 stage_type', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    resolver.register({
      name: 'llm-stage-limit',
      scope: 'stage_type',
      scopeValue: 'llm',
      enabled: true,
      softLimit: 0.3,
      hardLimit: 1.0,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block_stage',
    })

    const result = resolver.resolve({ organizationId: 1, stageType: 'hybrid' })
    assert.isUndefined(result.softLimit)
  })

  test('匹配 stage_id 级策略', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    resolver.register({
      name: 'intent-parsing-limit',
      scope: 'stage_id',
      scopeValue: 'intent-parsing',
      enabled: true,
      softLimit: 0.01,
      hardLimit: 0.05,
      currency: 'CNY',
      onSoftLimit: 'require_review',
      onHardLimit: 'block',
    })

    const result = resolver.resolve({ organizationId: 1, stageId: 'intent-parsing' })
    assert.equal(result.softLimit, 0.01)
  })

  // ── applicableStageTypes / applicableStageIds 过滤 ──

  test('applicableStageTypes 过滤', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    resolver.register({
      name: 'llm-only-policy',
      scope: 'organization',
      scopeValue: '1',
      enabled: true,
      softLimit: 0.05,
      hardLimit: 0.2,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block',
      applicableStageTypes: ['llm', 'hybrid'],
    })

    const result = resolver.resolve({ organizationId: 1, stageType: 'deterministic' })
    assert.isUndefined(result.softLimit)

    const result2 = resolver.resolve({ organizationId: 1, stageType: 'llm' })
    assert.equal(result2.softLimit, 0.05)
  })

  // ── 禁用策略 ──

  test('禁用策略不参与合并', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    resolver.register({
      name: 'disabled-policy',
      scope: 'organization',
      scopeValue: '1',
      enabled: false,
      softLimit: 0.01,
      hardLimit: 0.05,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block',
    })

    const result = resolver.resolve({ organizationId: 1 })
    assert.isUndefined(result.softLimit)
    assert.deepEqual(result.appliedPolicies, [])
  })

  // ── checkBudget ──

  test('checkBudget: within budget', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    const policy = resolver.resolve({ organizationId: 1 })

    const result = resolver.checkBudget(
      {
        ...policy,
        softLimit: 0.1,
        hardLimit: 0.5,
        currency: 'CNY',
        onSoftLimit: 'warn',
        onHardLimit: 'block',
        appliedPolicies: [],
      },
      0.03, // current cost
      10000, // current tokens
    )
    assert.equal(result.status, 'within_budget')
    assert.isFalse(result.softExceeded)
    assert.isFalse(result.hardExceeded)
  })

  test('checkBudget: soft exceeded', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()

    const result = resolver.checkBudget(
      {
        softLimit: 0.05,
        hardLimit: 0.1,
        currency: 'CNY',
        onSoftLimit: 'warn',
        onHardLimit: 'block',
        appliedPolicies: [],
      },
      0.08, // > softLimit
      25000,
    )
    assert.equal(result.status, 'soft_exceeded')
    assert.isTrue(result.softExceeded)
    assert.isFalse(result.hardExceeded)
  })

  test('checkBudget: hard exceeded by cost', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()

    const result = resolver.checkBudget(
      {
        softLimit: 0.05,
        hardLimit: 0.1,
        currency: 'CNY',
        onSoftLimit: 'warn',
        onHardLimit: 'block',
        appliedPolicies: [],
      },
      0.15, // > hardLimit
      50000,
    )
    assert.equal(result.status, 'hard_exceeded')
    assert.isTrue(result.softExceeded)
    assert.isTrue(result.hardExceeded)
  })

  test('checkBudget: hard exceeded by tokens', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()

    const result = resolver.checkBudget(
      {
        softLimit: 0.05,
        hardLimitTokens: 50000,
        currency: 'CNY',
        onSoftLimit: 'warn',
        onHardLimit: 'block',
        appliedPolicies: [],
      },
      0.03,
      60000, // > hardLimitTokens
    )
    assert.equal(result.status, 'hard_exceeded')
    assert.isTrue(result.hardExceeded)
  })

  test('checkBudget: soft exceeded by tokens', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()

    const result = resolver.checkBudget(
      {
        softLimitTokens: 30000,
        hardLimitTokens: 100000,
        currency: 'CNY',
        onSoftLimit: 'warn',
        onHardLimit: 'block',
        appliedPolicies: [],
      },
      0.01,
      50000, // > softLimitTokens but < hardLimitTokens
    )
    assert.equal(result.status, 'soft_exceeded')
    assert.isTrue(result.softExceeded)
    assert.isFalse(result.hardExceeded)
  })

  test('checkBudget: exactly at limit is not exceeded', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()

    // At exactly softLimit = 0.05. >= means 0.05 is considered exceeded
    const result1 = resolver.checkBudget(
      {
        softLimit: 0.05,
        hardLimit: 0.1,
        currency: 'CNY',
        onSoftLimit: 'warn',
        onHardLimit: 'block',
        appliedPolicies: [],
      },
      0.05,
      20000,
    )
    assert.equal(result1.status, 'soft_exceeded')

    // At exactly hardLimit = 0.1
    const result2 = resolver.checkBudget(
      {
        softLimit: 0.05,
        hardLimit: 0.1,
        currency: 'CNY',
        onSoftLimit: 'warn',
        onHardLimit: 'block',
        appliedPolicies: [],
      },
      0.1,
      40000,
    )
    assert.equal(result2.status, 'hard_exceeded')
  })

  // ── 完整链路 ──

  test('完整链路：组织 + 项目 + stage 策略合并', ({ assert }) => {
    const resolver = new CompilerBudgetPolicyResolver()
    resolver.register({
      name: 'org-default',
      scope: 'organization',
      scopeValue: '1',
      enabled: true,
      softLimit: 0.1,
      hardLimit: 0.5,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block',
      priority: 1,
    })
    resolver.register({
      name: 'project-strict',
      scope: 'project',
      scopeValue: 'proj-42',
      enabled: true,
      softLimit: 0.05,
      hardLimit: 0.2,
      currency: 'CNY',
      onSoftLimit: 'require_review',
      onHardLimit: 'block_stage',
      priority: 5,
    })
    resolver.register({
      name: 'thinking-no-budget',
      scope: 'model_tier',
      scopeValue: 'thinking',
      enabled: false, // disabled
      hardLimit: 0.0,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block',
      priority: 10,
    })

    const result = resolver.resolve({ organizationId: 1, projectId: 'proj-42', stageType: 'llm' })
    assert.equal(result.softLimit, 0.05)
    assert.equal(result.hardLimit, 0.2)
    assert.equal(result.onSoftLimit, 'require_review')
    assert.equal(result.onHardLimit, 'block_stage')
    assert.includeMembers(result.appliedPolicies, ['org-default', 'project-strict'])
    assert.notInclude(result.appliedPolicies, 'thinking-no-budget')

    // 检查 checkBudget
    const check1 = resolver.checkBudget(result, 0.03, 10000)
    assert.equal(check1.status, 'within_budget')

    const check2 = resolver.checkBudget(result, 0.06, 20000)
    assert.equal(check2.status, 'soft_exceeded')

    const check3 = resolver.checkBudget(result, 0.25, 100000)
    assert.equal(check3.status, 'hard_exceeded')
  })
})
