/**
 * BI 趋势分析 Validator 单元测试（v3-bi-trend-analysis §3.2, §3.9）。
 */
import { test } from '@japa/runner'
import {
  biTrendAnalysisParamsValidator,
  biTrendAnalysisQueryValidator,
  normalizeBiTrendQuery,
} from '#validators/bi_trend_analysis'

test.group('BiTrendAnalysisValidator', () => {
  test('路由参数：valid organizationId 通过', async ({ assert }) => {
    const result = await biTrendAnalysisParamsValidator.validate({ organizationId: 1 })
    assert.equal(result.organizationId, 1)
  })

  test('路由参数：负数 organizationId 拒绝', async ({ assert }) => {
    await assert.rejects(() => biTrendAnalysisParamsValidator.validate({ organizationId: -1 }))
  })

  test('路由参数：非数字 organizationId 拒绝', async ({ assert }) => {
    await assert.rejects(() => biTrendAnalysisParamsValidator.validate({ organizationId: 'abc' }))
  })

  test('查询参数：valid metricKeys 通过', async ({ assert }) => {
    const normalized = normalizeBiTrendQuery({
      metricKeys: 'project_progress,schedule_delay_pressure',
      window: 'last_12_weeks',
      grain: 'week',
    })
    const result = await biTrendAnalysisQueryValidator.validate(normalized)
    assert.deepEqual(result.metricKeys, ['project_progress', 'schedule_delay_pressure'])
  })

  test('查询参数：非法 metricKey 拒绝', async ({ assert }) => {
    const normalized = normalizeBiTrendQuery({ metricKeys: 'invalid_metric' })
    await assert.rejects(() => biTrendAnalysisQueryValidator.validate(normalized))
  })

  test('查询参数：valid window 通过', async ({ assert }) => {
    const tests = [
      'last_30_days',
      'last_90_days',
      'last_12_weeks',
      'last_6_months',
      'last_12_months',
    ]
    for (const w of tests) {
      const result = await biTrendAnalysisQueryValidator.validate({ window: w, grain: 'week' })
      assert.equal(result.window, w)
    }
  })

  test('查询参数：非法 window 拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      biTrendAnalysisQueryValidator.validate({ window: 'last_10_years', grain: 'week' }),
    )
  })

  test('查询参数：valid grain 通过', async ({ assert }) => {
    for (const g of ['day', 'week', 'month']) {
      const result = await biTrendAnalysisQueryValidator.validate({
        grain: g,
        window: 'last_12_weeks',
      })
      assert.equal(result.grain, g)
    }
  })

  test('查询参数：非法 grain 拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      biTrendAnalysisQueryValidator.validate({ grain: 'hour', window: 'last_12_weeks' }),
    )
  })

  test('查询参数：perPage 超限拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      biTrendAnalysisQueryValidator.validate({
        perPage: 9999,
        window: 'last_12_weeks',
        grain: 'week',
      }),
    )
  })

  test('查询参数：空查询返回默认值', async ({ assert }) => {
    const result = await biTrendAnalysisQueryValidator.validate({
      window: 'last_12_weeks',
      grain: 'week',
    })
    assert.isUndefined(result.metricKeys)
    assert.isUndefined(result.page)
    assert.isUndefined(result.perPage)
  })

  test('CSV 解析：逗号分隔转数组', async ({ assert }) => {
    const result = normalizeBiTrendQuery({
      metricKeys: 'project_progress,risk_pressure',
    })
    assert.deepEqual(result.metricKeys, ['project_progress', 'risk_pressure'])
  })

  test('CSV 解析：数组保持原样', async ({ assert }) => {
    const result = normalizeBiTrendQuery({
      metricKeys: ['project_progress', 'risk_pressure'],
    })
    assert.deepEqual(result.metricKeys, ['project_progress', 'risk_pressure'])
  })

  test('布尔转换：字符串 true/false', async ({ assert }) => {
    const result = normalizeBiTrendQuery({ includeAnomalies: 'true', includeForecast: 'false' })
    assert.equal(result.includeAnomalies, true)
    assert.equal(result.includeForecast, false)
  })
})
