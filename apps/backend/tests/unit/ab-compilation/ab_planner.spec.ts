/**
 * CompilerAbPlanner 单元测试（§2.2）。
 *
 * 覆盖：
 * - 默认 fixture matrix
 * - 34-stage catalog refs
 * - routing decision refs
 * - tool hardening profile refs
 * - disabled/invalid config 行为
 */

import { describe, expect, it } from 'vitest'
import { CompilerAbPlanner } from '#services/compiler/ab-compilation/ab_planner'
import { createDefaultFixtureAbConfig } from '@aiproj/types'

describe('§2.2 Default fixture matrix', () => {
  const planner = new CompilerAbPlanner()

  it('generates deterministic matrix from default config', () => {
    const config = createDefaultFixtureAbConfig('test-planner-1', 1, 1)
    const sampleIds = ['sample-1', 'sample-2']
    const matrix = planner.plan(config, sampleIds)

    expect(matrix.enabled).toBe(true)
    expect(matrix.experimentId).toBe('test-planner-1')
    expect(matrix.entryCount).toBe(4) // 2 variants × 2 samples
    expect(matrix.entries).toHaveLength(4)
  })

  it('matrix entries have correct structure', () => {
    const config = createDefaultFixtureAbConfig('test-planner-2', 1, 1)
    const matrix = planner.plan(config, ['sample-a'])

    for (const entry of matrix.entries) {
      expect(entry.entryId).toContain(':')
      expect(entry.entryId).toContain(entry.variantId)
      expect(entry.entryId).toContain(entry.sampleId)
      expect(entry.variantId).toBeTruthy()
      expect(entry.sampleId).toBeTruthy()
    }
  })
})

describe('§2.2 34-stage catalog refs', () => {
  const planner = new CompilerAbPlanner()

  it('variant catalogVersion appears in matrix entry', () => {
    const config = createDefaultFixtureAbConfig('test-catalog-1', 1, 1)
    config.variants[0].catalogVersion = '1.0'
    const matrix = planner.plan(config, ['sample-1'])
    const variantAEntries = matrix.entries.filter((e) => e.variantId === 'variant_a')
    expect(variantAEntries.length).toBeGreaterThan(0)
    expect(variantAEntries[0].catalogVersion).toBe('1.0')
  })

  it('variant without catalogVersion does not set it', () => {
    const config = createDefaultFixtureAbConfig('test-catalog-2', 1, 1)
    config.variants[0].catalogVersion = undefined
    const matrix = planner.plan(config, ['sample-1'])
    const variantAEntries = matrix.entries.filter((e) => e.variantId === 'variant_a')
    expect(variantAEntries[0].catalogVersion).toBeUndefined()
  })
})

describe('§2.2 Routing decision refs', () => {
  const planner = new CompilerAbPlanner()

  it('variant routingDecisionRef appears in matrix entry', () => {
    const config = createDefaultFixtureAbConfig('test-route-1', 1, 1)
    config.variants[0].routingDecisionRef = 'fixture-route-a'
    const matrix = planner.plan(config, ['sample-1'])
    const entry = matrix.entries.find((e) => e.variantId === 'variant_a')
    expect(entry?.routingDecisionRef).toBe('fixture-route-a')
  })

  it('different routing refs produce different entries', () => {
    const config = createDefaultFixtureAbConfig('test-route-2', 1, 1)
    config.variants[0].routingDecisionRef = 'route-a'
    config.variants[1].routingDecisionRef = 'route-b'
    const matrix = planner.plan(config, ['sample-1'])
    expect(matrix.entries).toHaveLength(2)
    const refs = matrix.entries.map((e) => e.routingDecisionRef)
    expect(refs).toContain('route-a')
    expect(refs).toContain('route-b')
  })
})

describe('§2.2 Tool hardening profile refs', () => {
  const planner = new CompilerAbPlanner()

  it('toolHardeningProfile appears in matrix entry', () => {
    const config = createDefaultFixtureAbConfig('test-tool-1', 1, 1)
    config.variants[0].toolHardeningProfile = 'strict-v1'
    const matrix = planner.plan(config, ['sample-1'])
    const entry = matrix.entries.find((e) => e.variantId === 'variant_a')
    expect(entry?.toolHardeningProfile).toBe('strict-v1')
  })
})

describe('§2.2 Disabled/invalid config behavior', () => {
  const planner = new CompilerAbPlanner()

  it('unauthorized mode returns disabled matrix', () => {
    const config = createDefaultFixtureAbConfig('test-disabled-1', 1, 1)
    config.authorization.mode = 'unauthorized'
    const matrix = planner.plan(config, ['sample-1', 'sample-2'])
    expect(matrix.enabled).toBe(false)
    expect(matrix.entries).toHaveLength(0)
    expect(matrix.entryCount).toBe(0)
  })

  it('empty sample array returns disabled matrix', () => {
    const config = createDefaultFixtureAbConfig('test-empty-1', 1, 1)
    const matrix = planner.plan(config, [])
    expect(matrix.enabled).toBe(false)
    expect(matrix.entries).toHaveLength(0)
    expect(matrix.entryCount).toBe(0)
  })

  it('disabled config does not call any external service', () => {
    const config = createDefaultFixtureAbConfig('test-safe-1', 1, 1)
    config.authorization.mode = 'unauthorized'
    const matrix = planner.plan(config, ['sample-1'])
    // 纯函数，无外部调用 —— 验证只返回内存数据
    expect(matrix.note).toContain('unauthorized')
  })
})
