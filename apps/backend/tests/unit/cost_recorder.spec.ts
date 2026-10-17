/**
 * CompilerCostRecorder 单元测试（tasks 2.5）。
 *
 * 覆盖：
 * - 成功调用记录 token 和成本
 * - 空输出、截断 JSON 也记录成本
 * - provider 错误也记录成本
 * - 确定性 Stage 零成本
 * - 幂等重复写入不重复记录
 * - 使用 mock AIGateway（无真实模型调用）
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import CompilerRun from '#models/compiler_run'
import AiModelPricingSnapshot from '#models/ai_model_pricing_snapshot'
import AiModelUsageSnapshot from '#models/ai_model_usage_snapshot'
import Organization from '#models/organization'
import User from '#models/user'
import { CompilerCostRecorder } from '#services/compiler/cost_recorder'
import { CompilerObservabilityRecorder } from '#services/compiler/observability_recorder'
import { ArtifactStore } from '#services/compiler/artifact_store'
import { StageEventLogger } from '#services/compiler/stage_event_logger'
import { DateTime } from 'luxon'

const dbTestUtils = testUtils as unknown as {
  db: () => { migrate: () => Promise<void>; truncate: () => Promise<void> }
}

interface CostRecorderTestContext {
  compilerRunId: number
  organizationId: number
  stageId: string
  attemptNumber: number
  provider: string
  model: string
  modelMode: 'thinking' | 'non-thinking'
  connectionId?: number | null
  connectionModelId?: number | null
  catalogProviderId?: string | null
  catalogModelId?: string | null
  pricingSnapshotId?: string | null
  contextLimits?: {
    contextWindowTokens: number | null
    maxInputTokens: number | null
    maxOutputTokens: number | null
    source: 'catalog' | 'manual' | null
  } | null
  isReal: boolean
}

test.group('CostRecorder', (group) => {
  let recorder: CompilerObservabilityRecorder
  let costRecorder: CompilerCostRecorder
  let org: Organization
  let owner: User
  let compilerRun: CompilerRun
  let defaultCtx: CostRecorderTestContext

  group.setup(async () => {
    await dbTestUtils.db().migrate()
  })

  group.each.setup(async () => {
    await dbTestUtils.db().truncate()

    owner = await User.create({
      email: `cost-recorder-${Date.now()}@test.local`,
      password: 'Password123!',
      fullName: 'Test User',
      authProvider: 'local',
      isActive: true,
    })

    org = await Organization.create({
      ownerId: owner.id,
      name: 'Cost Recorder Test Org',
      slug: `cr-${Date.now()}`,
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

    defaultCtx = {
      compilerRunId: compilerRun.id,
      organizationId: org.id,
      stageId: 'intent-parsing',
      attemptNumber: 1,
      provider: 'deepseek',
      model: 'deepseek-chat',
      modelMode: 'non-thinking' as const,
      isReal: false,
    }
  })

  function buildCtx(overrides: Partial<CostRecorderTestContext> = {}): CostRecorderTestContext {
    return { ...defaultCtx, ...overrides }
  }

  // ── 成功调用 ──

  test('记录成功调用：token 和成本正确', async ({ assert }) => {
    const ref = await costRecorder.recordCall(buildCtx(), {
      promptTokens: 1500,
      completionTokens: 800,
      totalTokens: 2300,
      latencyMs: 3400,
      finishReason: 'stop',
      contextPacketRef: 'packet:intent-parsing:v1',
      modelOutputRef: 'artifact:model_output:intent-parsing:v1',
    })

    assert.isNotNull(ref)
    assert.include(ref, 'artifact:cost_event:cost_')

    const costEvents = await recorder.getCostEvents(compilerRun.id, org.id)
    assert.lengthOf(costEvents, 1)
    assert.equal(costEvents[0]!.provider, 'deepseek')
    assert.equal(costEvents[0]!.model, 'deepseek-chat')
    assert.equal(costEvents[0]!.promptTokens, 1500)
    assert.equal(costEvents[0]!.completionTokens, 800)
    assert.equal(costEvents[0]!.totalTokens, 2300)
    assert.equal(costEvents[0]!.latencyMs, 3400)
    assert.isAbove(costEvents[0]!.estimatedCost, 0)
  })

  // ── 空输出 ──

  test('空输出也记录成本', async ({ assert }) => {
    const ref = await costRecorder.recordCall(buildCtx(), {
      promptTokens: 1000,
      completionTokens: 0,
      totalTokens: 1000,
      latencyMs: 1500,
      finishReason: 'stop',
      errorCategory: 'llm_empty',
      errorMessage: 'LLM returned empty response',
    })

    assert.isNotNull(ref)

    const costEvents = await recorder.getCostEvents(compilerRun.id, org.id)
    assert.lengthOf(costEvents, 1)
    assert.equal(costEvents[0]!.errorCategory, 'llm_empty')
    assert.isAbove(costEvents[0]!.promptTokens, 0)
  })

  // ── 截断 JSON ──

  test('截断 JSON 也记录成本', async ({ assert }) => {
    await costRecorder.recordCall(buildCtx(), {
      promptTokens: 2000,
      completionTokens: 500,
      totalTokens: 2500,
      latencyMs: 5000,
      finishReason: 'length',
      errorCategory: 'llm_truncated',
      errorMessage: 'JSON output truncated (unclosed braces)',
    })

    const costEvents = await recorder.getCostEvents(compilerRun.id, org.id)
    assert.lengthOf(costEvents, 1)
    assert.equal(costEvents[0]!.finishReason, 'length')
    assert.equal(costEvents[0]!.errorCategory, 'llm_truncated')
  })

  // ── Provider 错误 ──

  test('provider 错误也记录成本', async ({ assert }) => {
    await costRecorder.recordCall(buildCtx(), {
      promptTokens: 500,
      completionTokens: 0,
      totalTokens: 500,
      latencyMs: 12000,
      finishReason: 'error',
      errorCategory: 'llm_provider_error',
      errorMessage: 'Provider returned 500 Internal Server Error',
    })

    const costEvents = await recorder.getCostEvents(compilerRun.id, org.id)
    assert.lengthOf(costEvents, 1)
    assert.equal(costEvents[0]!.finishReason, 'error')
    assert.equal(costEvents[0]!.errorCategory, 'llm_provider_error')
    assert.isAbove(costEvents[0]!.latencyMs, 0)
  })

  // ── 确定性 Stage 零成本 ──

  test('确定性 Stage 记录零成本', async ({ assert }) => {
    await costRecorder.recordDeterministicZeroCost({
      compilerRunId: compilerRun.id,
      organizationId: org.id,
      stageId: 'critical-path',
      attemptNumber: 0,
    })

    const costEvents = await recorder.getCostEvents(compilerRun.id, org.id)
    assert.lengthOf(costEvents, 1)
    assert.equal(costEvents[0]!.totalTokens, 0)
    assert.equal(costEvents[0]!.estimatedCost, 0)
    assert.equal(costEvents[0]!.latencyMs, 0)
    assert.equal(costEvents[0]!.provider, 'deterministic')
    assert.equal(costEvents[0]!.errorCategory, 'none')
  })

  test('多次 recordDeterministicZeroCost 写入多条', async ({ assert }) => {
    await costRecorder.recordDeterministicZeroCost({
      compilerRunId: compilerRun.id,
      organizationId: org.id,
      stageId: 'critical-path',
      attemptNumber: 0,
    })
    await costRecorder.recordDeterministicZeroCost({
      compilerRunId: compilerRun.id,
      organizationId: org.id,
      stageId: 'schedule-engine',
      attemptNumber: 0,
    })

    const costEvents = await recorder.getCostEvents(compilerRun.id, org.id)
    assert.lengthOf(costEvents, 2)
  })

  // ── 幂等重复写入 ──

  test('相同 idempotencyKey 只写一次', async ({ assert }) => {
    await costRecorder.recordCall(buildCtx(), {
      promptTokens: 1500,
      completionTokens: 800,
      totalTokens: 2300,
      latencyMs: 3400,
    })
    await costRecorder.recordCall(buildCtx(), {
      promptTokens: 1500,
      completionTokens: 800,
      totalTokens: 2300,
      latencyMs: 3400,
    })

    const costEvents = await recorder.getCostEvents(compilerRun.id, org.id)
    assert.lengthOf(costEvents, 1)
  })

  test('不同 attempt 写入不同记录', async ({ assert }) => {
    await costRecorder.recordCall(buildCtx(), {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      latencyMs: 2000,
    })
    await costRecorder.recordCall(buildCtx({ attemptNumber: 2 }), {
      promptTokens: 1200,
      completionTokens: 600,
      totalTokens: 1800,
      latencyMs: 2500,
    })

    const costEvents = await recorder.getCostEvents(compilerRun.id, org.id)
    assert.lengthOf(costEvents, 2)
    assert.equal(costEvents[0]!.attemptNumber, 1)
    assert.equal(costEvents[1]!.attemptNumber, 2)
  })

  // ── 估算成本计算 ──

  test('估算成本按单价计算', async ({ assert }) => {
    await costRecorder.recordCall(buildCtx(), {
      promptTokens: 1500,
      completionTokens: 800,
      totalTokens: 2300,
      latencyMs: 1000,
    })

    const costEvents = await recorder.getCostEvents(compilerRun.id, org.id)
    // 0.5 * 1500/1M + 2.0 * 800/1M = 0.00075 + 0.00160 = 0.00235
    assert.approximately(costEvents[0]!.estimatedCost, 0.00235, 0.00001)
  })

  test('目录价格快照传播到 Compiler 成本事件与 usage snapshot', async ({ assert }) => {
    const pricingSnapshot = await AiModelPricingSnapshot.create({
      snapshotKey: 'cost-recorder-catalog-hash:openai:gpt-4o-mini',
      source: 'models.dev',
      sourceHash: 'cost-recorder-catalog-hash',
      providerId: 'openai',
      providerName: 'OpenAI',
      modelId: 'gpt-4o-mini',
      modelName: 'GPT-4o mini',
      currency: 'USD',
      pricingUnit: '1M_tokens',
      cost: {
        input: 0.15,
        output: 0.6,
        cacheRead: 0.075,
        cacheWrite: 0.2,
        inputAudio: 40,
        outputAudio: null,
        reasoning: null,
        contextOver200k: null,
        tiers: null,
      },
      limits: { context: 128000, input: 120000, output: 4096 },
      modalities: { input: ['text', 'audio'], output: ['text'] },
      rawProvider: { name: 'OpenAI' },
      rawModel: { id: 'gpt-4o-mini' },
      fetchedAt: DateTime.fromISO('2026-07-30T00:00:00.000Z'),
      expiresAt: DateTime.fromISO('2099-07-30T06:00:00.000Z'),
      stale: false,
    })

    await costRecorder.recordCall(
      buildCtx({
        provider: 'openai',
        model: 'gpt-4o-mini',
        catalogProviderId: 'openai',
        catalogModelId: 'gpt-4o-mini',
        pricingSnapshotId: String(pricingSnapshot.id),
        contextLimits: {
          contextWindowTokens: 128000,
          maxInputTokens: 120000,
          maxOutputTokens: 4096,
          source: 'catalog',
        },
      }),
      {
        promptTokens: 1000,
        completionTokens: 2000,
        totalTokens: 3500,
        cacheReadTokens: 500,
        cacheWriteTokens: 200,
        inputAudioTokens: 10,
        reasoningTokens: 300,
        latencyMs: 1200,
      },
    )

    const costEvents = await recorder.getCostEvents(compilerRun.id, org.id)
    assert.lengthOf(costEvents, 1)
    assert.equal(costEvents[0]!.pricingSnapshotId, String(pricingSnapshot.id))
    assert.equal(costEvents[0]!.catalogProviderId, 'openai')
    assert.equal(costEvents[0]!.catalogModelId, 'gpt-4o-mini')
    assert.equal(costEvents[0]!.costEstimateStatus, 'priced')
    assert.equal(costEvents[0]!.currency, 'USD')
    assert.approximately(costEvents[0]!.estimatedCost, 0.001828, 0.000001)
    assert.equal(costEvents[0]!.usageSnapshot?.cacheReadTokens, 500)
    assert.equal(costEvents[0]!.usageSnapshot?.inputAudioTokens, 10)
    assert.equal(costEvents[0]!.usageSnapshot?.reasoningTokens, 300)
    assert.equal(costEvents[0]!.contextLimitSnapshot?.maxOutputTokens, 4096)
    assert.equal(
      costEvents[0]!.costComponents?.find((component) => component.kind === 'reasoning')?.state,
      'included',
    )

    const usageSnapshot = await AiModelUsageSnapshot.query()
      .where('provider', 'openai')
      .where('model', 'gpt-4o-mini')
      .firstOrFail()
    assert.equal(usageSnapshot.pricingSnapshotId, pricingSnapshot.id)
    assert.equal(usageSnapshot.catalogProviderId, 'openai')
    assert.equal(usageSnapshot.usage?.cacheWriteTokens, 200)
    assert.equal(usageSnapshot.contextLimits?.contextWindowTokens, 128000)
    assert.approximately(usageSnapshot.estimatedCost!, 0.001828, 0.000001)
  })

  // ── 组织隔离 ──

  test('不同组织有不同的成本记录', async ({ assert }) => {
    // Create a second org + run
    const owner2 = await User.create({
      email: `cost-recorder-2-${Date.now()}@test.local`,
      password: 'Password123!',
      fullName: 'Test User 2',
      authProvider: 'local',
      isActive: true,
    })
    const org2 = await Organization.create({
      ownerId: owner2.id,
      name: 'Cost Recorder Test Org 2',
      slug: `cr2-${Date.now()}`,
    })
    const compilerRun2 = await CompilerRun.create({
      organizationId: org2.id,
      requestedByUserId: owner2.id,
      status: 'running',
      input: { prompt: 'test2' },
    })

    await costRecorder.recordCall(buildCtx(), {
      promptTokens: 500,
      completionTokens: 300,
      totalTokens: 800,
      latencyMs: 1500,
    })
    await costRecorder.recordCall(
      { ...buildCtx(), compilerRunId: compilerRun2.id, organizationId: org2.id },
      {
        promptTokens: 600,
        completionTokens: 400,
        totalTokens: 1000,
        latencyMs: 2000,
      },
    )

    const org1Events = await recorder.getCostEvents(compilerRun.id, org.id)
    const org2Events = await recorder.getCostEvents(compilerRun2.id, org2.id)
    assert.lengthOf(org1Events, 1)
    assert.lengthOf(org2Events, 1)
  })

  // ── 自定义单价覆盖 ──

  test('自定义单价覆盖默认值', async ({ assert }) => {
    const customCostRecorder = new CompilerCostRecorder(recorder, {
      'deepseek-chat': { input: 1.0, output: 4.0 },
    })

    await customCostRecorder.recordCall(buildCtx(), {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      latencyMs: 1000,
    })

    const costEvents = await recorder.getCostEvents(compilerRun.id, org.id)
    // 1.0 * 1000/1M + 4.0 * 500/1M = 0.001 + 0.002 = 0.003
    assert.approximately(costEvents[0]!.estimatedCost, 0.003, 0.00001)
  })
})
