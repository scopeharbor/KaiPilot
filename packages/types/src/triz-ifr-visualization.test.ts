/**
 * v3-triz-ifr-visualization —— 共享契约确定性测试。
 *
 * 覆盖 scoring determinism, missing data confidence, warning aggregation,
 * source hash stability, stale detection, redaction, handoff validation,
 * stage ordering, 以及 large-stage-set / long-text fixtures。
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeIdealityInput,
  computeIdealityScore,
  computeIdealityConfidence,
  computeIfrOutputHash,
  computeIfrTrendSummary,
  computeIfrStageHash,
  computeIfrSourceHash,
  isIfrSourceStale,
  detectIfrStaleStages,
  rankIfrStages,
  aggregateIfrWarnings,
  validateIfrHandoffInput,
  computeIfrHandoffIdempotencyKey,
  buildIfrLowSensitivityAuditMeta,
  simpleHash,
  redactIfrSourceRef,
  IFR_SCORE_VERSION,
  IFR_SCHEMA_VERSION,
  DEFAULT_IDEALITY_WEIGHTS,
  type IfrStage,
  type IfrSourceRef,
  type IdealityMeasureInput,
  type IdealityScoreOutput,
  type IfrHandoffInput,
} from './triz-ifr-visualization.js'

// ─── Fixtures ───────────────────────────────────────────────────

const baseSourceRefs: IfrSourceRef[] = [
  {
    kind: 'contradiction',
    refId: 'tc-001',
    title: '速度 vs 精度',
    hash: simpleHash('tc-001:v1'),
    stale: false,
    staleReason: null,
    navigationRef: '/projects/1/contradictions/tc-001',
    kindVersion: 'v2',
  },
  {
    kind: 'analysis_artifact',
    refId: 'ana-001',
    title: 'Compiler TRIZ 分析',
    hash: simpleHash('ana-001:v1'),
    stale: false,
    staleReason: null,
    navigationRef: '/projects/1/compiler/triz-analysis/ana-001',
    kindVersion: 'v1',
  },
]

function buildStage(overrides: Partial<IfrStage> = {}): IfrStage {
  return {
    stageId: 'stage-1',
    kind: 'current',
    label: '当前状态',
    description: '当前系统表现为中等速度但高能耗。',
    expectedUsefulFunctionChange: '+0%',
    expectedCostChange: '-20%',
    expectedHarmChange: '-15%',
    relatedPrincipleRefs: ['1', '15'],
    relatedContradictionRefs: ['tc-001'],
    warningCodes: [],
    reviewState: 'pending',
    stageHash: computeIfrStageHash({
      kind: 'current',
      label: '当前状态',
      description: '当前系统表现为中等速度但高能耗。',
    }),
    stale: false,
    ...overrides,
  }
}

function buildStages(): IfrStage[] {
  return [
    buildStage(),
    buildStage({
      stageId: 'stage-2',
      kind: 'intermediate',
      label: '中间阶段 1',
      description: '引入分离原理优化能耗。',
      expectedUsefulFunctionChange: '+15%',
      expectedCostChange: '-30%',
      expectedHarmChange: '-25%',
    }),
    buildStage({
      stageId: 'stage-3',
      kind: 'target',
      label: '目标 IFR',
      description: '零能耗高速系统。',
      expectedUsefulFunctionChange: '+50%',
      expectedCostChange: '-100%',
      expectedHarmChange: '-100%',
    }),
  ]
}

// ─── normalizeIdealityInput ──────────────────────────────────────

describe('normalizeIdealityInput', () => {
  it('clamps values to [0, 1]', () => {
    const result = normalizeIdealityInput({ usefulFunction: 1.5, cost: -0.2, harm: 0.8 })
    expect(result.usefulFunction).toBe(1.0)
    expect(result.cost).toBe(0.0)
    expect(result.harm).toBe(0.8)
  })

  it('fills missing values with 0', () => {
    const result = normalizeIdealityInput({})
    expect(result.usefulFunction).toBe(0)
    expect(result.cost).toBe(0)
    expect(result.harm).toBe(0)
  })

  it('preserves valid input', () => {
    const result = normalizeIdealityInput({ usefulFunction: 0.5, cost: 0.3, harm: 0.1 })
    expect(result).toEqual({ usefulFunction: 0.5, cost: 0.3, harm: 0.1 })
  })
})

// ─── computeIdealityScore ────────────────────────────────────────

describe('computeIdealityScore', () => {
  it('returns deterministic score for same input', () => {
    const input: IdealityMeasureInput = { usefulFunction: 0.8, cost: 0.2, harm: 0.1 }
    const r1 = computeIdealityScore(input)
    const r2 = computeIdealityScore(input)
    expect(r1).toEqual(r2)
  })

  it('calculates correct aggregate with default weights', () => {
    // uf=0.8*0.5=0.4, cost=(1-0.2)*0.25=0.2, harm=(1-0.1)*0.25=0.225 → 0.825
    const result = computeIdealityScore({ usefulFunction: 0.8, cost: 0.2, harm: 0.1 })
    expect(result.aggregateScore).toBeCloseTo(0.825, 5)
    expect(result.dimensions).toHaveLength(3)
    expect(result.formulaVersion).toBe(IFR_SCORE_VERSION)
  })

  it('handles missing cost data', () => {
    const result = computeIdealityScore({ usefulFunction: 0.8, cost: 0, harm: 0.1 })
    expect(result.missingDataWarnings).toContain('MISSING_COST_DATA')
    expect(result.confidence).toBeLessThan(1)
  })

  it('handles missing harm data', () => {
    const result = computeIdealityScore({ usefulFunction: 0.8, cost: 0.2, harm: 0 })
    expect(result.missingDataWarnings).toContain('MISSING_HARM_DATA')
  })

  it('handles missing useful function data', () => {
    const result = computeIdealityScore({ usefulFunction: 0, cost: 0.2, harm: 0.1 })
    expect(result.missingDataWarnings).toContain('MISSING_USEFUL_FUNCTION_DATA')
  })

  it('includes source refs in output hash', () => {
    const r1 = computeIdealityScore(
      { usefulFunction: 0.5, cost: 0.3, harm: 0.2 },
      DEFAULT_IDEALITY_WEIGHTS,
      baseSourceRefs,
    )
    const r2 = computeIdealityScore(
      { usefulFunction: 0.5, cost: 0.3, harm: 0.2 },
      DEFAULT_IDEALITY_WEIGHTS,
      [],
    )
    expect(r1.outputHash).not.toBe(r2.outputHash)
  })

  it('produces stable hash with same inputs', () => {
    const r1 = computeIdealityScore(
      { usefulFunction: 0.5, cost: 0.3, harm: 0.2 },
      DEFAULT_IDEALITY_WEIGHTS,
      baseSourceRefs,
    )
    const r2 = computeIdealityScore(
      { usefulFunction: 0.5, cost: 0.3, harm: 0.2 },
      DEFAULT_IDEALITY_WEIGHTS,
      baseSourceRefs,
    )
    expect(r1.outputHash).toBe(r2.outputHash)
  })
})

// ─── computeIdealityConfidence ────────────────────────────────────

describe('computeIdealityConfidence', () => {
  it('returns base confidence when no warnings', () => {
    const dims = [
      {
        name: 'useful_function' as const,
        raw: 0.8,
        normalized: 0.8,
        weight: 0.5,
        weightedScore: 0.4,
        hasData: true,
      },
      {
        name: 'cost' as const,
        raw: 0.2,
        normalized: 0.2,
        weight: 0.25,
        weightedScore: 0.2,
        hasData: true,
      },
      {
        name: 'harm' as const,
        raw: 0.1,
        normalized: 0.1,
        weight: 0.25,
        weightedScore: 0.225,
        hasData: true,
      },
    ]
    expect(computeIdealityConfidence([], dims)).toBeCloseTo(0.95, 5)
  })

  it('reduces confidence for each missing dimension', () => {
    const dims = [
      {
        name: 'useful_function' as const,
        raw: 0.8,
        normalized: 0.8,
        weight: 0.5,
        weightedScore: 0.4,
        hasData: false,
      },
      {
        name: 'cost' as const,
        raw: 0.2,
        normalized: 0.2,
        weight: 0.25,
        weightedScore: 0.2,
        hasData: false,
      },
      {
        name: 'harm' as const,
        raw: 0.1,
        normalized: 0.1,
        weight: 0.25,
        weightedScore: 0.225,
        hasData: false,
      },
    ]
    expect(
      computeIdealityConfidence(
        ['MISSING_USEFUL_FUNCTION_DATA', 'MISSING_COST_DATA', 'MISSING_HARM_DATA'],
        dims,
      ),
    ).toBeCloseTo(0.2, 5)
  })

  it('has minimum floor of 0.2', () => {
    expect(
      computeIdealityConfidence(
        ['MISSING_USEFUL_FUNCTION_DATA', 'MISSING_COST_DATA', 'MISSING_HARM_DATA', 'STALE_SOURCE'],
        [],
      ),
    ).toBe(0.2)
  })
})

// ─── computeIfrOutputHash ────────────────────────────────────────

describe('computeIfrOutputHash', () => {
  it('produces different hash for different scores', () => {
    const h1 = computeIfrOutputHash({
      aggregateScore: 0.825,
      dimensions: [],
      missingDataWarnings: [],
      sourceRefs: baseSourceRefs,
    })
    const h2 = computeIfrOutputHash({
      aggregateScore: 0.826,
      dimensions: [],
      missingDataWarnings: [],
      sourceRefs: baseSourceRefs,
    })
    expect(h1).not.toBe(h2)
  })

  it('produces different hash for different source refs', () => {
    const h1 = computeIfrOutputHash({
      aggregateScore: 0.5,
      dimensions: [],
      missingDataWarnings: [],
      sourceRefs: baseSourceRefs,
    })
    const h2 = computeIfrOutputHash({
      aggregateScore: 0.5,
      dimensions: [],
      missingDataWarnings: [],
      sourceRefs: [],
    })
    expect(h1).not.toBe(h2)
  })
})

// ─── computeIfrTrendSummary ──────────────────────────────────────

describe('computeIfrTrendSummary', () => {
  const current: IdealityScoreOutput = {
    formulaVersion: 1,
    dimensions: [
      {
        name: 'useful_function',
        raw: 0.8,
        normalized: 0.8,
        weight: 0.5,
        weightedScore: 0.4,
        hasData: true,
      },
      { name: 'cost', raw: 0.2, normalized: 0.2, weight: 0.25, weightedScore: 0.2, hasData: true },
      {
        name: 'harm',
        raw: 0.1,
        normalized: 0.1,
        weight: 0.25,
        weightedScore: 0.225,
        hasData: true,
      },
    ],
    aggregateScore: 0.825,
    confidence: 0.95,
    missingDataWarnings: [],
    sourceRefs: [],
    outputHash: 'test-hash',
  }

  it('returns unknown trends when no previous score', () => {
    const result = computeIfrTrendSummary(current, null)
    expect(result.usefulFunctionTrend).toBe('unknown')
    expect(result.costTrend).toBe('unknown')
    expect(result.harmTrend).toBe('unknown')
    expect(result.overallDirection).toBe('needs_review')
    expect(result.summaryText).toBe('尚无历史数据可比较趋势。请保存首个 IFR 审查以建立基线。')
    expect(result.trendHash).toBeDefined()
  })

  it('detects improving trends', () => {
    const previous: IdealityScoreOutput = {
      ...current,
      dimensions: [
        {
          name: 'useful_function',
          raw: 0.7,
          normalized: 0.7,
          weight: 0.5,
          weightedScore: 0.35,
          hasData: true,
        },
        {
          name: 'cost',
          raw: 0.3,
          normalized: 0.3,
          weight: 0.25,
          weightedScore: 0.175,
          hasData: true,
        },
        {
          name: 'harm',
          raw: 0.2,
          normalized: 0.2,
          weight: 0.25,
          weightedScore: 0.2,
          hasData: true,
        },
      ],
      aggregateScore: 0.725,
      confidence: 0.9,
      missingDataWarnings: [],
      sourceRefs: [],
      outputHash: 'prev-hash',
    }
    const result = computeIfrTrendSummary(current, previous)
    expect(result.usefulFunctionTrend).toBe('improving')
    expect(result.costTrend).toBe('decreasing')
    expect(result.harmTrend).toBe('decreasing')
    expect(result.overallDirection).toBe('toward_ideal')
  })

  it('detects declining trends', () => {
    const previous: IdealityScoreOutput = {
      ...current,
      dimensions: [
        {
          name: 'useful_function',
          raw: 0.85,
          normalized: 0.85,
          weight: 0.5,
          weightedScore: 0.425,
          hasData: true,
        },
        {
          name: 'cost',
          raw: 0.15,
          normalized: 0.15,
          weight: 0.25,
          weightedScore: 0.2125,
          hasData: true,
        },
        {
          name: 'harm',
          raw: 0.05,
          normalized: 0.05,
          weight: 0.25,
          weightedScore: 0.2375,
          hasData: true,
        },
      ],
      aggregateScore: 0.875,
      confidence: 0.92,
      missingDataWarnings: [],
      sourceRefs: [],
      outputHash: 'prev-hash',
    }
    const result = computeIfrTrendSummary(current, previous)
    expect(result.usefulFunctionTrend).toBe('declining')
    expect(result.costTrend).toBe('increasing')
    expect(result.harmTrend).toBe('increasing')
    expect(result.overallDirection).toBe('away_from_ideal')
  })
})

// ─── computeIfrStageHash ──────────────────────────────────────────

describe('computeIfrStageHash', () => {
  it('produces stable hash for same input', () => {
    const h1 = computeIfrStageHash({ kind: 'current', label: '当前状态', description: 'test' })
    const h2 = computeIfrStageHash({ kind: 'current', label: '当前状态', description: 'test' })
    expect(h1).toBe(h2)
  })

  it('produces different hash for different label', () => {
    const h1 = computeIfrStageHash({ kind: 'current', label: '当前状态', description: 'test' })
    const h2 = computeIfrStageHash({ kind: 'current', label: '不同标签', description: 'test' })
    expect(h1).not.toBe(h2)
  })
})

// ─── computeIfrSourceHash ────────────────────────────────────────

describe('computeIfrSourceHash', () => {
  it('produces stable hash for sorted sources', () => {
    const h1 = computeIfrSourceHash([
      { kind: 'contradiction', refId: 'tc-001', hash: 'a1b2' },
      { kind: 'decision_log', refId: 'dl-001', hash: 'c3d4' },
    ])
    const h2 = computeIfrSourceHash([
      { kind: 'decision_log', refId: 'dl-001', hash: 'c3d4' },
      { kind: 'contradiction', refId: 'tc-001', hash: 'a1b2' },
    ])
    expect(h1).toBe(h2)
  })
})

// ─── isIfrSourceStale ────────────────────────────────────────────

describe('isIfrSourceStale', () => {
  it('returns true when hashes differ', () => {
    expect(isIfrSourceStale('abc123', 'def456')).toBe(true)
  })

  it('returns false when hashes match', () => {
    expect(isIfrSourceStale('abc123', 'abc123')).toBe(false)
  })
})

// ─── detectIfrStaleStages ────────────────────────────────────────

describe('detectIfrStaleStages', () => {
  it('detects stages with mismatched hashes', () => {
    const stages = buildStages()
    const currentHashes = new Map<string, string>([['tc-001', 'new-hash']])
    const storedHashes = new Map<string, string>([['tc-001', 'old-hash']])
    const result = detectIfrStaleStages(stages, currentHashes, storedHashes)
    expect(result).toEqual(['stage-1', 'stage-2', 'stage-3'])
  })

  it('returns empty when hashes match', () => {
    const stages = buildStages()
    const hashes = new Map<string, string>([['tc-001', 'same-hash']])
    const result = detectIfrStaleStages(stages, hashes, hashes)
    expect(result).toEqual([])
  })
})

// ─── rankIfrStages ───────────────────────────────────────────────

describe('rankIfrStages', () => {
  it('orders current → intermediate → target', () => {
    const stages = buildStages()
    const ranked = rankIfrStages(stages)
    expect(ranked[0].kind).toBe('current')
    expect(ranked[1].kind).toBe('intermediate')
    expect(ranked[2].kind).toBe('target')
  })

  it('sorts intermediate by principle count and label', () => {
    const stages: IfrStage[] = [
      buildStage({ stageId: 's3', kind: 'intermediate', label: 'C', relatedPrincipleRefs: ['1'] }),
      buildStage({
        stageId: 's1',
        kind: 'intermediate',
        label: 'A',
        relatedPrincipleRefs: ['1', '2', '3'],
      }),
      buildStage({
        stageId: 's2',
        kind: 'intermediate',
        label: 'B',
        relatedPrincipleRefs: ['1', '2'],
      }),
    ]
    const ranked = rankIfrStages(stages)
    expect(ranked[0].stageId).toBe('s1')
    expect(ranked[1].stageId).toBe('s2')
    expect(ranked[2].stageId).toBe('s3')
  })
})

// ─── aggregateIfrWarnings ────────────────────────────────────────

describe('aggregateIfrWarnings', () => {
  it('collects warnings from stages, source refs, and score', () => {
    const stages = buildStages()
    stages[0].warningCodes = ['STALE_SOURCE']
    const staleRefs: IfrSourceRef[] = [
      ...baseSourceRefs,
      {
        kind: 'workbench_scheme',
        refId: 'ws-1',
        title: 'Scheme 1',
        hash: 'h1',
        stale: true,
        staleReason: null,
        navigationRef: null,
        kindVersion: 'v1',
      },
    ]
    const score: IdealityScoreOutput = {
      formulaVersion: 1,
      dimensions: [],
      aggregateScore: 0.5,
      confidence: 0.8,
      missingDataWarnings: ['MISSING_COST_DATA'],
      sourceRefs: [],
      outputHash: 'h',
    }
    const result = aggregateIfrWarnings(stages, staleRefs, score)
    expect(result).toContain('STALE_SOURCE')
    expect(result).toContain('MISSING_COST_DATA')
  })

  it('detects large stage sets', () => {
    const manyStages = Array.from({ length: 11 }, (_, i) =>
      buildStage({ stageId: `stage-${i}`, kind: 'intermediate', label: `Stage ${i}` }),
    )
    const result = aggregateIfrWarnings(manyStages, baseSourceRefs, {
      formulaVersion: 1,
      dimensions: [],
      aggregateScore: 0.5,
      confidence: 0.8,
      missingDataWarnings: [],
      sourceRefs: [],
      outputHash: 'h',
    })
    expect(result).toContain('LARGE_STAGE_SET')
  })
})

// ─── validateIfrHandoffInput ─────────────────────────────────────

describe('validateIfrHandoffInput', () => {
  const baseInput: IfrHandoffInput = {
    ifrId: 'ifr-001',
    projectId: 1,
    organizationId: 1,
    target: 'innovation_workbench',
    stageRefs: ['stage-1'],
    suggestionRefs: ['sug-1'],
    principleRefs: ['1'],
    sourceRefs: baseSourceRefs,
    sourceHash: 'abc123',
    outputHash: 'def456',
    warningSummary: [],
    actorId: 1,
    idempotencyKey: 'key-1',
    requiresUserConfirmation: true,
  }

  it('rejects when confirmation is missing', () => {
    const result = validateIfrHandoffInput(
      { ...baseInput, requiresUserConfirmation: false },
      'abc123',
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('handoff 必须包含显式用户确认')
  })

  it('rejects invalid target', () => {
    const result = validateIfrHandoffInput({ ...baseInput, target: 'invalid' as any }, 'abc123')
    expect(result.valid).toBe(false)
  })

  it('rejects when no stage or suggestion refs', () => {
    const result = validateIfrHandoffInput(
      { ...baseInput, stageRefs: [], suggestionRefs: [] },
      'abc123',
    )
    expect(result.valid).toBe(false)
  })

  it('rejects when source hash is stale', () => {
    const result = validateIfrHandoffInput(baseInput, 'different-hash')
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('来源 hash 已过期（stale），请在 handoff 前刷新 IFR')
  })

  it('accepts valid input', () => {
    const result = validateIfrHandoffInput(baseInput, 'abc123')
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })
})

// ─── computeIfrHandoffIdempotencyKey ─────────────────────────────

describe('computeIfrHandoffIdempotencyKey', () => {
  it('produces stable key', () => {
    const k1 = computeIfrHandoffIdempotencyKey('ifr-001', 'innovation_workbench', [
      'stage-1',
      'stage-2',
    ])
    const k2 = computeIfrHandoffIdempotencyKey('ifr-001', 'innovation_workbench', [
      'stage-2',
      'stage-1',
    ])
    expect(k1).toBe(k2)
  })

  it('produces different key for different target', () => {
    const k1 = computeIfrHandoffIdempotencyKey('ifr-001', 'innovation_workbench', ['stage-1'])
    const k2 = computeIfrHandoffIdempotencyKey('ifr-001', 'decision_log', ['stage-1'])
    expect(k1).not.toBe(k2)
  })
})

// ─── buildIfrLowSensitivityAuditMeta ─────────────────────────────

describe('buildIfrLowSensitivityAuditMeta', () => {
  it('includes required fields and excludes sensitive data', () => {
    const meta = buildIfrLowSensitivityAuditMeta({
      actorId: 1,
      organizationId: 2,
      projectId: 3,
      ifrId: 'ifr-001',
      stageRefs: ['s1'],
      sourceKinds: ['contradiction'],
      sourceHashPrefix: 'abcdef123456',
      warningCount: 2,
      outputHash: '9876543210ab',
      idempotencyKey: 'key-abc',
    })
    expect(meta.actor).toBe(1)
    expect(meta.org).toBe(2)
    expect(meta.project).toBe(3)
    expect(meta.ifr).toBe('ifr-001')
    expect(meta.sourceKinds).toEqual(['contradiction'])
    expect(meta.sourceHashPrefix).toBe('abcdef12')
    expect(meta.warningCount).toBe(2)
    expect(meta.outputHash).toBe('98765432')
    expect(meta.idempotencyKey).toBe('key-abc')
    expect(meta.ts).toBeDefined()
    // 不包含敏感字段
    expect(meta).not.toHaveProperty('fullPrompt')
    expect(meta).not.toHaveProperty('modelOutput')
    expect(meta).not.toHaveProperty('evidence')
    expect(meta).not.toHaveProperty('token')
    expect(meta).not.toHaveProperty('secret')
  })
})

// ─── redactIfrSourceRef ──────────────────────────────────────────

describe('redactIfrSourceRef', () => {
  it('hides sensitive fields', () => {
    const ref: IfrSourceRef = {
      kind: 'contradiction',
      refId: 'tc-001',
      title: '速度 vs 精度',
      hash: 'abc123',
      stale: true,
      staleReason: '源已变更',
      navigationRef: '/projects/1/contradictions/tc-001',
      kindVersion: 'v2',
    }
    const redacted = redactIfrSourceRef(ref)
    expect(redacted.title).toBe('[已隐藏]')
    expect(redacted.navigationRef).toBeNull()
    expect(redacted.hash).toBe('')
    expect(redacted.stale).toBe(false)
    expect(redacted.staleReason).toBeNull()
    expect(redacted.kindVersion).toBe('')
  })
})

// ─── Enums & Constants ───────────────────────────────────────────

describe('IFR_SCHEMA_VERSION', () => {
  it('is 1', () => {
    expect(IFR_SCHEMA_VERSION).toBe(1)
  })
})

describe('IFR_SCORE_VERSION', () => {
  it('is 1', () => {
    expect(IFR_SCORE_VERSION).toBe(1)
  })
})

describe('DEFAULT_IDEALITY_WEIGHTS', () => {
  it('sums to 1', () => {
    const sum =
      DEFAULT_IDEALITY_WEIGHTS.usefulFunction +
      DEFAULT_IDEALITY_WEIGHTS.cost +
      DEFAULT_IDEALITY_WEIGHTS.harm
    expect(sum).toBeCloseTo(1, 10)
  })
})

describe('simpleHash', () => {
  it('produces deterministic output', () => {
    expect(simpleHash('test')).toBe(simpleHash('test'))
  })

  it('produces 8-char hex string', () => {
    expect(simpleHash('hello world')).toMatch(/^[0-9a-f]{8}$/)
  })
})
