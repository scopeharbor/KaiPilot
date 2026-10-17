// @aiproj/types — V3 TRIZ Innovation Workbench 共享契约测试
// §1.4: schema 校验、稳定 hash 可复现、排序稳定性、stale 来源检测、无可执行 patch 字段

import { describe, expect, it } from 'vitest'
import {
  INNOVATION_SCHEME_STATUSES,
  INNOVATION_OPTION_ORIGINS,
  INNOVATION_SOURCE_TYPES,
  IMPACT_DIRECTIONS,
  IMPACT_DIMENSIONS,
  INNOVATION_REVIEW_STATES,
  INNOVATION_HANDOFF_STATUSES,
  INNOVATION_SCHEME_MAX_OPTIONS,
  TRIZ_INNOVATION_WORKBENCH_SOURCE_TYPE,
  computeInnovationOptionHash,
  computeInnovationSchemeHash,
  computeHandoffIdempotencyKey,
  detectStaleSources,
  compareInnovationOptions,
  sortWarningsBySeverity,
  impactDirectionWeight,
  validateInnovationOption,
  validateInnovationScheme,
  validateInnovationHandoffInput,
  validateInnovationNarrative,
  validateInnovationComparison,
  isInnovationSchemeStatus,
  isInnovationOptionOrigin,
} from './triz-innovation-workbench.js'
import type {
  InnovationScheme,
  InnovationOption,
  InnovationScore,
  InnovationImpactSummary,
  InnovationDraftHandoffInput,
  InnovationSchemeComparison,
  TrizAnalysisWarning,
} from './triz-innovation-workbench.js'

function baseImpact(): InnovationImpactSummary {
  return {
    schedule: 'neutral',
    resource_load: 'neutral',
    risk: 'improves',
    scope_flexibility: 'neutral',
    quality_maintainability: 'neutral',
    change_complexity: 'worsens',
  }
}

function baseScore(over: Partial<InnovationScore> = {}): InnovationScore {
  return {
    total: 50,
    severity: 20,
    confidence: 10,
    stalePenalty: 0,
    warningPenalty: 0,
    applicability: 5,
    constraintFit: 5,
    hashCompleteness: 5,
    reviewState: 5,
    ...over,
  }
}

function baseOption(over: Partial<InnovationOption> = {}): InnovationOption {
  return {
    optionId: 'opt-1',
    origin: 'triz_analysis_path',
    sourceRefs: [
      {
        sourceType: 'contradiction',
        ref: 'pc:1:d-abc',
        hash: 'tcd-111',
        severity: 'high',
        stale: false,
        title: '工期与资源负载对立',
      },
    ],
    selectedPathId: 'path-A',
    principleIds: ['segmentation'],
    name: '分段交付',
    description: '将关键路径分段管理',
    applicability: ['关键路径密度高'],
    nonApplicability: ['范围已锁定'],
    hashes: {
      contradictionSignatures: ['tcd-111'],
      analysisContentHashes: [],
      selectedPathId: 'path-A',
    },
    warnings: [],
    impact: baseImpact(),
    reviewState: 'pending',
    createdBy: 1,
    ...over,
  }
}

function baseScheme(over: Partial<InnovationScheme> = {}): InnovationScheme {
  const opt = baseOption()
  return {
    schemeId: 'sch-1',
    organizationId: 1,
    projectId: 10,
    name: '方案一',
    note: null,
    options: [opt],
    scores: { 'opt-1': baseScore() },
    status: 'open',
    reviewState: 'pending',
    handoff: {
      status: 'none',
      draftSessionRef: null,
      handedOffAt: null,
      blockedReason: null,
    },
    narrative: null,
    schemeHash: 'iw-sch-xxx',
    comparisonRef: null,
    schemaVersion: '1.0.0',
    createdBy: 1,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: null,
    reviewedAt: null,
    abandonedAt: null,
    ...over,
  }
}

describe('TRIZ Innovation Workbench — enums & constants', () => {
  it('exports expected scheme statuses', () => {
    expect(INNOVATION_SCHEME_STATUSES).toEqual(['open', 'abandoned', 'handed_off'])
  })
  it('exports expected option origins', () => {
    expect(INNOVATION_OPTION_ORIGINS).toEqual(['triz_analysis_path', 'deterministic_mapping'])
  })
  it('exports expected source types', () => {
    expect(INNOVATION_SOURCE_TYPES).toEqual(['contradiction', 'triz_analysis'])
  })
  it('exports expected impact directions', () => {
    expect(IMPACT_DIRECTIONS).toEqual(['improves', 'worsens', 'neutral', 'uncertain'])
  })
  it('exports six impact dimensions', () => {
    expect(IMPACT_DIMENSIONS).toEqual([
      'schedule',
      'resource_load',
      'risk',
      'scope_flexibility',
      'quality_maintainability',
      'change_complexity',
    ])
  })
  it('exports expected review states & handoff statuses', () => {
    expect(INNOVATION_REVIEW_STATES).toEqual(['pending', 'reviewed', 'needs_changes'])
    expect(INNOVATION_HANDOFF_STATUSES).toEqual([
      'none',
      'candidate_created',
      'stale',
      'handed_off',
    ])
  })
  it('caps scheme basket at 5 options', () => {
    expect(INNOVATION_SCHEME_MAX_OPTIONS).toBe(5)
  })
  it('locks handoff sourceType to triz_innovation_workbench', () => {
    expect(TRIZ_INNOVATION_WORKBENCH_SOURCE_TYPE).toBe('triz_innovation_workbench')
  })
})

describe('TRIZ Innovation Workbench — stable hash reproducibility', () => {
  it('computeInnovationOptionHash is deterministic for identical input', () => {
    const a = baseOption()
    const b = baseOption()
    expect(computeInnovationOptionHash(a)).toBe(computeInnovationOptionHash(b))
  })
  it('computeInnovationOptionHash is order-insensitive across sourceRefs', () => {
    const a = baseOption()
    const b = baseOption({
      sourceRefs: [...a.sourceRefs].reverse(),
    })
    expect(computeInnovationOptionHash(a)).toBe(computeInnovationOptionHash(b))
  })
  it('computeInnovationOptionHash changes when selectedPathId changes', () => {
    const a = baseOption()
    const b = baseOption({ selectedPathId: 'path-B' })
    expect(computeInnovationOptionHash(a)).not.toBe(computeInnovationOptionHash(b))
  })
  it('computeInnovationSchemeHash is deterministic & order-insensitive', () => {
    const h1 = computeInnovationSchemeHash({ optionHashes: ['h1', 'h2'], name: 's' })
    const h2 = computeInnovationSchemeHash({ optionHashes: ['h2', 'h1'], name: 's' })
    expect(h1).toBe(h2)
  })
  it('computeInnovationSchemeHash changes when name changes', () => {
    const h1 = computeInnovationSchemeHash({ optionHashes: ['h1'], name: 's' })
    const h2 = computeInnovationSchemeHash({ optionHashes: ['h1'], name: 't' })
    expect(h1).not.toBe(h2)
  })
  it('computeHandoffIdempotencyKey is order-insensitive across optionIds', () => {
    const k1 = computeHandoffIdempotencyKey({
      schemeId: 'sch-1',
      optionIds: ['o1', 'o2'],
      schemeHash: 'h',
    })
    const k2 = computeHandoffIdempotencyKey({
      schemeId: 'sch-1',
      optionIds: ['o2', 'o1'],
      schemeHash: 'h',
    })
    expect(k1).toBe(k2)
  })
})

describe('TRIZ Innovation Workbench — deterministic sort order', () => {
  it('compareInnovationOptions orders by total score desc', () => {
    const a = { score: baseScore({ total: 80 }), optionId: 'a' }
    const b = { score: baseScore({ total: 50 }), optionId: 'b' }
    expect(compareInnovationOptions(a, b)).toBeLessThan(0)
  })
  it('compareInnovationOptions is stable for identical scores', () => {
    const a = { score: baseScore(), optionId: 'a' }
    const b = { score: baseScore(), optionId: 'b' }
    const out = [a, b].sort(compareInnovationOptions)
    expect(out[0].optionId).toBe('a')
    // Re-sort returns same order
    expect([a, b].sort(compareInnovationOptions)[0].optionId).toBe('a')
  })
  it('sortWarningsBySeverity puts blocking first', () => {
    const warnings: TrizAnalysisWarning[] = [
      { code: 'INFO-ish' as any, severity: 'info', message: 'i' },
      { code: 'NEEDS_HUMAN_REVIEW', severity: 'blocking', message: 'b' },
      { code: 'AI_SUMMARY_FALLBACK', severity: 'warning', message: 'w' },
    ]
    const sorted = sortWarningsBySeverity(warnings)
    expect(sorted[0].severity).toBe('blocking')
    expect(sorted[sorted.length - 1].severity).toBe('info')
  })
  it('impactDirectionWeight scores improves positive, worsens negative', () => {
    expect(impactDirectionWeight('improves')).toBeGreaterThan(impactDirectionWeight('neutral'))
    expect(impactDirectionWeight('worsens')).toBeLessThan(impactDirectionWeight('neutral'))
  })
})

describe('TRIZ Innovation Workbench — stale source detection', () => {
  it('returns stale=false when recorded and current hashes match', () => {
    const result = detectStaleSources({
      recorded: { contradictionSignatures: ['tcd-1'], analysisContentHashes: ['ch-1'] },
      current: { contradictionSignatures: ['tcd-1'], analysisContentHashes: ['ch-1'] },
    })
    expect(result.stale).toBe(false)
  })
  it('returns stale=true when a recorded contradiction signature disappeared', () => {
    const result = detectStaleSources({
      recorded: { contradictionSignatures: ['tcd-1', 'tcd-2'], analysisContentHashes: [] },
      current: { contradictionSignatures: ['tcd-1'], analysisContentHashes: [] },
    })
    expect(result.stale).toBe(true)
    expect(result.mismatched.contradictions).toEqual(['tcd-2'])
  })
  it('returns stale=true when an analysis content hash changed', () => {
    const result = detectStaleSources({
      recorded: { contradictionSignatures: [], analysisContentHashes: ['ch-old'] },
      current: { contradictionSignatures: [], analysisContentHashes: ['ch-new'] },
    })
    expect(result.stale).toBe(true)
    expect(result.mismatched.analyses).toEqual(['ch-old'])
  })
})

describe('TRIZ Innovation Workbench — schema validation', () => {
  it('validates a correct option', () => {
    expect(validateInnovationOption(baseOption())).toEqual([])
  })
  it('rejects option with empty sourceRefs', () => {
    expect(validateInnovationOption(baseOption({ sourceRefs: [] }))).toContain(
      'sourceRefs must not be empty',
    )
  })
  it('rejects option with invalid origin', () => {
    expect(validateInnovationOption(baseOption({ origin: 'bogus' as any }))).toContain(
      'origin is invalid',
    )
  })
  it('validates a correct scheme', () => {
    expect(validateInnovationScheme(baseScheme())).toEqual([])
  })
  it('allows an empty scheme basket before options are added', () => {
    expect(validateInnovationScheme(baseScheme({ options: [] }))).toEqual([])
  })
  it('rejects scheme exceeding max options', () => {
    const opts = Array.from({ length: INNOVATION_SCHEME_MAX_OPTIONS + 1 }, (_, i) =>
      baseOption({ optionId: `opt-${i}` }),
    )
    expect(validateInnovationScheme(baseScheme({ options: opts }))).toContain(
      `options must not exceed ${INNOVATION_SCHEME_MAX_OPTIONS}`,
    )
  })
  it('rejects scheme carrying executable patch fields', () => {
    const s = baseScheme() as unknown as Record<string, unknown>
    s.applyPlan = [{ op: 'replace', path: '/tasks/1' }]
    expect(validateInnovationScheme(s)).toEqual(
      expect.arrayContaining([expect.stringContaining('forbidden executable field')]),
    )
  })
  it('validates a correct handoff input', () => {
    const input: InnovationDraftHandoffInput = {
      sourceType: TRIZ_INNOVATION_WORKBENCH_SOURCE_TYPE,
      schemeId: 'sch-1',
      optionIds: ['opt-1'],
      organizationId: 1,
      projectId: 10,
      actorId: 1,
      contradictionRefs: ['pc:1:d-abc'],
      analysisArtifactRefs: [],
      sourceHashes: {
        contradictionSignatures: ['tcd-1'],
        analysisContentHashes: [],
        schemeHash: 'iw-sch-x',
      },
      warningSummary: { total: 0, blocking: 0, codes: [] },
      idempotencyKey: 'iw-hof-1',
      note: null,
    }
    expect(validateInnovationHandoffInput(input)).toEqual([])
  })
  it('rejects handoff input with wrong sourceType', () => {
    const input = {
      sourceType: 'something_else',
      schemeId: 'sch-1',
      optionIds: ['opt-1'],
      organizationId: 1,
      projectId: 10,
      actorId: 1,
      idempotencyKey: 'k',
    }
    expect(validateInnovationHandoffInput(input)).toContain(
      `sourceType must be ${TRIZ_INNOVATION_WORKBENCH_SOURCE_TYPE}`,
    )
  })
  it('validates narrative & comparison shapes', () => {
    expect(
      validateInnovationNarrative({
        narrative: 'x',
        isFallback: false,
        referencedOptionIds: [],
      }),
    ).toEqual([])
    const comparison: InnovationSchemeComparison = {
      schemeId: 'sch-1',
      schemaVersion: '1.0.0',
      cells: [],
      warnings: [],
      calculatedAt: '2026-07-16T00:00:00.000Z',
      modelCostRecorded: true,
    }
    expect(validateInnovationComparison(comparison)).toEqual([])
  })
  it('rejects comparison with modelCostRecorded !== true', () => {
    expect(
      validateInnovationComparison({
        schemeId: 'sch-1',
        schemaVersion: '1.0.0',
        cells: [],
        warnings: [],
        calculatedAt: '2026-07-16',
        modelCostRecorded: false,
      }),
    ).toContain('modelCostRecorded must be true for deterministic comparison')
  })
  it('type guards narrow correctly', () => {
    expect(isInnovationSchemeStatus('open')).toBe(true)
    expect(isInnovationSchemeStatus('deleted')).toBe(false)
    expect(isInnovationOptionOrigin('triz_analysis_path')).toBe(true)
  })
})
