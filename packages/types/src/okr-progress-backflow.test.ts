// @aiproj/types —— OKR 进度回流共享契约单元测试。
// v3-okr-progress-backflow §1.6

import { describe, it, expect } from 'vitest'
import {
  normalizeBackflowContributionWeights,
  clampBackflowProgress,
  computeBackflowDelta,
  computeBackflowFreshness,
  computeBackflowSuggestionHash,
  mergeBackflowWarnings,
  isOkrBackflowSourceKind,
  isOkrBackflowSuggestionStatus,
  isOkrBackflowWarningCode,
  isOkrBackflowReasonCode,
  isOkrBackflowSortField,
  sourcePrecedence,
  makeOkrBackflowSourceRef,
  makeOkrBackflowContribution,
  makeOkrBackflowSuggestion,
  makeOkrBackflowAuditPayload,
  makeManualOverrideWarning,
  makeRestrictedSourceWarning,
  makeInvalidAggregateWeightWarning,
  makeStaleSourceWarning,
  makeSourceUnavailableWarning,
  makeCancelledProjectWarning,
  makePausedProjectWarning,
  makeUnsupportedLifecycleWarning,
  makeConcurrentUpdateWarning,
  makeBaseProgressVersionMismatchWarning,
  makeSuggestionHashMismatchWarning,
  makeNestedSourceDedupWarning,
  makeRecentManualUpdateWarning,
  makeNormalBackflowFixture,
  makeMultiSourceBackflowFixture,
  makeRestrictedSourceBackflowFixture,
  makeManualOverrideBackflowFixture,
  makeInvalidWeightBackflowFixture,
  makeStaleSourceBackflowFixture,
  makeNestedSourceBackflowFixture,
  makeIdempotentBackflowFixture,
  OKR_BACKFLOW_SOURCE_KINDS,
  OKR_BACKFLOW_SUGGESTION_STATUSES,
  OKR_BACKFLOW_WARNING_CODES,
  OKR_BACKFLOW_REASON_CODES,
  OKR_BACKFLOW_SORT_FIELDS,
  OKR_BACKFLOW_DEFAULTS,
  OKR_BACKFLOW_SOURCE_PRECEDENCE,
} from './okr-progress-backflow'
import type {
  OkrBackflowSourceRef,
  OkrBackflowContribution,
  OkrBackflowSuggestion,
  OkrBackflowSourceKind,
} from './okr-progress-backflow'

// ══════════════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════════════

describe('OKR Backflow Constants', () => {
  it('source kinds are three', () => {
    expect(Object.keys(OKR_BACKFLOW_SOURCE_KINDS)).toEqual(['PROJECT', 'MILESTONE', 'TASK'])
  })

  it('suggestion statuses are five', () => {
    expect(Object.values(OKR_BACKFLOW_SUGGESTION_STATUSES)).toHaveLength(5)
  })

  it('warning codes cover all defined codes', () => {
    expect(Object.keys(OKR_BACKFLOW_WARNING_CODES)).toHaveLength(13)
  })

  it('reason codes are six', () => {
    expect(Object.keys(OKR_BACKFLOW_REASON_CODES)).toHaveLength(6)
  })

  it('sort fields are three', () => {
    expect(Object.values(OKR_BACKFLOW_SORT_FIELDS)).toHaveLength(3)
  })

  it('defaults have sane values', () => {
    expect(OKR_BACKFLOW_DEFAULTS.MAX_KR_PER_BATCH).toBe(100)
    expect(OKR_BACKFLOW_DEFAULTS.STALE_THRESHOLD_MS).toBe(24 * 60 * 60 * 1000)
    expect(OKR_BACKFLOW_DEFAULTS.DEFAULT_PAGE_SIZE).toBe(25)
    expect(OKR_BACKFLOW_DEFAULTS.MAX_REASON_NOTE_LENGTH).toBe(500)
  })
})

// ══════════════════════════════════════════════════════════════════════
// Source Precedence
// ══════════════════════════════════════════════════════════════════════

describe('sourcePrecedence', () => {
  it('project > milestone > task', () => {
    expect(sourcePrecedence('project')).toBeGreaterThan(sourcePrecedence('milestone'))
    expect(sourcePrecedence('milestone')).toBeGreaterThan(sourcePrecedence('task'))
  })

  it('matches constant map', () => {
    expect(sourcePrecedence('project')).toBe(OKR_BACKFLOW_SOURCE_PRECEDENCE.project)
    expect(sourcePrecedence('milestone')).toBe(OKR_BACKFLOW_SOURCE_PRECEDENCE.milestone)
    expect(sourcePrecedence('task')).toBe(OKR_BACKFLOW_SOURCE_PRECEDENCE.task)
  })
})

// ══════════════════════════════════════════════════════════════════════
// Contribution Normalization
// ══════════════════════════════════════════════════════════════════════

describe('normalizeBackflowContributionWeights', () => {
  it('normalizes weights to sum to progress', () => {
    const contributions: OkrBackflowContribution[] = [
      makeOkrBackflowContribution({
        source: makeOkrBackflowSourceRef({ kind: 'task', weight: 50, progress: 80 }),
        contributedValue: 80,
        weightedValue: 40,
      }),
      makeOkrBackflowContribution({
        source: makeOkrBackflowSourceRef({ kind: 'task', weight: 50, progress: 60 }),
        contributedValue: 60,
        weightedValue: 30,
      }),
    ]
    const normalized = normalizeBackflowContributionWeights(contributions)
    expect(normalized[0].weightedValue).toBeCloseTo(40, 0)
    expect(normalized[1].weightedValue).toBeCloseTo(30, 0)
  })

  it('handles zero total weight', () => {
    const contributions: OkrBackflowContribution[] = [
      makeOkrBackflowContribution({
        source: makeOkrBackflowSourceRef({ weight: 0 }),
      }),
    ]
    const normalized = normalizeBackflowContributionWeights(contributions)
    expect(normalized).toEqual(contributions)
  })

  it('handles empty contributions', () => {
    expect(normalizeBackflowContributionWeights([])).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════════════
// Progress Clamp
// ══════════════════════════════════════════════════════════════════════

describe('clampBackflowProgress', () => {
  it('clamps percent to 0-100', () => {
    expect(clampBackflowProgress(150, 'percent')).toBe(100)
    expect(clampBackflowProgress(-10, 'percent')).toBe(0)
    expect(clampBackflowProgress(50, 'percent')).toBe(50)
  })

  it('clamps binary to 0-1', () => {
    expect(clampBackflowProgress(2, 'binary')).toBe(1)
    expect(clampBackflowProgress(-1, 'binary')).toBe(0)
  })

  it('clamps milestone to 0-1', () => {
    expect(clampBackflowProgress(2, 'milestone')).toBe(1)
    expect(clampBackflowProgress(-1, 'milestone')).toBe(0)
  })

  it('only floors number/currency_like to 0', () => {
    expect(clampBackflowProgress(-50, 'number')).toBe(0)
    expect(clampBackflowProgress(9999, 'number')).toBe(9999) // no upper clamp
  })
})

// ══════════════════════════════════════════════════════════════════════
// Delta Calculation
// ══════════════════════════════════════════════════════════════════════

describe('computeBackflowDelta', () => {
  it('positive delta', () => {
    expect(computeBackflowDelta(75, 50)).toBe(25)
  })

  it('negative delta', () => {
    expect(computeBackflowDelta(30, 50)).toBe(-20)
  })

  it('zero delta', () => {
    expect(computeBackflowDelta(50, 50)).toBe(0)
  })

  it('rounds to 2 decimal places', () => {
    expect(computeBackflowDelta(50.555, 50)).toBe(0.55)
  })
})

// ══════════════════════════════════════════════════════════════════════
// Warning Generation
// ══════════════════════════════════════════════════════════════════════

describe('warning generation', () => {
  it('makeManualOverrideWarning has correct code', () => {
    const w = makeManualOverrideWarning()
    expect(w.code).toBe('MANUAL_OVERRIDE_CONFLICT')
  })

  it('makeRecentManualUpdateWarning has correct code', () => {
    const w = makeRecentManualUpdateWarning()
    expect(w.code).toBe('RECENT_MANUAL_UPDATE')
  })

  it('makeRestrictedSourceWarning has correct code', () => {
    const w = makeRestrictedSourceWarning()
    expect(w.code).toBe('RESTRICTED_SOURCE')
  })

  it('makeInvalidAggregateWeightWarning has correct code', () => {
    const w = makeInvalidAggregateWeightWarning()
    expect(w.code).toBe('INVALID_AGGREGATE_WEIGHT')
  })

  it('makeStaleSourceWarning includes source kind', () => {
    const w = makeStaleSourceWarning('project')
    expect(w.code).toBe('STALE_SOURCE')
    expect(w.details?.sourceKind).toBe('project')
  })

  it('makeSourceUnavailableWarning includes source kind', () => {
    const w = makeSourceUnavailableWarning('task')
    expect(w.code).toBe('SOURCE_UNAVAILABLE')
    expect(w.details?.sourceKind).toBe('task')
  })

  it('all warning makers produce unique codes', () => {
    const makers = [
      makeManualOverrideWarning,
      makeRecentManualUpdateWarning,
      makeRestrictedSourceWarning,
      makeInvalidAggregateWeightWarning,
      makeCancelledProjectWarning,
      makePausedProjectWarning,
      makeUnsupportedLifecycleWarning,
      makeConcurrentUpdateWarning,
      makeBaseProgressVersionMismatchWarning,
      makeSuggestionHashMismatchWarning,
      makeNestedSourceDedupWarning,
    ]
    const codes = new Set(makers.map((m) => m().code))
    expect(codes.size).toBe(makers.length)
  })
})

// ══════════════════════════════════════════════════════════════════════
// mergeBackflowWarnings
// ══════════════════════════════════════════════════════════════════════

describe('mergeBackflowWarnings', () => {
  it('deduplicates by code', () => {
    const w1 = [makeManualOverrideWarning(), makeRestrictedSourceWarning()]
    const w2 = [makeManualOverrideWarning(), makeStaleSourceWarning('project')]
    const merged = mergeBackflowWarnings([w1, w2])
    expect(merged).toHaveLength(3)
  })

  it('handles empty input', () => {
    expect(mergeBackflowWarnings([])).toEqual([])
  })

  it('handles single array', () => {
    const warnings = [makeManualOverrideWarning()]
    expect(mergeBackflowWarnings([warnings])).toEqual(warnings)
  })
})

// ══════════════════════════════════════════════════════════════════════
// Freshness
// ══════════════════════════════════════════════════════════════════════

describe('computeBackflowFreshness', () => {
  it('empty sources → stale', () => {
    const f = computeBackflowFreshness([])
    expect(f.stale).toBe(true)
    expect(f.oldestSourceUpdatedAt).toBeNull()
  })

  it('fresh sources → not stale', () => {
    const now = new Date().toISOString()
    const sources: OkrBackflowSourceRef[] = [makeOkrBackflowSourceRef({ lastUpdatedAt: now })]
    const f = computeBackflowFreshness(sources)
    expect(f.stale).toBe(false)
  })

  it('old source → stale', () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    const sources: OkrBackflowSourceRef[] = [makeOkrBackflowSourceRef({ lastUpdatedAt: old })]
    const f = computeBackflowFreshness(sources)
    expect(f.stale).toBe(true)
  })

  it('tracks oldest and newest', () => {
    const old = new Date('2026-01-01').toISOString()
    const fresh = new Date().toISOString()
    const sources: OkrBackflowSourceRef[] = [
      makeOkrBackflowSourceRef({ lastUpdatedAt: old }),
      makeOkrBackflowSourceRef({ lastUpdatedAt: fresh }),
    ]
    const f = computeBackflowFreshness(sources)
    expect(f.oldestSourceUpdatedAt).toBe(old)
    expect(f.newestSourceUpdatedAt).toBe(fresh)
  })
})

// ══════════════════════════════════════════════════════════════════════
// Stable Hash
// ══════════════════════════════════════════════════════════════════════

describe('computeBackflowSuggestionHash', () => {
  it('same inputs → same hash', () => {
    const contributions = [makeOkrBackflowContribution()]
    const h1 = computeBackflowSuggestionHash(1, 75, contributions, '1')
    const h2 = computeBackflowSuggestionHash(1, 75, contributions, '1')
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{8}$/)
  })

  it('different keyResultId → different hash', () => {
    const c1 = [makeOkrBackflowContribution()]
    const h1 = computeBackflowSuggestionHash(1, 75, c1, '1')
    const h2 = computeBackflowSuggestionHash(2, 75, c1, '1')
    expect(h1).not.toBe(h2)
  })

  it('different base version → different hash', () => {
    const contributions = [makeOkrBackflowContribution()]
    const h1 = computeBackflowSuggestionHash(1, 75, contributions, '1')
    const h2 = computeBackflowSuggestionHash(1, 75, contributions, '2')
    expect(h1).not.toBe(h2)
  })
})

// ══════════════════════════════════════════════════════════════════════
// Type Guards
// ══════════════════════════════════════════════════════════════════════

describe('type guards', () => {
  it('isOkrBackflowSourceKind', () => {
    expect(isOkrBackflowSourceKind('project')).toBe(true)
    expect(isOkrBackflowSourceKind('milestone')).toBe(true)
    expect(isOkrBackflowSourceKind('task')).toBe(true)
    expect(isOkrBackflowSourceKind('invalid')).toBe(false)
  })

  it('isOkrBackflowSuggestionStatus', () => {
    expect(isOkrBackflowSuggestionStatus('pending')).toBe(true)
    expect(isOkrBackflowSuggestionStatus('confirmed')).toBe(true)
    expect(isOkrBackflowSuggestionStatus('invalid')).toBe(false)
  })

  it('isOkrBackflowWarningCode', () => {
    expect(isOkrBackflowWarningCode('MANUAL_OVERRIDE_CONFLICT')).toBe(true)
    expect(isOkrBackflowWarningCode('INVALID')).toBe(false)
  })

  it('isOkrBackflowReasonCode', () => {
    expect(isOkrBackflowReasonCode('VALUE_INACCURATE')).toBe(true)
    expect(isOkrBackflowReasonCode('OTHER')).toBe(true)
    expect(isOkrBackflowReasonCode('INVALID')).toBe(false)
  })

  it('isOkrBackflowSortField', () => {
    expect(isOkrBackflowSortField('calculatedAt')).toBe(true)
    expect(isOkrBackflowSortField('createdAt')).toBe(true)
    expect(isOkrBackflowSortField('delta')).toBe(true)
    expect(isOkrBackflowSortField('invalid')).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════
// Fixture Builders
// ══════════════════════════════════════════════════════════════════════

describe('fixture builders', () => {
  it('makeOkrBackflowSourceRef has defaults', () => {
    const s = makeOkrBackflowSourceRef()
    expect(s.kind).toBe('project')
    expect(s.id).toBe(1)
    expect(s.organizationId).toBe(1)
    expect(s.weight).toBe(100)
    expect(s.progress).toBe(75)
  })

  it('makeOkrBackflowContribution has defaults', () => {
    const c = makeOkrBackflowContribution()
    expect(c.contributedValue).toBe(75)
    expect(c.weightedValue).toBe(75)
    expect(c.source.kind).toBe('project')
  })

  it('makeOkrBackflowSuggestion has defaults', () => {
    const s = makeOkrBackflowSuggestion()
    expect(s.id).toBe(1)
    expect(s.status).toBe('pending')
    expect(s.confidence).toBe('high')
    expect(s.warnings).toEqual([])
  })

  it('makeOkrBackflowAuditPayload has defaults', () => {
    const a = makeOkrBackflowAuditPayload()
    expect(a.action).toBe('recalculate')
    expect(a.status).toBe('pending')
  })

  it('fixtures are stable across calls', () => {
    const f1 = makeNormalBackflowFixture()
    const f2 = makeNormalBackflowFixture()
    expect(f1.suggestions).toHaveLength(f2.suggestions.length)
    expect(f1.suggestions[0].proposedValue).toBe(f2.suggestions[0].proposedValue)
  })
})

// ══════════════════════════════════════════════════════════════════════
// Fixture Scenarios
// ══════════════════════════════════════════════════════════════════════

describe('fixture scenarios', () => {
  it('normal fixture has single project source', () => {
    const f = makeNormalBackflowFixture()
    expect(f.sources).toHaveLength(1)
    expect(f.sources[0].kind).toBe('project')
    expect(f.suggestions[0].proposedValue).toBe(75)
  })

  it('multi-source fixture has three sources', () => {
    const f = makeMultiSourceBackflowFixture()
    expect(f.sources).toHaveLength(3)
    const kinds = f.sources.map((s) => s.kind)
    expect(kinds).toContain('project')
    expect(kinds).toContain('milestone')
    expect(kinds).toContain('task')
  })

  it('restricted source fixture has warning', () => {
    const f = makeRestrictedSourceBackflowFixture()
    expect(f.suggestions[0].warnings.some((w) => w.code === 'RESTRICTED_SOURCE')).toBe(true)
  })

  it('manual override fixture is needs_review', () => {
    const f = makeManualOverrideBackflowFixture()
    expect(f.suggestions[0].status).toBe('needs_review')
    expect(f.suggestions[0].warnings.some((w) => w.code === 'MANUAL_OVERRIDE_CONFLICT')).toBe(true)
  })

  it('invalid weight fixture has warning', () => {
    const f = makeInvalidWeightBackflowFixture()
    expect(f.suggestions[0].warnings.some((w) => w.code === 'INVALID_AGGREGATE_WEIGHT')).toBe(true)
  })

  it('stale source fixture is stale', () => {
    const f = makeStaleSourceBackflowFixture()
    expect(f.suggestions[0].freshness.stale).toBe(true)
    expect(f.suggestions[0].warnings.some((w) => w.code === 'STALE_SOURCE')).toBe(true)
  })

  it('nested source fixture dedups', () => {
    const f = makeNestedSourceBackflowFixture()
    // Only project source should remain (milestone is nested)
    expect(f.contributions).toHaveLength(1)
    expect(f.contributions[0].source.kind).toBe('project')
    expect(f.suggestions[0].warnings.some((w) => w.code === 'NESTED_SOURCE_DEDUP')).toBe(true)
  })

  it('idempotent fixture has confirmed status', () => {
    const f = makeIdempotentBackflowFixture()
    expect(f.suggestions[0].status).toBe('confirmed')
    expect(f.suggestions[0].id).toBe(99)
  })
})
