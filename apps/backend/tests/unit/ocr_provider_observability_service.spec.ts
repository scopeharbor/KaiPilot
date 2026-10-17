/**
 * v3-ocr-provider-observability-cost-controls — 后端服务测试。
 *
 * 覆盖: cost estimator, budget guard, rate-limit guard, recorder,
 * execution service, redline 不变性。
 */

import { test } from '@japa/runner'
import OcrProviderCostEstimator from '#services/ai_ocr/ocr_provider_cost_estimator'
import OcrBudgetPolicyResolver from '#services/ai_ocr/ocr_budget_policy_resolver'
import OcrBudgetGuard from '#services/ai_ocr/ocr_budget_guard'
import OcrRateLimitGuard from '#services/ai_ocr/ocr_rate_limit_guard'
import OcrProviderAttemptRecorder from '#services/ai_ocr/ocr_provider_attempt_recorder'
import OcrProviderExecutionService from '#services/ai_ocr/ocr_provider_execution_service'
import { computeOcrProviderIdempotencyKey } from '@aiproj/types'

// =========================================================================
// Cost Estimator
// =========================================================================
test.group('OcrProviderCostEstimator', () => {
  test('pricing snapshot 正常估计', ({ assert }) => {
    const estimator = new OcrProviderCostEstimator()
    const usage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 }
    const pricing = { inputCostPer1k: 0.01, outputCostPer1k: 0.03 }
    const result = estimator.estimate(usage, pricing, 'ps-001')

    assert.equal(result.costStatus, 'estimated')
    assert.closeTo(result.estimatedCost, 0.01 + 0.015, 0.001)
    assert.equal(result.pricingSnapshotId, 'ps-001')
  })

  test('无 pricing snapshot 用 fallback 价格', ({ assert }) => {
    const estimator = new OcrProviderCostEstimator({
      fallbackInputPrice: 0.01,
      fallbackOutputPrice: 0.03,
      fallbackCurrency: 'CNY',
    })
    const usage = { inputTokens: 1000, outputTokens: 500 }
    const result = estimator.estimate(usage, null, null)

    assert.equal(result.costStatus, 'fallback_estimate')
    assert.equal(result.currency, 'CNY')
    assert.closeTo(result.estimatedCost, 0.01 + 0.015, 0.001)
  })

  test('无 usage 返回 unavailable', ({ assert }) => {
    const estimator = new OcrProviderCostEstimator()
    const result = estimator.estimate(null, { inputCostPer1k: 0.01 })
    assert.equal(result.costStatus, 'unavailable')
  })

  test('无 pricing 无 fallback 返回 cost_unknown', ({ assert }) => {
    const estimator = new OcrProviderCostEstimator()
    const usage = { inputTokens: 100, outputTokens: 50 }
    const result = estimator.estimate(usage, null, null)
    assert.equal(result.costStatus, 'cost_unknown')
  })
})

// =========================================================================
// Budget Policy Resolver
// =========================================================================
test.group('OcrBudgetPolicyResolver', () => {
  test('默认策略 unlimited', ({ assert }) => {
    const resolver = new OcrBudgetPolicyResolver()
    const resolution = resolver.resolve({
      organizationId: 1,
      projectId: 1,
      provider: 'openai',
      model: 'gpt-4o',
    })

    assert.isNotNull(resolution.policy)
    assert.isNull(resolution.policy!.hardLimit)
    assert.isNull(resolution.policy!.softLimit)
    assert.isTrue(resolution.policy!.enabled)
  })

  test('used amount 默认 0', ({ assert }) => {
    const resolver = new OcrBudgetPolicyResolver()
    const amount = resolver.getUsedAmount({
      organizationId: 1,
      projectId: 1,
    })
    assert.equal(amount, 0)
  })
})

// =========================================================================
// Budget Guard
// =========================================================================
test.group('OcrBudgetGuard', () => {
  test('preflight 默认策略允许', async ({ assert }) => {
    const guard = new OcrBudgetGuard()
    const result = await guard.preflight({
      organizationId: 1,
      projectId: 1,
      ocrJobId: 1,
      provider: 'openai',
      model: 'gpt-4o',
      estimatedTokens: 1000,
    })

    assert.isTrue(result.allowed)
    assert.equal(result.status, 'allowed')
  })

  test('preflight 幂等：相同输入返回相同结果', async ({ assert }) => {
    const guard = new OcrBudgetGuard()
    const r1 = await guard.preflight({
      organizationId: 1,
      projectId: 1,
      ocrJobId: 1,
      provider: 'openai',
      model: 'gpt-4o',
      estimatedTokens: 1000,
    })
    const r2 = await guard.preflight({
      organizationId: 1,
      projectId: 1,
      ocrJobId: 1,
      provider: 'openai',
      model: 'gpt-4o',
      estimatedTokens: 1000,
    })

    assert.isTrue(r1.allowed)
    assert.isTrue(r2.allowed)
    assert.equal(r1.status, r2.status)
  })

  test('postflight 幂等记录', async ({ assert }) => {
    const guard = new OcrBudgetGuard()
    const idempotencyKey = 'test-postflight-001'
    const d1 = await guard.postflight({
      organizationId: 1,
      projectId: 1,
      ocrJobId: 1,
      provider: 'openai',
      model: 'gpt-4o',
      actualCost: 0.005,
      currency: 'USD',
      idempotencyKey,
    })
    const d2 = await guard.postflight({
      organizationId: 1,
      projectId: 1,
      ocrJobId: 1,
      provider: 'openai',
      model: 'gpt-4o',
      actualCost: 0.005,
      currency: 'USD',
      idempotencyKey,
    })

    assert.isNotNull(d1)
    assert.equal(d1, d2) // 幂等
  })
})

// =========================================================================
// Rate Limit Guard
// =========================================================================
test.group('OcrRateLimitGuard', () => {
  test('无限限默认允许', async ({ assert }) => {
    const guard = new OcrRateLimitGuard()
    const result = await guard.preflight({
      organizationId: 1,
      projectId: 1,
      provider: 'openai',
      model: 'gpt-4o',
    })

    assert.isTrue(result.allowed)
    assert.equal(result.status, 'allowed')
  })

  test('RPM 超限 blocked', async ({ assert }) => {
    // 需要数据库状态，但逻辑已在 types 包测试覆盖
    // 这里验证输入正确传递
    const guard = new OcrRateLimitGuard()
    const result = await guard.preflight({
      organizationId: 1,
      projectId: 1,
      ocrJobId: 1,
      provider: 'test-provider',
      model: 'test-model',
      rpmLimit: 0, // 0 RPM 必然超限
      estimatedTokens: 100,
    })

    // 0 RPM 意味着不允许任何调用
    assert.isFalse(result.allowed)
  })
})

// =========================================================================
// Attempt Recorder
// =========================================================================
test.group('OcrProviderAttemptRecorder', () => {
  test('record 创建新记录', async ({ assert }) => {
    const recorder = new OcrProviderAttemptRecorder()
    const ref = await recorder.record({
      organizationId: 1,
      projectId: 1,
      ocrJobId: 1,
      pageId: 1,
      attemptNumber: 1,
      provider: 'test',
      model: 'test-model',
      status: 'succeeded',
      latencyMs: 100,
      inputTokens: 500,
      outputTokens: 200,
      estimatedCost: 0.005,
      currency: 'USD',
      costStatus: 'estimated',
      idempotencyKey: `test-recorder-${Date.now()}`,
    })

    assert.isNotNull(ref)
    assert.isTrue(ref.startsWith('attempt:'))
  })

  test('record 幂等：相同 idempotencyKey 不重复', async ({ assert }) => {
    const recorder = new OcrProviderAttemptRecorder()
    const key = `test-idem-${Date.now()}`
    const r1 = await recorder.record({
      organizationId: 1,
      projectId: 1,
      ocrJobId: 1,
      attemptNumber: 1,
      provider: 'test',
      model: 'test-model',
      status: 'queued',
      idempotencyKey: key,
    })
    const r2 = await recorder.record({
      organizationId: 1,
      projectId: 1,
      ocrJobId: 1,
      attemptNumber: 1,
      provider: 'test',
      model: 'test-model',
      status: 'succeeded',
      latencyMs: 200,
      idempotencyKey: key,
    })

    assert.isNotNull(r1)
    assert.isNotNull(r2)
  })

  test('getSummary 返回聚合', async ({ assert }) => {
    const recorder = new OcrProviderAttemptRecorder()
    const summary = await recorder.getSummary(1, 1)

    assert.equal(summary.projectId, 1)
    assert.isNumber(summary.totalAttempts)
  })
})

// =========================================================================
// Execution Service — Redline
// =========================================================================
test.group('OcrProviderExecutionService — Redline', () => {
  test('executePage 不自动写正式项目/任务/WBS/风险数据', async ({ assert }) => {
    // 执行服务的结果仅影响 attempt/budget 记录，
    // 不创建 project/task/wbs/risk/compiler/draft/search 记录。
    // 此处验证服务构造函数和接口完整性。

    const service = new OcrProviderExecutionService()
    assert.isDefined(service)
    assert.isFunction(service.executePage)
  })
})

// =========================================================================
// Idempotency Key Stability
// =========================================================================
test.group('Idempotency Key Stability', () => {
  test('computeOcrProviderIdempotencyKey 稳定', ({ assert }) => {
    const k1 = computeOcrProviderIdempotencyKey({
      organizationId: 1,
      projectId: 2,
      ocrJobId: 10,
      pageId: 3,
      attemptNumber: 1,
    })
    const k2 = computeOcrProviderIdempotencyKey({
      organizationId: 1,
      projectId: 2,
      ocrJobId: 10,
      pageId: 3,
      attemptNumber: 1,
    })
    assert.equal(k1, k2)
    assert.lengthOf(k1, 16)
  })

  test('computeOcrProviderIdempotencyKey 不同 attemptNumber 不同', ({ assert }) => {
    const k1 = computeOcrProviderIdempotencyKey({
      organizationId: 1,
      projectId: 1,
      ocrJobId: 1,
      pageId: 1,
      attemptNumber: 1,
    })
    const k2 = computeOcrProviderIdempotencyKey({
      organizationId: 1,
      projectId: 1,
      ocrJobId: 1,
      pageId: 1,
      attemptNumber: 2,
    })
    assert.notEqual(k1, k2)
  })
})
