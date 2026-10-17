// @aiproj/types - PMO Investment Distribution shared contract tests.

import { describe, expect, test } from 'vitest'
import {
  PMO_INVESTMENT_DISPLAY_MODES,
  PMO_INVESTMENT_DISTRIBUTION_BASIS_VALUES,
  PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS,
  PMO_INVESTMENT_DISTRIBUTION_METRIC_VERSION,
  PMO_INVESTMENT_FINANCIAL_BASIS_VALUES,
  PMO_INVESTMENT_HOURS_PER_PERSON_DAY,
  PMO_INVESTMENT_MAX_TOP_N,
  PMO_INVESTMENT_MIN_BUCKET_PROJECT_COUNT,
  PMO_INVESTMENT_NON_FINANCIAL_BASIS,
  PMO_INVESTMENT_NON_FINANCIAL_BASIS_VALUES,
  PMO_INVESTMENT_SOURCES,
  PMO_INVESTMENT_STALE_THRESHOLD_MINUTES,
  PMO_INVESTMENT_TREND_WINDOWS,
  PMO_INVESTMENT_UNSUPPORTED_FINANCIAL_BASIS,
  PMO_INVESTMENT_WARNING_CODES,
  buildRedactedInvestmentBucket,
  buildUnsupportedFinancialInvestmentSummary,
  investmentHoursFromPersonDays,
  isInvestmentSourceStale,
  isLowSensitiveInvestmentEvidenceRef,
  isPmoInvestmentDimension,
  isPmoInvestmentDisplayMode,
  isPmoInvestmentDistributionBasis,
  isPmoInvestmentFinancialBasis,
  isPmoInvestmentNonFinancialBasis,
  isPmoInvestmentTrendWindow,
  makeInvestmentSourceFreshness,
  makeLowSensitiveInvestmentEvidenceRef,
  mergeLowCardinalityInvestmentBuckets,
  normalizeInvestmentBucketPercentages,
  projectFinancialBasisUnsupportedWarning,
  projectFinancialSourceUnavailableWarning,
  projectPermissionRedactedInvestmentWarning,
  projectSourceUnavailableInvestmentWarning,
  type PmoInvestmentBucket,
} from './pmo-investment-distribution.js'
import {
  makeEffortDistributionFixture,
  makeEmptyInvestmentDistributionFixture,
  makeFinancialUnsupportedDistributionFixture,
  makeProjectCountDistributionFixture,
  makeRedactedInvestmentDistributionFixture,
  makeResourceAllocationDistributionFixture,
  makeStaleSourceDistributionFixture,
} from './pmo-investment-distribution-fixtures.js'

describe('investment distribution constants', () => {
  test('exports stable basis catalogues', () => {
    expect(PMO_INVESTMENT_NON_FINANCIAL_BASIS.PROJECT_COUNT).toBe('project_count')
    expect(PMO_INVESTMENT_NON_FINANCIAL_BASIS.PLANNED_EFFORT_HOURS).toBe('planned_effort_hours')
    expect(PMO_INVESTMENT_NON_FINANCIAL_BASIS.ESTIMATED_EFFORT_HOURS).toBe('estimated_effort_hours')
    expect(PMO_INVESTMENT_NON_FINANCIAL_BASIS.RESOURCE_ALLOCATION_PERCENT).toBe(
      'resource_allocation_percent',
    )
    expect(PMO_INVESTMENT_UNSUPPORTED_FINANCIAL_BASIS.BUDGET_AMOUNT).toBe('budget_amount')
    expect(PMO_INVESTMENT_UNSUPPORTED_FINANCIAL_BASIS.ROI).toBe('roi')
    expect(PMO_INVESTMENT_DISTRIBUTION_BASIS_VALUES.length).toBeGreaterThanOrEqual(12)
  })

  test('exports stable dimensions and display modes', () => {
    expect(PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.PROJECT_TYPE).toBe('project_type')
    expect(PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.TRAFFIC_LIGHT_STATUS).toBe('traffic_light_status')
    expect(Object.values(PMO_INVESTMENT_DISPLAY_MODES)).toEqual([
      'donut',
      'pie',
      'horizontal_bar',
      'stacked_bar',
      'flow',
      'matrix',
    ])
  })

  test('exports limits and version', () => {
    expect(PMO_INVESTMENT_DISTRIBUTION_METRIC_VERSION).toBe('pmo-investment-distribution.v1')
    expect(PMO_INVESTMENT_MAX_TOP_N).toBe(20)
    expect(PMO_INVESTMENT_MIN_BUCKET_PROJECT_COUNT).toBe(2)
    expect(PMO_INVESTMENT_STALE_THRESHOLD_MINUTES).toBe(60)
    expect(PMO_INVESTMENT_HOURS_PER_PERSON_DAY).toBe(8)
    expect(PMO_INVESTMENT_TREND_WINDOWS.LAST_30_DAYS).toBe('last_30_days')
    expect(PMO_INVESTMENT_TREND_WINDOWS.LAST_90_DAYS).toBe('last_90_days')
  })
})

describe('basis and query validators', () => {
  test('accepts non-financial basis and identifies financial basis', () => {
    expect(isPmoInvestmentNonFinancialBasis('project_count')).toBe(true)
    expect(isPmoInvestmentNonFinancialBasis('roi')).toBe(false)
    expect(isPmoInvestmentFinancialBasis('roi')).toBe(true)
    expect(isPmoInvestmentFinancialBasis('project_count')).toBe(false)
    expect(isPmoInvestmentDistributionBasis('actual_cost')).toBe(true)
    expect(isPmoInvestmentDistributionBasis('made_up_basis')).toBe(false)
  })

  test('validates dimensions, display modes, and trend windows', () => {
    expect(isPmoInvestmentDimension('department')).toBe(true)
    expect(isPmoInvestmentDimension('budget_owner')).toBe(false)
    expect(isPmoInvestmentDisplayMode('horizontal_bar')).toBe(true)
    expect(isPmoInvestmentDisplayMode('heatmap')).toBe(false)
    expect(isPmoInvestmentTrendWindow('last_90_days')).toBe(true)
    expect(isPmoInvestmentTrendWindow('last_365_days')).toBe(false)
  })

  test('catalogues keep financial values separate from allowed non-financial basis', () => {
    for (const financialBasis of PMO_INVESTMENT_FINANCIAL_BASIS_VALUES) {
      expect(PMO_INVESTMENT_NON_FINANCIAL_BASIS_VALUES).not.toContain(financialBasis as never)
    }
  })
})

describe('unsupported financial projection', () => {
  test('returns explicit unsupported warnings without numeric values', () => {
    const warning = projectFinancialBasisUnsupportedWarning(
      PMO_INVESTMENT_UNSUPPORTED_FINANCIAL_BASIS.ROI,
    )
    expect(warning.code).toBe(PMO_INVESTMENT_WARNING_CODES.FINANCIAL_BASIS_UNSUPPORTED)
    expect(warning.basis).toBe('roi')

    const summary = buildUnsupportedFinancialInvestmentSummary({
      organizationId: 1,
      actorId: 2,
      basis: PMO_INVESTMENT_UNSUPPORTED_FINANCIAL_BASIS.BUDGET_AMOUNT,
    })
    expect(summary.meta.totalBasisValue).toBeNull()
    expect(summary.buckets).toHaveLength(0)
    expect(summary.warnings[0].code).toBe(PMO_INVESTMENT_WARNING_CODES.FINANCIAL_BASIS_UNSUPPORTED)
  })

  test('source unavailable warning identifies basis and source', () => {
    const sourceWarning = projectSourceUnavailableInvestmentWarning(
      PMO_INVESTMENT_SOURCES.RESOURCE_ALLOCATION,
      PMO_INVESTMENT_NON_FINANCIAL_BASIS.RESOURCE_ALLOCATION_PERCENT,
    )
    expect(sourceWarning.code).toBe(PMO_INVESTMENT_WARNING_CODES.SOURCE_UNAVAILABLE)
    expect(sourceWarning.source).toBe('resource_allocation')

    const financialWarning = projectFinancialSourceUnavailableWarning(
      PMO_INVESTMENT_UNSUPPORTED_FINANCIAL_BASIS.ACTUAL_COST,
    )
    expect(financialWarning.code).toBe(PMO_INVESTMENT_WARNING_CODES.FINANCIAL_SOURCE_UNAVAILABLE)
  })
})

describe('bucket normalization and redaction', () => {
  const buckets: PmoInvestmentBucket[] = [
    makeBucket('a', 1, 1),
    makeBucket('b', 1, 1),
    makeBucket('c', 1, 1),
  ]

  test('normalizes percentages to exactly 100 after rounding', () => {
    const normalized = normalizeInvestmentBucketPercentages(buckets)
    expect(normalized.reduce((sum, bucket) => sum + bucket.percent, 0)).toBe(100)
    expect(normalized.every((bucket) => bucket.percent > 0)).toBe(true)
  })

  test('redacted bucket has no totals or evidence refs', () => {
    const bucket = buildRedactedInvestmentBucket({
      dimension: PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.DEPARTMENT,
      basis: PMO_INVESTMENT_NON_FINANCIAL_BASIS.PROJECT_COUNT,
    })
    expect(bucket.total).toBeNull()
    expect(bucket.projectCount).toBeNull()
    expect(bucket.evidenceRefs).toHaveLength(0)
    expect(bucket.warnings[0].code).toBe(PMO_INVESTMENT_WARNING_CODES.PERMISSION_REDACTED)
  })

  test('low-cardinality buckets are merged without hidden count leakage', () => {
    const merged = mergeLowCardinalityInvestmentBuckets(
      [makeBucket('large', 10, 10), makeBucket('tiny', 1, 1)],
      { dimension: PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.MANAGER },
    )
    const other = merged.find((bucket) => bucket.key === 'other')
    expect(other).toBeDefined()
    expect(other?.total).toBeNull()
    expect(other?.projectCount).toBeNull()
    expect(other?.warnings[0].code).toBe(PMO_INVESTMENT_WARNING_CODES.LOW_CARDINALITY_REDACTED)
  })
})

describe('freshness, evidence refs, and units', () => {
  test('detects stale sources', () => {
    expect(isInvestmentSourceStale(null)).toBe(true)
    expect(isInvestmentSourceStale(new Date().toISOString())).toBe(false)
    const old = new Date(
      Date.now() - (PMO_INVESTMENT_STALE_THRESHOLD_MINUTES + 5) * 60 * 1000,
    ).toISOString()
    expect(isInvestmentSourceStale(old)).toBe(true)
  })

  test('source freshness helper mirrors stale detection', () => {
    const freshness = makeInvestmentSourceFreshness({
      source: PMO_INVESTMENT_SOURCES.PROJECT,
      lastUpdatedAt: null,
    })
    expect(freshness.isStale).toBe(true)
    expect(freshness.staleThresholdMinutes).toBe(PMO_INVESTMENT_STALE_THRESHOLD_MINUTES)
  })

  test('evidence refs are stable and low-sensitive', () => {
    const a = makeLowSensitiveInvestmentEvidenceRef({
      source: PMO_INVESTMENT_SOURCES.PROJECT,
      refSeed: 'project:1',
      valueSummary: 'project_count_bucket',
    })
    const b = makeLowSensitiveInvestmentEvidenceRef({
      source: PMO_INVESTMENT_SOURCES.PROJECT,
      refSeed: 'project:1',
      valueSummary: 'project_count_bucket',
    })
    expect(a.refHash).toBe(b.refHash)
    expect(isLowSensitiveInvestmentEvidenceRef(a)).toBe(true)
    expect(isLowSensitiveInvestmentEvidenceRef({ ...a, forbidden: true })).toBe(false)
  })

  test('person-days convert to documented effort hours', () => {
    expect(investmentHoursFromPersonDays(1.5)).toBe(12)
  })
})

describe('fixtures', () => {
  test('cover empty, non-financial, stale, financial, and redacted states', () => {
    expect(makeEmptyInvestmentDistributionFixture().warnings[0].code).toBe(
      PMO_INVESTMENT_WARNING_CODES.EMPTY_PORTFOLIO,
    )
    expect(makeProjectCountDistributionFixture().meta.basis).toBe('project_count')
    expect(makeEffortDistributionFixture().meta.basis).toBe('estimated_effort_hours')
    expect(makeResourceAllocationDistributionFixture().meta.basis).toBe(
      'resource_allocation_percent',
    )
    expect(makeStaleSourceDistributionFixture().warnings[0].code).toBe(
      PMO_INVESTMENT_WARNING_CODES.SOURCE_STALE,
    )
    expect(makeFinancialUnsupportedDistributionFixture().meta.basis).toBe('roi')
    expect(makeRedactedInvestmentDistributionFixture().buckets[0].total).toBeNull()
  })

  test('fixtures do not leak sensitive keywords', () => {
    const json = JSON.stringify([
      makeProjectCountDistributionFixture(),
      makeResourceAllocationDistributionFixture(),
      makeRedactedInvestmentDistributionFixture(),
    ]).toLowerCase()
    expect(json).not.toContain('prompt')
    expect(json).not.toContain('model_output')
    expect(json).not.toContain('secret')
    expect(json).not.toContain('token')
    expect(json).not.toContain('authorization')
  })
})

describe('permission warning shape', () => {
  test('keeps warning low-sensitive but traceable to query shape', () => {
    const warning = projectPermissionRedactedInvestmentWarning(
      PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.MANAGER,
      PMO_INVESTMENT_NON_FINANCIAL_BASIS.PROJECT_COUNT,
      'redacted',
    )
    expect(warning.code).toBe(PMO_INVESTMENT_WARNING_CODES.PERMISSION_REDACTED)
    expect(warning.dimension).toBe('manager')
    expect(warning.basis).toBe('project_count')
    expect(warning.bucketKey).toBe('redacted')
  })
})

function makeBucket(key: string, total: number, projectCount: number): PmoInvestmentBucket {
  return {
    key,
    label: key,
    total,
    percent: 0,
    projectCount,
    status: 'ok',
    evidenceRefs: [],
    warnings: [],
  }
}
