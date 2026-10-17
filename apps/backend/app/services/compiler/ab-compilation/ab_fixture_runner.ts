/**
 * CompilerAbFixtureRunner —— Compiler A/B fixture runner（§2.3）。
 *
 * 使用 fixture providers 和 candidate bundle summaries 执行确定性
 * sample/variant 比较。
 *
 * 保证零真实 AIGateway 调用、零仓库写回、零依赖安装、零生产配置修改。
 * 遵循 design D3（fixture 默认 runner）。
 */

import type { CompilerAbRunMatrix, CompilerAbRunMatrixEntry } from './ab_planner.js'
import type {
  CompilerAbMetricSnapshot,
  CompilerAbQualityMetrics,
  CompilerAbSafetyMetrics,
  CompilerAbCostMetrics,
  CompilerAbLatencyMetrics,
  CompilerAbStabilityMetrics,
} from '@aiproj/types'

// ── Fixture Runner Result ─────────────────────────────────────

export interface CompilerAbFixtureResult {
  entryId: string
  variantId: string
  sampleId: string
  metrics: CompilerAbMetricSnapshot
  fixtureEvidence: string[]
  errors: string[]
}

// ── Fixture Provider Interface ────────────────────────────────

export interface CompilerAbFixtureProvider {
  /** Provider 标识。 */
  id: string
  /**
   * 执行单个 sample/variant 组合。
   * 返回 fixture metrics，零真实 AI 调用。
   */
  executeSample(
    entry: CompilerAbRunMatrixEntry,
    sampleInputRef: string,
  ): Promise<CompilerAbFixtureResult>
}

// ── Default Fixture Provider ──────────────────────────────────

export class CompilerAbDefaultFixtureProvider implements CompilerAbFixtureProvider {
  id = 'fixture-provider-default'

  async executeSample(
    entry: CompilerAbRunMatrixEntry,
    _sampleInputRef: string,
  ): Promise<CompilerAbFixtureResult> {
    // 确定性 fixture 指标 —— 模拟一组稳定结果
    const quality: CompilerAbQualityMetrics = {
      schemaValidRate: 0.95,
      candidateBundleSafetyPassRate: 1,
      hallucinationViolationCount: 0,
      ruleViolationCount: 0,
    }

    const safety: CompilerAbSafetyMetrics = {
      ruleViolationCount: 0,
      noReviewWritebackRisk: false,
      secretExposureDetected: false,
    }

    const cost: CompilerAbCostMetrics = {
      estimatedTokenCount: 1000,
      estimatedCostUsd: 0,
      realModelCallCount: 0,
      currency: 'USD',
    }

    const latency: CompilerAbLatencyMetrics = {
      totalDurationMs: 150,
      perStageDurationMs: {},
      latencyBuckets: { '0-100ms': 2, '100-500ms': 1 },
    }

    const stability: CompilerAbStabilityMetrics = {
      stageFailureCount: 0,
      totalRetryCount: 0,
      deterministicDiffSummary: 'No diff (fixture mode)',
    }

    return {
      entryId: entry.entryId,
      variantId: entry.variantId,
      sampleId: entry.sampleId,
      metrics: {
        variantId: entry.variantId,
        quality,
        safety,
        cost,
        latency,
        stability,
        compositeScore: 0.9,
      },
      fixtureEvidence: ['fixture-executed', `provider:${this.id}`],
      errors: [],
    }
  }
}

// ── Fixture Runner ────────────────────────────────────────────

export interface CompilerAbFixtureRunnerOptions {
  provider?: CompilerAbFixtureProvider
  sampleInputs: Record<string, string>
}

export class CompilerAbFixtureRunner {
  private provider: CompilerAbFixtureProvider

  constructor(private options: CompilerAbFixtureRunnerOptions) {
    this.provider = options.provider ?? new CompilerAbDefaultFixtureProvider()
  }

  /**
   * 执行 entire run matrix 的 fixture run。
   * 返回所有 entry 的 fixture 结果。
   * 零真实 AI 调用、零仓库写回。
   */
  async executeMatrix(matrix: CompilerAbRunMatrix): Promise<{
    results: CompilerAbFixtureResult[]
    totalEntries: number
    successCount: number
    failureCount: number
  }> {
    if (!matrix.enabled || matrix.entries.length === 0) {
      return { results: [], totalEntries: 0, successCount: 0, failureCount: 0 }
    }

    const results: CompilerAbFixtureResult[] = []
    let failureCount = 0

    for (const entry of matrix.entries) {
      const sampleInputRef = this.options.sampleInputs[entry.sampleId] ?? entry.sampleId
      try {
        const result = await this.provider.executeSample(entry, sampleInputRef)
        results.push(result)
      } catch (err) {
        failureCount++
        results.push({
          entryId: entry.entryId,
          variantId: entry.variantId,
          sampleId: entry.sampleId,
          metrics: null as unknown as CompilerAbMetricSnapshot,
          fixtureEvidence: [],
          errors: [(err as Error).message ?? 'fixture execution error'],
        })
      }
    }

    return {
      results,
      totalEntries: matrix.entries.length,
      successCount: results.length - failureCount,
      failureCount,
    }
  }
}
