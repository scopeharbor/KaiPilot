/**
 * compiler-ab-compilation.test —— Compiler A/B compilation 共享契约测试（§1.3/1.5）。
 *
 * 覆盖：fixture config 合法性、重复 variant 拒绝、敏感字段拒绝、
 * evidence eligibility、report 序列化、类型 guards。
 */

import { describe, expect, it } from 'vitest'
import {
  COMPILER_AB_CONTRACT_VERSION,
  COMPILER_AB_AUTHORIZATION_MODES,
  COMPILER_AB_METRIC_GROUPS,
  COMPILER_AB_WINNER_RESULTS,
  COMPILER_AB_GO_NOGO_RESULTS,
  COMPILER_AB_FORBIDDEN_FIELDS,
  createDefaultFixtureAbConfig,
  validateCompilerAbConfig,
  variantContainsSensitiveFields,
  isCompilerAbAuthorizationMode,
  isCompilerAbMetricGroup,
  isCompilerAbWinnerResult,
  isCompilerAbGoNoGoResult,
  buildCompilerAbReportSummary,
} from './compiler-ab-compilation.js'
import type {
  CompilerAbExperimentConfig,
  CompilerAbVariant,
  CompilerAbReport,
  CompilerAbMetricSnapshot,
  CompilerAbWinnerDecision,
  CompilerAbGoNoGoDecision,
} from './compiler-ab-compilation.js'

describe('§1.3 Fixture config validation', () => {
  it('default fixture config is valid', () => {
    const config = createDefaultFixtureAbConfig('test-1', 1, 1)
    const result = validateCompilerAbConfig(config)
    expect(result).toEqual({ valid: true })
  })

  it('default config has correct contract version', () => {
    const config = createDefaultFixtureAbConfig('test-2', 1, 1)
    expect(config.contractVersion).toBe(COMPILER_AB_CONTRACT_VERSION)
  })

  it('default config includes at least 2 variants', () => {
    const config = createDefaultFixtureAbConfig('test-3', 1, 1)
    expect(config.variants.length).toBeGreaterThanOrEqual(2)
  })

  it('default config uses fixture authorization', () => {
    const config = createDefaultFixtureAbConfig('test-4', 1, 1)
    expect(config.authorization.mode).toBe('fixture')
  })

  it('default config has all 5 metric groups enabled', () => {
    const config = createDefaultFixtureAbConfig('test-5', 1, 1)
    expect(config.metricProfile.enabledGroups).toEqual([
      'quality',
      'safety',
      'cost',
      'latency',
      'stability',
    ])
  })

  it('default config has stable sample set hash', () => {
    const config1 = createDefaultFixtureAbConfig('test-6', 1, 1)
    const config2 = createDefaultFixtureAbConfig('test-7', 1, 1)
    expect(config1.sampleSetHash).toBe('fixture-hash-default')
    expect(config2.sampleSetHash).toBe('fixture-hash-default')
  })
})

describe('§1.3 Duplicate variant rejection', () => {
  it('rejects single variant config', () => {
    const config: CompilerAbExperimentConfig = {
      contractVersion: COMPILER_AB_CONTRACT_VERSION,
      experimentId: 'dup-test-1',
      organizationId: 1,
      actorId: 1,
      objective: 'Test',
      sampleSetRef: 's1',
      sampleSetHash: 'h1',
      variants: [{ variantId: 'v1', label: 'Only' }],
      metricProfile: {
        profileId: 'p1',
        enabledGroups: ['quality'],
      },
      winnerPolicy: {
        policyId: 'w1',
        weights: { quality: 1 },
        safetyRegressionForcesNoWinner: true,
      },
      authorization: { mode: 'fixture' },
      createdAt: new Date().toISOString(),
    }
    const result = validateCompilerAbConfig(config)
    expect(result).toEqual({
      valid: false,
      reasonCode: 'AB_CONFIG_INVALID',
      violations: expect.arrayContaining(['experiment must have at least 2 variants']),
    })
  })

  it('rejects duplicate variant ids', () => {
    const config: CompilerAbExperimentConfig = {
      contractVersion: COMPILER_AB_CONTRACT_VERSION,
      experimentId: 'dup-test-2',
      organizationId: 1,
      actorId: 1,
      objective: 'Test',
      sampleSetRef: 's1',
      sampleSetHash: 'h2',
      variants: [
        { variantId: 'v1', label: 'A' },
        { variantId: 'v1', label: 'B' },
      ],
      metricProfile: {
        profileId: 'p1',
        enabledGroups: ['quality'],
      },
      winnerPolicy: {
        policyId: 'w1',
        weights: { quality: 1 },
        safetyRegressionForcesNoWinner: true,
      },
      authorization: { mode: 'fixture' },
      createdAt: new Date().toISOString(),
    }
    const result = validateCompilerAbConfig(config)
    expect('valid' in result && result.valid === false).toBe(true)
    if ('valid' in result && !result.valid) {
      expect(result.violations).toContain('duplicate variant ids detected')
    }
  })
})

describe('§1.3 Sensitive field rejection', () => {
  it('detects prompt in variant metadata', () => {
    const variant: CompilerAbVariant = {
      variantId: 'bad',
      label: 'Bad variant',
      // @ts-expect-error testing forbidden field
      prompt: 'should not be here',
    }
    expect(variantContainsSensitiveFields(variant)).toBe(true)
  })

  it('detects rawOutput in variant', () => {
    const variant: CompilerAbVariant = {
      variantId: 'bad2',
      label: 'Bad',
      // @ts-expect-error testing forbidden field
      rawOutput: 'sensitive',
    }
    expect(variantContainsSensitiveFields(variant)).toBe(true)
  })

  it('detects token in variant', () => {
    const variant: CompilerAbVariant = {
      variantId: 'bad3',
      label: 'Bad',
      // @ts-expect-error testing forbidden field
      token: 'sensitive',
    }
    expect(variantContainsSensitiveFields(variant)).toBe(true)
  })

  it('detects secret in variant', () => {
    const variant: CompilerAbVariant = {
      variantId: 'bad4',
      label: 'Bad',
      // @ts-expect-error testing forbidden field
      secret: 'sensitive',
    }
    expect(variantContainsSensitiveFields(variant)).toBe(true)
  })

  it('rejects config with sensitive variant', () => {
    const config: CompilerAbExperimentConfig = {
      contractVersion: COMPILER_AB_CONTRACT_VERSION,
      experimentId: 'sens-test-1',
      organizationId: 1,
      actorId: 1,
      objective: 'Test',
      sampleSetRef: 's1',
      sampleSetHash: 'h3',
      variants: [
        { variantId: 'v1', label: 'Clean' },
        {
          variantId: 'v2',
          label: 'Sensitive',
          // @ts-expect-error testing forbidden field
          apiKey: 'sk-123',
        },
      ],
      metricProfile: {
        profileId: 'p1',
        enabledGroups: ['quality'],
      },
      winnerPolicy: {
        policyId: 'w1',
        weights: { quality: 1 },
        safetyRegressionForcesNoWinner: true,
      },
      authorization: { mode: 'fixture' },
      createdAt: new Date().toISOString(),
    }
    const result = validateCompilerAbConfig(config)
    expect(result.valid).toBe(false)
  })

  it('clean variant does not trigger sensitive detection', () => {
    const variant: CompilerAbVariant = {
      variantId: 'clean',
      label: 'Clean variant',
      catalogVersion: '1.0',
      routingDecisionRef: 'route-ref-1',
      toolHardeningProfile: 'strict-v1',
    }
    expect(variantContainsSensitiveFields(variant)).toBe(false)
  })
})

describe('§1.3 Type guards', () => {
  it('validates authorization modes', () => {
    expect(isCompilerAbAuthorizationMode('fixture')).toBe(true)
    expect(isCompilerAbAuthorizationMode('authorized')).toBe(true)
    expect(isCompilerAbAuthorizationMode('unauthorized')).toBe(true)
    expect(isCompilerAbAuthorizationMode('invalid')).toBe(false)
  })

  it('validates metric groups', () => {
    COMPILER_AB_METRIC_GROUPS.forEach((g) => {
      expect(isCompilerAbMetricGroup(g)).toBe(true)
    })
    expect(isCompilerAbMetricGroup('unknown')).toBe(false)
  })

  it('validates winner results', () => {
    COMPILER_AB_WINNER_RESULTS.forEach((r) => {
      expect(isCompilerAbWinnerResult(r)).toBe(true)
    })
    expect(isCompilerAbWinnerResult('unknown')).toBe(false)
  })

  it('validates go/no-go results', () => {
    COMPILER_AB_GO_NOGO_RESULTS.forEach((r) => {
      expect(isCompilerAbGoNoGoResult(r)).toBe(true)
    })
    expect(isCompilerAbGoNoGoResult('unknown')).toBe(false)
  })

  it('forbidden fields constant is populated', () => {
    expect(COMPILER_AB_FORBIDDEN_FIELDS.length).toBeGreaterThan(0)
    expect(COMPILER_AB_FORBIDDEN_FIELDS).toContain('prompt')
    expect(COMPILER_AB_FORBIDDEN_FIELDS).toContain('token')
    expect(COMPILER_AB_FORBIDDEN_FIELDS).toContain('secret')
    expect(COMPILER_AB_FORBIDDEN_FIELDS).toContain('apiKey')
  })
})

describe('§1.3 Evidence eligibility flags', () => {
  it('fixture report has evidenceEligible=false', () => {
    const report: CompilerAbReport = {
      contractVersion: COMPILER_AB_CONTRACT_VERSION,
      experimentId: 'report-1',
      organizationId: 1,
      createdAt: new Date().toISOString(),
      variantMetrics: [],
      winnerDecision: {
        policyId: 'p1',
        result: 'no_winner',
        reasonCode: 'NO_WINNER_INCONCLUSIVE',
        reasonSummary: 'No clear winner in fixture mode',
        groupScores: {},
      },
      goNoGoDecision: {
        result: 'FIX_THEN_GO',
        reasonCode: 'FIXTURE_ONLY',
        reasonSummary: 'Fixture only, needs real model for evidence',
        evidenceEligible: false,
        followUpActions: ['Run authorized real-model A/B smoke'],
        blockers: [],
        fixItems: [],
      },
      isFixture: true,
      evidenceEligible: false,
      summary: 'Fixture A/B report',
      evidenceRefs: [],
    }
    expect(report.evidenceEligible).toBe(false)
    expect(report.isFixture).toBe(true)
  })
})

describe('§1.3 Report serialization', () => {
  it('builds redacted summary without sensitive fields', () => {
    const variantMetrics: CompilerAbMetricSnapshot[] = [
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
          estimatedCostUsd: 0.01,
          realModelCallCount: 0,
          currency: 'USD',
        },
        latency: { totalDurationMs: 500, perStageDurationMs: {}, latencyBuckets: {} },
        stability: { stageFailureCount: 0, totalRetryCount: 0 },
        compositeScore: 0.85,
      },
    ]
    const report: CompilerAbReport = {
      contractVersion: COMPILER_AB_CONTRACT_VERSION,
      experimentId: 'report-serial',
      organizationId: 1,
      createdAt: '2026-07-20T00:00:00Z',
      variantMetrics,
      winnerDecision: {
        policyId: 'p1',
        result: 'variant_a_preferred',
        reasonCode: 'QUALITY_SAFETY_LEAD',
        reasonSummary: 'Variant A has better quality and safety',
        groupScores: { quality: { a: 0.9, b: 0.7 } },
        preferredVariantId: 'v1',
      },
      goNoGoDecision: {
        result: 'GO',
        reasonCode: 'ALL_METRICS_PASS',
        reasonSummary: 'All metrics passed thresholds',
        evidenceEligible: true,
        followUpActions: [],
        blockers: [],
        fixItems: [],
      },
      isFixture: false,
      evidenceEligible: true,
      summary: 'Full report',
      evidenceRefs: ['ev-1', 'ev-2'],
    }
    const summary = buildCompilerAbReportSummary(report)
    expect(summary).not.toHaveProperty('prompt')
    expect(summary).not.toHaveProperty('token')
    expect(summary).not.toHaveProperty('secret')
    expect(summary).not.toHaveProperty('apiKey')
    expect(summary.winnerResult).toBe('variant_a_preferred')
    expect(summary.goNoGoResult).toBe('GO')
    expect(summary.compositeScores).toHaveLength(1)
    expect(summary.compositeScores![0]).toEqual({
      variantId: 'v1',
      compositeScore: 0.85,
    })
  })
})
