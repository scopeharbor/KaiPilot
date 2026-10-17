/**
 * V-Gate 决策矩阵单元测试（tasks 7.5）。
 *
 * 覆盖：blocked、awaiting_review、pass、conditional_pass、soft_unavailable warning
 */

import { describe, expect, it } from 'vitest'
import { VGateDecisionService } from '../../../app/services/compiler/validation/v_gate/v_gate_service.js'
import type { V2HardValidationReport, SoftEvaluationReport } from '@aiproj/compiler-spec'
import type { VGateProfile } from '../../../app/services/compiler/validation/types.js'

const service = new VGateDecisionService()
const defaultProfile: VGateProfile = {
  profileId: 'global_sample',
  name: 'Global Sample',
  softDimensionIds: [],
  hardWarningThreshold: 3,
}

// ── Factory ──

function makeHardReport(overrides: Partial<V2HardValidationReport> = {}): V2HardValidationReport {
  return {
    validationId: 'hv-test',
    stageId: 'test',
    rulesetVersion: '1.0',
    summary: {
      totalRules: 25,
      passed: 25,
      blocking: 0,
      warnings: 0,
      infos: 0,
      notApplicable: 0,
      inputMissing: 0,
    },
    issues: [],
    notApplicableRules: [],
    inputSignature: {
      schemaParsed: true,
      graphAvailable: true,
      scheduleAvailable: true,
      criticalPathAvailable: true,
      resourceLoadAvailable: true,
      diffAvailable: true,
      stageMetadataAvailable: true,
    },
    isFullValidation: true,
    skippedRules: [],
    generatedAt: '2026-07-11T00:00:00.000Z',
    ...overrides,
  }
}

function makeSoftReport(overrides: Partial<SoftEvaluationReport> = {}): SoftEvaluationReport {
  return {
    evaluationId: 'se-test',
    profile: {
      profileId: 'global_sample',
      name: '',
      dimensionIds: [],
      weightOverrides: {},
      thresholdOverrides: {},
      budgetTokens: 0,
      budgetCalls: 0,
      maxRetriesPerDimension: 2,
      enabledByDefault: false,
      description: '',
    },
    model: 'deepseek-v4-flash',
    dimensionsEvaluated: [],
    overallScore: 4,
    weightedScore: 4,
    status: 'completed',
    dimensionScores: [],
    confidence: 0.8,
    costAndLatencySummary: {
      totalCalls: 1,
      totalTokens: 500,
      totalLatencyMs: 1000,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      dimensionCount: 1,
      retryCount: 0,
      budgetStatus: 'within_budget',
      budgetLimitTokens: 0,
      budgetLimitCalls: 0,
    },
    generatedAt: '2026-07-11T00:00:00.000Z',
    ...overrides,
  }
}

describe('VGateDecisionService', () => {
  it('Hard blocking → blocked', async () => {
    const hardBlocking = makeHardReport({
      summary: {
        totalRules: 25,
        passed: 24,
        blocking: 1,
        warnings: 0,
        infos: 0,
        notApplicable: 0,
        inputMissing: 0,
      },
      issues: [
        {
          ruleId: 'HV-008',
          severity: 'blocking',
          category: 'structure',
          path: '/dependencies',
          message: '依赖环',
          affectedEntityIds: [],
          autoFixable: false,
          requiresHumanReview: true,
          sourceStageId: 'graph',
          evidence: '',
        },
      ],
    })
    const soft = makeSoftReport()
    const decision = await service.decide(hardBlocking, soft, defaultProfile, 'blueprint_gate')
    expect(decision.status).toBe('blocked')
    expect(decision.blockingReasons).toHaveLength(1)
    expect(decision.allowedNextActions).toContain('fix_blocking_issues')
    expect(decision.requiresHumanReview).toBe(true)
  })

  it('Hard warning 超过阈值 → awaiting_review', async () => {
    const hardWarnings = makeHardReport({
      summary: {
        totalRules: 25,
        passed: 25,
        blocking: 0,
        warnings: 5,
        infos: 0,
        notApplicable: 0,
        inputMissing: 0,
      },
      issues: Array.from({ length: 5 }, (_, i) => ({
        ruleId: `HV-0${i}`,
        severity: 'warning' as const,
        category: 'numeric' as const,
        path: '/test',
        message: `Warning ${i}`,
        affectedEntityIds: [],
        autoFixable: false,
        requiresHumanReview: false,
        sourceStageId: 'test',
        evidence: '',
      })),
    })
    const soft = makeSoftReport()
    const decision = await service.decide(hardWarnings, soft, defaultProfile, 'test')
    expect(decision.status).toBe('awaiting_review')
    expect(decision.requiresHumanReview).toBe(true)
  })

  it('Hard pass + Soft 达标 → pass', async () => {
    const hardPass = makeHardReport()
    const soft = makeSoftReport({ weightedScore: 4, overallScore: 4 })
    const decision = await service.decide(hardPass, soft, defaultProfile, 'test')
    expect(decision.status).toBe('pass')
    expect(decision.requiresHumanReview).toBe(false)
  })

  it('Soft 低分 → conditional_pass（不产生 blocked）', async () => {
    const hardPass = makeHardReport()
    const softLow = makeSoftReport({
      weightedScore: 2,
      overallScore: 2,
      dimensionScores: [
        {
          dimensionId: 'SE-WBS-02',
          score: 2,
          confidence: 0.6,
          rationale: '低分',
          findings: [],
          status: 'evaluated',
          tokensUsed: 0,
          latencyMs: 0,
          retryCount: 0,
        },
      ],
    })
    const decision = await service.decide(hardPass, softLow, defaultProfile, 'test')
    expect(decision.status).toBe('conditional_pass')
    expect(decision.requiresHumanReview).toBe(true)
    expect(decision.attentionAreas.length).toBeGreaterThanOrEqual(1)
  })

  it('Soft unavailable → pass with warning（不产生 blocked）', async () => {
    const hardPass = makeHardReport()
    const decision = await service.decide(hardPass, null, defaultProfile, 'test')
    expect(decision.status).toBe('pass')
    expect(decision.warnings[0]).toContain('Soft evaluation unavailable')
    expect(decision.requiresHumanReview).toBe(false)
  })

  it('Soft unavailable 不单独产生 hard blocked', async () => {
    const hardPass = makeHardReport()
    // Soft 不可用但 Hard 通过 → 不能是 blocked
    const softUnavailable = makeSoftReport({
      status: 'all_unavailable',
      overallScore: undefined,
      weightedScore: undefined,
    })
    const decision = await service.decide(hardPass, softUnavailable, defaultProfile, 'test')
    expect(decision.status).toBe('pass')
    expect(decision.warnings.length).toBeGreaterThanOrEqual(1)
  })
})
