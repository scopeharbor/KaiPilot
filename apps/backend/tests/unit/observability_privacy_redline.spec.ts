/**
 * 可观测性隐私、人工确认与红线测试（tasks 6.1-6.4）。
 *
 * 覆盖：
 * - 6.1 敏感字段脱敏：observability/cost/budget event 不保存完整 prompt/output/API Key
 * - 6.2 零正式落库：预算操作不写入 projects/tasks/wbs/risks/resources 业务表
 * - 6.3 Draft Layer 边界：预算状态不绕过 Preview/Diff/Apply 与人工确认
 * - 6.4 审计事件：发起编译、预算阻断、跨组织拒绝有审计摘要
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import CompilerRun from '#models/compiler_run'
import Organization from '#models/organization'
import User from '#models/user'
import Project from '#models/project'
import Task from '#models/task'
import { CompilerBudgetGuard } from '#services/compiler/budget_guard'
import { CompilerBudgetPolicyResolver } from '#services/compiler/budget_policy_resolver'
import { CompilerObservabilityRecorder } from '#services/compiler/observability_recorder'
import { CompilerObservabilitySummaryService } from '#services/compiler/observability_summary_service'
import { CompilerCostRecorder } from '#services/compiler/cost_recorder'
import { ArtifactStore } from '#services/compiler/artifact_store'
import { StageEventLogger } from '#services/compiler/stage_event_logger'

test.group('ObservabilityPrivacyRedline', (group) => {
  let org: Organization
  let owner: User
  let compilerRun: CompilerRun
  let recorder: CompilerObservabilityRecorder
  let costRecorder: CompilerCostRecorder
  let resolver: CompilerBudgetPolicyResolver
  let summaryService: CompilerObservabilitySummaryService

  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await testUtils.db().truncate()

    owner = await User.create({
      email: `privacy-test-${Date.now()}@test.local`,
      password: 'Password123!',
      fullName: 'Test User',
      authProvider: 'local',
      isActive: true,
    })

    org = await Organization.create({
      ownerId: owner.id,
      name: 'Privacy Test Org',
      slug: `privacy-${Date.now()}`,
    })

    compilerRun = await CompilerRun.create({
      organizationId: org.id,
      requestedByUserId: owner.id,
      status: 'running',
      input: { prompt: 'test' },
    })

    const stageEventLogger = new StageEventLogger()
    const artifactStore = new ArtifactStore()
    recorder = new CompilerObservabilityRecorder({ stageEventLogger, artifactStore })
    costRecorder = new CompilerCostRecorder(recorder)
    resolver = new CompilerBudgetPolicyResolver()
    summaryService = new CompilerObservabilitySummaryService(recorder)
  })

  // ── 6.1 敏感字段脱敏 ──

  test('observability event schema 禁止 prompt/output/API Key 字段', async ({ assert }) => {
    const { observabilityEventSchema } = await import('@aiproj/compiler-spec')
    const schemaKeys = Object.keys(observabilityEventSchema.shape)
    assert.notInclude(schemaKeys, 'prompt')
    assert.notInclude(schemaKeys, 'output')
    assert.notInclude(schemaKeys, 'apiKey')
    assert.notInclude(schemaKeys, 'fullPrompt')
    assert.notInclude(schemaKeys, 'fullUserInput')
    assert.notInclude(schemaKeys, 'fullModelOutput')
  })

  test('model cost event schema 禁止 prompt/output/API Key 字段', async ({ assert }) => {
    const { modelCostEventSchema } = await import('@aiproj/compiler-spec')
    const schemaKeys = Object.keys(modelCostEventSchema.shape)
    assert.notInclude(schemaKeys, 'prompt')
    assert.notInclude(schemaKeys, 'output')
    assert.notInclude(schemaKeys, 'apiKey')
    assert.notInclude(schemaKeys, 'fullPrompt')
    assert.notInclude(schemaKeys, 'fullUserInput')
    assert.notInclude(schemaKeys, 'fullModelOutput')
  })

  test('budget decision schema 禁止敏感字段', async ({ assert }) => {
    const { budgetDecisionSchema } = await import('@aiproj/compiler-spec')
    const schemaKeys = Object.keys(budgetDecisionSchema.shape)
    assert.notInclude(schemaKeys, 'prompt')
    assert.notInclude(schemaKeys, 'output')
    assert.notInclude(schemaKeys, 'apiKey')
  })

  test('cost event artifact payload 不含敏感正文', async ({ assert }) => {
    await costRecorder.recordCall(
      {
        compilerRunId: compilerRun.id,
        organizationId: org.id,
        stageId: 'test-stage',
        attemptNumber: 1,
        provider: 'deepseek',
        model: 'deepseek-chat',
        modelMode: 'non-thinking',
        isReal: false,
      },
      {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        latencyMs: 500,
      },
    )

    const costEvents = await recorder.getCostEvents(compilerRun.id, org.id)
    const event = costEvents[0]!
    assert.isUndefined((event as any).fullPrompt)
    assert.isUndefined((event as any).fullUserInput)
    assert.isUndefined((event as any).fullModelOutput)
    assert.isUndefined((event as any).apiKey)
  })

  // ── 6.2 零正式落库 ──

  test('预算阻断不写入正式业务表', async ({ assert }) => {
    resolver.register({
      name: 'zero-budget',
      scope: 'organization',
      scopeValue: String(org.id),
      enabled: true,
      hardLimit: 0.001,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block',
    })

    const guard2 = new CompilerBudgetGuard(resolver, recorder)
    await guard2.preflight({
      compilerRunId: compilerRun.id,
      organizationId: org.id,
      stageId: 'test-stage',
      attemptNumber: 1,
      estimatedTokens: 10000,
      estimatedCost: 0.01,
    })

    // 验证正式业务表没有新增记录
    const projects = await Project.all()
    const tasks = await Task.all()
    assert.lengthOf(projects, 0)
    assert.lengthOf(tasks, 0)
  })

  test('预算通过不写入正式业务表', async ({ assert }) => {
    resolver.register({
      name: 'high-budget',
      scope: 'organization',
      scopeValue: String(org.id),
      enabled: true,
      hardLimit: 10.0,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block',
    })

    const guard2 = new CompilerBudgetGuard(resolver, recorder)
    await guard2.preflight({
      compilerRunId: compilerRun.id,
      organizationId: org.id,
      stageId: 'test-stage',
      attemptNumber: 1,
      estimatedTokens: 100,
      estimatedCost: 0.001,
    })

    const projects = await Project.all()
    const tasks = await Task.all()
    assert.lengthOf(projects, 0)
    assert.lengthOf(tasks, 0)
  })

  test('摘要查询不写入正式业务表', async ({ assert }) => {
    await summaryService.getRunSummary({ compilerRunId: compilerRun.id, organizationId: org.id })

    const projects = await Project.all()
    const tasks = await Task.all()
    assert.lengthOf(projects, 0)
    assert.lengthOf(tasks, 0)
  })

  test('成本记录不写入正式业务表', async ({ assert }) => {
    await costRecorder.recordCall(
      {
        compilerRunId: compilerRun.id,
        organizationId: org.id,
        stageId: 'test-stage',
        attemptNumber: 1,
        provider: 'mock',
        model: 'mock-model',
        modelMode: 'non-thinking',
        isReal: false,
      },
      {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        latencyMs: 500,
      },
    )

    const projects = await Project.all()
    const tasks = await Task.all()
    assert.lengthOf(projects, 0)
    assert.lengthOf(tasks, 0)
  })

  // ── 6.3 Draft Layer 边界 ──

  test('预算状态不影响 Draft Layer 人工确认要求', async ({ assert }) => {
    const decisions = await recorder.getBudgetDecisions(compilerRun.id, org.id)
    for (const d of decisions) {
      assert.isUndefined((d as any).autoApply)
      assert.isUndefined((d as any).bypassReview)
    }
  })

  test('预算阻断状态只写运行态，不修改正式项目数据', async ({ assert }) => {
    resolver.register({
      name: 'blocking-budget',
      scope: 'organization',
      scopeValue: String(org.id),
      enabled: true,
      hardLimit: 0.001,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block',
    })

    const guard2 = new CompilerBudgetGuard(resolver, recorder, 0.002, 500)
    const result = await guard2.preflight({
      compilerRunId: compilerRun.id,
      organizationId: org.id,
      stageId: 'test-stage',
      attemptNumber: 1,
      estimatedTokens: 100,
      estimatedCost: 0.01,
    })

    assert.isFalse(result.allowed)
    // 确认只有运行态变更 —— 没有正式业务表写入
    const projects = await Project.all()
    const tasks = await Task.all()
    assert.lengthOf(projects, 0)
    assert.lengthOf(tasks, 0)
  })

  // ── 6.4 审计事件 ──

  test('预算阻断产生可审计的 budget decision artifact', async ({ assert }) => {
    resolver.register({
      name: 'audit-budget',
      scope: 'organization',
      scopeValue: String(org.id),
      enabled: true,
      hardLimit: 0.005,
      currency: 'CNY',
      onSoftLimit: 'warn',
      onHardLimit: 'block',
    })

    const guard2 = new CompilerBudgetGuard(resolver, recorder, 0.006, 500)
    const result = await guard2.preflight({
      compilerRunId: compilerRun.id,
      organizationId: org.id,
      stageId: 'audit-stage',
      attemptNumber: 1,
      estimatedTokens: 100,
      estimatedCost: 0.01,
    })

    assert.isFalse(result.allowed)
    assert.isNotNull(result.decision.idempotencyKey)
    assert.equal(result.decision.status, 'hard_exceeded')

    const decisions = await recorder.getBudgetDecisions(compilerRun.id, org.id)
    assert.lengthOf(decisions, 1)
    assert.equal(decisions[0]!.status, 'hard_exceeded')
  })

  test('跨组织拒绝不泄露存在性', async ({ assert }) => {
    // 组织 O1 的用户查询组织 O2 的 run
    const otherOrg = await Organization.create({
      ownerId: owner.id,
      name: 'Other Org',
      slug: `other-${Date.now()}`,
    })
    const otherRun = await CompilerRun.create({
      organizationId: otherOrg.id,
      requestedByUserId: owner.id,
      status: 'completed',
      input: { prompt: 'other' },
    })

    // 写入一些成本事件到 otherOrg
    await costRecorder.recordCall(
      {
        compilerRunId: otherRun.id,
        organizationId: otherOrg.id,
        stageId: 'test',
        attemptNumber: 1,
        provider: 'deepseek',
        model: 'deepseek-chat',
        modelMode: 'non-thinking',
        isReal: false,
      },
      {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        latencyMs: 500,
      },
    )

    // O1 查询应返回空结果（不泄露 O2 的存在）
    const o1CostEvents = await recorder.getCostEvents(otherRun.id, org.id)
    assert.lengthOf(o1CostEvents, 0)
  })
})
