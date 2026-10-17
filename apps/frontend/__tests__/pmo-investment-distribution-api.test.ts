import { describe, expect, test } from 'vitest'
import { pmoInvestmentDistributionKeys } from '@/lib/api/pmo-investment-distribution'

describe('pmoInvestmentDistributionKeys', () => {
  test('all/catalogue keys are stable', () => {
    expect(pmoInvestmentDistributionKeys.all).toEqual(['pmo', 'investment-distribution'])
    expect(pmoInvestmentDistributionKeys.catalogue()).toEqual([
      'pmo',
      'investment-distribution',
      'catalogue',
    ])
  })

  test('summary/trends keys include query shape', () => {
    const query = {
      basis: 'project_count' as const,
      dimension: 'project_type' as const,
      displayMode: 'donut' as const,
      topN: 10,
    }
    expect(pmoInvestmentDistributionKeys.summary(query)).toEqual([
      'pmo',
      'investment-distribution',
      'summary',
      query,
    ])
    expect(pmoInvestmentDistributionKeys.trends(query)).toEqual([
      'pmo',
      'investment-distribution',
      'trends',
      query,
    ])
  })

  test('drill-down key includes bucket key', () => {
    const query = {
      bucketKey: 'delivery',
      basis: 'estimated_effort_hours' as const,
      dimension: 'lifecycle_phase' as const,
    }
    expect(pmoInvestmentDistributionKeys.drillDown(query)).toEqual([
      'pmo',
      'investment-distribution',
      'drill-down',
      query,
    ])
  })
})
