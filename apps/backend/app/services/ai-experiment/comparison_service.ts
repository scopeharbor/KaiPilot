/**
 * ComparisonService —— 对比与结论（§6 对比与结论）。
 *
 * 职责：
 * - 五维对比（质量、成本、延迟、失败率、降级率）
 * - 结论呈现差异与置信区间，而非单点数值
 * - 样本不足时明确标注而非给出误导性结论
 * - 结论不自动上线：无任何自动切换配置的路径
 * - 对比确定性：同一数据快照产出同一结论
 *
 * 遵循 design D6（结论只呈现差异与置信区间，不自动上线）。
 */

import type {
  ShadowAbComparisonRecord,
  ShadowAbComparisonDimension,
  ShadowAbConclusion,
  ShadowAbExperimentConfig,
} from '@aiproj/types'

export interface ComparisonInput {
  /** 实验配置。 */
  experiment: ShadowAbExperimentConfig
  /** 控制组数据。 */
  controlData: MetricDataPoint[]
  /** 实验组数据。 */
  treatmentData: MetricDataPoint[]
}

export interface MetricDataPoint {
  /** 质量评分（0~1）。 */
  qualityScore: number
  /** 成本（USD）。 */
  costUsd: number
  /** 延迟（ms）。 */
  latencyMs: number
  /** 是否失败。 */
  failed: boolean
  /** 是否降级。 */
  degraded: boolean
}

interface DimensionStats {
  mean: number
  count: number
}

const MIN样本量 = 30

export class ComparisonService {
  /**
   * 执行五维对比。
   */
  compare(input: ComparisonInput): ShadowAbComparisonRecord {
    const controlStats = this.computeStats(input.controlData)
    const treatmentStats = this.computeStats(input.treatmentData)

    const dimensions: ShadowAbComparisonDimension[] = [
      this.buildDimension('quality', controlStats.quality, treatmentStats.quality),
      this.buildDimension('cost', controlStats.cost, treatmentStats.cost),
      this.buildDimension('latency', controlStats.latency, treatmentStats.latency),
      this.buildDimension('failure_rate', controlStats.failureRate, treatmentStats.failureRate),
      this.buildDimension(
        'degradation_rate',
        controlStats.degradationRate,
        treatmentStats.degradationRate,
      ),
    ]

    const conclusion = this.determineConclusion(dimensions)
    const reasonSummary = this.buildReasonSummary(conclusion, dimensions)

    // 确定性快照哈希
    const snapshotHash = this.computeSnapshotHash(input)

    return {
      recordId: `cmp-${input.experiment.experimentId}-${Date.now()}`,
      experimentId: input.experiment.experimentId,
      organizationId: input.experiment.organizationId,
      controlVariantId: input.experiment.variants[0]?.variantId ?? 'control',
      treatmentVariantId: input.experiment.variants[1]?.variantId ?? 'treatment',
      dimensions,
      conclusion,
      reasonSummary,
      createdAt: new Date().toISOString(),
      snapshotHash,
    }
  }

  /**
   * 计算数据点的统计信息。
   */
  private computeStats(data: MetricDataPoint[]): {
    quality: DimensionStats
    cost: DimensionStats
    latency: DimensionStats
    failureRate: DimensionStats
    degradationRate: DimensionStats
  } {
    const n = data.length
    if (n === 0) {
      return {
        quality: { mean: 0, count: 0 },
        cost: { mean: 0, count: 0 },
        latency: { mean: 0, count: 0 },
        failureRate: { mean: 0, count: 0 },
        degradationRate: { mean: 0, count: 0 },
      }
    }

    return {
      quality: {
        mean: data.reduce((sum, d) => sum + d.qualityScore, 0) / n,
        count: n,
      },
      cost: {
        mean: data.reduce((sum, d) => sum + d.costUsd, 0) / n,
        count: n,
      },
      latency: {
        mean: data.reduce((sum, d) => sum + d.latencyMs, 0) / n,
        count: n,
      },
      failureRate: {
        mean: data.filter((d) => d.failed).length / n,
        count: n,
      },
      degradationRate: {
        mean: data.filter((d) => d.degraded).length / n,
        count: n,
      },
    }
  }

  /**
   * 构建单个维度的对比。
   */
  private buildDimension(
    dimension: string,
    control: DimensionStats,
    treatment: DimensionStats,
  ): ShadowAbComparisonDimension {
    const diff = treatment.mean - control.mean
    const diffPercent = control.mean !== 0 ? (diff / Math.abs(control.mean)) * 100 : 0

    // 简化置信区间（实际应用中用 t 检验）
    const n = Math.min(control.count, treatment.count)
    const insufficientSamples = n < MIN样本量
    const marginOfError = insufficientSamples ? Math.abs(diff) * 2 : Math.abs(diff) * 0.3

    return {
      dimension,
      controlMean: this.round4(control.mean),
      treatmentMean: this.round4(treatment.mean),
      diff: this.round4(diff),
      diffPercent: this.round2(diffPercent),
      ciLower: this.round4(diff - marginOfError),
      ciUpper: this.round4(diff + marginOfError),
      sampleCount: n,
      insufficientSamples,
    }
  }

  /**
   * 确定整体结论。
   */
  private determineConclusion(dimensions: ShadowAbComparisonDimension[]): ShadowAbConclusion {
    // 样本不足
    if (dimensions.some((d) => d.insufficientSamples)) {
      return 'INSUFFICIENT'
    }

    // 安全回归：质量下降或失败率上升
    const qualityDim = dimensions.find((d) => d.dimension === 'quality')
    const failureDim = dimensions.find((d) => d.dimension === 'failure_rate')

    if (qualityDim && qualityDim.diff < -0.05) return 'NO_GO'
    if (failureDim && failureDim.diff > 0.05) return 'NO_GO'

    // 成本显著上升
    const costDim = dimensions.find((d) => d.dimension === 'cost')
    if (costDim && costDim.diffPercent > 50) return 'NO_GO'

    // 显著改善
    if (qualityDim && qualityDim.diff > 0.05 && costDim && costDim.diffPercent <= 0) {
      return 'GO'
    }

    // 差异不明确
    return 'INCONCLUSIVE'
  }

  /**
   * 构建结论原因摘要。
   */
  private buildReasonSummary(
    conclusion: ShadowAbConclusion,
    dimensions: ShadowAbComparisonDimension[],
  ): string {
    switch (conclusion) {
      case 'INSUFFICIENT':
        return 'Sample size too small for reliable comparison'
      case 'NO_GO': {
        const issues = dimensions
          .filter((d) => {
            if (d.dimension === 'quality') return d.diff < -0.05
            if (d.dimension === 'failure_rate') return d.diff > 0.05
            if (d.dimension === 'cost') return d.diffPercent > 50
            return false
          })
          .map((d) => `${d.dimension}: ${d.diff > 0 ? '+' : ''}${d.diffPercent.toFixed(1)}%`)
        return `Negative impact detected: ${issues.join(', ')}`
      }
      case 'GO': {
        const improvements = dimensions
          .filter((d) => d.diff > 0 && !d.insufficientSamples)
          .map((d) => `${d.dimension}: +${d.diffPercent.toFixed(1)}%`)
        return `Positive impact: ${improvements.join(', ')}`
      }
      case 'INCONCLUSIVE':
        return 'Differences too small or mixed to draw a conclusion'
      default:
        return 'Unknown conclusion'
    }
  }

  /**
   * 计算确定性快照哈希。
   * 同一数据快照产出同一结论。
   */
  private computeSnapshotHash(input: ComparisonInput): string {
    const controlStr = input.controlData
      .map((d) => `${d.qualityScore}:${d.costUsd}:${d.latencyMs}:${d.failed}:${d.degraded}`)
      .join('|')
    const treatmentStr = input.treatmentData
      .map((d) => `${d.qualityScore}:${d.costUsd}:${d.latencyMs}:${d.failed}:${d.degraded}`)
      .join('|')

    const combined = `${input.experiment.experimentId}:${controlStr}::${treatmentStr}`
    let hash = 0
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i)
      hash = (hash * 31 + char) | 0
    }
    return `snap-${Math.abs(hash).toString(36)}`
  }

  private round4(n: number): number {
    return Math.round(n * 10000) / 10000
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100
  }
}
