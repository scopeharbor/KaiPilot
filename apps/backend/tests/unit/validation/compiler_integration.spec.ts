/**
 * Compiler Integration 单元测试（tasks 9.3-9.5）。
 *
 * 覆盖：
 * - 9.3: 成功路径：deterministic outputs → Hard → Soft → V-Gate → Ledger evidence
 * - 9.4: blocked 集成：Hard blocking 禁止进入 apply-ready
 * - 9.5: advisory 集成：Soft 低分只进入 conditional_pass
 */

import { describe, expect, it } from 'vitest'
import { ValidationHandler } from '../../../app/services/compiler/validation/compiler_integration.js'
import { InMemoryEvidenceWriter } from '../../../app/services/compiler/validation/interfaces.js'
import type {
  V2HardValidationReport,
  SoftEvaluationReport,
  VGateDecision,
} from '@aiproj/compiler-spec'
import type { ValidationInputContext } from '../../../app/services/compiler/validation/types.js'

// ── Helpers ──

function makeHardSuite(result: Partial<V2HardValidationReport>) {
  return async (_ctx: ValidationInputContext): Promise<V2HardValidationReport> => ({
    validationId: 'hv-int-test',
    stageId: 'blueprint_gate',
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
    ...result,
  })
}

function makeSoftOrchestrator(result: Partial<SoftEvaluationReport>) {
  return async (_ctx: ValidationInputContext): Promise<SoftEvaluationReport> => ({
    evaluationId: 'se-int-test',
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
    ...result,
  })
}

async function makeVGateService(
  hard: V2HardValidationReport,
  soft: SoftEvaluationReport | null,
  _ctx: ValidationInputContext,
): Promise<VGateDecision> {
  const blocked = hard.issues.some((i) => i.severity === 'blocking')
  return {
    decisionId: 'vg-int-test',
    stageId: 'blueprint_gate',
    profileId: 'global_sample',
    status: blocked
      ? 'blocked'
      : soft && (soft.weightedScore ?? 0) < 3
        ? 'conditional_pass'
        : 'pass',
    blockingReasons: blocked
      ? hard.issues.filter((i) => i.severity === 'blocking').map((i) => `${i.ruleId}: ${i.message}`)
      : [],
    warnings: [],
    attentionAreas: [],
    requiresHumanReview: blocked || (soft !== null && (soft.weightedScore ?? 0) < 3),
    allowedNextActions: blocked ? ['fix_blocking_issues'] : ['proceed_to_next_stage'],
    evidenceRefs: [],
    hardSummary: {
      totalBlocking: hard.issues.filter((i) => i.severity === 'blocking').length,
      totalWarnings: hard.issues.filter((i) => i.severity === 'warning').length,
      passed: !blocked,
    },
    softSummary: soft
      ? {
          overallScore: soft.overallScore,
          weightedScore: soft.weightedScore,
          dimensionsEvaluated: soft.dimensionsEvaluated.length,
          status: soft.status,
        }
      : undefined,
    repairSuggestions: [],
    generatedAt: '2026-07-11T00:00:00.000Z',
  }
}

describe('ValidationHandler - 成功路径', () => {
  it('9.3: 完整成功路径：Hard → Soft → V-Gate → Evidence', async () => {
    const writer = new InMemoryEvidenceWriter()
    const handler = new ValidationHandler(writer)
    const ctx: ValidationInputContext = { stageId: 'blueprint_gate' }

    const result = await handler.runFullValidation(
      makeHardSuite({}),
      makeSoftOrchestrator({}),
      makeVGateService,
      ctx,
    )

    expect(result.hardReport).toBeDefined()
    expect(result.softReport).toBeDefined()
    expect(result.vGateDecision.status).toBe('pass')
    expect(result.evidenceIds).toHaveLength(3) // hard + soft + v-gate
    expect(writer.getAll()).toHaveLength(3)
  })
})

describe('ValidationHandler - blocked', () => {
  it('9.4: Hard blocking 禁止进入 apply-ready', async () => {
    const writer = new InMemoryEvidenceWriter()
    const handler = new ValidationHandler(writer)
    const ctx: ValidationInputContext = { stageId: 'blueprint_gate' }

    const hardBlocking = {
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
          severity: 'blocking' as const,
          category: 'structure' as const,
          path: '/deps',
          message: '依赖环',
          affectedEntityIds: [],
          autoFixable: false,
          requiresHumanReview: true,
          sourceStageId: 'graph',
          evidence: '',
        },
      ],
    }

    const result = await handler.runFullValidation(
      makeHardSuite(hardBlocking),
      makeSoftOrchestrator({}),
      makeVGateService,
      ctx,
    )

    expect(result.vGateDecision.status).toBe('blocked')
    expect(result.vGateDecision.allowedNextActions).not.toContain('proceed_to_next_stage')
    expect(result.vGateDecision.allowedNextActions).toContain('fix_blocking_issues')
    expect(result.vGateDecision.requiresHumanReview).toBe(true)
  })
})

describe('ValidationHandler - advisory', () => {
  it('9.5: Soft 低分只进入 conditional_pass，保留人工确认要求', async () => {
    const writer = new InMemoryEvidenceWriter()
    const handler = new ValidationHandler(writer)
    const ctx: ValidationInputContext = { stageId: 'blueprint_gate' }

    const result = await handler.runFullValidation(
      makeHardSuite({}),
      makeSoftOrchestrator({ weightedScore: 2, overallScore: 2 }),
      makeVGateService,
      ctx,
    )

    expect(result.vGateDecision.status).toBe('conditional_pass')
    expect(result.vGateDecision.requiresHumanReview).toBe(true)
    // 确保不产生 blocked
    expect(result.vGateDecision.status).not.toBe('blocked')
  })
})
