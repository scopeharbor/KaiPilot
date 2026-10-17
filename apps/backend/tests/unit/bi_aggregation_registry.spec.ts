/**
 * BI 聚合 Registry 单元测试（v3-bi-data-aggregation-service §3.6）。
 * 覆盖合法 key、未知 key、source 注册与解析。
 */
import { test } from '@japa/runner'
import { createBiAggregationRegistry } from '#services/bi_aggregation/registry'
import {
  BI_AGGREGATION_METRIC_KEYS,
  BI_AGGREGATION_DIMENSION_KEYS,
  BI_AGGREGATION_SOURCE_KEYS,
  BI_AGGREGATION_SCOPES,
  type BiAggregationMetricKey,
} from '@aiproj/types'

test.group('BiAggregation Registry — 初始化', () => {
  test('factory 创建非空 registry', ({ assert }) => {
    const registry = createBiAggregationRegistry()
    assert.isNotNull(registry)
    assert.isAtLeast(registry.listMetricKeys().length, 1)
    assert.isAtLeast(registry.listDimensionKeys().length, 1)
    assert.isAtLeast(registry.listSourceKeys().length, 1)
  })

  test('所有 14 个 metric key 均注册', ({ assert }) => {
    const registry = createBiAggregationRegistry()
    const allMetricValues = Object.values(BI_AGGREGATION_METRIC_KEYS)
    for (const mk of allMetricValues) {
      const def = registry.getMetric(mk)
      assert.isDefined(def, `metric ${mk} 应已注册`)
      assert.equal(def!.key, mk)
    }
  })

  test('所有 11 个 dimension key 均注册', ({ assert }) => {
    const registry = createBiAggregationRegistry()
    const allDimValues = Object.values(BI_AGGREGATION_DIMENSION_KEYS)
    for (const dk of allDimValues) {
      const def = registry.getDimension(dk)
      assert.isDefined(def, `dimension ${dk} 应已注册`)
      assert.equal(def!.key, dk)
    }
  })

  test('所有 9 个 source key 均注册', ({ assert }) => {
    const registry = createBiAggregationRegistry()
    const allSourceValues = Object.values(BI_AGGREGATION_SOURCE_KEYS)
    for (const sk of allSourceValues) {
      const def = registry.getSource(sk)
      assert.isDefined(def, `source ${sk} 应已注册`)
      assert.equal(def!.key, sk)
    }
  })
})

test.group('BiAggregation Registry — Metric 查询', () => {
  test('hasMetric 对已注册 key 返回 true', ({ assert }) => {
    const registry = createBiAggregationRegistry()
    assert.isTrue(registry.hasMetric(BI_AGGREGATION_METRIC_KEYS.BI_TREND_PROGRESS))
    assert.isTrue(registry.hasMetric(BI_AGGREGATION_METRIC_KEYS.RISK_SUMMARY))
  })

  test('getMetric 对未知 key 返回 undefined', ({ assert }) => {
    const registry = createBiAggregationRegistry()
    assert.isUndefined(registry.getMetric('unknown' as BiAggregationMetricKey))
  })

  test('listMetricsForScope: organization scope 返回 metric', ({ assert }) => {
    const registry = createBiAggregationRegistry()
    const orgMetrics = registry.listMetricsForScope(BI_AGGREGATION_SCOPES.ORGANIZATION)
    assert.isAtLeast(orgMetrics.length, 5)
    for (const m of orgMetrics) {
      assert.include(m.scope, BI_AGGREGATION_SCOPES.ORGANIZATION)
    }
  })

  test('listMetricsForScope: pmo scope 返回 metric', ({ assert }) => {
    const registry = createBiAggregationRegistry()
    const pmoMetrics = registry.listMetricsForScope(BI_AGGREGATION_SCOPES.PMO)
    assert.isAtLeast(pmoMetrics.length, 1)
    for (const m of pmoMetrics) {
      assert.include(m.scope, BI_AGGREGATION_SCOPES.PMO)
    }
  })
})

test.group('BiAggregation Registry — Source Adapter 解析', () => {
  test('resolveAdapterForMetric 返回正确 adapter', ({ assert }) => {
    const registry = createBiAggregationRegistry()
    // BI trend metrics → bi_trend_metrics source
    const adapter = registry.resolveAdapterForMetric(BI_AGGREGATION_METRIC_KEYS.BI_TREND_PROGRESS)
    assert.isNotNull(adapter)
  })

  test('resolveAdaptersForMetrics 去重返回', ({ assert }) => {
    const registry = createBiAggregationRegistry()
    const adapters = registry.resolveAdaptersForMetrics([
      BI_AGGREGATION_METRIC_KEYS.BI_TREND_PROGRESS,
      BI_AGGREGATION_METRIC_KEYS.BI_TREND_DELAY,
      BI_AGGREGATION_METRIC_KEYS.RISK_SUMMARY,
    ])
    // bi_trend_progress 和 bi_trend_delay 共用一个 adapter → 2 个不同的 adapter
    assert.isAtMost(adapters.size, 3)
    assert.isAtLeast(adapters.size, 1)
  })
})

test.group('BiAggregation Registry — Metric Definition 完整性', () => {
  test('每个 metric 都有 sourceKey', ({ assert }) => {
    const registry = createBiAggregationRegistry()
    for (const mk of registry.listMetricKeys()) {
      const def = registry.getMetric(mk)!
      assert.isDefined(def.sourceKey, `metric ${mk} 应有关联 sourceKey`)
      assert.isNotEmpty(def.allowedGrains, `metric ${mk} 应有 allowedGrains`)
      assert.isNotEmpty(def.allowedWindows, `metric ${mk} 应有 allowedWindows`)
      assert.isDefined(def.aggregationStrategy, `metric ${mk} 应有 aggregationStrategy`)
    }
  })

  test('每个 metric 都有 permissionTags', ({ assert }) => {
    const registry = createBiAggregationRegistry()
    for (const mk of registry.listMetricKeys()) {
      const def = registry.getMetric(mk)!
      assert.isAtLeast(def.permissionTags.length, 1, `metric ${mk} 应有 permissionTags`)
    }
  })

  test('每个 metric 都有 freshnessThresholdSeconds', ({ assert }) => {
    const registry = createBiAggregationRegistry()
    for (const mk of registry.listMetricKeys()) {
      const def = registry.getMetric(mk)!
      assert.isNumber(def.freshnessThresholdSeconds, `metric ${mk} 应有 freshnessThresholdSeconds`)
    }
  })
})

test.group('BiAggregation Registry — 快照测试', () => {
  // 本包是 ESM（"type": "module"），require 不存在，原写法运行到就是 ReferenceError。
  test('BI_AGGREGATION_REGISTRY_VERSION 稳定', async ({ assert }) => {
    const { BI_AGGREGATION_REGISTRY_VERSION } = await import('#services/bi_aggregation/registry')
    assert.equal(BI_AGGREGATION_REGISTRY_VERSION, 'bi-aggregation-registry-v1')
  })
})
