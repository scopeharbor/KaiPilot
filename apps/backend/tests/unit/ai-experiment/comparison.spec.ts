/**
 * ComparisonService 单元测试（§6 对比与结论）。
 *
 * 覆盖：
 * - 五维对比（质量、成本、延迟、失败率、降级率）
 * - 结论呈现差异与置信区间
 * - 样本不足时明确标注
 * - 结论不自动上线
 * - 对比确定性
 */

import { test } from '@japa/runner'
import { ComparisonService } from '../../../app/services/ai-experiment/comparison_service.js'
import { createShadowExperimentFixture } from '@aiproj/types'
import type {
  ComparisonInput,
  MetricDataPoint,
} from '../../../app/services/ai-experiment/comparison_service.js'

test.group('ComparisonService', (group) => {
  let service: ComparisonService

  group.each.setup(() => {
    service = new ComparisonService()
  })

  function generateData(
    count: number,
    overrides: Partial<MetricDataPoint> = {},
  ): MetricDataPoint[] {
    return Array.from({ length: count }, () => ({
      qualityScore: 0.8 + Math.random() * 0.1,
      costUsd: 0.01 + Math.random() * 0.05,
      latencyMs: 100 + Math.random() * 200,
      failed: false,
      degraded: false,
      ...overrides,
    }))
  }

  test('should produce five dimensions in comparison', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-5d', 1, 1)
    const input: ComparisonInput = {
      experiment: config,
      controlData: generateData(50),
      treatmentData: generateData(50),
    }

    const result = service.compare(input)

    assert.lengthOf(result.dimensions, 5)
    assert.equal(result.dimensions[0].dimension, 'quality')
    assert.equal(result.dimensions[1].dimension, 'cost')
    assert.equal(result.dimensions[2].dimension, 'latency')
    assert.equal(result.dimensions[3].dimension, 'failure_rate')
    assert.equal(result.dimensions[4].dimension, 'degradation_rate')
  })

  test('should present confidence intervals', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-ci', 1, 1)
    const input: ComparisonInput = {
      experiment: config,
      controlData: generateData(50),
      treatmentData: generateData(50),
    }

    const result = service.compare(input)

    for (const dim of result.dimensions) {
      assert.isDefined(dim.ciLower)
      assert.isDefined(dim.ciUpper)
      assert.isAtMost(dim.ciLower, dim.ciUpper)
    }
  })

  test('should label insufficient samples', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-insuff', 1, 1)
    const input: ComparisonInput = {
      experiment: config,
      controlData: generateData(5),
      treatmentData: generateData(5),
    }

    const result = service.compare(input)

    assert.equal(result.conclusion, 'INSUFFICIENT')
    for (const dim of result.dimensions) {
      assert.isTrue(dim.insufficientSamples)
    }
  })

  test('should produce GO conclusion for significant improvement', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-go', 1, 1)
    const input: ComparisonInput = {
      experiment: config,
      controlData: generateData(100, { qualityScore: 0.7, costUsd: 0.03 }),
      treatmentData: generateData(100, { qualityScore: 0.9, costUsd: 0.03 }),
    }

    const result = service.compare(input)
    assert.equal(result.conclusion, 'GO')
  })

  test('should produce NO_GO conclusion for quality regression', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-nogo', 1, 1)
    const input: ComparisonInput = {
      experiment: config,
      controlData: generateData(100, { qualityScore: 0.9 }),
      treatmentData: generateData(100, { qualityScore: 0.7 }),
    }

    const result = service.compare(input)
    assert.equal(result.conclusion, 'NO_GO')
  })

  test('should be deterministic (same data, same conclusion)', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-det', 1, 1)
    const controlData = generateData(50)
    const treatmentData = generateData(50)

    const input1: ComparisonInput = { experiment: config, controlData, treatmentData }
    const input2: ComparisonInput = { experiment: config, controlData, treatmentData }

    const result1 = service.compare(input1)
    const result2 = service.compare(input2)

    assert.equal(result1.conclusion, result2.conclusion)
    assert.equal(result1.snapshotHash, result2.snapshotHash)
  })

  test('should not write any configuration (no auto-switch)', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-noswitch', 1, 1)
    const input: ComparisonInput = {
      experiment: config,
      controlData: generateData(100),
      treatmentData: generateData(100, { qualityScore: 0.95 }),
    }

    const result = service.compare(input)

    // 结论只包含数据，不包含任何配置切换指令
    assert.notInclude(JSON.stringify(result), 'switchConfig')
    assert.notInclude(JSON.stringify(result), 'applyConfig')
    assert.notInclude(JSON.stringify(result), 'rollout')
    assert.notInclude(JSON.stringify(result), 'promote')
  })
})
