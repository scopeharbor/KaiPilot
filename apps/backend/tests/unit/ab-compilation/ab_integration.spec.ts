/**
 * Compiler A/B Integration 单元测试（§4.2/4.4/4.6）。
 *
 * §4.2: A/B 不能 add/remove/reorder stages, expose all tools, bypass validator
 * §4.4: A/B winner 不 rewrite routing rules, resume/replay 用原始 routing
 * §4.6: GO/FIX_THEN_GO/NO_GO, evidence eligibility, follow-up action mapping
 */

import { describe, expect, it } from 'vitest'
import { CompilerAbIntegrationValidator } from '#services/compiler/ab-compilation/ab_integration'
import { CompilerAbReportBuilder } from '#services/compiler/ab-compilation/ab_report_builder'
import type { CompilerAbReport, CompilerAbVariant } from '@aiproj/types'
import {
  CODE_GENERATION_STAGE_CATALOG,
  CODE_GENERATION_STAGE_IDS,
  CODE_CANDIDATE_REVIEW_STATUSES,
  buildCodeGenerationStagePlan,
  createDefaultFixtureAbConfig,
  COMPILER_AB_CONTRACT_VERSION,
} from '@aiproj/types'

describe('§4.2 A/B cannot add/remove/reorder stages', () => {
  const validator = new CompilerAbIntegrationValidator()

  it('stage catalog has exactly 34 stages', () => {
    expect(CODE_GENERATION_STAGE_CATALOG.length).toBe(34)
  })

  it('all 34 stage IDs are unique', () => {
    const uniqueIds = new Set(CODE_GENERATION_STAGE_IDS)
    expect(uniqueIds.size).toBe(34)
  })

  it('variant cannot override catalog via feature flags', () => {
    const badVariant: CompilerAbVariant = {
      variantId: 'malicious',
      label: 'Override attempt',
      featureFlags: ['override_catalog', 'add_stage'],
    }
    const result = validator.validateExperimentAgainstCatalog({
      contractVersion: COMPILER_AB_CONTRACT_VERSION,
      experimentId: 'test',
      organizationId: 1,
      actorId: 1,
      objective: 'test',
      sampleSetRef: 's1',
      sampleSetHash: 'h1',
      variants: [badVariant],
      metricProfile: { profileId: 'p1', enabledGroups: ['quality'] },
      winnerPolicy: {
        policyId: 'w1',
        weights: { quality: 1 },
        safetyRegressionForcesNoWinner: true,
      },
      authorization: { mode: 'fixture' },
      createdAt: new Date().toISOString(),
    })
    expect(result.ok).toBe(false)
    expect(result.violations.length).toBeGreaterThan(0)
  })
})

describe('§4.2 A/B cannot expose all tools', () => {
  const validator = new CompilerAbIntegrationValidator()

  it('toolHardeningProfile "expose_all" is rejected', () => {
    const badVariant: CompilerAbVariant = {
      variantId: 'malicious2',
      label: 'Expose all',
      toolHardeningProfile: 'expose_all',
    }
    const result = validator.validateExperimentAgainstCatalog({
      contractVersion: COMPILER_AB_CONTRACT_VERSION,
      experimentId: 'test',
      organizationId: 1,
      actorId: 1,
      objective: 'test',
      sampleSetRef: 's1',
      sampleSetHash: 'h1',
      variants: [{ variantId: 'v1', label: 'Clean' }, badVariant],
      metricProfile: { profileId: 'p1', enabledGroups: ['quality'] },
      winnerPolicy: {
        policyId: 'w1',
        weights: { quality: 1 },
        safetyRegressionForcesNoWinner: true,
      },
      authorization: { mode: 'fixture' },
      createdAt: new Date().toISOString(),
    })
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.includes('expose_all'))).toBe(true)
  })

  it('normal variant passes catalog validation', () => {
    const normalVariant: CompilerAbVariant = {
      variantId: 'normal',
      label: 'Normal variant',
      catalogVersion: '1.0',
      toolHardeningProfile: 'strict-v1',
    }
    const result = validator.validateExperimentAgainstCatalog({
      contractVersion: COMPILER_AB_CONTRACT_VERSION,
      experimentId: 'test',
      organizationId: 1,
      actorId: 1,
      objective: 'test',
      sampleSetRef: 's1',
      sampleSetHash: 'h1',
      variants: [{ variantId: 'v1', label: 'A' }, normalVariant],
      metricProfile: { profileId: 'p1', enabledGroups: ['quality'] },
      winnerPolicy: {
        policyId: 'w1',
        weights: { quality: 1 },
        safetyRegressionForcesNoWinner: true,
      },
      authorization: { mode: 'fixture' },
      createdAt: new Date().toISOString(),
    })
    expect(result.ok).toBe(true)
  })
})

describe('§4.2 A/B cannot bypass candidate validator', () => {
  it('candidate bundles always require human review', () => {
    // Validate that all catalog stages require human review
    for (const stageDef of CODE_GENERATION_STAGE_CATALOG) {
      expect(stageDef.defaultReviewRequired).toBe(true)
    }
  })

  it('review statuses do not include auto-approved', () => {
    expect(CODE_CANDIDATE_REVIEW_STATUSES).not.toContain('auto_approved')
    expect(CODE_CANDIDATE_REVIEW_STATUSES).not.toContain('automatically_approved')
  })

  it('human review packet is required before handoff', () => {
    const result = buildCodeGenerationStagePlan()
    expect(result.length).toBe(34)
    for (const stage of result) {
      expect(stage.requiresHumanReview).toBe(true)
    }
  })
})

describe('§4.4 A/B winner does not rewrite routing rules', () => {
  const validator = new CompilerAbIntegrationValidator()

  it('winner decision summary does not contain routing mutation keywords', () => {
    const report = {
      contractVersion: COMPILER_AB_CONTRACT_VERSION,
      experimentId: 'test',
      organizationId: 1,
      createdAt: new Date().toISOString(),
      variantMetrics: [
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
          latency: { totalDurationMs: 200, perStageDurationMs: {}, latencyBuckets: {} },
          stability: { stageFailureCount: 0, totalRetryCount: 0 },
          compositeScore: 0.9,
        },
        {
          variantId: 'v2',
          quality: {
            schemaValidRate: 0.85,
            candidateBundleSafetyPassRate: 0.95,
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
          latency: { totalDurationMs: 200, perStageDurationMs: {}, latencyBuckets: {} },
          stability: { stageFailureCount: 0, totalRetryCount: 0 },
          compositeScore: 0.85,
        },
      ],
      winnerDecision: {
        policyId: 'p1',
        result: 'variant_a_preferred',
        reasonCode: 'QUALITY_LEAD',
        reasonSummary: 'Variant A has better quality',
        groupScores: {},
        preferredVariantId: 'v1',
      },
      goNoGoDecision: {
        result: 'GO',
        reasonCode: 'ALL_METRICS_PASS',
        reasonSummary: 'All metrics passed',
        evidenceEligible: true,
        followUpActions: [],
        blockers: [],
        fixItems: [],
      },
      isFixture: false,
      evidenceEligible: true,
      summary: 'Variant A preferred due to quality improvements',
      evidenceRefs: [],
    } as CompilerAbReport

    const result = validator.validateWinnerDoesNotRewriteRouting(report)
    expect(result.ok).toBe(true)
  })

  it('summary with rewrite keyword is flagged', () => {
    const result = validator.validateWinnerDoesNotRewriteRouting({
      contractVersion: COMPILER_AB_CONTRACT_VERSION,
      experimentId: 'test',
      organizationId: 1,
      createdAt: '',
      variantMetrics: [],
      winnerDecision: {
        policyId: 'p1',
        result: 'variant_a_preferred',
        reasonCode: 'QUALITY',
        reasonSummary: 'A is better',
        groupScores: {},
        preferredVariantId: 'v1',
      },
      goNoGoDecision: {
        result: 'GO',
        reasonCode: 'PASS',
        reasonSummary: 'All passed',
        evidenceEligible: true,
        followUpActions: [],
        blockers: [],
        fixItems: [],
      },
      isFixture: false,
      evidenceEligible: true,
      summary: 'Recommendation: rewrite routing rules to use variant A',
      evidenceRefs: [],
    })
    expect(result.ok).toBe(false)
  })
})

describe('§4.4 Resume/replay uses original routing decision', () => {
  const validator = new CompilerAbIntegrationValidator()

  it('resume with same routing ref passes', () => {
    const result = validator.validateResumeUsesOriginalRouting(
      'route-original-001',
      'route-original-001',
    )
    expect(result.ok).toBe(true)
  })

  it('resume with A/B winner routing ref is flagged', () => {
    const result = validator.validateResumeUsesOriginalRouting(
      'route-original-001',
      'route-ab-winner-002',
    )
    expect(result.ok).toBe(false)
  })
})

describe('§4.6 GO/FIX_THEN_GO/NO_GO and evidence eligibility', () => {
  const validator = new CompilerAbIntegrationValidator()

  it('fixture report must have evidenceEligible=false', () => {
    const fixtureReport: CompilerAbReport = {
      contractVersion: COMPILER_AB_CONTRACT_VERSION,
      experimentId: 'test',
      organizationId: 1,
      createdAt: '',
      variantMetrics: [],
      winnerDecision: {
        policyId: 'p1',
        result: 'no_winner',
        reasonCode: 'FIXTURE',
        reasonSummary: 'Fixture mode',
        groupScores: {},
      },
      goNoGoDecision: {
        result: 'FIX_THEN_GO',
        reasonCode: 'FIXTURE_ONLY',
        reasonSummary: 'Fixture only',
        evidenceEligible: false,
        followUpActions: ['Run real model'],
        blockers: [],
        fixItems: [],
      },
      isFixture: true,
      evidenceEligible: false,
      summary: 'Fixture run',
      evidenceRefs: [],
    }
    const result = validator.validateEvidenceEligibility(fixtureReport)
    expect(result.ok).toBe(true)
  })

  it('fixture report with evidenceEligible=true is rejected', () => {
    const badReport: CompilerAbReport = {
      contractVersion: COMPILER_AB_CONTRACT_VERSION,
      experimentId: 'test',
      organizationId: 1,
      createdAt: '',
      variantMetrics: [],
      winnerDecision: {
        policyId: 'p1',
        result: 'no_winner',
        reasonCode: 'FIXTURE',
        reasonSummary: 'Fixture mode',
        groupScores: {},
      },
      goNoGoDecision: {
        result: 'GO',
        reasonCode: 'ALL_PASS',
        reasonSummary: 'All passed',
        evidenceEligible: true,
        followUpActions: [],
        blockers: [],
        fixItems: [],
      },
      isFixture: true,
      evidenceEligible: true,
      summary: 'Bad fixture report',
      evidenceRefs: [],
    }
    const result = validator.validateEvidenceEligibility(badReport)
    expect(result.ok).toBe(false)
  })

  it('safety blocker produces NO_GO with follow-up', () => {
    const builder = new CompilerAbReportBuilder()
    const config = createDefaultFixtureAbConfig('test-nogo', 1, 1)
    const results = [
      {
        entryId: 'va:s1',
        variantId: 'variant_a',
        sampleId: 's1',
        metrics: {
          variantId: 'variant_a',
          quality: {
            schemaValidRate: 0.95,
            candidateBundleSafetyPassRate: 1,
            hallucinationViolationCount: 0,
            ruleViolationCount: 0,
          },
          safety: {
            ruleViolationCount: 1,
            noReviewWritebackRisk: true,
            secretExposureDetected: true,
          },
          cost: {
            estimatedTokenCount: 1000,
            estimatedCostUsd: 0,
            realModelCallCount: 0,
            currency: 'USD',
          },
          latency: { totalDurationMs: 200, perStageDurationMs: {}, latencyBuckets: {} },
          stability: { stageFailureCount: 0, totalRetryCount: 0 },
          compositeScore: 0.5,
        },
        fixtureEvidence: [],
        errors: [],
      },
      {
        entryId: 'vb:s1',
        variantId: 'variant_b',
        sampleId: 's1',
        metrics: {
          variantId: 'variant_b',
          quality: {
            schemaValidRate: 0.9,
            candidateBundleSafetyPassRate: 0.95,
            hallucinationViolationCount: 0,
            ruleViolationCount: 0,
          },
          safety: {
            ruleViolationCount: 0,
            noReviewWritebackRisk: false,
            secretExposureDetected: true,
          },
          cost: {
            estimatedTokenCount: 1000,
            estimatedCostUsd: 0,
            realModelCallCount: 0,
            currency: 'USD',
          },
          latency: { totalDurationMs: 200, perStageDurationMs: {}, latencyBuckets: {} },
          stability: { stageFailureCount: 0, totalRetryCount: 0 },
          compositeScore: 0.6,
        },
        fixtureEvidence: [],
        errors: [],
      },
    ]
    const report = builder.build(config, results)
    expect(report.goNoGoDecision.result).toBe('NO_GO')
    expect(report.goNoGoDecision.blockers.length).toBeGreaterThan(0)
    expect(report.goNoGoDecision.followUpActions.length).toBeGreaterThan(0)
  })

  it('inconclusive quality produces FIX_THEN_GO', () => {
    const builder = new CompilerAbReportBuilder()
    const config = createDefaultFixtureAbConfig('test-fixthengo', 1, 1)
    const results = [
      {
        entryId: 'va:s1',
        variantId: 'variant_a',
        sampleId: 's1',
        metrics: {
          variantId: 'variant_a',
          quality: {
            schemaValidRate: 0.7,
            candidateBundleSafetyPassRate: 0.8,
            hallucinationViolationCount: 2,
            ruleViolationCount: 1,
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
          latency: { totalDurationMs: 200, perStageDurationMs: {}, latencyBuckets: {} },
          stability: { stageFailureCount: 1, totalRetryCount: 2 },
          compositeScore: 0.6,
        },
        fixtureEvidence: [],
        errors: [],
      },
      {
        entryId: 'vb:s1',
        variantId: 'variant_b',
        sampleId: 's1',
        metrics: {
          variantId: 'variant_b',
          quality: {
            schemaValidRate: 0.75,
            candidateBundleSafetyPassRate: 0.85,
            hallucinationViolationCount: 1,
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
          latency: { totalDurationMs: 200, perStageDurationMs: {}, latencyBuckets: {} },
          stability: { stageFailureCount: 0, totalRetryCount: 1 },
          compositeScore: 0.65,
        },
        fixtureEvidence: [],
        errors: [],
      },
    ]
    const report = builder.build(config, results)
    expect(report.goNoGoDecision.result).toBe('FIX_THEN_GO')
    expect(report.goNoGoDecision.fixItems.length).toBeGreaterThan(0)
  })
})
