/**
 * BI 聚合 Validator 单元测试（v3-bi-data-aggregation-service §3.6）。
 */
import { test } from '@japa/runner'
import {
  biAggregationParamsValidator,
  biAggregationQueryValidator,
  normalizeBiAggregationQuery,
  detectUnsafeBiAggregationInput,
  checkUnsupportedBiAggregationMetrics,
} from '#validators/bi_aggregation'
import {
  BI_AGGREGATION_MAX_METRIC_KEYS,
  BI_AGGREGATION_MAX_DIMENSIONS,
  BI_AGGREGATION_MAX_FILTERS,
} from '@aiproj/types'

test.group('BiAggregation Validator — Params', () => {
  test('合法 organizationId 通过', async ({ assert }) => {
    const result = await biAggregationParamsValidator.validate({ organizationId: 1 })
    assert.equal(result.organizationId, 1)
  })

  test('负数 organizationId 拒绝', async ({ assert }) => {
    await assert.rejects(() => biAggregationParamsValidator.validate({ organizationId: -1 }))
  })

  test('非数字 organizationId 拒绝', async ({ assert }) => {
    await assert.rejects(() => biAggregationParamsValidator.validate({ organizationId: 'abc' }))
  })
})

test.group('BiAggregation Validator — Query (合法)', () => {
  test('合法 metricKeys 通过', async ({ assert }) => {
    const normalized = normalizeBiAggregationQuery({ metricKeys: 'bi_trend_progress,risk_summary' })
    const result = await biAggregationQueryValidator.validate(normalized)
    assert.deepEqual(result.metricKeys, ['bi_trend_progress', 'risk_summary'])
  })

  test('合法 scope 通过', async ({ assert }) => {
    const result = await biAggregationQueryValidator.validate({
      metricKeys: ['bi_trend_progress'],
      scope: 'organization',
    })
    assert.equal(result.scope, 'organization')
  })

  test('合法 dimensions 通过', async ({ assert }) => {
    const result = await biAggregationQueryValidator.validate({
      metricKeys: ['bi_trend_progress'],
      dimensions: ['project', 'risk_level'],
    })
    assert.deepEqual(result.dimensions, ['project', 'risk_level'])
  })

  test('合法 window 通过', async ({ assert }) => {
    for (const w of ['last_7_days', 'last_30_days', 'last_90_days', 'current_year']) {
      const result = await biAggregationQueryValidator.validate({
        metricKeys: ['bi_trend_progress'],
        window: w,
      })
      assert.equal(result.window, w)
    }
  })

  test('合法 grain 通过', async ({ assert }) => {
    for (const g of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']) {
      const result = await biAggregationQueryValidator.validate({
        metricKeys: ['bi_trend_progress'],
        grain: g,
      })
      assert.equal(result.grain, g)
    }
  })

  test('合法 compareWith 通过', async ({ assert }) => {
    const result = await biAggregationQueryValidator.validate({
      metricKeys: ['bi_trend_progress'],
      compareWith: 'previous_period',
    })
    assert.equal(result.compareWith, 'previous_period')
  })

  test('合法 filters 通过', async ({ assert }) => {
    const result = await biAggregationQueryValidator.validate({
      metricKeys: ['bi_trend_progress'],
      filters: [{ dimension: 'project', operator: 'eq', value: 'proj_123' }],
    })
    assert.lengthOf(result.filters!, 1)
  })

  test('合法 perPage 通过', async ({ assert }) => {
    const result = await biAggregationQueryValidator.validate({
      metricKeys: ['bi_trend_progress'],
      perPage: 50,
    })
    assert.equal(result.perPage, 50)
  })

  test('合法 includeSources/includeEvidence 布尔值通过', async ({ assert }) => {
    const result = await biAggregationQueryValidator.validate({
      metricKeys: ['bi_trend_progress'],
      includeSources: true,
      includeEvidence: false,
    })
    assert.isTrue(result.includeSources)
    assert.isFalse(result.includeEvidence)
  })
})

test.group('BiAggregation Validator — Query (非法)', () => {
  test('非法 metricKey 拒绝', async ({ assert }) => {
    const normalized = normalizeBiAggregationQuery({ metricKeys: 'invalid_metric' })
    await assert.rejects(() => biAggregationQueryValidator.validate(normalized))
  })

  test('非法 scope 拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      biAggregationQueryValidator.validate({
        metricKeys: ['bi_trend_progress'],
        scope: 'unknown_scope',
      }),
    )
  })

  test('非法 window 拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      biAggregationQueryValidator.validate({
        metricKeys: ['bi_trend_progress'],
        window: 'last_10_years',
      }),
    )
  })

  test('非法 grain 拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      biAggregationQueryValidator.validate({
        metricKeys: ['bi_trend_progress'],
        grain: 'hourly',
      }),
    )
  })

  test('非法 filter dimension 拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      biAggregationQueryValidator.validate({
        metricKeys: ['bi_trend_progress'],
        filters: [{ dimension: 'unknown_dim', operator: 'eq', value: 1 }],
      }),
    )
  })

  test('非法 filter operator 拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      biAggregationQueryValidator.validate({
        metricKeys: ['bi_trend_progress'],
        filters: [{ dimension: 'project', operator: 'regex', value: '.*' }],
      }),
    )
  })

  test('metricKeys 为空拒绝', async ({ assert }) => {
    await assert.rejects(() => biAggregationQueryValidator.validate({ metricKeys: [] }))
  })

  test('metricKeys 超限拒绝', async ({ assert }) => {
    const keys = Array(BI_AGGREGATION_MAX_METRIC_KEYS + 1).fill('bi_trend_progress')
    await assert.rejects(() => biAggregationQueryValidator.validate({ metricKeys: keys }))
  })

  test('dimensions 超限拒绝', async ({ assert }) => {
    const dims = Array(BI_AGGREGATION_MAX_DIMENSIONS + 1).fill('project')
    await assert.rejects(() =>
      biAggregationQueryValidator.validate({
        metricKeys: ['bi_trend_progress'],
        dimensions: dims,
      }),
    )
  })

  test('filters 超限拒绝', async ({ assert }) => {
    const filters = Array(BI_AGGREGATION_MAX_FILTERS + 1).fill({
      dimension: 'project',
      operator: 'eq',
      value: '1',
    })
    await assert.rejects(() =>
      biAggregationQueryValidator.validate({
        metricKeys: ['bi_trend_progress'],
        filters,
      }),
    )
  })

  test('perPage 超限拒绝', async ({ assert }) => {
    await assert.rejects(() =>
      biAggregationQueryValidator.validate({
        metricKeys: ['bi_trend_progress'],
        perPage: 9999,
      }),
    )
  })
})

test.group('BiAggregation Validator — CSV Parse', () => {
  test('逗号分隔字符串解析为数组', async ({ assert }) => {
    const normalized = normalizeBiAggregationQuery({
      metricKeys: 'bi_trend_progress,risk_summary,okr_summary',
    })
    const result = await biAggregationQueryValidator.validate(normalized)
    assert.deepEqual(result.metricKeys, ['bi_trend_progress', 'risk_summary', 'okr_summary'])
  })

  test('数组参数直接使用', async ({ assert }) => {
    const normalized = normalizeBiAggregationQuery({
      metricKeys: ['bi_trend_progress', 'risk_summary'],
    })
    const result = await biAggregationQueryValidator.validate(normalized)
    assert.deepEqual(result.metricKeys, ['bi_trend_progress', 'risk_summary'])
  })

  test('空字符串过滤', async ({ assert }) => {
    const normalized = normalizeBiAggregationQuery({
      metricKeys: 'bi_trend_progress,,risk_summary',
    })
    const result = await biAggregationQueryValidator.validate(normalized)
    assert.deepEqual(result.metricKeys, ['bi_trend_progress', 'risk_summary'])
  })
})

test.group('BiAggregation Validator — Unsafe Input', () => {
  test('SQL injection 被检测', ({ assert }) => {
    const unsafe = detectUnsafeBiAggregationInput({
      metricKeys: 'SELECT * FROM users',
    })
    assert.isAtLeast(unsafe.length, 1)
  })

  test('脚本注入被检测', ({ assert }) => {
    const unsafe = detectUnsafeBiAggregationInput({
      filters: JSON.stringify({ script: "eval('alert')" }),
    })
    assert.isAtLeast(unsafe.length, 1)
  })

  test('URL/HTTP 被检测', ({ assert }) => {
    const unsafe = detectUnsafeBiAggregationInput({
      metricKeys: 'bi_trend_progress; https://evil.com',
    })
    assert.isAtLeast(unsafe.length, 1)
  })

  test('合法查询不被误判', ({ assert }) => {
    const unsafe = detectUnsafeBiAggregationInput({
      metricKeys: 'bi_trend_progress,risk_summary',
      window: 'last_30_days',
      scope: 'organization',
    })
    assert.lengthOf(unsafe, 0)
  })
})

test.group('BiAggregation Validator — Unsupported Metrics', () => {
  test('财务类指标被识别', ({ assert }) => {
    const unsupported = checkUnsupportedBiAggregationMetrics(['budget_cost', 'bi_trend_progress'])
    assert.include(unsupported, 'budget_cost')
    assert.notInclude(unsupported, 'bi_trend_progress')
  })

  test('非财务指标全部通过', ({ assert }) => {
    const unsupported = checkUnsupportedBiAggregationMetrics(['bi_trend_progress', 'risk_summary'])
    assert.lengthOf(unsupported, 0)
  })
})
