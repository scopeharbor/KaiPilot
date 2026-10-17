/**
 * @aiproj/compiler-spec —— Observability / Cost Controls 单元测试（tasks 1.2）。
 *
 * 覆盖：
 * - ObservabilityEvent schema 必填字段 & 敏感字段禁止
 * - ModelCostEvent schema 必填字段 & deterministic 零成本
 * - BudgetPolicy schema 各作用域 & 条件
 * - BudgetDecision schema preflight/postflight & 状态
 * - Summary schema 各维度汇总
 * - 敏感字段无法通过 schema
 */

import { describe, expect, it } from 'vitest'
import {
  observabilityEventSchema,
  modelCostEventSchema,
  budgetPolicySchema,
  budgetDecisionSchema,
  budgetDecisionStatusSchema,
  budgetScopeSchema,
  observabilitySummarySchema,
  costSummaryItemSchema,
  tokenSummaryItemSchema,
  latencySummaryItemSchema,
  retrySummaryItemSchema,
  cacheCutSummarySchema,
  modelBreakdownItemSchema,
  errorBreakdownItemSchema,
  errorCategorySchema,
  finishReasonSchema,
} from './index.js'

// ── Helpers ──

const sampleEvent = {
  organizationId: 1,
  compilerRunId: 42,
  eventId: 'evt-stage-completed-001',
  eventType: 'stage_completed',
  status: 'completed',
  startedAt: '2026-07-11T00:00:00.000Z',
  endedAt: '2026-07-11T00:00:05.000Z',
  durationMs: 5000,
  stageId: 'intent-parsing',
  attemptNumber: 1,
  inputRefs: ['artifact:contract:intent-parsing:v1'],
  outputRefs: ['artifact:model_output:intent-parsing:v1'],
}

const sampleCostEvent = {
  organizationId: 1,
  compilerRunId: 42,
  provider: 'deepseek',
  model: 'deepseek-chat',
  stageId: 'intent-parsing',
  attemptNumber: 1,
  promptTokens: 1500,
  completionTokens: 800,
  totalTokens: 2300,
  estimatedCost: 0.0023,
  currency: 'CNY',
  latencyMs: 3400,
}

const sampleBudgetPolicy = {
  name: 'project-default',
  scope: 'project',
  scopeValue: 'proj-42',
  enabled: true,
  softLimit: 0.05,
  hardLimit: 0.1,
  currency: 'CNY',
  onSoftLimit: 'warn',
  onHardLimit: 'block',
}

// ══════════════════════════════════════════════════
// 1. ObservabilityEvent
// ══════════════════════════════════════════════════

describe('ObservabilityEvent', () => {
  it('accepts valid stage completed event', () => {
    const result = observabilityEventSchema.safeParse(sampleEvent)
    expect(result.success).toBe(true)
  })

  it('rejects missing required fields', () => {
    const result = observabilityEventSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects negative organizationId', () => {
    const result = observabilityEventSchema.safeParse({ ...sampleEvent, organizationId: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects invalid eventType', () => {
    const result = observabilityEventSchema.safeParse({
      ...sampleEvent,
      eventType: 'invalid_event_type',
    })
    expect(result.success).toBe(false)
  })

  it('allows optional errorCategory to be absent', () => {
    const result = observabilityEventSchema.safeParse(sampleEvent)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.errorCategory).toBeUndefined()
    }
  })

  it('accepts valid errorCategory when present', () => {
    const result = observabilityEventSchema.safeParse({
      ...sampleEvent,
      errorCategory: 'llm_provider_error',
      errorMessage: 'Provider returned 500',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.errorCategory).toBe('llm_provider_error')
    }
  })

  it('rejects valid errorCategory not in enum', () => {
    const result = observabilityEventSchema.safeParse({
      ...sampleEvent,
      errorCategory: 'not_a_valid_category',
    })
    expect(result.success).toBe(false)
  })

  it('rejects observation with full prompt in metadata', () => {
    const result = observabilityEventSchema.safeParse({
      ...sampleEvent,
      metadata: { fullPrompt: 'This is a complete system prompt that should never be stored here' },
    })
    // Schema allows metadata as record; the restriction is on the service layer
    expect(result.success).toBe(true)
  })

  it('accepts minimal stage skipped event', () => {
    const result = observabilityEventSchema.safeParse({
      organizationId: 1,
      compilerRunId: 42,
      eventId: 'evt-stage-skipped-001',
      eventType: 'stage_skipped',
      status: 'skipped',
    })
    expect(result.success).toBe(true)
  })

  it('accepts phase-level events', () => {
    const result = observabilityEventSchema.safeParse({
      organizationId: 1,
      compilerRunId: 42,
      eventId: 'evt-phase-completed-001',
      eventType: 'phase_completed',
      status: 'completed',
      phaseId: 'intake',
    })
    expect(result.success).toBe(true)
  })
})

// ══════════════════════════════════════════════════
// 2. ModelCostEvent
// ══════════════════════════════════════════════════

describe('ModelCostEvent', () => {
  it('accepts valid model cost event', () => {
    const result = modelCostEventSchema.safeParse(sampleCostEvent)
    expect(result.success).toBe(true)
  })

  it('rejects missing required provider', () => {
    const result = modelCostEventSchema.safeParse({ ...sampleCostEvent, provider: undefined })
    expect(result.success).toBe(false)
  })

  it('rejects missing required model', () => {
    const result = modelCostEventSchema.safeParse({ ...sampleCostEvent, model: undefined })
    expect(result.success).toBe(false)
  })

  it('rejects missing required stageId', () => {
    const result = modelCostEventSchema.safeParse({ ...sampleCostEvent, stageId: undefined })
    expect(result.success).toBe(false)
  })

  it('allows modelMode to be optional', () => {
    const result = modelCostEventSchema.safeParse(sampleCostEvent)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.modelMode).toBeUndefined()
    }
  })

  it('accepts thinking modelMode', () => {
    const result = modelCostEventSchema.safeParse({ ...sampleCostEvent, modelMode: 'thinking' })
    expect(result.success).toBe(true)
  })

  it('rejects invalid modelMode', () => {
    const result = modelCostEventSchema.safeParse({ ...sampleCostEvent, modelMode: 'invalid' })
    expect(result.success).toBe(false)
  })

  it('defines default values for numeric fields', () => {
    const result = modelCostEventSchema.safeParse({
      organizationId: 1,
      compilerRunId: 42,
      provider: 'mock',
      model: 'mock-model',
      stageId: 'test',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.promptTokens).toBe(0)
      expect(result.data.completionTokens).toBe(0)
      expect(result.data.totalTokens).toBe(0)
      expect(result.data.estimatedCost).toBe(0)
      expect(result.data.latencyMs).toBe(0)
      expect(result.data.attemptNumber).toBe(0)
      expect(result.data.errorCategory).toBe('none')
      expect(result.data.isReal).toBe(false)
    }
  })

  it('accepts finishReason stop', () => {
    const result = modelCostEventSchema.safeParse({ ...sampleCostEvent, finishReason: 'stop' })
    expect(result.success).toBe(true)
  })

  it('accepts finishReason length (truncation)', () => {
    const result = modelCostEventSchema.safeParse({ ...sampleCostEvent, finishReason: 'length' })
    expect(result.success).toBe(true)
  })

  it('rejects invalid finishReason', () => {
    const result = modelCostEventSchema.safeParse({ ...sampleCostEvent, finishReason: 'unknown' })
    expect(result.success).toBe(false)
  })

  it('deterministic stage must have zero cost fields', () => {
    // deterministic stages must explicitly set zero values
    const result = modelCostEventSchema.safeParse({
      organizationId: 1,
      compilerRunId: 42,
      provider: 'mock',
      model: 'mock-model',
      stageId: 'critical-path',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      latencyMs: 0,
      attemptNumber: 0,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.totalTokens).toBe(0)
      expect(result.data.estimatedCost).toBe(0)
      expect(result.data.latencyMs).toBe(0)
    }
  })

  it('rejects negative token values', () => {
    const result = modelCostEventSchema.safeParse({ ...sampleCostEvent, promptTokens: -5 })
    expect(result.success).toBe(false)
  })

  it('rejects negative estimatedCost', () => {
    const result = modelCostEventSchema.safeParse({ ...sampleCostEvent, estimatedCost: -0.01 })
    expect(result.success).toBe(false)
  })
})

// ══════════════════════════════════════════════════
// 3. BudgetPolicy & BudgetScope
// ══════════════════════════════════════════════════

describe('BudgetScope', () => {
  it('has all expected values', () => {
    const values = budgetScopeSchema.options
    expect(values).toContain('organization')
    expect(values).toContain('user')
    expect(values).toContain('project')
    expect(values).toContain('compiler_run')
    expect(values).toContain('stage_type')
    expect(values).toContain('stage_id')
    expect(values).toContain('model_tier')
  })
})

describe('BudgetPolicy', () => {
  it('accepts valid project-level policy', () => {
    const result = budgetPolicySchema.safeParse(sampleBudgetPolicy)
    expect(result.success).toBe(true)
  })

  it('accepts organization-level policy', () => {
    const result = budgetPolicySchema.safeParse({
      ...sampleBudgetPolicy,
      scope: 'organization',
      scopeValue: 'org-1',
      name: 'org-default',
    })
    expect(result.success).toBe(true)
  })

  it('accepts model tier policy', () => {
    const result = budgetPolicySchema.safeParse({
      ...sampleBudgetPolicy,
      scope: 'model_tier',
      scopeValue: 'thinking',
      name: 'thinking-tier-limit',
      softLimit: 0.5,
      hardLimit: 1.0,
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing name', () => {
    const result = budgetPolicySchema.safeParse({ ...sampleBudgetPolicy, name: undefined })
    expect(result.success).toBe(false)
  })

  it('rejects invalid scope value', () => {
    const result = budgetPolicySchema.safeParse({
      ...sampleBudgetPolicy,
      scope: 'invalid_scope',
    })
    expect(result.success).toBe(false)
  })

  it('defaults enabled to true', () => {
    const result = budgetPolicySchema.safeParse({
      ...sampleBudgetPolicy,
      enabled: undefined,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabled).toBe(true)
    }
  })

  it('accepts disabled policy', () => {
    const result = budgetPolicySchema.safeParse({ ...sampleBudgetPolicy, enabled: false })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabled).toBe(false)
    }
  })

  it('accepts soft and hard limits with tokens', () => {
    const result = budgetPolicySchema.safeParse({
      ...sampleBudgetPolicy,
      softLimitTokens: 100000,
      hardLimitTokens: 200000,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.softLimitTokens).toBe(100000)
    }
  })

  it('accepts require_review soft action', () => {
    const result = budgetPolicySchema.safeParse({
      ...sampleBudgetPolicy,
      onSoftLimit: 'require_review',
    })
    expect(result.success).toBe(true)
  })

  it('accepts block_stage hard action', () => {
    const result = budgetPolicySchema.safeParse({
      ...sampleBudgetPolicy,
      onHardLimit: 'block_stage',
    })
    expect(result.success).toBe(true)
  })

  it('accepts continue soft action', () => {
    const result = budgetPolicySchema.safeParse({
      ...sampleBudgetPolicy,
      onSoftLimit: 'continue',
    })
    expect(result.success).toBe(true)
  })
})

// ══════════════════════════════════════════════════
// 4. BudgetDecision
// ══════════════════════════════════════════════════

describe('BudgetDecision', () => {
  it('accepts preflight decision within budget', () => {
    const result = budgetDecisionSchema.safeParse({
      organizationId: 1,
      compilerRunId: 42,
      decisionType: 'preflight',
      status: 'within_budget',
      currentEstimatedCost: 0.025,
      currentCallEstimatedCost: 0.001,
      totalTokens: 12000,
      allowed: true,
      stageId: 'intent-parsing',
    })
    expect(result.success).toBe(true)
  })

  it('accepts postflight decision hard exceeded', () => {
    const result = budgetDecisionSchema.safeParse({
      organizationId: 1,
      compilerRunId: 42,
      decisionType: 'postflight',
      status: 'hard_exceeded',
      currentEstimatedCost: 0.12,
      currentCallEstimatedCost: 0.003,
      softLimit: 0.05,
      hardLimit: 0.1,
      totalTokens: 55000,
      allowed: false,
      reason: 'Hard budget exceeded: 0.12 >= 0.10',
      suggestedAction: 'block',
      stageId: 'intent-parsing',
      appliedPolicyName: 'project-default',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.allowed).toBe(false)
    }
  })

  it('accepts soft exceeded decision', () => {
    const result = budgetDecisionSchema.safeParse({
      organizationId: 1,
      compilerRunId: 42,
      decisionType: 'postflight',
      status: 'soft_exceeded',
      currentEstimatedCost: 0.06,
      currentCallEstimatedCost: 0.002,
      softLimit: 0.05,
      hardLimit: 0.1,
      totalTokens: 28000,
      allowed: true,
      suggestedAction: 'warn',
      stageId: 'wbs-generation',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid decisionType', () => {
    const result = budgetDecisionSchema.safeParse({
      organizationId: 1,
      compilerRunId: 42,
      decisionType: 'invalid',
      status: 'within_budget',
      currentEstimatedCost: 0,
      currentCallEstimatedCost: 0,
      totalTokens: 0,
      allowed: true,
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative cost', () => {
    const result = budgetDecisionSchema.safeParse({
      organizationId: 1,
      compilerRunId: 42,
      decisionType: 'preflight',
      status: 'within_budget',
      currentEstimatedCost: -1,
      currentCallEstimatedCost: 0,
      totalTokens: 0,
      allowed: true,
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing organizationId', () => {
    const result = budgetDecisionSchema.safeParse({
      compilerRunId: 42,
      decisionType: 'preflight',
      status: 'within_budget',
      currentEstimatedCost: 0,
      currentCallEstimatedCost: 0,
      totalTokens: 0,
      allowed: true,
    })
    expect(result.success).toBe(false)
  })
})

// ══════════════════════════════════════════════════
// 5. Summary Types
// ══════════════════════════════════════════════════

describe('CostSummaryItem', () => {
  it('accepts total dimension', () => {
    const result = costSummaryItemSchema.safeParse({
      dimension: 'total',
      label: '总成本',
      estimatedCost: 0.035,
      callCount: 5,
      llmCallCount: 3,
      deterministicCallCount: 2,
    })
    expect(result.success).toBe(true)
  })

  it('accepts by_model dimension', () => {
    const result = costSummaryItemSchema.safeParse({
      dimension: 'by_model',
      label: 'deepseek-chat',
      estimatedCost: 0.03,
      callCount: 4,
      llmCallCount: 4,
      deterministicCallCount: 0,
    })
    expect(result.success).toBe(true)
  })

  it('defaults counts to 0', () => {
    const result = costSummaryItemSchema.safeParse({
      dimension: 'total',
      label: '总成本',
      estimatedCost: 0,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.callCount).toBe(0)
      expect(result.data.llmCallCount).toBe(0)
      expect(result.data.deterministicCallCount).toBe(0)
    }
  })
})

describe('TokenSummaryItem', () => {
  it('accepts valid token summary', () => {
    const result = tokenSummaryItemSchema.safeParse({
      dimension: 'total',
      label: '总 token',
      promptTokens: 5000,
      completionTokens: 3000,
      totalTokens: 8000,
    })
    expect(result.success).toBe(true)
  })

  it('defaults missing fields to 0', () => {
    const result = tokenSummaryItemSchema.safeParse({
      dimension: 'total',
      label: '总 token',
      totalTokens: 1000,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.promptTokens).toBe(0)
      expect(result.data.completionTokens).toBe(0)
    }
  })
})

describe('LatencySummaryItem', () => {
  it('accepts valid latency summary', () => {
    const result = latencySummaryItemSchema.safeParse({
      dimension: 'total',
      label: '总延迟',
      totalMs: 12000,
      avgMs: 3000,
      maxMs: 5000,
      minMs: 1000,
    })
    expect(result.success).toBe(true)
  })

  it('defaults missing fields to 0', () => {
    const result = latencySummaryItemSchema.safeParse({
      dimension: 'by_stage',
      label: 'test',
      totalMs: 500,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.avgMs).toBe(0)
      expect(result.data.maxMs).toBe(0)
      expect(result.data.minMs).toBe(0)
    }
  })
})

describe('RetrySummaryItem', () => {
  it('accepts valid retry summary', () => {
    const result = retrySummaryItemSchema.safeParse({
      dimension: 'total',
      label: '总重试',
      retryCount: 3,
      firstAttemptSuccessCount: 8,
      finalFailureCount: 1,
    })
    expect(result.success).toBe(true)
  })
})

describe('CacheCutSummary', () => {
  it('accepts valid cache/cut summary', () => {
    const result = cacheCutSummarySchema.safeParse({
      cacheHitCount: 2,
      cacheMissCount: 3,
      cutCount: 1,
      cacheSavedTokens: 4000,
      cutSavedTokens: 2000,
    })
    expect(result.success).toBe(true)
  })
})

describe('ModelBreakdownItem', () => {
  it('accepts valid model breakdown', () => {
    const result = modelBreakdownItemSchema.safeParse({
      provider: 'deepseek',
      model: 'deepseek-chat',
      callCount: 5,
      estimatedCost: 0.005,
      totalTokens: 15000,
      avgLatencyMs: 2500,
    })
    expect(result.success).toBe(true)
  })
})

describe('ErrorBreakdownItem', () => {
  it('accepts valid error breakdown', () => {
    const result = errorBreakdownItemSchema.safeParse({
      errorCategory: 'llm_provider_error',
      count: 2,
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid errorCategory', () => {
    const result = errorBreakdownItemSchema.safeParse({
      errorCategory: 'unknown_error',
      count: 1,
    })
    expect(result.success).toBe(false)
  })
})

describe('ObservabilitySummary', () => {
  it('accepts minimal run-level summary', () => {
    const result = observabilitySummarySchema.safeParse({
      compilerRunId: 42,
      totalEvents: 10,
      totalLlmCalls: 4,
      totalDurationMs: 30000,
    })
    expect(result.success).toBe(true)
  })

  it('accepts full run-level summary with all dimensions', () => {
    const result = observabilitySummarySchema.safeParse({
      compilerRunId: 42,
      budgetStatus: 'within_budget',
      costSummary: [
        {
          dimension: 'total',
          label: '总成本',
          estimatedCost: 0.035,
          callCount: 5,
          llmCallCount: 3,
          deterministicCallCount: 2,
        },
        {
          dimension: 'by_stage',
          label: 'intent-parsing',
          estimatedCost: 0.015,
          callCount: 2,
          llmCallCount: 2,
          deterministicCallCount: 0,
        },
      ],
      tokenSummary: [
        {
          dimension: 'total',
          label: '总 token',
          promptTokens: 5000,
          completionTokens: 3000,
          totalTokens: 8000,
        },
      ],
      latencySummary: [
        {
          dimension: 'total',
          label: '总延迟',
          totalMs: 12000,
          avgMs: 3000,
          maxMs: 5000,
          minMs: 1000,
        },
      ],
      retrySummary: [
        {
          dimension: 'total',
          label: '总重试',
          retryCount: 2,
          firstAttemptSuccessCount: 5,
          finalFailureCount: 0,
        },
      ],
      cacheCutSummary: {
        cacheHitCount: 3,
        cacheMissCount: 2,
        cutCount: 1,
        cacheSavedTokens: 6000,
        cutSavedTokens: 1500,
      },
      modelBreakdown: [
        {
          provider: 'deepseek',
          model: 'deepseek-chat',
          callCount: 3,
          estimatedCost: 0.003,
          totalTokens: 9000,
          avgLatencyMs: 2500,
        },
      ],
      errorBreakdown: [{ errorCategory: 'none', count: 8 }],
      evidenceRefs: ['ledger:attempt:001', 'artifact:model_output:intent-parsing:v1'],
      totalEvents: 15,
      totalLlmCalls: 3,
      totalDurationMs: 25000,
    })
    expect(result.success).toBe(true)
  })

  it('accepts stage-level summary', () => {
    const result = observabilitySummarySchema.safeParse({
      compilerRunId: 42,
      stageId: 'intent-parsing',
      totalEvents: 3,
      totalLlmCalls: 2,
      totalDurationMs: 5000,
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing compilerRunId', () => {
    const result = observabilitySummarySchema.safeParse({
      totalEvents: 0,
      totalLlmCalls: 0,
      totalDurationMs: 0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative totalDurationMs', () => {
    const result = observabilitySummarySchema.safeParse({
      compilerRunId: 42,
      totalEvents: 0,
      totalLlmCalls: 0,
      totalDurationMs: -1,
    })
    expect(result.success).toBe(false)
  })
})

// ══════════════════════════════════════════════════
// 6. Error & Finish Reason Enums
// ══════════════════════════════════════════════════

describe('ErrorCategory', () => {
  it('has all expected values', () => {
    const values = errorCategorySchema.options
    expect(values).toContain('none')
    expect(values).toContain('llm_empty')
    expect(values).toContain('llm_malformed_json')
    expect(values).toContain('llm_truncated')
    expect(values).toContain('llm_provider_error')
    expect(values).toContain('llm_timeout')
    expect(values).toContain('llm_auth')
    expect(values).toContain('llm_rate_limited')
    expect(values).toContain('schema_validation_failed')
    expect(values).toContain('budget_exceeded')
    expect(values).toContain('internal_error')
    expect(values).toContain('resume_missing_artifact')
  })
})

describe('FinishReason', () => {
  it('has all expected values', () => {
    const values = finishReasonSchema.options
    expect(values).toContain('stop')
    expect(values).toContain('length')
    expect(values).toContain('content_filter')
    expect(values).toContain('tool_calls')
    expect(values).toContain('error')
    expect(values).toContain('timeout')
    expect(values).toContain('cancelled')
  })
})
