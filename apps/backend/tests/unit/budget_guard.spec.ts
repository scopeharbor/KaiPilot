/**
 * CompilerBudgetGuard 单元测试（tasks 3.5, 3.6）。
 *
 * 覆盖：
 * - within budget: preflight 允许
 * - soft exceeded: preflight 允许 + warning
 * - hard exceeded: preflight 阻止
 * - postflight: 更新累计成本、超出估算告警
 * - 跨 scope 策略优先级
 * - 人工复核状态
 * - 使用 fake provider（无真实模型调用）
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import CompilerRun from '#models/compiler_run'
import Organization from '#models/organization'
import User from '#models/user'
import { CompilerBudgetGuard } from '#services/compiler/budget_guard'
import { CompilerBudgetPolicyResolver } from '#services/compiler/budget_policy_resolver'
import { CompilerObservabilityRecorder } from '#services/compiler/observability_recorder'
import { ArtifactStore } from '#services/compiler/artifact_store'
import { StageEventLogger } from '#services/compiler/stage_event_logger'
import type { BudgetGuardContext } from '#services/compiler/budget_guard'

type BudgetGuardTestContext = BudgetGuardContext & {
  actualTokens?: number
  actualCost?: number
}

test.group('BudgetGuard', (group) => {
  let resolver: CompilerBudgetPolicyResolver
  let recorder: CompilerObservabilityRecorder
  let guard: CompilerBudgetGuard
  let org: Organization
  let owner: User
  let compilerRun: CompilerRun
  let defaultCtx: BudgetGuardTestContext

  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await testUtils.db().truncate()

    owner = await User.create({
      email: `budget-guard-${Date.now()}@test.local`,
      password: 'Password123!',
      fullName: 'Test User',
      authProvider: 'local',
      isActive: true,
    })

    org = await Organization.create({
      ownerId: owner.id,
      name: 'Budget Guard Test Org',
      slug: `bg-${Date.now()}`,
    })

    compilerRun = await CompilerRun.create({
      organizationId: org.id,
      requestedByUserId: owner.id,
      status: 'running',
      input: { prompt: 'test' },
    })

    resolver = new CompilerBudgetPolicyResolver()
    resolver.register({
      name: 'test-policy',
      scope: 'organization',
      scopeValue: String(org.id),
      enabled: true,
      softLimit: 0.05,
      hardLimit: 0.1,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block',
    })

    const stageEventLogger = new StageEventLogger()
    const artifactStore = new ArtifactStore()
    recorder = new CompilerObservabilityRecorder({ stageEventLogger, artifactStore })
    guard = new CompilerBudgetGuard(resolver, recorder)

    defaultCtx = {
      compilerRunId: compilerRun.id,
      organizationId: org.id,
      stageId: 'intent-parsing',
      attemptNumber: 1,
      estimatedTokens: 4000,
      estimatedCost: 0.01,
    }
  })

  function buildCtx<T extends Partial<BudgetGuardTestContext> = {}>(
    overrides?: T,
  ): BudgetGuardContext & T {
    return { ...defaultCtx, ...overrides } as BudgetGuardContext & T
  }

  // ── Preflight ──

  test('preflight: within budget 允许通过', async ({ assert }) => {
    const result = await guard.preflight(buildCtx())
    assert.isTrue(result.allowed)
    assert.equal(result.decision.status, 'within_budget')
    assert.equal(result.decision.decisionType, 'preflight')
  })

  test('preflight: soft exceeded 仍允许通过', async ({ assert }) => {
    const guard2 = new CompilerBudgetGuard(resolver, recorder, 0.045, 15000)
    const result = await guard2.preflight(buildCtx({ estimatedCost: 0.01, estimatedTokens: 5000 }))
    assert.isTrue(result.allowed)
    assert.equal(result.decision.status, 'soft_exceeded')
    assert.equal(result.decision.suggestedAction, 'warn')
  })

  test('preflight: hard exceeded 阻止', async ({ assert }) => {
    const guard2 = new CompilerBudgetGuard(resolver, recorder, 0.1, 40000)
    const result = await guard2.preflight(buildCtx({ estimatedCost: 0.01, estimatedTokens: 5000 }))
    assert.isFalse(result.allowed)
    assert.equal(result.decision.status, 'hard_exceeded')
    assert.isNotNull(result.reason)
    assert.include(result.reason!, '硬预算超出')
  })

  test('preflight: 累计成本 = hardLimit 视为硬超出', async ({ assert }) => {
    const guard2 = new CompilerBudgetGuard(resolver, recorder, 0.1, 40000)
    const result = await guard2.preflight(buildCtx({ estimatedCost: 0, estimatedTokens: 0 }))
    assert.isFalse(result.allowed)
    assert.equal(result.decision.status, 'hard_exceeded')
  })

  test('preflight: 写入 budget decision artifact', async ({ assert }) => {
    const result = await guard.preflight(buildCtx())
    assert.isDefined(result.decision.idempotencyKey)
    assert.isDefined(result.decision.decidedAt)
    assert.equal(result.decision.compilerRunId, compilerRun.id)
    assert.equal(result.decision.organizationId, org.id)
  })

  test('preflight: 记录 appliedPolicyName', async ({ assert }) => {
    const result = await guard.preflight(buildCtx())
    assert.equal(result.decision.appliedPolicyName, 'test-policy')
  })

  test('preflight: 多策略 resolve 时记录所有策略名', async ({ assert }) => {
    resolver.register({
      name: 'project-strict',
      scope: 'project',
      scopeValue: 'proj-42',
      enabled: true,
      softLimit: 0.02,
      hardLimit: 0.025,
      currency: 'CNY',
      onSoftLimit: 'require_review',
      onHardLimit: 'block_stage',
    })

    const result = await guard.preflight(
      buildCtx({
        projectId: 'proj-42',
        estimatedCost: 0.03,
        estimatedTokens: 15000,
      }),
    )
    assert.isFalse(result.allowed)
    assert.include(result.decision.appliedPolicyName ?? '', 'project-strict')
  })

  // ── Postflight ──

  test('postflight: 更新累计成本状态', async ({ assert }) => {
    await guard.postflight(
      buildCtx({
        estimatedTokens: 4000,
        estimatedCost: 0.01,
        actualTokens: 3500,
        actualCost: 0.008,
      }),
    )

    assert.approximately(guard.accumulatedCost, 0.008, 0.0001)
    assert.equal(guard.accumulatedTokens, 3500)
    assert.equal(guard.callCount, 1)
  })

  test('postflight: 多次调用累积', async ({ assert }) => {
    await guard.postflight(
      buildCtx({
        attemptNumber: 1,
        estimatedTokens: 4000,
        estimatedCost: 0.01,
        actualTokens: 3500,
        actualCost: 0.008,
      }),
    )
    await guard.postflight(
      buildCtx({
        attemptNumber: 2,
        estimatedTokens: 3000,
        estimatedCost: 0.007,
        actualTokens: 2800,
        actualCost: 0.006,
      }),
    )

    assert.approximately(guard.accumulatedCost, 0.014, 0.0001)
    assert.equal(guard.accumulatedTokens, 6300)
    assert.equal(guard.callCount, 2)
  })

  test('postflight: 软预算超出产生 warning', async ({ assert }) => {
    const guard2 = new CompilerBudgetGuard(resolver, recorder, 0.045, 15000)
    const result = await guard2.postflight(
      buildCtx({
        estimatedTokens: 4000,
        estimatedCost: 0.01,
        actualTokens: 3500,
        actualCost: 0.008,
      }),
    )

    assert.equal(result.decision.status, 'soft_exceeded')
    assert.isAtLeast(result.warnings.length, 1)
    assert.include(result.warnings[0]!, '软预算超出')
  })

  test('postflight: 硬预算超出产生 warning', async ({ assert }) => {
    const guard2 = new CompilerBudgetGuard(resolver, recorder, 0.095, 40000)
    const result = await guard2.postflight(
      buildCtx({
        estimatedTokens: 4000,
        estimatedCost: 0.01,
        actualTokens: 3500,
        actualCost: 0.008,
      }),
    )

    assert.equal(result.decision.status, 'hard_exceeded')
    assert.isAtLeast(result.warnings.length, 1)
    assert.include(result.warnings[0]!, '硬预算超出')
  })

  test('postflight: 实际 token 远超预估时产生告警', async ({ assert }) => {
    const result = await guard.postflight(
      buildCtx({
        estimatedTokens: 1000,
        estimatedCost: 0.002,
        actualTokens: 3000,
        actualCost: 0.006,
      }),
    )

    const hasOverEstimateWarning = result.warnings.some((w) => w.includes('超过预估'))
    assert.isTrue(hasOverEstimateWarning)
  })

  // ── 跨 scope 策略优先级 ──

  test('跨 scope 策略优先级影响 preflight', async ({ assert }) => {
    resolver.register({
      name: 'project-strict',
      scope: 'project',
      scopeValue: 'proj-42',
      enabled: true,
      softLimit: 0.01,
      hardLimit: 0.03,
      currency: 'CNY',
      onSoftLimit: 'require_review',
      onHardLimit: 'block_stage',
      priority: 10,
    })

    const result = await guard.preflight(
      buildCtx({
        projectId: 'proj-42',
        estimatedCost: 0.04,
        estimatedTokens: 10000,
      }),
    )

    assert.isFalse(result.allowed)
    assert.equal(result.decision.status, 'hard_exceeded')
  })

  // ── 人工复核状态 ──

  test('soft exceeded + require_review 映射到 suggestedAction', async ({ assert }) => {
    resolver.register({
      name: 'strict-project',
      scope: 'project',
      scopeValue: 'proj-42',
      enabled: true,
      softLimit: 0.03,
      hardLimit: 0.1,
      currency: 'CNY',
      onSoftLimit: 'require_review',
      onHardLimit: 'block',
      priority: 10,
    })

    const guard2 = new CompilerBudgetGuard(resolver, recorder, 0.025, 10000)
    const result = await guard2.preflight(
      buildCtx({
        projectId: 'proj-42',
        estimatedCost: 0.01,
        estimatedTokens: 3000,
      }),
    )

    assert.isTrue(result.allowed)
    assert.equal(result.decision.status, 'soft_exceeded')
    assert.equal(result.decision.suggestedAction, 'require_review')
  })

  // ── 真实模型验证开关 ──

  test('使用 fake provider（默认），不发起真实模型调用', async ({ assert }) => {
    const result = await guard.preflight(buildCtx())
    assert.isTrue(result.allowed)
    assert.equal(result.decision.decisionType, 'preflight')
  })
})
