import { describe, expect, test } from 'vitest'
import {
  formatInvestmentValue,
  isUnsupportedFinancialSummary,
  toInvestmentChartData,
} from '@/lib/pmo-investment-distribution-ui'
import type { PmoInvestmentBucket } from '@aiproj/types'

describe('PMO investment distribution UI helpers', () => {
  test('maps buckets to chart data with safe labels and colors', () => {
    const data = toInvestmentChartData([
      bucket('long', '特别长的项目类型标签需要截断', 60, 60),
      { ...bucket('redacted', '受限部门', null, 0), status: 'redacted', projectCount: null },
    ])
    expect(data[0]!.shortLabel.length).toBeLessThanOrEqual(12)
    expect(data[0]!.color).toBe('#3B6BEF')
    expect(data[1]!.color).toBe('#94A3B8')
    expect(data[1]!.total).toBeNull()
  })

  test('detects unsupported financial warnings', () => {
    expect(isUnsupportedFinancialSummary(['FINANCIAL_BASIS_UNSUPPORTED'])).toBe(true)
    expect(isUnsupportedFinancialSummary(['FINANCIAL_SOURCE_UNAVAILABLE'])).toBe(true)
    expect(isUnsupportedFinancialSummary(['SOURCE_UNAVAILABLE'])).toBe(false)
  })

  test('formats values by basis without financial inference', () => {
    expect(formatInvestmentValue(24, 'estimated_effort_hours')).toBe('24 小时')
    expect(formatInvestmentValue(125, 'resource_allocation_percent')).toBe('125%')
    expect(formatInvestmentValue(null, 'roi')).toBe('不可用')
    expect(formatInvestmentValue(3, 'project_count')).toBe('3')
  })
})

function bucket(
  key: string,
  label: string,
  total: number | null,
  percent: number,
): PmoInvestmentBucket {
  return {
    key,
    label,
    total,
    percent,
    projectCount: total,
    status: 'ok',
    evidenceRefs: [],
    warnings: [],
  }
}
