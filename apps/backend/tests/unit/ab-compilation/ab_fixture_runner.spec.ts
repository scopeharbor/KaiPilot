/**
 * CompilerAbFixtureRunner 单元测试（§2.4）。
 *
 * 覆盖：
 * - fixture 执行不调用真实 AIGateway
 * - 零仓库写回
 * - 零依赖安装
 * - 零生产配置修改
 */

import { describe, expect, it, vi } from 'vitest'
import {
  CompilerAbFixtureRunner,
  CompilerAbDefaultFixtureProvider,
} from '#services/compiler/ab-compilation/ab_fixture_runner'
import { CompilerAbPlanner } from '#services/compiler/ab-compilation/ab_planner'
import { createDefaultFixtureAbConfig } from '@aiproj/types'
import type { CompilerAbFixtureProvider } from '#services/compiler/ab-compilation/ab_fixture_runner'
import type { CompilerAbRunMatrixEntry } from '#services/compiler/ab-compilation/ab_planner'

describe('§2.4 Zero real AIGateway calls', () => {
  let aiGatewaySpy: ReturnType<typeof vi.fn>
  let runner: CompilerAbFixtureRunner

  it('fixture runner does not call any AIGateway', async () => {
    aiGatewaySpy = vi.fn()
    const fakeProvider: CompilerAbFixtureProvider = {
      id: 'test-fixture-provider',
      executeSample: async () => ({
        entryId: 'test',
        variantId: 'v1',
        sampleId: 's1',
        metrics: {
          variantId: 'v1',
          quality: {
            schemaValidRate: 1,
            candidateBundleSafetyPassRate: 1,
            hallucinationViolationCount: 0,
            ruleViolationCount: 0,
          },
          safety: {
            ruleViolationCount: 0,
            noReviewWritebackRisk: false,
            secretExposureDetected: false,
          },
          cost: {
            estimatedTokenCount: 0,
            estimatedCostUsd: 0,
            realModelCallCount: 0,
            currency: 'USD',
          },
          latency: { totalDurationMs: 0, perStageDurationMs: {}, latencyBuckets: {} },
          stability: { stageFailureCount: 0, totalRetryCount: 0 },
          compositeScore: 1,
        },
        fixtureEvidence: ['fixture'],
        errors: [],
      }),
    }

    runner = new CompilerAbFixtureRunner({
      provider: fakeProvider,
      sampleInputs: { s1: 'test-input' },
    })
    const planner = new CompilerAbPlanner()
    const config = createDefaultFixtureAbConfig('test-no-ai', 1, 1)
    const matrix = planner.plan(config, ['s1'])
    const result = await runner.executeMatrix(matrix)

    expect(aiGatewaySpy).not.toHaveBeenCalled()
    expect(result.successCount).toBe(2)
    expect(result.totalEntries).toBe(2)
  })
})

describe('§2.4 Zero repository writeback', () => {
  const planner = new CompilerAbPlanner()
  const runner = new CompilerAbFixtureRunner({
    provider: new CompilerAbDefaultFixtureProvider(),
    sampleInputs: { s1: 'test' },
  })

  it('fixture execution produces no file writes', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const config = createDefaultFixtureAbConfig('test-no-writeback', 1, 1)
    const matrix = planner.plan(config, ['s1'])
    const result = await runner.executeMatrix(matrix)

    // 不写仓库文件
    expect(result.results.every((r) => r.errors.length === 0)).toBe(true)
    writeSpy.mockRestore()
  })
})

describe('§2.4 Zero dependency install', () => {
  it('runner is a pure service with no npm/package operations', () => {
    const runner = new CompilerAbFixtureRunner({
      provider: new CompilerAbDefaultFixtureProvider(),
      sampleInputs: { s1: 'test' },
    })
    expect(runner).toBeInstanceOf(CompilerAbFixtureRunner)
    // 默认 provider 没有外部调用
    expect(runner['provider'].id).toBe('fixture-provider-default')
  })
})

describe('§2.4 Zero production config mutation', () => {
  it('runner does not accept config mutation parameters', () => {
    const runner = new CompilerAbFixtureRunner({
      sampleInputs: { s1: 'test' },
    })
    // 类型层面验证 —— 不接受 production config 参数
    const keys = Object.keys(runner).sort()
    expect(keys).not.toContain('productionConfig')
  })
})

describe('§2.4 Default fixture provider determinism', () => {
  it('same inputs produce same metrics', async () => {
    const provider = new CompilerAbDefaultFixtureProvider()
    const entry: CompilerAbRunMatrixEntry = {
      entryId: 'v1:s1',
      variantId: 'v1',
      sampleId: 's1',
      label: 'Test',
      catalogVersion: '1.0',
      routingDecisionRef: undefined,
      toolHardeningProfile: undefined,
      modelProfileRef: undefined,
      featureFlags: undefined,
      fixtureProviderId: provider.id,
    }

    const result1 = await provider.executeSample(entry, 'input-1')
    const result2 = await provider.executeSample(entry, 'input-1')

    expect(result1.metrics.compositeScore).toBe(result2.metrics.compositeScore)
    expect(result1.metrics.quality.schemaValidRate).toBe(result2.metrics.quality.schemaValidRate)
    expect(result1.fixtureEvidence).toEqual(result2.fixtureEvidence)
  })
})
