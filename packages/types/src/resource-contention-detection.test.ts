// @aiproj/types —— 资源争用检测共享契约测试。
// v3-resource-contention-detection §2.3：稳定严重度值、原因码、warning codes、redaction states、
// 分页信封、evidence references、drill-down target types。

import { describe, expect, it } from 'vitest'
import {
  RESOURCE_CONTENTION_DEFAULT_DATE_WINDOW_DAYS,
  RESOURCE_CONTENTION_DEFAULT_PAGE,
  RESOURCE_CONTENTION_DEFAULT_PER_PAGE,
  RESOURCE_CONTENTION_LOW_CARDINALITY_THRESHOLD,
  RESOURCE_CONTENTION_MAX_DATE_WINDOW_DAYS,
  RESOURCE_CONTENTION_MAX_PER_PAGE,
  RESOURCE_CONTENTION_MAX_TOP_N,
  RESOURCE_CONTENTION_METRIC_VERSION,
  RESOURCE_CONTENTION_OVERLOAD_SEVERITY_THRESHOLD,
  RESOURCE_CONTENTION_REASON_CODE_VALUES,
  RESOURCE_CONTENTION_REDACTION_STATE_VALUES,
  RESOURCE_CONTENTION_SEVERITY_ORDER,
  RESOURCE_CONTENTION_SEVERITY_VALUES,
  RESOURCE_CONTENTION_SORT_KEY_VALUES,
  RESOURCE_CONTENTION_SOURCE_VALUES,
  RESOURCE_CONTENTION_TARGET_KIND_VALUES,
  RESOURCE_CONTENTION_VIEW_MODE_VALUES,
  RESOURCE_CONTENTION_WARNING_CODE_VALUES,
  computeEvidenceKey,
  computeQuerySignatureHash,
  computeContentionSourceSignature,
  deriveResourceContentionSeverity,
  emptyReasonCounts,
  emptySeverityCounts,
  isResourceContentionSourceStale,
  makeContentionWarning,
  makeLowSensitiveEvidenceHash,
  makeResourceContentionFreshness,
  mergeResourceContentionFreshness,
  mergeResourceContentionWarnings,
  normalizeLoadBucket,
  normalizeResourceContentionQuery,
  resourceContentionFreshnessHash,
  resourceContentionStableHash,
  resourceContentionValidationDetail,
  sortContentionReasons,
  type NormalizedResourceContentionQuery,
  type ResourceContentionQuery,
  type ResourceContentionSeverity,
  type ResourceContentionReasonCode,
  type ResourceContentionWarningCode,
} from './resource-contention-detection.js'

// ─── 2.3.1 Severity values are stable ────────────────────────────────────────

describe('Resource Contention Severity Values', () => {
  it('has exactly four severity levels', () => {
    expect(RESOURCE_CONTENTION_SEVERITY_VALUES).toHaveLength(4)
    expect(RESOURCE_CONTENTION_SEVERITY_VALUES).toContain('info')
    expect(RESOURCE_CONTENTION_SEVERITY_VALUES).toContain('warning')
    expect(RESOURCE_CONTENTION_SEVERITY_VALUES).toContain('high')
    expect(RESOURCE_CONTENTION_SEVERITY_VALUES).toContain('critical')
  })

  it('severity order is stable: critical < high < warning < info', () => {
    expect(RESOURCE_CONTENTION_SEVERITY_ORDER.critical).toBeLessThan(
      RESOURCE_CONTENTION_SEVERITY_ORDER.high,
    )
    expect(RESOURCE_CONTENTION_SEVERITY_ORDER.high).toBeLessThan(
      RESOURCE_CONTENTION_SEVERITY_ORDER.warning,
    )
    expect(RESOURCE_CONTENTION_SEVERITY_ORDER.warning).toBeLessThan(
      RESOURCE_CONTENTION_SEVERITY_ORDER.info,
    )
  })
})

// ─── 2.3.2 Reason codes are stable ──────────────────────────────────────────

describe('Resource Contention Reason Codes', () => {
  it('has exactly six reason codes', () => {
    expect(RESOURCE_CONTENTION_REASON_CODE_VALUES).toHaveLength(6)
  })

  it('includes all expected reason codes', () => {
    expect(RESOURCE_CONTENTION_REASON_CODE_VALUES).toContain('cross-project-overload')
    expect(RESOURCE_CONTENTION_REASON_CODE_VALUES).toContain('unavailable-allocation')
    expect(RESOURCE_CONTENTION_REASON_CODE_VALUES).toContain('critical-skill-contention')
    expect(RESOURCE_CONTENTION_REASON_CODE_VALUES).toContain('duplicate-reservation')
    expect(RESOURCE_CONTENTION_REASON_CODE_VALUES).toContain('demand-window-contention')
    expect(RESOURCE_CONTENTION_REASON_CODE_VALUES).toContain('draft-allocation-contention')
  })

  it('sortContentionReasons returns reasons in stable order', () => {
    const sorted = sortContentionReasons([
      'draft-allocation-contention',
      'cross-project-overload',
      'critical-skill-contention',
    ])
    expect(sorted[0]).toBe('cross-project-overload')
    expect(sorted[1]).toBe('critical-skill-contention')
    expect(sorted[2]).toBe('draft-allocation-contention')
  })
})

// ─── 2.3.3 Warning codes are stable ─────────────────────────────────────────

describe('Resource Contention Warning Codes', () => {
  it('has at least 8 warning codes', () => {
    expect(RESOURCE_CONTENTION_WARNING_CODE_VALUES.length).toBeGreaterThanOrEqual(8)
  })

  it('includes key warning codes', () => {
    expect(RESOURCE_CONTENTION_WARNING_CODE_VALUES).toContain('EMPTY_CONTENTION_RESULT')
    expect(RESOURCE_CONTENTION_WARNING_CODE_VALUES).toContain('PERMISSION_REDACTED')
    expect(RESOURCE_CONTENTION_WARNING_CODE_VALUES).toContain('SOURCE_STALE')
    expect(RESOURCE_CONTENTION_WARNING_CODE_VALUES).toContain('CACHE_DEGRADED')
  })
})

// ─── 2.3.4 Redaction states are stable ──────────────────────────────────────

describe('Resource Contention Redaction States', () => {
  it('has exactly five redaction states', () => {
    expect(RESOURCE_CONTENTION_REDACTION_STATE_VALUES).toHaveLength(5)
    expect(RESOURCE_CONTENTION_REDACTION_STATE_VALUES).toContain('visible')
    expect(RESOURCE_CONTENTION_REDACTION_STATE_VALUES).toContain('redacted')
    expect(RESOURCE_CONTENTION_REDACTION_STATE_VALUES).toContain('forbidden')
    expect(RESOURCE_CONTENTION_REDACTION_STATE_VALUES).toContain('unavailable')
    expect(RESOURCE_CONTENTION_REDACTION_STATE_VALUES).toContain('partial')
  })
})

// ─── 2.3.5 Source keys are stable ───────────────────────────────────────────

describe('Resource Contention Source Keys', () => {
  it('includes core source keys', () => {
    expect(RESOURCE_CONTENTION_SOURCE_VALUES).toContain('resource_registry')
    expect(RESOURCE_CONTENTION_SOURCE_VALUES).toContain('resource_allocation')
    expect(RESOURCE_CONTENTION_SOURCE_VALUES).toContain('resource_requirement')
    expect(RESOURCE_CONTENTION_SOURCE_VALUES).toContain('computed')
  })
})

// ─── 2.3.6 Drill-down target types are stable ───────────────────────────────

describe('Resource Contention Target Kinds', () => {
  it('includes all expected drill-down target types', () => {
    expect(RESOURCE_CONTENTION_TARGET_KIND_VALUES).toContain('project')
    expect(RESOURCE_CONTENTION_TARGET_KIND_VALUES).toContain('resource')
    expect(RESOURCE_CONTENTION_TARGET_KIND_VALUES).toContain('task')
    expect(RESOURCE_CONTENTION_TARGET_KIND_VALUES).toContain('allocation')
    expect(RESOURCE_CONTENTION_TARGET_KIND_VALUES).toContain('skill')
    expect(RESOURCE_CONTENTION_TARGET_KIND_VALUES).toContain('evidence')
  })
})

// ─── 2.3.7 View modes are stable ────────────────────────────────────────────

describe('Resource Contention View Modes', () => {
  it('has exactly four view modes', () => {
    expect(RESOURCE_CONTENTION_VIEW_MODE_VALUES).toHaveLength(4)
    expect(RESOURCE_CONTENTION_VIEW_MODE_VALUES).toContain('summary')
    expect(RESOURCE_CONTENTION_VIEW_MODE_VALUES).toContain('list')
    expect(RESOURCE_CONTENTION_VIEW_MODE_VALUES).toContain('matrix')
    expect(RESOURCE_CONTENTION_VIEW_MODE_VALUES).toContain('timeline')
  })
})

// ─── 2.3.8 Sort keys are stable ─────────────────────────────────────────────

describe('Resource Contention Sort Keys', () => {
  it('has at least 6 sort keys', () => {
    expect(RESOURCE_CONTENTION_SORT_KEY_VALUES.length).toBeGreaterThanOrEqual(6)
  })
})

// ─── 2.2.1 Query normalization ──────────────────────────────────────────────

describe('normalizeResourceContentionQuery', () => {
  it('returns defaults for empty query', () => {
    const result = normalizeResourceContentionQuery()
    expect(result.view).toBe('summary')
    expect(result.page).toBe(1)
    expect(result.perPage).toBe(RESOURCE_CONTENTION_DEFAULT_PER_PAGE)
    expect(result.severity).toBeNull()
    expect(result.reasonCode).toBeNull()
    expect(result.projectIds).toBeNull()
  })

  it('clamps page and perPage to valid ranges', () => {
    const result = normalizeResourceContentionQuery({ page: -5, perPage: 500 })
    expect(result.page).toBe(1)
    expect(result.perPage).toBe(RESOURCE_CONTENTION_MAX_PER_PAGE)
  })

  it('clamps topN', () => {
    const result = normalizeResourceContentionQuery({ topN: 500 })
    expect(result.topN).toBe(RESOURCE_CONTENTION_MAX_TOP_N)
  })

  it('clamps date window to max days', () => {
    const from = '2026-01-01'
    const to = '2028-01-01'
    const result = normalizeResourceContentionQuery({ from, to })
    expect(result.from).toBe(from)
    expect(result.to).not.toBe(to)
    const toDate = new Date(result.to!)
    const expectedMax = new Date(
      new Date(from).getTime() + RESOURCE_CONTENTION_MAX_DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    )
    expect(Math.abs(toDate.getTime() - expectedMax.getTime())).toBeLessThan(2000)
  })

  it('passes through valid severity and reasonCode', () => {
    const result = normalizeResourceContentionQuery({
      severity: 'critical',
      reasonCode: 'cross-project-overload',
    })
    expect(result.severity).toBe('critical')
    expect(result.reasonCode).toBe('cross-project-overload')
  })

  it('ignores invalid severity and reasonCode', () => {
    const result = normalizeResourceContentionQuery({
      severity: 'impossible' as ResourceContentionSeverity,
      reasonCode: 'bogus' as ResourceContentionReasonCode,
    })
    expect(result.severity).toBeNull()
    expect(result.reasonCode).toBeNull()
  })

  it('normalizes projectIds, resourceIds, skillIds', () => {
    const result = normalizeResourceContentionQuery({
      projectIds: [1, 2, NaN, 3],
      resourceIds: [10, 20],
    })
    expect(result.projectIds).toEqual([1, 2, 3])
    expect(result.resourceIds).toEqual([10, 20])
    expect(result.skillIds).toBeNull()
  })
})

// ─── 2.2.2 Severity derivation ──────────────────────────────────────────────

describe('deriveResourceContentionSeverity', () => {
  it('returns CRITICAL for unavailable allocation', () => {
    expect(deriveResourceContentionSeverity({ unavailableCapacity: true })).toBe('critical')
  })

  it('returns CRITICAL for overload >= 150%', () => {
    expect(deriveResourceContentionSeverity({ overloadRatio: 150 })).toBe('critical')
    expect(deriveResourceContentionSeverity({ overloadRatio: 200 })).toBe('critical')
  })

  it('returns CRITICAL for critical skill with 3+ projects', () => {
    expect(deriveResourceContentionSeverity({ criticalSkill: true, affectedProjectCount: 3 })).toBe(
      'critical',
    )
  })

  it('returns HIGH for overload >= 120%', () => {
    expect(deriveResourceContentionSeverity({ overloadRatio: 130 })).toBe('high')
  })

  it('returns HIGH for critical skill with 2 projects', () => {
    expect(deriveResourceContentionSeverity({ criticalSkill: true, affectedProjectCount: 2 })).toBe(
      'high',
    )
  })

  it('returns HIGH for 5+ projects within 7 days', () => {
    expect(
      deriveResourceContentionSeverity({ affectedProjectCount: 5, dateProximityDays: 3 }),
    ).toBe('high')
  })

  it('returns WARNING for overload >= 100%', () => {
    expect(deriveResourceContentionSeverity({ overloadRatio: 110 })).toBe('warning')
  })

  it('returns WARNING for 3+ projects', () => {
    expect(deriveResourceContentionSeverity({ affectedProjectCount: 4 })).toBe('warning')
  })

  it('returns WARNING for draft', () => {
    expect(deriveResourceContentionSeverity({ isDraft: true })).toBe('warning')
  })

  it('returns INFO for low severity', () => {
    expect(deriveResourceContentionSeverity({ overloadRatio: 50 })).toBe('info')
  })
})

// ─── 2.2.3 Load bucket normalization ────────────────────────────────────────

describe('normalizeLoadBucket', () => {
  it('classifies idle for <= 10%', () => {
    expect(normalizeLoadBucket(0).status).toBe('idle')
    expect(normalizeLoadBucket(10).status).toBe('idle')
  })

  it('classifies normal for 11-80%', () => {
    expect(normalizeLoadBucket(50).status).toBe('normal')
    expect(normalizeLoadBucket(80).status).toBe('normal')
  })

  it('classifies high for 81-100%', () => {
    expect(normalizeLoadBucket(90).status).toBe('high')
    expect(normalizeLoadBucket(100).status).toBe('high')
  })

  it('classifies overloaded for > 100%', () => {
    expect(normalizeLoadBucket(120).status).toBe('overloaded')
  })

  it('rounds percent to 1 decimal', () => {
    expect(normalizeLoadBucket(75.678).percent).toBe(75.7)
  })
})

// ─── 2.2.4 Freshness helpers ────────────────────────────────────────────────

describe('resourceContentionFreshness', () => {
  it('stale when lastUpdatedAt is null', () => {
    expect(isResourceContentionSourceStale(null)).toBe(true)
  })

  it('stale when older than threshold', () => {
    const old = new Date(Date.now() - 120 * 60 * 1000).toISOString()
    expect(isResourceContentionSourceStale(old, 60)).toBe(true)
  })

  it('not stale when within threshold', () => {
    const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    expect(isResourceContentionSourceStale(recent, 60)).toBe(false)
  })

  it('makeResourceContentionFreshness handles forbidden', () => {
    const result = makeResourceContentionFreshness({
      source: 'resource_allocation',
      lastUpdatedAt: null,
      forbidden: true,
    })
    expect(result.status).toBe('forbidden')
    expect(result.isStale).toBe(false)
  })

  it('makeResourceContentionFreshness handles unavailable', () => {
    const result = makeResourceContentionFreshness({
      source: 'resource_allocation',
      lastUpdatedAt: null,
      unavailable: true,
    })
    expect(result.status).toBe('unavailable')
  })
})

// ─── 2.2.5 Freshness merge ──────────────────────────────────────────────────

describe('mergeResourceContentionFreshness', () => {
  it('returns null for empty array', () => {
    expect(mergeResourceContentionFreshness([])).toBeNull()
  })

  it('returns single item', () => {
    const item = makeResourceContentionFreshness({
      source: 'resource_allocation',
      lastUpdatedAt: new Date().toISOString(),
    })
    const merged = mergeResourceContentionFreshness([item])
    expect(merged).not.toBeNull()
    expect(merged!.source).toBe('computed')
  })

  it('detects stale from any item', () => {
    const recent = makeResourceContentionFreshness({
      source: 'resource_allocation',
      lastUpdatedAt: new Date().toISOString(),
    })
    const old = makeResourceContentionFreshness({
      source: 'resource_requirement',
      lastUpdatedAt: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
      staleThresholdMinutes: 60,
    })
    const merged = mergeResourceContentionFreshness([recent, old])
    expect(merged!.isStale).toBe(true)
  })

  it('propagates forbidden status', () => {
    const ok = makeResourceContentionFreshness({
      source: 'resource_allocation',
      lastUpdatedAt: new Date().toISOString(),
    })
    const forbidden = makeResourceContentionFreshness({
      source: 'resource_requirement',
      lastUpdatedAt: null,
      forbidden: true,
    })
    const merged = mergeResourceContentionFreshness([ok, forbidden])
    expect(merged!.status).toBe('forbidden')
  })
})

// ─── 2.2.6 Warning merge ────────────────────────────────────────────────────

describe('mergeResourceContentionWarnings', () => {
  it('returns empty for no input', () => {
    expect(mergeResourceContentionWarnings()).toEqual([])
  })

  it('deduplicates by code|source|metricKey', () => {
    const w1 = makeContentionWarning('SOURCE_STALE', 'stale', 'resource_allocation')
    const w2 = makeContentionWarning('SOURCE_STALE', 'stale', 'resource_allocation')
    const merged = mergeResourceContentionWarnings([w1], [w2])
    expect(merged).toHaveLength(1)
  })

  it('preserves different codes', () => {
    const w1 = makeContentionWarning('SOURCE_STALE', 'stale')
    const w2 = makeContentionWarning('PERMISSION_REDACTED', 'redacted')
    const merged = mergeResourceContentionWarnings([w1, w2])
    expect(merged).toHaveLength(2)
  })
})

// ─── 2.2.7 Evidence helpers ─────────────────────────────────────────────────

describe('evidence helpers', () => {
  it('computeEvidenceKey produces stable hash', () => {
    const a = computeEvidenceKey(['a', 'b', 'c'])
    const b = computeEvidenceKey(['a', 'b', 'c'])
    expect(a).toBe(b)
    expect(typeof a).toBe('string')
  })

  it('computeEvidenceKey differs for different inputs', () => {
    const a = computeEvidenceKey(['a', 'b'])
    const b = computeEvidenceKey(['a', 'c'])
    expect(a).not.toBe(b)
  })

  it('makeLowSensitiveEvidenceHash excludes raw text', () => {
    const hash = makeLowSensitiveEvidenceHash('resource_allocation', ['1', '2'], '2026-07-29')
    expect(typeof hash).toBe('string')
    expect(hash.length).toBe(8)
  })

  it('computeQuerySignatureHash is stable', () => {
    const q = normalizeResourceContentionQuery({
      from: '2026-07-01',
      to: '2026-07-31',
      severity: 'high',
    })
    const a = computeQuerySignatureHash(q)
    const b = computeQuerySignatureHash(q)
    expect(a).toBe(b)
  })

  it('computeContentionSourceSignature produces stable hash', () => {
    const a = computeContentionSourceSignature(['a', 'b', 'c'])
    const b = computeContentionSourceSignature(['a', 'b', 'c'])
    expect(a).toBe(b)
    expect(a).not.toBe(computeContentionSourceSignature(['x', 'y']))
  })
})

// ─── 2.2.8 Severity and reason empty counters ───────────────────────────────

describe('empty counters', () => {
  it('emptySeverityCounts returns all-zero', () => {
    const counts = emptySeverityCounts()
    expect(counts.info).toBe(0)
    expect(counts.warning).toBe(0)
    expect(counts.high).toBe(0)
    expect(counts.critical).toBe(0)
  })

  it('emptyReasonCounts returns all-zero', () => {
    const counts = emptyReasonCounts()
    for (const code of RESOURCE_CONTENTION_REASON_CODE_VALUES) {
      expect(counts[code]).toBe(0)
    }
  })
})

// ─── 2.2.9 Validation detail ────────────────────────────────────────────────

describe('resourceContentionValidationDetail', () => {
  it('returns consistent limits', () => {
    const detail = resourceContentionValidationDetail()
    expect(detail.maxDateWindowDays).toBe(RESOURCE_CONTENTION_MAX_DATE_WINDOW_DAYS)
    expect(detail.maxPerPage).toBe(RESOURCE_CONTENTION_MAX_PER_PAGE)
    expect(detail.maxTopN).toBe(RESOURCE_CONTENTION_MAX_TOP_N)
    expect(detail.allowedViews).toHaveLength(4)
    expect(detail.allowedAggregations).toHaveLength(5)
  })
})

// ─── 2.2.10 Stable hash function ────────────────────────────────────────────

describe('resourceContentionStableHash', () => {
  it('is deterministic', () => {
    const a = resourceContentionStableHash('hello')
    const b = resourceContentionStableHash('hello')
    expect(a).toBe(b)
  })

  it('returns 8-character hex string', () => {
    const hash = resourceContentionStableHash('test')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })
})

// ─── 2.2.11 Metric version is stable ────────────────────────────────────────

describe('constants', () => {
  it('metric version is resource-contention-detection.v1', () => {
    expect(RESOURCE_CONTENTION_METRIC_VERSION).toBe('resource-contention-detection.v1')
  })

  it('default date window is 90 days', () => {
    expect(RESOURCE_CONTENTION_DEFAULT_DATE_WINDOW_DAYS).toBe(90)
  })

  it('max date window is 366 days', () => {
    expect(RESOURCE_CONTENTION_MAX_DATE_WINDOW_DAYS).toBe(366)
  })

  it('overload threshold is 100%', () => {
    expect(RESOURCE_CONTENTION_OVERLOAD_SEVERITY_THRESHOLD).toBe(150)
  })

  it('low cardinality threshold is 3', () => {
    expect(RESOURCE_CONTENTION_LOW_CARDINALITY_THRESHOLD).toBe(3)
  })
})
