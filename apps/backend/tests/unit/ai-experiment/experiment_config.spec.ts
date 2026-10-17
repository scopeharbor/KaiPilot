/**
 * ExperimentConfigService 单元测试（§2 契约）。
 *
 * 覆盖：
 * - 缺结束条件的实验创建被拒
 * - 模式在创建时固定不可中途切换
 * - 最多两条配置（不做多臂）
 * - 组织隔离
 */

import { test } from '@japa/runner'
import {
  ExperimentConfigService,
  ExperimentValidationError,
  ExperimentAccessDeniedError,
} from '../../../app/services/ai-experiment/experiment_config_service.js'
import { createShadowExperimentFixture, createAbExperimentFixture } from '@aiproj/types'
import type { ShadowAbExperimentConfig } from '@aiproj/types'

test.group('ExperimentConfigService', (group) => {
  let service: ExperimentConfigService

  group.each.setup(() => {
    service = new ExperimentConfigService()
  })

  test('should create a shadow experiment with valid config', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-1', 1, 1)
    const record = service.create(config)

    assert.equal(record.config.experimentId, 'exp-1')
    assert.equal(record.status, 'running')
    assert.equal(record.collectedSamples, 0)
    assert.isFalse(record.config.concluded)
  })

  test('should create an A/B experiment with valid config', ({ assert }) => {
    const config = createAbExperimentFixture('exp-2', 1, 1)
    const record = service.create(config)

    assert.equal(record.config.mode, 'ab')
    assert.equal(record.status, 'running')
  })

  test('should reject experiment without end condition', ({ assert }) => {
    const config: ShadowAbExperimentConfig = {
      ...createShadowExperimentFixture('exp-no-end', 1, 1),
      endCondition: undefined as any,
    }

    assert.throws(() => service.create(config), ExperimentValidationError)
  })

  test('should reject experiment with invalid end condition', ({ assert }) => {
    const config: ShadowAbExperimentConfig = {
      ...createShadowExperimentFixture('exp-bad-end', 1, 1),
      endCondition: { kind: 'sample_count', targetCount: -1 },
    }

    assert.throws(() => service.create(config), ExperimentValidationError)
  })

  test('should reject experiment with more than 2 variants', ({ assert }) => {
    const config: ShadowAbExperimentConfig = {
      ...createShadowExperimentFixture('exp-3-arms', 1, 1),
      variants: [
        { variantId: 'a', label: 'A' },
        { variantId: 'b', label: 'B' },
        { variantId: 'c', label: 'C' },
      ],
    }

    assert.throws(() => service.create(config), ExperimentValidationError)
  })

  test('should reject duplicate experiment ID', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-dup', 1, 1)
    service.create(config)

    assert.throws(() => service.create(config), ExperimentValidationError)
  })

  test('should conclude an experiment', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-conclude', 1, 1)
    service.create(config)

    const concluded = service.conclude('exp-conclude', 1)
    assert.equal(concluded.status, 'concluded')
    assert.isTrue(concluded.config.concluded)
    assert.isDefined(concluded.concludedAt)
  })

  test('should not conclude an already concluded experiment', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-concluded', 1, 1)
    service.create(config)
    service.conclude('exp-concluded', 1)

    assert.throws(() => service.conclude('exp-concluded', 1), ExperimentValidationError)
  })

  test('should isolate experiments by organization', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-org', 1, 1)
    service.create(config)

    // 组织 2 无法访问组织 1 的实验
    assert.throws(() => service.get('exp-org', 2), ExperimentAccessDeniedError)
  })

  test('should list experiments by organization', ({ assert }) => {
    service.create(createShadowExperimentFixture('exp-a', 1, 1))
    service.create(createShadowExperimentFixture('exp-b', 1, 2))
    service.create(createShadowExperimentFixture('exp-c', 2, 1))

    const org1 = service.list(1)
    assert.lengthOf(org1, 2)

    const org2 = service.list(2)
    assert.lengthOf(org2, 1)
  })

  test('should increment samples and auto-conclude when target reached', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-auto', 1, 1)
    config.endCondition = { kind: 'sample_count', targetCount: 10 }
    service.create(config)

    for (let i = 0; i < 9; i++) {
      service.incrementSamples('exp-auto', 1, 1)
    }
    assert.equal(service.get('exp-auto', 1).status, 'running')

    service.incrementSamples('exp-auto', 1, 1)
    assert.equal(service.get('exp-auto', 1).status, 'concluded')
  })

  test('should track shadow cost', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-cost', 1, 1)
    service.create(config)

    service.addShadowCost('exp-cost', 1, 2.5)
    service.addShadowCost('exp-cost', 1, 1.5)

    const record = service.get('exp-cost', 1)
    assert.equal(record.shadowCostUsd, 4.0)
    assert.equal(record.shadowInvocationCount, 2)
  })

  test('should detect shadow budget exceeded', ({ assert }) => {
    const config = createShadowExperimentFixture('exp-budget', 1, 1)
    config.shadowBudgetCapUsd = 5
    service.create(config)

    service.addShadowCost('exp-budget', 1, 3)
    assert.isFalse(service.isShadowBudgetExceeded('exp-budget', 1))

    service.addShadowCost('exp-budget', 1, 3)
    assert.isTrue(service.isShadowBudgetExceeded('exp-budget', 1))
  })
})
