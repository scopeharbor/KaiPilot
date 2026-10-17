/**
 * ShadowInvocationService —— 影子调用（§3 影子模式）。
 *
 * 职责：
 * - 同一次真实请求额外跑一次候选配置
 * - 影子结果只落账不返回用户（无用户可见出口）
 * - 影子失败不影响生产结果（异常吞掉并记为影子降级）
 * - 影子采样率可配置，默认低于全量
 *
 * 遵循 design D2（只落账不返回用户）、D3（成本单独归属）、D7（失败不拖垮生产）。
 */

import type { ShadowAbExperimentConfig } from '@aiproj/types'

export interface ShadowInvocationResult {
  /** 是否执行了影子调用。 */
  executed: boolean
  /** 影子是否成功。 */
  success: boolean
  /** 影子配置 ID。 */
  treatmentVariantId: string
  /** 影子调用延迟（ms）。 */
  latencyMs: number
  /** 影子调用成本（USD）。 */
  costUsd: number
  /** 影子降级原因（失败时）。 */
  degradationReason?: string
}

export interface ShadowInvocationInput {
  /** 实验配置。 */
  experiment: ShadowAbExperimentConfig
  /** 用户 ID（用于采样判定）。 */
  userId: number
  /** 生产调用的输入描述（低敏）。 */
  productionInputRef: string
}

export interface ShadowCostRecord {
  /** 实验 ID。 */
  experimentId: string
  /** 组织 ID。 */
  organizationId: number
  /** 成本金额（USD）。 */
  costUsd: number
  /** 是否成功。 */
  success: boolean
  /** 归因标签：shadow。 */
  attributionScope: 'shadow'
}

export class ShadowInvocationService {
  private defaultSamplingRate = 0.1

  /**
   * 判断是否应执行影子调用。
   * 基于采样率和确定性哈希判定。
   */
  shouldExecuteShadow(experiment: ShadowAbExperimentConfig, userId: number): boolean {
    // 非影子模式不执行
    if (experiment.mode !== 'shadow') return false

    // 实验已结束不执行
    if (experiment.concluded) return false

    const samplingRate = experiment.shadowSamplingRate ?? this.defaultSamplingRate
    if (samplingRate <= 0) return false
    if (samplingRate >= 1) return true

    // 确定性哈希判定
    const hash = this.computeDeterministicHash(experiment.experimentId, userId)
    return hash < samplingRate
  }

  /**
   * 执行影子调用（模拟）。
   * 实际实现中这里会调用候选配置的模型。
   * 当前为框架实现，返回 fixture 结果。
   */
  async invoke(input: ShadowInvocationInput): Promise<ShadowInvocationResult> {
    const startTime = Date.now()

    try {
      // 模拟影子调用（实际会调用候选配置的模型）
      const treatmentVariant = input.experiment.variants.find((v) => v.variantId !== 'control')

      if (!treatmentVariant) {
        return {
          executed: false,
          success: false,
          treatmentVariantId: '',
          latencyMs: 0,
          costUsd: 0,
          degradationReason: 'No treatment variant found',
        }
      }

      // 模拟调用延迟和成本
      const latencyMs = Date.now() - startTime + Math.random() * 100
      const costUsd = 0.001 + Math.random() * 0.01

      return {
        executed: true,
        success: true,
        treatmentVariantId: treatmentVariant.variantId,
        latencyMs,
        costUsd,
      }
    } catch (error) {
      // 影子失败不影响生产结果（design D7）
      return {
        executed: true,
        success: false,
        treatmentVariantId: input.experiment.variants[1]?.variantId ?? '',
        latencyMs: Date.now() - startTime,
        costUsd: 0,
        degradationReason: error instanceof Error ? error.message : 'Unknown shadow error',
      }
    }
  }

  /**
   * 构建影子成本记录（单独归属，不混入生产成本）。
   */
  buildCostRecord(
    result: ShadowInvocationResult,
    experiment: ShadowAbExperimentConfig,
  ): ShadowCostRecord {
    return {
      experimentId: experiment.experimentId,
      organizationId: experiment.organizationId,
      costUsd: result.costUsd,
      success: result.success,
      attributionScope: 'shadow',
    }
  }

  /**
   * 确定性哈希函数（用于采样）。
   * 同一 (experimentId, userId) 始终产出相同结果。
   */
  computeDeterministicHash(experimentId: string, userId: number): number {
    const input = `${experimentId}:${userId}`
    let hash = 2166136261 // FNV-1a 32-bit offset basis
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    // 归一化到 [0, 1)
    return (hash >>> 0) / 4294967296
  }
}
