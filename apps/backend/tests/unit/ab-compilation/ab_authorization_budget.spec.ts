/**
 * Compiler A/B Authorization, Budget, Observability 单元测试（§3.2/3.4/3.6）。
 *
 * §3.2: 授权缺失/不完整返回 authorization_required
 * §3.4: 硬预算阻断、软预算警告、预算通过不授权 apply
 * §3.6: 观测事件排除敏感字段
 */

import { describe, expect, it } from 'vitest'
import { CompilerAbAuthorizationGateService } from '#services/compiler/ab-compilation/ab_authorization_gate'
import { CompilerAbBudgetIntegration } from '#services/compiler/ab-compilation/ab_budget_integration'
import { CompilerAbObservabilityRecorder } from '#services/compiler/ab-compilation/ab_observability'
import { createDefaultFixtureAbConfig, COMPILER_AB_CONTRACT_VERSION } from '@aiproj/types'
import type { CompilerAbAuthorizationGate, CompilerAbExperimentConfig } from '@aiproj/types'

describe('§3.2 Missing authorization returns authorization_required', () => {
  const gate = new CompilerAbAuthorizationGateService()

  it('unauthorized mode returns authorization_required', () => {
    const config = createDefaultFixtureAbConfig('test-auth-1', 1, 1)
    config.authorization.mode = 'unauthorized'
    const result = gate.checkAuthorization(config)
    expect(result.ok).toBe(false)
    expect(result.reasonCode).toBe('authorization_required')
  })

  it('empty authorized providers returns authorization_required', () => {
    const gate2 = new CompilerAbAuthorizationGateService()
    const config: CompilerAbExperimentConfig = {
      contractVersion: COMPILER_AB_CONTRACT_VERSION,
      experimentId: 'test-auth-2',
      organizationId: 1,
      actorId: 1,
      objective: 'test',
      sampleSetRef: 's1',
      sampleSetHash: 'h1',
      variants: [
        { variantId: 'v1', label: 'A' },
        { variantId: 'v2', label: 'B' },
      ],
      metricProfile: { profileId: 'p1', enabledGroups: ['quality'] },
      winnerPolicy: {
        policyId: 'w1',
        weights: { quality: 1 },
        safetyRegressionForcesNoWinner: true,
      },
      authorization: {
        mode: 'authorized',
        authorizedProviders: [],
        maxRunCount: 5,
        tokenCeiling: 100000,
        costCeilingUsd: 1,
        authorizedDate: '2026-07-20',
        authorizationRef: 'ticket-123',
      },
      createdAt: new Date().toISOString(),
    }
    const result = gate2.checkAuthorization(config)
    expect(result.ok).toBe(false)
    expect(result.reasonCode).toBe('authorization_required')
  })

  it('missing maxRunCount returns authorization_required', () => {
    const config: CompilerAbExperimentConfig = {
      contractVersion: COMPILER_AB_CONTRACT_VERSION,
      experimentId: 'test-auth-3',
      organizationId: 1,
      actorId: 1,
      objective: 'test',
      sampleSetRef: 's1',
      sampleSetHash: 'h1',
      variants: [
        { variantId: 'v1', label: 'A' },
        { variantId: 'v2', label: 'B' },
      ],
      metricProfile: { profileId: 'p1', enabledGroups: ['quality'] },
      winnerPolicy: {
        policyId: 'w1',
        weights: { quality: 1 },
        safetyRegressionForcesNoWinner: true,
      },
      authorization: {
        mode: 'authorized',
        authorizedProviders: ['test-provider'],
        tokenCeiling: 100000,
        costCeilingUsd: 1,
        authorizedDate: '2026-07-20',
        authorizationRef: 'ticket-123',
      },
      createdAt: new Date().toISOString(),
    }
    const result = gate.checkAuthorization(config)
    expect(result.ok).toBe(false)
    expect(result.reasonCode).toBe('authorization_required')
  })

  it('fixture mode bypasses authorization check', () => {
    const config = createDefaultFixtureAbConfig('test-auth-4', 1, 1)
    const result = gate.checkAuthorization(config)
    expect(result.ok).toBe(true)
    expect(result.reasonCode).toBe('fixture_bypass')
  })

  it('complete authorized config passes', () => {
    const config: CompilerAbExperimentConfig = {
      contractVersion: COMPILER_AB_CONTRACT_VERSION,
      experimentId: 'test-auth-5',
      organizationId: 1,
      actorId: 1,
      objective: 'test',
      sampleSetRef: 's1',
      sampleSetHash: 'h1',
      variants: [
        { variantId: 'v1', label: 'A' },
        { variantId: 'v2', label: 'B' },
      ],
      metricProfile: { profileId: 'p1', enabledGroups: ['quality'] },
      winnerPolicy: {
        policyId: 'w1',
        weights: { quality: 1 },
        safetyRegressionForcesNoWinner: true,
      },
      authorization: {
        mode: 'authorized',
        authorizedProviders: ['test-provider'],
        authorizedSampleRange: '10 samples',
        maxRunCount: 5,
        tokenCeiling: 100000,
        costCeilingUsd: 1,
        authorizedDate: '2026-07-20',
        authorizationRef: 'ticket-123',
      },
      createdAt: new Date().toISOString(),
    }
    const result = gate.checkAuthorization(config)
    expect(result.ok).toBe(true)
    expect(result.reasonCode).toBe('authorized')
  })
})

describe('§3.4 Budget hard block, soft warning, pass no-apply', () => {
  const auth: CompilerAbAuthorizationGate = {
    mode: 'authorized',
    authorizedProviders: ['test'],
    authorizedSampleRange: '10',
    maxRunCount: 5,
    tokenCeiling: 10000,
    costCeilingUsd: 0.5,
    authorizedDate: '2026-07-20',
    authorizationRef: 'ticket-1',
  }

  it('hard budget block prevents provider call', () => {
    const budget = new CompilerAbBudgetIntegration(auth)
    budget.setRealModelEnabled(true)

    // Exceeds token ceiling
    const result = budget.preflight({
      estimatedTokens: 20000,
      estimatedCostUsd: 0.1,
      usedTokens: 0,
      usedCostUsd: 0,
      tokenCeiling: 10000,
      costCeilingUsd: 0.5,
      softWarningEnabled: true,
      softWarningThreshold: 0.8,
    })
    expect(result.allowed).toBe(false)
    expect(result.decision).toBe('hard_block')
  })

  it('hard budget block for cost ceiling', () => {
    const budget = new CompilerAbBudgetIntegration(auth)
    budget.setRealModelEnabled(true)

    const result = budget.preflight({
      estimatedTokens: 1000,
      estimatedCostUsd: 0.6,
      usedTokens: 0,
      usedCostUsd: 0,
      tokenCeiling: 10000,
      costCeilingUsd: 0.5,
      softWarningEnabled: true,
      softWarningThreshold: 0.8,
    })
    expect(result.allowed).toBe(false)
    expect(result.decision).toBe('hard_block')
  })

  it('soft budget warning is returned', () => {
    const budget = new CompilerAbBudgetIntegration(auth, 9000, 0.45)
    budget.setRealModelEnabled(true)

    const result = budget.preflight({
      estimatedTokens: 1000,
      estimatedCostUsd: 0.05,
      usedTokens: 9000,
      usedCostUsd: 0.45,
      tokenCeiling: 10000,
      costCeilingUsd: 0.5,
      softWarningEnabled: true,
      softWarningThreshold: 0.8,
    })
    expect(result.allowed).toBe(true)
    expect(result.decision).toBe('soft_warning')
  })

  it('budget pass does not grant apply or config mutation', () => {
    const budget = new CompilerAbBudgetIntegration(auth)
    budget.setRealModelEnabled(true)

    const result = budget.preflight({
      estimatedTokens: 1000,
      estimatedCostUsd: 0.05,
      usedTokens: 0,
      usedCostUsd: 0,
      tokenCeiling: 10000,
      costCeilingUsd: 0.5,
      softWarningEnabled: true,
      softWarningThreshold: 0.8,
    })
    expect(result.allowed).toBe(true)
    expect(result.decision).toBe('pass')

    // Budget pass does not grant special permissions
    expect(budget.isRealModelEnabled()).toBe(true)
    // Integration has no setConfigurationMutation method
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(budget))).not.toContain(
      'applyWinnerConfig',
    )
  })

  it('budget pass does not authorize apply', () => {
    const budget = new CompilerAbBudgetIntegration(auth)
    budget.setRealModelEnabled(true)

    // Postflight after a successful run
    const post = budget.postflight({ actualTokens: 500, actualCostUsd: 0.02 })
    expect(post.exceededThreshold).toBe(false)

    // Postflight does not apply anything — just tracks
    expect(post.cumulativeTokens).toBe(500)
    expect(post.cumulativeCostUsd).toBeCloseTo(0.02)
  })
})

describe('§3.6 Observability excludes sensitive data', () => {
  const recorder = new CompilerAbObservabilityRecorder()

  it('experiment start event excludes sensitive fields', () => {
    recorder.clear()
    recorder.recordExperimentStart('exp-1', 1, {
      objective: 'test fixture comparison',
      sampleSetRef: 'fixture-v1',
      variantCount: 2,
      authorizationMode: 'fixture',
    })
    const events = recorder.getEvents()
    const event = events[0]
    const json = JSON.stringify(event).toLowerCase()

    expect(event.kind).toBe('experiment_start')
    expect(json).not.toContain('prompt')
    expect(json).not.toContain('rawoutput')
    expect(json).not.toContain('apikey')
    expect(json).not.toContain('secret')
    expect(json).not.toContain('token')
    expect(json).not.toContain('authorizationheader')
  })

  it('sample execution event excludes raw output', () => {
    recorder.clear()
    recorder.recordSampleExecution('exp-1', 1, 'v1', 's1', 150, 0)
    const events = recorder.getEvents()
    const json = JSON.stringify(events[0])

    expect(json).not.toContain('rawOutput')
    expect(json).not.toContain('output')
  })

  it('metric aggregation excludes artifact body', () => {
    recorder.clear()
    recorder.recordMetricAggregation('exp-1', 1, [
      {
        variantId: 'v1',
        quality: {
          schemaValidRate: 0.95,
          candidateBundleSafetyPassRate: 1,
          hallucinationViolationCount: 0,
          ruleViolationCount: 0,
        },
        safety: {
          ruleViolationCount: 0,
          noReviewWritebackRisk: false,
          secretExposureDetected: false,
        },
        cost: {
          estimatedTokenCount: 1000,
          estimatedCostUsd: 0,
          realModelCallCount: 0,
          currency: 'USD',
        },
        latency: { totalDurationMs: 150, perStageDurationMs: {}, latencyBuckets: {} },
        stability: { stageFailureCount: 0, totalRetryCount: 0 },
        compositeScore: 0.9,
      },
    ])
    const events = recorder.getEvents()
    const json = JSON.stringify(events[0]).toLowerCase()

    expect(json).not.toContain('artifactbody')
    expect(json).not.toContain('fullprompt')
  })

  it('budget decision event excludes API keys and full logs', () => {
    recorder.clear()
    recorder.recordBudgetDecision('exp-1', 1, 'hard_block', 'Token ceiling exceeded')
    const events = recorder.getEvents()
    const json = JSON.stringify(events[0])

    expect(json).not.toContain('apiKey')
    expect(json).not.toContain('api_key')
    expect(json).not.toContain('secret')
    expect(json).toContain('hard_block')
  })

  it('winner policy event only exposes low-sensitive fields', () => {
    recorder.clear()
    recorder.recordWinnerPolicy(
      'exp-1',
      1,
      {
        policyId: 'p1',
        result: 'variant_a_preferred',
        reasonCode: 'QUALITY_LEAD',
        reasonSummary: 'Variant A has better quality',
        groupScores: {},
        preferredVariantId: 'v1',
      },
      {
        result: 'GO',
        reasonCode: 'ALL_METRICS_PASS',
        reasonSummary: 'All passed',
        evidenceEligible: true,
        followUpActions: [],
        blockers: [],
        fixItems: [],
      },
    )
    const events = recorder.getEvents()
    const json = JSON.stringify(events[0]).toLowerCase()

    expect(events[0].kind).toBe('winner_policy')
    expect(json).not.toContain('prompt')
    expect(json).not.toContain('rawoutput')
    expect(json).not.toContain('apikey')
    expect(json).not.toContain('authorization')
    expect(json).toContain('winnerresult')
    expect(json).toContain('gonogoresult')
  })
})
