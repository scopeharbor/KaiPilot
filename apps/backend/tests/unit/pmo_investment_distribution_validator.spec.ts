import { test } from '@japa/runner'
import {
  pmoInvestmentDistributionDrillDownValidator,
  pmoInvestmentDistributionSummaryValidator,
  pmoInvestmentDistributionTrendValidator,
} from '#validators/pmo_investment_distribution'

test.group('PMO Investment Distribution Validators', () => {
  test('summary validator 接受非财务查询', async ({ assert }) => {
    const result = await pmoInvestmentDistributionSummaryValidator.validate({
      basis: 'project_count',
      dimension: 'project_type',
      displayMode: 'donut',
      topN: 10,
    })
    assert.equal(result.basis, 'project_count')
    assert.equal(result.dimension, 'project_type')
  })

  test('summary validator 接受财务 basis 交给 service 投影 unsupported', async ({ assert }) => {
    const result = await pmoInvestmentDistributionSummaryValidator.validate({ basis: 'roi' })
    assert.equal(result.basis, 'roi')
  })

  test('summary validator 拒绝 unsupported dimension/display mode/topN', async ({ assert }) => {
    await assert.rejects(() =>
      pmoInvestmentDistributionSummaryValidator.validate({ dimension: 'budget_owner' }),
    )
    await assert.rejects(() =>
      pmoInvestmentDistributionSummaryValidator.validate({ displayMode: 'heatmap' }),
    )
    await assert.rejects(() => pmoInvestmentDistributionSummaryValidator.validate({ topN: 999 }))
  })

  test('trend validator 限制窗口', async ({ assert }) => {
    const result = await pmoInvestmentDistributionTrendValidator.validate({
      trendWindow: 'last_90_days',
    })
    assert.equal(result.trendWindow, 'last_90_days')
    await assert.rejects(() =>
      pmoInvestmentDistributionTrendValidator.validate({ trendWindow: 'last_365_days' }),
    )
  })

  test('drill-down validator 要求 bucketKey 并限制 perPage', async ({ assert }) => {
    const result = await pmoInvestmentDistributionDrillDownValidator.validate({
      bucketKey: 'delivery',
      perPage: 50,
    })
    assert.equal(result.bucketKey, 'delivery')
    await assert.rejects(() => pmoInvestmentDistributionDrillDownValidator.validate({}))
    await assert.rejects(() =>
      pmoInvestmentDistributionDrillDownValidator.validate({ bucketKey: 'x', perPage: 999 }),
    )
  })
})
