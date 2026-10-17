// @aiproj/types —— 组织资源池共享契约测试（前后端共享）。
// v3-organization-resource-pool §2.5：DTO 形状、枚举守卫、warning 语义、freshness helper、redaction helper、确定性归一化。
import { describe, it, expect } from 'vitest'
import {
  ORGANIZATION_RESOURCE_POOL_METRIC_KEYS,
  ORGANIZATION_RESOURCE_POOL_METRIC_KEY_VALUES,
  ORGANIZATION_RESOURCE_POOL_SOURCES,
  ORGANIZATION_RESOURCE_POOL_SOURCE_VALUES,
  ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES,
  ORGANIZATION_RESOURCE_POOL_LOAD_STATUS_VALUES,
  ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITIES,
  ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITY_VALUES,
  ORGANIZATION_RESOURCE_POOL_WARNING_CODES,
  ORGANIZATION_RESOURCE_POOL_WARNING_CODE_VALUES,
  ORGANIZATION_RESOURCE_POOL_VIEW_MODES,
  ORGANIZATION_RESOURCE_POOL_VIEW_MODE_VALUES,
  ORGANIZATION_RESOURCE_POOL_SORT_KEYS,
  ORGANIZATION_RESOURCE_POOL_SORT_KEY_VALUES,
  ORGANIZATION_RESOURCE_POOL_STATUSES,
  ORGANIZATION_RESOURCE_POOL_MAX_DATE_WINDOW_DAYS,
  ORGANIZATION_RESOURCE_POOL_MAX_PER_PAGE,
  ORGANIZATION_RESOURCE_POOL_MAX_TOP_N,
  ORGANIZATION_RESOURCE_POOL_MAX_FRESHNESS_WINDOW_MINUTES,
  normalizeOrganizationResourcePoolQuery,
  mapLoadBucket,
  isLowCardinalityBucket,
  isOrganizationResourcePoolSourceStale,
  makeOrganizationResourcePoolFreshness,
  mergeOrganizationResourcePoolFreshness,
  organizationResourcePoolFreshnessHash,
  organizationResourcePoolStableHash,
  mergeOrganizationResourcePoolWarnings,
  computeSourceSignature,
  normalizeCapacityHours,
  normalizeUtilizationPercent,
  computeDrillDownBucketHash,
  organizationResourcePoolValidationDetail,
} from './organization-resource-pool.js'

// ─── Enum Guards ─────────────────────────────────────────────────────────────

describe('Organization Resource Pool — Enum Guards', () => {
  it('metric key values are non-empty and unique', () => {
    expect(ORGANIZATION_RESOURCE_POOL_METRIC_KEY_VALUES.length).toBeGreaterThan(0)
    expect(new Set(ORGANIZATION_RESOURCE_POOL_METRIC_KEY_VALUES).size).toBe(
      ORGANIZATION_RESOURCE_POOL_METRIC_KEY_VALUES.length,
    )
  })

  it('source values are non-empty and unique', () => {
    expect(ORGANIZATION_RESOURCE_POOL_SOURCE_VALUES.length).toBeGreaterThan(0)
    expect(new Set(ORGANIZATION_RESOURCE_POOL_SOURCE_VALUES).size).toBe(
      ORGANIZATION_RESOURCE_POOL_SOURCE_VALUES.length,
    )
  })

  it('load status values are non-empty and unique', () => {
    expect(ORGANIZATION_RESOURCE_POOL_LOAD_STATUS_VALUES.length).toBeGreaterThan(0)
    expect(new Set(ORGANIZATION_RESOURCE_POOL_LOAD_STATUS_VALUES).size).toBe(
      ORGANIZATION_RESOURCE_POOL_LOAD_STATUS_VALUES.length,
    )
  })

  it('conflict severity values are non-empty and unique', () => {
    expect(ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITY_VALUES.length).toBeGreaterThan(0)
    expect(new Set(ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITY_VALUES).size).toBe(
      ORGANIZATION_RESOURCE_POOL_CONFLICT_SEVERITY_VALUES.length,
    )
  })

  it('warning code values are non-empty and unique', () => {
    expect(ORGANIZATION_RESOURCE_POOL_WARNING_CODE_VALUES.length).toBeGreaterThan(0)
    expect(new Set(ORGANIZATION_RESOURCE_POOL_WARNING_CODE_VALUES).size).toBe(
      ORGANIZATION_RESOURCE_POOL_WARNING_CODE_VALUES.length,
    )
  })

  it('view mode values are non-empty and unique', () => {
    expect(ORGANIZATION_RESOURCE_POOL_VIEW_MODE_VALUES.length).toBeGreaterThan(0)
    expect(new Set(ORGANIZATION_RESOURCE_POOL_VIEW_MODE_VALUES).size).toBe(
      ORGANIZATION_RESOURCE_POOL_VIEW_MODE_VALUES.length,
    )
  })

  it('sort key values are non-empty and unique', () => {
    expect(ORGANIZATION_RESOURCE_POOL_SORT_KEY_VALUES.length).toBeGreaterThan(0)
    expect(new Set(ORGANIZATION_RESOURCE_POOL_SORT_KEY_VALUES).size).toBe(
      ORGANIZATION_RESOURCE_POOL_SORT_KEY_VALUES.length,
    )
  })
})

// ─── Query Normalization ────────────────────────────────────────────────────

describe('Organization Resource Pool — Query Normalization', () => {
  it('defaults to matrix view and utilization sort', () => {
    const result = normalizeOrganizationResourcePoolQuery({})
    expect(result.view).toBe(ORGANIZATION_RESOURCE_POOL_VIEW_MODES.MATRIX)
    expect(result.sort).toBe(ORGANIZATION_RESOURCE_POOL_SORT_KEYS.UTILIZATION)
    expect(result.order).toBe('desc')
    expect(result.page).toBe(1)
    expect(result.perPage).toBe(20)
    expect(result.topN).toBe(ORGANIZATION_RESOURCE_POOL_MAX_TOP_N)
  })

  it('rejects unknown view and falls back to matrix', () => {
    const result = normalizeOrganizationResourcePoolQuery({ view: 'unknown' as never })
    expect(result.view).toBe(ORGANIZATION_RESOURCE_POOL_VIEW_MODES.MATRIX)
  })

  it('rejects unknown sort and falls back to utilization', () => {
    const result = normalizeOrganizationResourcePoolQuery({ sort: 'unknown' as never })
    expect(result.sort).toBe(ORGANIZATION_RESOURCE_POOL_SORT_KEYS.UTILIZATION)
  })

  it('rejects unknown load status', () => {
    const result = normalizeOrganizationResourcePoolQuery({ loadStatus: 'unknown' as never })
    expect(result.loadStatus).toBeNull()
  })

  it('clamps perPage to max', () => {
    const result = normalizeOrganizationResourcePoolQuery({ perPage: 9999 })
    expect(result.perPage).toBe(ORGANIZATION_RESOURCE_POOL_MAX_PER_PAGE)
  })

  it('clamps topN to max', () => {
    const result = normalizeOrganizationResourcePoolQuery({ topN: 9999 })
    expect(result.topN).toBe(ORGANIZATION_RESOURCE_POOL_MAX_TOP_N)
  })

  it('clamps date window exceeding max', () => {
    const from = '2026-01-01'
    const to = '2027-06-01' // well over 366 days
    const result = normalizeOrganizationResourcePoolQuery({ from, to })
    expect(result.from).toBe(from)
    // to should be clamped to max days from `from`
    const expectedTo = new Date(
      new Date(from).getTime() +
        ORGANIZATION_RESOURCE_POOL_MAX_DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString()
    expect(result.to).toBe(expectedTo)
  })

  it('accepts valid sort keys', () => {
    for (const key of ORGANIZATION_RESOURCE_POOL_SORT_KEY_VALUES) {
      const result = normalizeOrganizationResourcePoolQuery({ sort: key })
      expect(result.sort).toBe(key)
    }
  })

  it('accepts valid view modes', () => {
    for (const mode of ORGANIZATION_RESOURCE_POOL_VIEW_MODE_VALUES) {
      const result = normalizeOrganizationResourcePoolQuery({ view: mode })
      expect(result.view).toBe(mode)
    }
  })

  it('truncates long search', () => {
    const result = normalizeOrganizationResourcePoolQuery({ search: 'a'.repeat(500) })
    expect(result.search!.length).toBeLessThanOrEqual(200)
  })
})

// ─── Load Bucket Mapping ────────────────────────────────────────────────────

describe('Organization Resource Pool — Load Bucket Mapping', () => {
  it('maps negative to unavailable', () => {
    expect(mapLoadBucket(-1)).toBe(ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.UNAVAILABLE)
  })

  it('maps 0–10 to idle', () => {
    expect(mapLoadBucket(0)).toBe(ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.IDLE)
    expect(mapLoadBucket(5)).toBe(ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.IDLE)
    expect(mapLoadBucket(10)).toBe(ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.IDLE)
  })

  it('maps 11–80 to normal', () => {
    expect(mapLoadBucket(11)).toBe(ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.NORMAL)
    expect(mapLoadBucket(50)).toBe(ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.NORMAL)
    expect(mapLoadBucket(80)).toBe(ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.NORMAL)
  })

  it('maps 81–100 to high', () => {
    expect(mapLoadBucket(81)).toBe(ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.HIGH)
    expect(mapLoadBucket(100)).toBe(ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.HIGH)
  })

  it('maps >100 to overloaded', () => {
    expect(mapLoadBucket(101)).toBe(ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.OVERLOADED)
    expect(mapLoadBucket(150)).toBe(ORGANIZATION_RESOURCE_POOL_LOAD_STATUSES.OVERLOADED)
  })
})

// ─── Low-Cardinality Redaction ──────────────────────────────────────────────

describe('Organization Resource Pool — Low-Cardinality Redaction', () => {
  it('count 0 is not low-cardinality', () => {
    expect(isLowCardinalityBucket(0)).toBe(false)
  })

  it('count 1 is low-cardinality (below threshold 3)', () => {
    expect(isLowCardinalityBucket(1)).toBe(true)
  })

  it('count 2 is low-cardinality (below threshold 3)', () => {
    expect(isLowCardinalityBucket(2)).toBe(true)
  })

  it('count 3 meets threshold', () => {
    expect(isLowCardinalityBucket(3)).toBe(false)
  })

  it('custom threshold', () => {
    expect(isLowCardinalityBucket(5, 5)).toBe(false)
    expect(isLowCardinalityBucket(4, 5)).toBe(true)
  })
})

// ─── Freshness Helpers ──────────────────────────────────────────────────────

describe('Organization Resource Pool — Freshness Helpers', () => {
  it('null is stale', () => {
    expect(isOrganizationResourcePoolSourceStale(null)).toBe(true)
  })

  it('old timestamp is stale', () => {
    const old = new Date(Date.now() - 120 * 60 * 1000).toISOString()
    expect(isOrganizationResourcePoolSourceStale(old, 60)).toBe(true)
  })

  it('recent timestamp is not stale', () => {
    const recent = new Date().toISOString()
    expect(isOrganizationResourcePoolSourceStale(recent, 60)).toBe(false)
  })

  it('forbidden freshness', () => {
    const f = makeOrganizationResourcePoolFreshness({
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      lastUpdatedAt: null,
      forbidden: true,
    })
    expect(f.status).toBe(ORGANIZATION_RESOURCE_POOL_STATUSES.FORBIDDEN)
    expect(f.isStale).toBe(false)
  })

  it('unavailable freshness', () => {
    const f = makeOrganizationResourcePoolFreshness({
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      lastUpdatedAt: null,
      unavailable: true,
    })
    expect(f.status).toBe(ORGANIZATION_RESOURCE_POOL_STATUSES.UNAVAILABLE)
  })

  it('freshness hash is stable', () => {
    const f = makeOrganizationResourcePoolFreshness({
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
      lastUpdatedAt: '2026-07-01T00:00:00.000Z',
    })
    const hash1 = organizationResourcePoolFreshnessHash(f)
    const hash2 = organizationResourcePoolFreshnessHash(f)
    expect(hash1).toBe(hash2)
    expect(hash1.length).toBeGreaterThan(0)
  })

  it('merge freshness: picks latest and any stale', () => {
    const a = makeOrganizationResourcePoolFreshness({
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_REGISTRY,
      lastUpdatedAt: '2026-07-01T00:00:00.000Z',
    })
    const b = makeOrganizationResourcePoolFreshness({
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
      lastUpdatedAt: '2026-07-02T00:00:00.000Z',
    })
    const merged = mergeOrganizationResourcePoolFreshness([a, b])
    expect(merged).not.toBeNull()
    expect(merged!.lastUpdatedAt).toBe('2026-07-02T00:00:00.000Z')
    expect(merged!.source).toBe(ORGANIZATION_RESOURCE_POOL_SOURCES.COMPUTED)
  })

  it('merge freshness: empty returns null', () => {
    expect(mergeOrganizationResourcePoolFreshness([])).toBeNull()
  })
})

// ─── Warning Helpers ────────────────────────────────────────────────────────

describe('Organization Resource Pool — Warning Helpers', () => {
  it('merges and deduplicates', () => {
    const w1 = {
      code: ORGANIZATION_RESOURCE_POOL_WARNING_CODES.SOURCE_STALE,
      message: 'stale',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
    }
    const w2 = {
      code: ORGANIZATION_RESOURCE_POOL_WARNING_CODES.SOURCE_STALE,
      message: 'stale',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
    }
    const merged = mergeOrganizationResourcePoolWarnings([w1], [w2])
    expect(merged).toHaveLength(1)
  })

  it('keeps distinct warnings', () => {
    const w1 = {
      code: ORGANIZATION_RESOURCE_POOL_WARNING_CODES.SOURCE_STALE,
      message: 'stale',
      source: ORGANIZATION_RESOURCE_POOL_SOURCES.RESOURCE_ALLOCATION,
    }
    const w2 = {
      code: ORGANIZATION_RESOURCE_POOL_WARNING_CODES.CACHE_DEGRADED,
      message: 'cache',
      source: null,
    }
    const merged = mergeOrganizationResourcePoolWarnings([w1], [w2])
    expect(merged).toHaveLength(2)
  })

  it('handles undefined groups', () => {
    const merged = mergeOrganizationResourcePoolWarnings(undefined)
    expect(merged).toHaveLength(0)
  })
})

// ─── Deterministic Normalization ─────────────────────────────────────────────

describe('Organization Resource Pool — Deterministic Normalization', () => {
  it('normalizeCapacityHours: clamps negative to 0', () => {
    expect(normalizeCapacityHours(-10)).toBe(0)
  })

  it('normalizeCapacityHours: rounds to 2 decimals', () => {
    expect(normalizeCapacityHours(10.123456)).toBe(10.12)
  })

  it('normalizeUtilizationPercent: clamps to 0–100', () => {
    expect(normalizeUtilizationPercent(-5)).toBe(0)
    expect(normalizeUtilizationPercent(150)).toBe(100)
  })

  it('normalizeUtilizationPercent: rounds to 1 decimal', () => {
    expect(normalizeUtilizationPercent(66.666)).toBe(66.7)
  })

  it('stableHash is deterministic', () => {
    const h1 = organizationResourcePoolStableHash('test')
    const h2 = organizationResourcePoolStableHash('test')
    expect(h1).toBe(h2)
    expect(h1).toBe('afd071e5') // known FNV-1a hash of "test"
  })

  it('computeSourceSignature uses stable hash', () => {
    const sig1 = computeSourceSignature(['a', 'b'])
    const sig2 = computeSourceSignature(['a', 'b'])
    expect(sig1).toBe(sig2)
  })

  it('drillDownBucketHash is stable', () => {
    const h1 = computeDrillDownBucketHash({
      kind: 'resource',
      organizationId: 1,
      resourceId: 5,
      projectId: null,
      taskId: null,
      skill: null,
    })
    const h2 = computeDrillDownBucketHash({
      kind: 'resource',
      organizationId: 1,
      resourceId: 5,
      projectId: null,
      taskId: null,
      skill: null,
    })
    expect(h1).toBe(h2)
    expect(h1.length).toBe(8)
  })
})

// ─── Validation Detail ──────────────────────────────────────────────────────

describe('Organization Resource Pool — Validation Detail', () => {
  it('returns stable allowed values', () => {
    const detail = organizationResourcePoolValidationDetail()
    expect(detail.allowedViews.length).toBe(ORGANIZATION_RESOURCE_POOL_VIEW_MODE_VALUES.length)
    expect(detail.allowedSorts.length).toBe(ORGANIZATION_RESOURCE_POOL_SORT_KEY_VALUES.length)
    expect(detail.maxDateWindowDays).toBe(ORGANIZATION_RESOURCE_POOL_MAX_DATE_WINDOW_DAYS)
    expect(detail.maxPerPage).toBe(ORGANIZATION_RESOURCE_POOL_MAX_PER_PAGE)
    expect(detail.maxTopN).toBe(ORGANIZATION_RESOURCE_POOL_MAX_TOP_N)
    expect(detail.maxFreshnessWindowMinutes).toBe(
      ORGANIZATION_RESOURCE_POOL_MAX_FRESHNESS_WINDOW_MINUTES,
    )
  })
})
