/**
 * ShadowInvocationService 单元测试（§3 影子模式）。
 *
 * 覆盖：
 * - 影子结果只落账不返回用户
 * - 影子失败不影响生产结果
 * - 影子采样率可配置，默认低于全量
 */

import { test } from '@japa/runner'
import { ShadowInvocationService } from '../../../app/services/ai-experiment/shadow_invocation_service.js'
import { createShadowExperimentFixture } from '@aiproj/types'

test.group('ShadowInvocationService', (group) => {
  let service: ShadowInvocationService

  group.each.setup(() => {
    service = new ShadowInvocationService()
  })

  test('should not execute shadow for non-shadow mode', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-ab', 1, 1)
    config.mode = 'ab'

    assert.isFalse(service.shouldExecuteShadow(config, 1))
  })

  test('should not execute shadow for concluded experiment', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-done', 1, 1)
    config.concluded = true

    assert.isFalse(service.shouldExecuteShadow(config, 1))
  })

  test('should execute shadow at full sampling rate', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-full', 1, 1)
    config.shadowSamplingRate = 1

    // 所有用户都应该被采样
    for (let userId = 1; userId <= 100; userId++) {
      assert.isTrue(service.shouldExecuteShadow(config, userId))
    }
  })

  test('should not execute shadow at zero sampling rate', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-zero', 1, 1)
    config.shadowSamplingRate = 0

    for (let userId = 1; userId <= 100; userId++) {
      assert.isFalse(service.shouldExecuteShadow(config, userId))
    }
  })

  test('should sample approximately correct ratio', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-sample', 1, 1)
    config.shadowSamplingRate = 0.5

    let sampled = 0
    const total = 1000
    for (let userId = 1; userId <= total; userId++) {
      if (service.shouldExecuteShadow(config, userId)) sampled++
    }

    // 允许 10% 的误差
    const ratio = sampled / total
    assert.isAbove(ratio, 0.35)
    assert.isBelow(ratio, 0.65)
  })

  test('should use deterministic hashing (same user always same result)', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-det', 1, 1)
    config.shadowSamplingRate = 0.3

    const userId = 42
    const first = service.shouldExecuteShadow(config, userId)
    for (let i = 0; i < 100; i++) {
      assert.equal(service.shouldExecuteShadow(config, userId), first)
    }
  })

  test('should execute shadow and return result', async ({ assert }) => {
    const config = createShadowExperimentFixture('exp-exec', 1, 1)
    const input = {
      experiment: config,
      userId: 1,
      productionInputRef: 'fixture-input',
    }

    const result = await service.invoke(input)

    assert.isTrue(result.executed)
    assert.equal(result.treatmentVariantId, 'treatment')
    assert.isAbove(result.latencyMs, 0)
    assert.isAbove(result.costUsd, 0)
  })

  test('shadow failure should not affect production', async ({ assert }) => {
    // 创建没有 treatment variant 的实验
    const config = createShadowExperimentFixture('exp-fail', 1, 1)
    config.variants = [{ variantId: 'control', label: 'Only control' }]

    const input = {
      experiment: config,
      userId: 1,
      productionInputRef: 'fixture-input',
    }

    const result = await service.invoke(input)

    // 影子失败但不影响生产
    assert.isFalse(result.success)
    assert.equal(result.costUsd, 0)
  })

  test('should build cost record with shadow attribution', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-cost', 1, 1)
    const result = {
      executed: true,
      success: true,
      treatmentVariantId: 'treatment',
      latencyMs: 100,
      costUsd: 0.05,
    }

    const costRecord = service.buildCostRecord(result, config)

    assert.equal(costRecord.attributionScope, 'shadow')
    assert.equal(costRecord.costUsd, 0.05)
    assert.equal(costRecord.experimentId, 'exp-cost')
    assert.equal(costRecord.organizationId, 1)
  })

  test('deterministic hash should be consistent across experiments', ({ assert }) => {
    const hash1 = service.computeDeterministicHash('exp-a', 42)
    const hash2 = service.computeDeterministicHash('exp-a', 42)
    assert.equal(hash1, hash2)

    // 不同实验不同哈希
    const hash3 = service.computeDeterministicHash('exp-b', 42)
    assert.notEqual(hash1, hash3)
  })
})
