/**
 * CompilerAbReportBuilder 单元测试（§2.6）。
 *
 * 覆盖：
 * - metric 完整性（五维）
 * - safety regression no_winner
 * - inconclusive quality
 * - redacted JSON/Markdown summary
 */

import { describe, expect, it } from 'vitest'
import { CompilerAbReportBuilder } from '#services/compiler/ab-compilation/ab_report_builder'
import {
  CompilerAbFixtureRunner,
  CompilerAbDefaultFixtureProvider,
} from '#services/compiler/ab-compilation/ab_fixture_runner'
import { CompilerAbPlanner } from '#services/compiler/ab-compilation/ab_planner'
import { createDefaultFixtureAbConfig } from '@aiproj/types'

describe('§2.6 Metric completeness (all 5 groups)', () => {
  const planner = new CompilerAbPlanner()
  const runner = new CompilerAbFixtureRunner({
    provider: new CompilerAbDefaultFixtureProvider(),
    sampleInputs: { s1: 'test', s2: 'test-2' },
  })
  const builder = new CompilerAbReportBuilder()

  it('report contains all 5 metric groups', async () => {
    const config = createDefaultFixtureAbConfig('test-metrics-1', 1, 1)
    const matrix = planner.plan(config, ['s1', 's2'])
    const runResult = await runner.executeMatrix(matrix)
    const report = builder.build(config, runResult.results)

    expect(report.variantMetrics.length).toBeGreaterThanOrEqual(2)

    for (const vm of report.variantMetrics) {
      expect(vm.quality).toBeDefined()
      expect(vm.safety).toBeDefined()
      expect(vm.cost).toBeDefined()
      expect(vm.latency).toBeDefined()
      expect(vm.stability).toBeDefined()

      // quality 子字段
      expect(typeof vm.quality.schemaValidRate).toBe('number')
      expect(typeof vm.quality.candidateBundleSafetyPassRate).toBe('number')
      expect(typeof vm.quality.hallucinationViolationCount).toBe('number')

      // safety 子字段
      expect(typeof vm.safety.noReviewWritebackRisk).toBe('boolean')
      expect(typeof vm.safety.secretExposureDetected).toBe('boolean')

      // cost 子字段（fixture 模式 zero calls）
      expect(vm.cost.realModelCallCount).toBe(0)

      // stability
      expect(typeof vm.stability.stageFailureCount).toBe('number')

      // compositeScore
      expect(vm.compositeScore).toBeGreaterThan(0)
    }
  })
})

describe('§2.6 Safety regression no_winner', () => {
  const builder = new CompilerAbReportBuilder()

  it('safety regression produces no_winner', () => {
    const config = createDefaultFixtureAbConfig('test-safety-no-win', 1, 1)
    // Simulate safety regression in variant_b by building results with bad safety
    const results = [
      {
        entryId: 'va:s1',
        variantId: 'variant_a',
        sampleId: 's1',
        metrics: {
          variantId: 'variant_a',
          quality: {
            schemaValidRate: 0.95,
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
            estimatedTokenCount: 1000,
            estimatedCostUsd: 0,
            realModelCallCount: 0,
            currency: 'USD',
          },
          latency: { totalDurationMs: 200, perStageDurationMs: {}, latencyBuckets: {} },
          stability: { stageFailureCount: 0, totalRetryCount: 0 },
          compositeScore: 0.9,
        },
        fixtureEvidence: [],
        errors: [],
      },
      {
        entryId: 'vb:s1',
        variantId: 'variant_b',
        sampleId: 's1',
        metrics: {
          variantId: 'variant_b',
          quality: {
            schemaValidRate: 0.9,
            candidateBundleSafetyPassRate: 1,
            hallucinationViolationCount: 0,
            ruleViolationCount: 0,
          },
          safety: {
            ruleViolationCount: 1,
            noReviewWritebackRisk: true,
            secretExposureDetected: true,
          },
          cost: {
            estimatedTokenCount: 1000,
            estimatedCostUsd: 0,
            realModelCallCount: 0,
            currency: 'USD',
          },
          latency: { totalDurationMs: 200, perStageDurationMs: {}, latencyBuckets: {} },
          stability: { stageFailureCount: 0, totalRetryCount: 0 },
          compositeScore: 0.6,
        },
        fixtureEvidence: [],
        errors: [],
      },
    ]
    const report = builder.build(config, results)
    expect(report.winnerDecision.result).toBe('no_winner')
    expect(report.winnerDecision.reasonCode).toBe('SAFETY_REGRESSION')
  })
})

describe('§2.6 Inconclusive quality', () => {
  const builder = new CompilerAbReportBuilder()

  it('close scores produce inconclusive winner', () => {
    const config = createDefaultFixtureAbConfig('test-inconclusive', 1, 1)
    const results = [
      {
        entryId: 'va:s1',
        variantId: 'variant_a',
        sampleId: 's1',
        metrics: {
          variantId: 'variant_a',
          quality: {
            schemaValidRate: 0.85,
            candidateBundleSafetyPassRate: 0.95,
            hallucinationViolationCount: 0,
            ruleViolationCount: 0,
          },
          safety: {
            ruleViolationCount: 0,
            noReviewWritebackRisk: false,
            secretExposureDetected: false,
          },
          cost: {
            estimatedTokenCount: 1000,
            estimatedCostUsd: 0,
            realModelCallCount: 0,
            currency: 'USD',
          },
          latency: { totalDurationMs: 200, perStageDurationMs: {}, latencyBuckets: {} },
          stability: { stageFailureCount: 0, totalRetryCount: 0 },
          compositeScore: 0.85,
        },
        fixtureEvidence: [],
        errors: [],
      },
      {
        entryId: 'vb:s1',
        variantId: 'variant_b',
        sampleId: 's1',
        metrics: {
          variantId: 'variant_b',
          quality: {
            schemaValidRate: 0.84,
            candidateBundleSafetyPassRate: 0.95,
            hallucinationViolationCount: 0,
            ruleViolationCount: 0,
          },
          safety: {
            ruleViolationCount: 0,
            noReviewWritebackRisk: false,
            secretExposureDetected: false,
          },
          cost: {
            estimatedTokenCount: 1000,
            estimatedCostUsd: 0,
            realModelCallCount: 0,
            currency: 'USD',
          },
          latency: { totalDurationMs: 210, perStageDurationMs: {}, latencyBuckets: {} },
          stability: { stageFailureCount: 0, totalRetryCount: 0 },
          compositeScore: 0.84,
        },
        fixtureEvidence: [],
        errors: [],
      },
    ]
    const report = builder.build(config, results)
    expect(report.winnerDecision.result).toBe('inconclusive')
  })
})

describe('§2.6 Redacted JSON/Markdown summaries', () => {
  const builder = new CompilerAbReportBuilder()

  it('report summary does not contain forbidden sensitive payload fields', async () => {
    const config = createDefaultFixtureAbConfig('test-redact', 1, 1)
    const planner = new CompilerAbPlanner()
    const runner = new CompilerAbFixtureRunner({
      provider: new CompilerAbDefaultFixtureProvider(),
      sampleInputs: { s1: 'test' },
    })
    const matrix = planner.plan(config, ['s1'])
    const runResult = await runner.executeMatrix(matrix)
    const report = builder.build(config, runResult.results)

    const json = JSON.stringify(report).toLowerCase()
    // Only check for actual payload content — metric property names like
    // "secretExposureDetected" are legitimate schema names, not data leaks.
    expect(json).not.toContain('prompt')
    expect(json).not.toContain('rawoutput')
    expect(json).not.toContain('raw_output')
    expect(json).not.toContain('apikey')
    expect(json).not.toContain('api_key')
    expect(json).not.toContain('password')
    expect(json).not.toContain('privatekey')
    expect(json).not.toContain('authorization')
    expect(json).not.toContain('artifactbody')
    expect(json).not.toContain('contextpacket')
    expect(json).not.toContain('modeloutput')
  })

  it('fixture report has evidenceEligible=false', async () => {
    const config = createDefaultFixtureAbConfig('test-eligible', 1, 1)
    const planner = new CompilerAbPlanner()
    const runner = new CompilerAbFixtureRunner({
      provider: new CompilerAbDefaultFixtureProvider(),
      sampleInputs: { s1: 'test' },
    })
    const matrix = planner.plan(config, ['s1'])
    const runResult = await runner.executeMatrix(matrix)
    const report = builder.build(config, runResult.results)

    expect(report.isFixture).toBe(true)
    expect(report.evidenceEligible).toBe(false)
  })
})
