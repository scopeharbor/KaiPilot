/**
 * v3-ocr-provider-observability-cost-controls — 共享契约测试。
 *
 * 涵盖所有纯辅助函数：enum guard、hash 稳定性、成本估计、预算决策、
 * 限流判断、脱敏、聚合与 fixture 不变性。
 */

import { describe, it, expect } from 'vitest'
import {
  OCR_PROVIDER_ATTEMPT_STATUSES,
  OCR_PROVIDER_ERROR_CATEGORIES,
  OCR_PROVIDER_WARNING_CODES,
  OCR_BUDGET_DECISION_STATUSES,
  OCR_RATE_LIMIT_DECISION_STATUSES,
  OCR_COST_STATUSES,
  OCR_BUDGET_SCOPES,
  OCR_BUDGET_SOFT_LIMIT_ACTIONS,
  isOcrProviderAttemptStatus,
  isOcrProviderWarningCode,
  isOcrBudgetDecisionStatus,
  isOcrRateLimitDecisionStatus,
  isOcrCostStatus,
  computeOcrProviderIdempotencyKey,
  computeOcrBudgetIdempotencyKey,
  computeOcrRateLimitIdempotencyKey,
  computeOcrInputHash,
  computeOcrOutputHash,
  computeOcrObservabilitySummaryHash,
  buildOcrProviderSafeRef,
  aggregateOcrWarnings,
  isOcrWarningBlocking,
  redactOcrProviderObservabilityMetadata,
  redactOcrProviderError,
  estimateOcrCost,
  estimateOcrCostFallback,
  normalizeOcrErrorCategory,
  resolveOcrBudgetDecisionStatus,
  checkOcrRateLimitCapacity,
  buildOcrProviderObservabilitySummary,
  ocrProviderAttemptFixture,
  ocrProviderSafeRefFixture,
  ocrProviderUsageSummaryFixture,
  ocrCostEstimateFixture,
  ocrBudgetDecisionFixture,
  ocrRateLimitDecisionFixture,
  ocrBudgetPreflightResultFixture,
  ocrRateLimitPreflightResultFixture,
  ocrProviderObservabilitySummaryFixture,
  ocrProviderAttemptFixtures,
  ocrProviderAttemptFailureFixture,
  ocrProviderAttemptBudgetBlockedFixture,
  ocrProviderAttemptRateLimitedFixture,
  ocrProviderAttemptUnknownCostFixture,
  ocrProviderAttemptNoUsageFixture,
} from './ocr-provider-observability.js'

// =========================================================================
// Enum guards
// =========================================================================
describe('枚举类型守卫', () => {
  it('isOcrProviderAttemptStatus 识别所有合法状态', () => {
    const all = OCR_PROVIDER_ATTEMPT_STATUSES.slice()
    for (const s of all) {
      expect(isOcrProviderAttemptStatus(s)).toBe(true)
    }
    expect(isOcrProviderAttemptStatus('invalid')).toBe(false)
  })

  it('isOcrProviderWarningCode 识别所有合法警告代码', () => {
    const all = OCR_PROVIDER_WARNING_CODES.slice()
    for (const w of all) {
      expect(isOcrProviderWarningCode(w)).toBe(true)
    }
    expect(isOcrProviderWarningCode('FAKE_WARNING')).toBe(false)
  })

  it('isOcrBudgetDecisionStatus 识别已有状态', () => {
    OCR_BUDGET_DECISION_STATUSES.forEach((s) => {
      expect(isOcrBudgetDecisionStatus(s)).toBe(true)
    })
    expect(isOcrBudgetDecisionStatus('nonsense')).toBe(false)
  })

  it('isOcrRateLimitDecisionStatus 识别已有状态', () => {
    OCR_RATE_LIMIT_DECISION_STATUSES.forEach((s) => {
      expect(isOcrRateLimitDecisionStatus(s)).toBe(true)
    })
    expect(isOcrRateLimitDecisionStatus('unknown')).toBe(false)
  })

  it('isOcrCostStatus 识别成本状态', () => {
    OCR_COST_STATUSES.forEach((s) => {
      expect(isOcrCostStatus(s)).toBe(true)
    })
    expect(isOcrCostStatus('free')).toBe(false)
  })
})

// =========================================================================
// Idempotency keys
// =========================================================================
describe('幂等键', () => {
  it('computeOcrProviderIdempotencyKey 稳定', () => {
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
    expect(k1).toBe(k2)
    expect(k1).toHaveLength(16)
  })

  it('computeOcrProviderIdempotencyKey 不同 attemptNumber 不同', () => {
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
    expect(k1).not.toBe(k2)
  })

  it('computeOcrBudgetIdempotencyKey 稳定', () => {
    const k1 = computeOcrBudgetIdempotencyKey({
      organizationId: 1,
      projectId: 1,
      ocrJobId: 1,
      pageId: 1,
      scope: 'job',
    })
    const k2 = computeOcrBudgetIdempotencyKey({
      organizationId: 1,
      projectId: 1,
      ocrJobId: 1,
      pageId: 1,
      scope: 'job',
    })
    expect(k1).toBe(k2)
  })

  it('computeOcrRateLimitIdempotencyKey 稳定', () => {
    const k1 = computeOcrRateLimitIdempotencyKey({
      organizationId: 1,
      projectId: 1,
      ocrJobId: 1,
      provider: 'openai',
      model: 'gpt-4o',
    })
    const k2 = computeOcrRateLimitIdempotencyKey({
      organizationId: 1,
      projectId: 1,
      ocrJobId: 1,
      provider: 'openai',
      model: 'gpt-4o',
    })
    expect(k1).toBe(k2)
  })
})

// =========================================================================
// Hashes
// =========================================================================
describe('哈希', () => {
  it('computeOcrInputHash 稳定', () => {
    const h1 = computeOcrInputHash({
      imageDataUrl: 'data:image/png;base64,aGk=',
      promptHint: '测试',
    })
    const h2 = computeOcrInputHash({
      imageDataUrl: 'data:image/png;base64,aGk=',
      promptHint: '测试',
    })
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(12)
  })

  it('computeOcrInputHash 不同输入不同', () => {
    const h1 = computeOcrInputHash({ imageDataUrl: 'a' })
    const h2 = computeOcrInputHash({ imageDataUrl: 'b' })
    expect(h1).not.toBe(h2)
  })

  it('computeOcrOutputHash 稳定', () => {
    expect(computeOcrOutputHash('hello')).toBe(computeOcrOutputHash('hello'))
  })

  it('computeOcrObservabilitySummaryHash 稳定', () => {
    const s1 = ocrProviderObservabilitySummaryFixture({ computedAt: '2024-01-01T00:00:00Z' })
    const s2 = ocrProviderObservabilitySummaryFixture({ computedAt: '2024-01-01T00:00:00Z' })
    expect(computeOcrObservabilitySummaryHash(s1)).toBe(computeOcrObservabilitySummaryHash(s2))
  })
})

// =========================================================================
// Provider safe ref
// =========================================================================
describe('安全 provider 引用', () => {
  it('buildOcrProviderSafeRef 构建低敏引用', () => {
    const ref = buildOcrProviderSafeRef({
      provider: 'openai',
      model: 'gpt-4o',
      connectionId: 5,
      modelId: 10,
    })
    expect(ref.provider).toBe('openai')
    expect(ref.model).toBe('gpt-4o')
    expect(ref.connectionId).toBe(5)
    expect(ref.modelId).toBe(10)
  })
})

// =========================================================================
// Warning aggregation
// =========================================================================
describe('警告聚合', () => {
  it('aggregateOcrWarnings 合并去重排序', () => {
    const result = aggregateOcrWarnings(['COST_UNKNOWN'], ['PROVIDER_DEGRADATION', 'COST_UNKNOWN'])
    expect(result).toEqual(['COST_UNKNOWN', 'PROVIDER_DEGRADATION'])
  })

  it('isOcrWarningBlocking 识别阻断警告', () => {
    expect(isOcrWarningBlocking(['BUDGET_HARD_LIMIT_REACHED'])).toBe(true)
    expect(isOcrWarningBlocking(['RATE_LIMIT_BLOCKED'])).toBe(true)
    expect(isOcrWarningBlocking(['PROVIDER_UNAVAILABLE'])).toBe(true)
    expect(isOcrWarningBlocking(['COST_UNKNOWN'])).toBe(false)
  })
})

// =========================================================================
// Redaction
// =========================================================================
describe('脱敏', () => {
  it('redactOcrProviderObservabilityMetadata 移除敏感字段', () => {
    const raw = {
      provider: 'openai',
      model: 'gpt-4o',
      api_key: 'sk-secret123',
      authorization: 'Bearer token',
      prompt: 'extract text',
      safe_field: 'ok',
    }
    const result = redactOcrProviderObservabilityMetadata(raw)
    expect(result).not.toBeNull()
    expect(result!['provider']).toBe('openai')
    expect(result!['api_key']).toBeUndefined()
    expect(result!['authorization']).toBeUndefined()
    expect(result!['prompt']).toBeUndefined()
    expect(result!['safe_field']).toBe('ok')
  })

  it('redactOcrProviderObservabilityMetadata null 输入返回 null', () => {
    expect(redactOcrProviderObservabilityMetadata(null)).toBeNull()
    expect(redactOcrProviderObservabilityMetadata(undefined)).toBeNull()
  })

  it('redactOcrProviderError 截断和脱敏', () => {
    const msg =
      'Error: sk-abcdefghijklmnopqrst123456 api call failed with very long message '.repeat(10)
    const result = redactOcrProviderError(msg)
    expect(result).not.toContain('sk-abcdefghijklmnopqrst123456')
    expect(result.length).toBeLessThanOrEqual(200)
  })

  it('redactOcrProviderError null/undefined 返回 unknown', () => {
    expect(redactOcrProviderError(null)).toBe('unknown')
    expect(redactOcrProviderError(undefined)).toBe('unknown')
  })
})

// =========================================================================
// Cost estimation
// =========================================================================
describe('成本估计', () => {
  it('estimateOcrCost 正常定价快照', () => {
    const usage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 }
    const pricing = { inputCostPer1k: 0.01, outputCostPer1k: 0.03 }
    const result = estimateOcrCost(usage, pricing, 'ps-001')
    expect(result.costStatus).toBe('estimated')
    expect(result.estimatedCost).toBeCloseTo(0.01 + 0.015, 6)
    expect(result.pricingSnapshotId).toBe('ps-001')
    expect(result.currency).toBe('USD')
  })

  it('estimateOcrCost 零成本不是 unknown', () => {
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    const pricing = { inputCostPer1k: 0.01, outputCostPer1k: 0.03 }
    const result = estimateOcrCost(usage, pricing)
    expect(result.costStatus).toBe('zero')
  })

  it('estimateOcrCost 无 usage → unavailable', () => {
    const result = estimateOcrCost(null, { inputCostPer1k: 0.01 })
    expect(result.costStatus).toBe('unavailable')
    expect(result.estimationBasis).toBe('no_usage_data')
  })

  it('estimateOcrCost 无 pricing → cost_unknown', () => {
    const usage = { inputTokens: 100, outputTokens: 50 }
    const result = estimateOcrCost(usage, null)
    expect(result.costStatus).toBe('cost_unknown')
    expect(result.estimationBasis).toBe('no_pricing_data')
  })

  it('estimateOcrCost 包含 cache tokens', () => {
    const usage = { inputTokens: 500, outputTokens: 200, cacheReadTokens: 100 }
    const pricing = { inputCostPer1k: 0.01, outputCostPer1k: 0.03, cacheReadCostPer1k: 0.005 }
    const result = estimateOcrCost(usage, pricing)
    expect(result.estimatedCost).toBeCloseTo(0.005 + 0.006 + 0.0005, 6)
  })

  it('estimateOcrCostFallback 使用手动回退价格', () => {
    const usage = { inputTokens: 1000, outputTokens: 2000 }
    const result = estimateOcrCostFallback(usage, 0.01, 0.03, 'CNY')
    expect(result.costStatus).toBe('fallback_estimate')
    expect(result.currency).toBe('CNY')
    expect(result.estimatedCost).toBeCloseTo(0.07, 6)
    expect(result.pricingSnapshotId).toBeNull()
  })
})

// =========================================================================
// Error normalization
// =========================================================================
describe('错误分类规范化', () => {
  it('normalizeOcrErrorCategory 映射已知错误', () => {
    expect(normalizeOcrErrorCategory('AUTH_REQUIRED')).toBe('auth')
    expect(normalizeOcrErrorCategory('PROVIDER_TIMEOUT')).toBe('timeout')
    expect(normalizeOcrErrorCategory('PROVIDER_RATE_LIMITED')).toBe('rate_limit')
    expect(normalizeOcrErrorCategory('MODEL_UNAVAILABLE')).toBe('unavailable')
    expect(normalizeOcrErrorCategory('PROVIDER_MALFORMED_RESPONSE')).toBe('malformed_response')
    expect(normalizeOcrErrorCategory('MODEL_CAPABILITY_MISMATCH')).toBe('capability_mismatch')
    expect(normalizeOcrErrorCategory('AI_SERVICE_ERROR')).toBe('unknown')
  })

  it('normalizeOcrErrorCategory null/undefined → none', () => {
    expect(normalizeOcrErrorCategory(null)).toBe('none')
    expect(normalizeOcrErrorCategory(undefined)).toBe('none')
  })
})

// =========================================================================
// Budget decision
// =========================================================================
describe('预算决策', () => {
  it('resolveOcrBudgetDecisionStatus hard block', () => {
    expect(resolveOcrBudgetDecisionStatus(1.5, 1.0, null)).toBe('hard_blocked')
  })

  it('resolveOcrBudgetDecisionStatus soft warning', () => {
    expect(resolveOcrBudgetDecisionStatus(0.8, 1.0, 0.5)).toBe('soft_warning')
  })

  it('resolveOcrBudgetDecisionStatus allowed', () => {
    expect(resolveOcrBudgetDecisionStatus(0.3, 1.0, 0.5)).toBe('allowed')
  })

  it('resolveOcrBudgetDecisionStatus no limits → allowed', () => {
    expect(resolveOcrBudgetDecisionStatus(100, null, null)).toBe('allowed')
  })
})

// =========================================================================
// Rate limit
// =========================================================================
describe('限流检查', () => {
  it('checkOcrRateLimitCapacity RPM 超限 blocked', () => {
    const result = checkOcrRateLimitCapacity(100, 100, 5000, 100000, 1000)
    expect(result.allowed).toBe(false)
    expect(result.status).toBe('blocked')
  })

  it('checkOcrRateLimitCapacity TPM 超限 blocked', () => {
    const result = checkOcrRateLimitCapacity(50, 100, 99000, 100000, 2000)
    expect(result.allowed).toBe(false)
    expect(result.status).toBe('blocked')
  })

  it('checkOcrRateLimitCapacity 正常 allowed', () => {
    const result = checkOcrRateLimitCapacity(10, 100, 5000, 100000, 1000)
    expect(result.allowed).toBe(true)
    expect(result.status).toBe('allowed')
  })

  it('checkOcrRateLimitCapacity 无限限，allowed', () => {
    const result = checkOcrRateLimitCapacity(9999, null, 99999, null)
    expect(result.allowed).toBe(true)
  })
})

// =========================================================================
// Summary builder
// =========================================================================
describe('摘要构建', () => {
  it('buildOcrProviderObservabilitySummary 聚合正确', () => {
    const events = [...ocrProviderAttemptFixtures(), ocrProviderAttemptFailureFixture()]
    const summary = buildOcrProviderObservabilitySummary({
      projectId: 1,
      events,
      computedAt: '2024-06-01T12:00:00Z',
    })
    expect(summary.totalAttempts).toBe(6)
    expect(summary.succeededAttempts).toBe(5)
    expect(summary.failedAttempts).toBe(1)
    expect(summary.budgetBlockedAttempts).toBe(0)
    expect(summary.rateLimitedAttempts).toBe(0)
    expect(summary.totalLatencyMs).toBeGreaterThan(0)
    expect(summary.totalEstimatedCost!).toBeGreaterThan(0)
  })

  it('buildOcrProviderObservabilitySummary 含预算阻断和限流', () => {
    const events = [
      ocrProviderAttemptFixture(),
      ocrProviderAttemptBudgetBlockedFixture(),
      ocrProviderAttemptRateLimitedFixture(),
    ]
    const summary = buildOcrProviderObservabilitySummary({
      projectId: 1,
      events,
    })
    expect(summary.budgetBlockedAttempts).toBe(1)
    expect(summary.rateLimitedAttempts).toBe(1)
    expect(summary.budgetStatus).toBe('hard_blocked')
    expect(summary.rateLimitStatus).toBe('blocked')
  })

  it('buildOcrProviderObservabilitySummary 成本 unknown', () => {
    const events = [ocrProviderAttemptUnknownCostFixture()]
    const summary = buildOcrProviderObservabilitySummary({
      projectId: 1,
      events,
    })
    expect(summary.costStatus).toBe('cost_unknown')
  })
})

// =========================================================================
// Fixtures
// =========================================================================
describe('fixtures', () => {
  it('ocrProviderAttemptFixture 字段完整性', () => {
    const e = ocrProviderAttemptFixture()
    expect(e.organizationId).toBe(1)
    expect(e.status).toBe('succeeded')
    expect(e.idempotencyKey).toBeTruthy()
    expect(e.providerRef.provider).toBeTruthy()
    expect(e.occurredAt).toBeTruthy()
  })

  it('ocrProviderAttemptFailureFixture provider 失败', () => {
    const e = ocrProviderAttemptFailureFixture()
    expect(e.status).toBe('failed')
    expect(e.errorCategory).toBe('timeout')
    expect(e.usage).toBeNull()
  })

  it('ocrProviderAttemptBudgetBlockedFixture 预算阻断', () => {
    const e = ocrProviderAttemptBudgetBlockedFixture()
    expect(e.status).toBe('budget_blocked')
    expect(e.latencyMs).toBeNull()
    expect(e.usage).toBeNull()
  })

  it('ocrProviderAttemptRateLimitedFixture 限流', () => {
    const e = ocrProviderAttemptRateLimitedFixture()
    expect(e.status).toBe('rate_limited')
    expect(e.rateLimitDecisionRef).toBeTruthy()
  })

  it('ocrProviderAttemptUnknownCostFixture 成本 unknown', () => {
    const e = ocrProviderAttemptUnknownCostFixture()
    expect(e.costEstimate?.costStatus).toBe('cost_unknown')
    expect(e.warningCodes).toContain('COST_UNKNOWN')
  })

  it('ocrProviderAttemptNoUsageFixture 无 usage', () => {
    const e = ocrProviderAttemptNoUsageFixture()
    expect(e.usage).toBeNull()
    expect(e.costEstimate?.costStatus).toBe('unavailable')
  })

  it('ocrAttemptFixtures 多事件 fixture 数量正确', () => {
    const events = ocrProviderAttemptFixtures()
    expect(events).toHaveLength(5)
  })

  it('ocrBudgetDecisionFixture 预算决策 fixture', () => {
    const d = ocrBudgetDecisionFixture()
    expect(d.status).toBe('allowed')
    expect(d.scope).toBe('job')
  })

  it('ocrRateLimitDecisionFixture 限流决策 fixture', () => {
    const d = ocrRateLimitDecisionFixture()
    expect(d.status).toBe('allowed')
    expect(d.rpmLimit).toBe(100)
  })

  it('ocrProviderObservabilitySummaryFixture 摘要 fixture', () => {
    const s = ocrProviderObservabilitySummaryFixture()
    expect(s.totalAttempts).toBe(5)
    expect(s.succeededAttempts).toBe(4)
    expect(s.failedAttempts).toBe(0)
  })

  it('overrides 机制正常工作', () => {
    const e = ocrProviderAttemptFixture({ status: 'failed', latencyMs: 500 })
    expect(e.status).toBe('failed')
    expect(e.latencyMs).toBe(500)
    expect(e.organizationId).toBe(1) // 未覆盖的保持默认
  })
})

// =========================================================================
// Enum completeness
// =========================================================================
describe('枚举完整性', () => {
  it('OCR_PROVIDER_ATTEMPT_STATUSES 包含 8 个状态', () => {
    expect(OCR_PROVIDER_ATTEMPT_STATUSES).toHaveLength(8)
  })

  it('OCR_PROVIDER_ERROR_CATEGORIES 包含 8 个类别', () => {
    expect(OCR_PROVIDER_ERROR_CATEGORIES).toHaveLength(8)
  })

  it('OCR_PROVIDER_WARNING_CODES 包含 14 个警告代码', () => {
    expect(OCR_PROVIDER_WARNING_CODES).toHaveLength(14)
  })

  it('OCR_BUDGET_DECISION_STATUSES 包含 4 个状态', () => {
    expect(OCR_BUDGET_DECISION_STATUSES).toHaveLength(4)
  })

  it('OCR_RATE_LIMIT_DECISION_STATUSES 包含 4 个状态', () => {
    expect(OCR_RATE_LIMIT_DECISION_STATUSES).toHaveLength(4)
  })

  it('OCR_COST_STATUSES 包含 5 个状态', () => {
    expect(OCR_COST_STATUSES).toHaveLength(5)
  })

  it('OCR_BUDGET_SCOPES 包含 4 个作用域', () => {
    expect(OCR_BUDGET_SCOPES).toHaveLength(4)
  })

  it('OCR_BUDGET_SOFT_LIMIT_ACTIONS 包含 3 种动作', () => {
    expect(OCR_BUDGET_SOFT_LIMIT_ACTIONS).toHaveLength(3)
  })
})
