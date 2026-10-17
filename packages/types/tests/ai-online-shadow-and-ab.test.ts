/**
 * ai-online-shadow-and-ab 共享契约测试（§2 契约）。
 *
 * 覆盖：
 * - 模式定义（shadow / ab）
 * - 结束条件验证
 * - 禁存约束（不含 prompt、模型输出、token 与 secret）
 * - 验证函数
 * - Fixtures
 */

import { describe, it, expect } from 'vitest'
import {
  isShadowAbMode,
  isValidEndCondition,
  shadowAbContainsForbiddenFields,
  validateShadowAbConfig,
  createShadowExperimentFixture,
  createAbExperimentFixture,
  createShadowFailureFixture,
  createInsufficientSamplesFixture,
  createConcludedExperimentFixture,
  SHADOW_AB_CONTRACT_VERSION,
  SHADOW_AB_CONCLUSIONS,
} from '../src/ai-online-shadow-and-ab.js'

describe('ai-online-shadow-and-ab', () => {
  describe('isShadowAbMode', () => {
    it('should accept shadow mode', () => {
      expect(isShadowAbMode('shadow')).toBe(true)
    })

    it('should accept ab mode', () => {
      expect(isShadowAbMode('ab')).toBe(true)
    })

    it('should reject unknown mode', () => {
      expect(isShadowAbMode('unknown')).toBe(false)
    })
  })

  describe('isValidEndCondition', () => {
    it('should accept valid time condition', () => {
      const future = new Date(Date.now() + 86400000).toISOString()
      expect(isValidEndCondition({ kind: 'time', endsAt: future })).toBe(true)
    })

    it('should reject past time condition', () => {
      const past = new Date(Date.now() - 86400000).toISOString()
      expect(isValidEndCondition({ kind: 'time', endsAt: past })).toBe(false)
    })

    it('should accept valid sample count condition', () => {
      expect(isValidEndCondition({ kind: 'sample_count', targetCount: 100 })).toBe(true)
    })

    it('should reject zero sample count', () => {
      expect(isValidEndCondition({ kind: 'sample_count', targetCount: 0 })).toBe(false)
    })

    it('should reject negative sample count', () => {
      expect(isValidEndCondition({ kind: 'sample_count', targetCount: -1 })).toBe(false)
    })
  })

  describe('shadowAbContainsForbiddenFields', () => {
    it('should detect prompt in values', () => {
      expect(shadowAbContainsForbiddenFields({ data: 'this contains a prompt' })).toBe(true)
    })

    it('should detect token in values', () => {
      expect(shadowAbContainsForbiddenFields({ apiKey: 'sk-1234567890' })).toBe(true)
    })

    it('should detect secret in values', () => {
      expect(shadowAbContainsForbiddenFields({ config: 'my secret value' })).toBe(true)
    })

    it('should allow clean data', () => {
      expect(
        shadowAbContainsForbiddenFields({
          dimension: 'quality',
          score: 0.85,
          count: 100,
        }),
      ).toBe(false)
    })

    it('should detect modelOutput in nested JSON', () => {
      const data = JSON.stringify({ nested: { model_output: 'test' } })
      expect(shadowAbContainsForbiddenFields(JSON.parse(data))).toBe(true)
    })
  })

  describe('validateShadowAbConfig', () => {
    it('should accept valid shadow config', () => {
      const config = createShadowExperimentFixture('exp-1', 1, 1)
      const result = validateShadowAbConfig(config)
      expect(result.valid).toBe(true)
    })

    it('should accept valid A/B config', () => {
      const config = createAbExperimentFixture('exp-2', 1, 1)
      const result = validateShadowAbConfig(config)
      expect(result.valid).toBe(true)
    })

    it('should reject config without end condition', () => {
      const config = createShadowExperimentFixture('exp-3', 1, 1)
      config.endCondition = undefined as any
      const result = validateShadowAbConfig(config)
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.reasonCode).toBe('SHADOW_AB_CONFIG_INVALID')
      }
    })

    it('should reject config with more than 2 variants', () => {
      const config = createShadowExperimentFixture('exp-4', 1, 1)
      config.variants = [
        { variantId: 'a', label: 'A' },
        { variantId: 'b', label: 'B' },
        { variantId: 'c', label: 'C' },
      ]
      const result = validateShadowAbConfig(config)
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.violations.some((v) => v.includes('exceed 2 variants'))).toBe(true)
      }
    })

    it('should reject config with invalid sampling rate', () => {
      const config = createShadowExperimentFixture('exp-5', 1, 1)
      config.shadowSamplingRate = 1.5
      const result = validateShadowAbConfig(config)
      expect(result.valid).toBe(false)
    })
  })

  describe('fixtures', () => {
    it('should create valid shadow experiment fixture', () => {
      const fixture = createShadowExperimentFixture('test-exp', 1, 1)
      expect(fixture.contractVersion).toBe(SHADOW_AB_CONTRACT_VERSION)
      expect(fixture.mode).toBe('shadow')
      expect(fixture.variants).toHaveLength(2)
      expect(fixture.endCondition).toBeDefined()
      expect(fixture.concluded).toBe(false)
    })

    it('should create valid A/B experiment fixture', () => {
      const fixture = createAbExperimentFixture('test-exp', 1, 1)
      expect(fixture.mode).toBe('ab')
      expect(fixture.variants).toHaveLength(2)
    })

    it('should create shadow failure fixture', () => {
      const fixture = createShadowFailureFixture('test-exp', 1, 1)
      expect(fixture.status).toBe('running')
      expect(fixture.shadowCostUsd).toBeGreaterThan(0)
    })

    it('should create insufficient samples fixture', () => {
      const fixture = createInsufficientSamplesFixture('test-exp', 1)
      expect(fixture.conclusion).toBe('INSUFFICIENT')
      expect(fixture.dimensions[0].insufficientSamples).toBe(true)
    })

    it('should create concluded experiment fixture', () => {
      const fixture = createConcludedExperimentFixture('test-exp', 1, 1)
      expect(fixture.status).toBe('concluded')
      expect(fixture.config.concluded).toBe(true)
      expect(fixture.concludedAt).toBeDefined()
    })
  })

  describe('contract version', () => {
    it('should have a valid version string', () => {
      expect(SHADOW_AB_CONTRACT_VERSION).toBe('1.0')
    })
  })

  describe('conclusions', () => {
    it('should include all required conclusions', () => {
      expect(SHADOW_AB_CONCLUSIONS).toContain('GO')
      expect(SHADOW_AB_CONCLUSIONS).toContain('NO_GO')
      expect(SHADOW_AB_CONCLUSIONS).toContain('INCONCLUSIVE')
      expect(SHADOW_AB_CONCLUSIONS).toContain('INSUFFICIENT')
    })
  })
})
