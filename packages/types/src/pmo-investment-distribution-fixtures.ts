// @aiproj/types - PMO Investment Distribution contract fixtures.

import {
  PMO_INVESTMENT_BUCKET_STATUSES,
  PMO_INVESTMENT_DISPLAY_MODES,
  PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS,
  PMO_INVESTMENT_DISTRIBUTION_METRIC_VERSION,
  PMO_INVESTMENT_NON_FINANCIAL_BASIS,
  PMO_INVESTMENT_SOURCES,
  PMO_INVESTMENT_UNSUPPORTED_FINANCIAL_BASIS,
  buildRedactedInvestmentBucket,
  buildUnsupportedFinancialInvestmentSummary,
  makeInvestmentSourceFreshness,
  makeLowSensitiveInvestmentEvidenceRef,
  normalizeInvestmentBucketPercentages,
  projectEmptyInvestmentPortfolioWarning,
  projectStaleInvestmentWarning,
  type PmoInvestmentDistributionMeta,
  type PmoInvestmentDistributionSummary,
} from './pmo-investment-distribution.js'

const DEFAULT_CALCULATED_AT = '2026-07-28T00:00:00.000Z'
const DEFAULT_UPDATED_AT = '2026-07-28T00:00:00.000Z'
const STALE_UPDATED_AT = '2026-07-20T00:00:00.000Z'

function makeBaseMeta(
  overrides: Partial<PmoInvestmentDistributionMeta> = {},
): PmoInvestmentDistributionMeta {
  return {
    calculatedAt: DEFAULT_CALCULATED_AT,
    metricVersion: PMO_INVESTMENT_DISTRIBUTION_METRIC_VERSION,
    organizationId: 1,
    actorId: 10,
    visibleProjectCount: 6,
    basis: PMO_INVESTMENT_NON_FINANCIAL_BASIS.PROJECT_COUNT,
    dimension: PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.PROJECT_TYPE,
    displayMode: PMO_INVESTMENT_DISPLAY_MODES.DONUT,
    totalBasisValue: 6,
    sourceFreshness: [
      makeInvestmentSourceFreshness({
        source: PMO_INVESTMENT_SOURCES.PROJECT,
        lastUpdatedAt: DEFAULT_UPDATED_AT,
      }),
    ],
    inputSignatureHash: 'fixture-project-count',
    ...overrides,
  }
}

export function makeEmptyInvestmentDistributionFixture(): PmoInvestmentDistributionSummary {
  const warning = projectEmptyInvestmentPortfolioWarning()
  return {
    meta: makeBaseMeta({
      visibleProjectCount: 0,
      totalBasisValue: 0,
      inputSignatureHash: 'fixture-empty',
    }),
    buckets: [],
    warnings: [warning],
  }
}

export function makeProjectCountDistributionFixture(): PmoInvestmentDistributionSummary {
  const buckets = normalizeInvestmentBucketPercentages([
    {
      key: 'delivery',
      label: '交付项目',
      total: 3,
      percent: 0,
      projectCount: 3,
      status: PMO_INVESTMENT_BUCKET_STATUSES.OK,
      evidenceRefs: [
        makeLowSensitiveInvestmentEvidenceRef({
          source: PMO_INVESTMENT_SOURCES.PROJECT,
          refSeed: 'project_type:delivery',
          valueSummary: 'project_count_bucket',
          lastUpdatedAt: DEFAULT_UPDATED_AT,
        }),
      ],
      warnings: [],
    },
    {
      key: 'research',
      label: '研究项目',
      total: 2,
      percent: 0,
      projectCount: 2,
      status: PMO_INVESTMENT_BUCKET_STATUSES.OK,
      evidenceRefs: [
        makeLowSensitiveInvestmentEvidenceRef({
          source: PMO_INVESTMENT_SOURCES.PROJECT,
          refSeed: 'project_type:research',
          valueSummary: 'project_count_bucket',
          lastUpdatedAt: DEFAULT_UPDATED_AT,
        }),
      ],
      warnings: [],
    },
    {
      key: 'unknown',
      label: '未分类',
      total: 1,
      percent: 0,
      projectCount: 1,
      status: PMO_INVESTMENT_BUCKET_STATUSES.OK,
      evidenceRefs: [],
      warnings: [],
    },
  ])

  return {
    meta: makeBaseMeta(),
    buckets,
    warnings: [],
  }
}

export function makeEffortDistributionFixture(): PmoInvestmentDistributionSummary {
  const buckets = normalizeInvestmentBucketPercentages([
    {
      key: 'phase-build',
      label: '建设阶段',
      total: 160,
      percent: 0,
      projectCount: 2,
      status: PMO_INVESTMENT_BUCKET_STATUSES.OK,
      evidenceRefs: [
        makeLowSensitiveInvestmentEvidenceRef({
          source: PMO_INVESTMENT_SOURCES.TASK_REQUIREMENT,
          refSeed: 'lifecycle_phase:phase-build',
          valueSummary: 'estimated_effort_hours_bucket',
          lastUpdatedAt: DEFAULT_UPDATED_AT,
        }),
      ],
      warnings: [],
    },
    {
      key: 'phase-run',
      label: '运营阶段',
      total: 80,
      percent: 0,
      projectCount: 2,
      status: PMO_INVESTMENT_BUCKET_STATUSES.OK,
      evidenceRefs: [],
      warnings: [],
    },
  ])

  return {
    meta: makeBaseMeta({
      basis: PMO_INVESTMENT_NON_FINANCIAL_BASIS.ESTIMATED_EFFORT_HOURS,
      dimension: PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.LIFECYCLE_PHASE,
      totalBasisValue: 240,
      visibleProjectCount: 4,
      inputSignatureHash: 'fixture-effort',
    }),
    buckets,
    warnings: [],
  }
}

export function makeResourceAllocationDistributionFixture(): PmoInvestmentDistributionSummary {
  const buckets = normalizeInvestmentBucketPercentages([
    {
      key: 'platform',
      label: '平台部',
      total: 220,
      percent: 0,
      projectCount: 4,
      status: PMO_INVESTMENT_BUCKET_STATUSES.OK,
      evidenceRefs: [
        makeLowSensitiveInvestmentEvidenceRef({
          source: PMO_INVESTMENT_SOURCES.RESOURCE_ALLOCATION,
          refSeed: 'department:platform',
          valueSummary: 'allocation_percent_bucket',
          lastUpdatedAt: DEFAULT_UPDATED_AT,
        }),
      ],
      warnings: [],
    },
    buildRedactedInvestmentBucket({
      key: 'restricted-department',
      label: '受限部门',
      dimension: PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.DEPARTMENT,
      basis: PMO_INVESTMENT_NON_FINANCIAL_BASIS.RESOURCE_ALLOCATION_PERCENT,
    }),
  ])

  return {
    meta: makeBaseMeta({
      basis: PMO_INVESTMENT_NON_FINANCIAL_BASIS.RESOURCE_ALLOCATION_PERCENT,
      dimension: PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.DEPARTMENT,
      displayMode: PMO_INVESTMENT_DISPLAY_MODES.HORIZONTAL_BAR,
      totalBasisValue: 220,
      visibleProjectCount: 5,
      inputSignatureHash: 'fixture-resource-allocation',
    }),
    buckets,
    warnings: buckets.flatMap((bucket) => bucket.warnings),
  }
}

export function makeStaleSourceDistributionFixture(): PmoInvestmentDistributionSummary {
  const staleWarning = projectStaleInvestmentWarning(PMO_INVESTMENT_SOURCES.PROJECT)
  return {
    meta: makeBaseMeta({
      sourceFreshness: [
        makeInvestmentSourceFreshness({
          source: PMO_INVESTMENT_SOURCES.PROJECT,
          lastUpdatedAt: STALE_UPDATED_AT,
        }),
      ],
      inputSignatureHash: 'fixture-stale',
    }),
    buckets: [
      {
        key: 'delivery',
        label: '交付项目',
        total: 6,
        percent: 100,
        projectCount: 6,
        status: PMO_INVESTMENT_BUCKET_STATUSES.STALE,
        evidenceRefs: [
          makeLowSensitiveInvestmentEvidenceRef({
            source: PMO_INVESTMENT_SOURCES.PROJECT,
            refSeed: 'stale:delivery',
            valueSummary: 'stale_project_count_bucket',
            lastUpdatedAt: STALE_UPDATED_AT,
          }),
        ],
        warnings: [staleWarning],
      },
    ],
    warnings: [staleWarning],
  }
}

export function makeFinancialUnsupportedDistributionFixture(): PmoInvestmentDistributionSummary {
  return buildUnsupportedFinancialInvestmentSummary({
    organizationId: 1,
    actorId: 10,
    basis: PMO_INVESTMENT_UNSUPPORTED_FINANCIAL_BASIS.ROI,
    displayMode: PMO_INVESTMENT_DISPLAY_MODES.MATRIX,
    calculatedAt: DEFAULT_CALCULATED_AT,
  })
}

export function makeRedactedInvestmentDistributionFixture(): PmoInvestmentDistributionSummary {
  const redactedBucket = buildRedactedInvestmentBucket({
    dimension: PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.MANAGER,
    basis: PMO_INVESTMENT_NON_FINANCIAL_BASIS.PROJECT_COUNT,
  })
  return {
    meta: makeBaseMeta({
      dimension: PMO_INVESTMENT_DISTRIBUTION_DIMENSIONS.MANAGER,
      totalBasisValue: null,
      inputSignatureHash: 'fixture-redacted',
    }),
    buckets: [redactedBucket],
    warnings: redactedBucket.warnings,
  }
}
