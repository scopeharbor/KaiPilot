/**
 * ExperimentConfigService —— 实验配置管理（§2 契约）。
 *
 * 职责：
 * - 创建实验（验证模式固定、结束条件必须、最多两条配置）
 * - 结束实验
 * - 查询实验
 * - 组织隔离
 *
 * 遵循 design D5（强制结束条件）和 D8（不做多臂）。
 */

import type { ShadowAbExperimentConfig, ShadowAbExperimentRecord } from '@aiproj/types'
import { validateShadowAbConfig } from '@aiproj/types'

export class ExperimentConfigService {
  private experiments = new Map<string, ShadowAbExperimentRecord>()

  /**
   * 创建实验。
   * 模式在创建时固定，不可中途切换（spec 要求）。
   * 必须声明结束条件，否则拒绝。
   */
  create(config: ShadowAbExperimentConfig): ShadowAbExperimentRecord {
    const validation = validateShadowAbConfig(config)
    if (!validation.valid) {
      throw new ExperimentValidationError(validation.reasonCode, validation.violations)
    }

    if (this.experiments.has(config.experimentId)) {
      throw new ExperimentValidationError('EXPERIMENT_ALREADY_EXISTS', [
        `experiment ${config.experimentId} already exists`,
      ])
    }

    const record: ShadowAbExperimentRecord = {
      config: { ...config },
      status: 'running',
      collectedSamples: 0,
      shadowCostUsd: 0,
      shadowInvocationCount: 0,
    }

    this.experiments.set(config.experimentId, record)
    return record
  }

  /**
   * 结束实验。结束后分流停止，全部流量回到生产配置。
   */
  conclude(experimentId: string, organizationId: number): ShadowAbExperimentRecord {
    const record = this.get(experimentId, organizationId)
    if (record.status !== 'running') {
      throw new ExperimentValidationError('EXPERIMENT_NOT_RUNNING', [
        `experiment ${experimentId} is not running`,
      ])
    }

    record.status = 'concluded'
    record.config.concluded = true
    record.concludedAt = new Date().toISOString()
    return record
  }

  /**
   * 取消实验。
   */
  cancel(experimentId: string, organizationId: number): ShadowAbExperimentRecord {
    const record = this.get(experimentId, organizationId)
    if (record.status !== 'running') {
      throw new ExperimentValidationError('EXPERIMENT_NOT_RUNNING', [
        `experiment ${experimentId} is not running`,
      ])
    }

    record.status = 'cancelled'
    record.config.concluded = true
    record.concludedAt = new Date().toISOString()
    return record
  }

  /**
   * 获取实验（带组织隔离）。
   */
  get(experimentId: string, organizationId: number): ShadowAbExperimentRecord {
    const record = this.experiments.get(experimentId)
    if (!record) {
      throw new ExperimentNotFoundError(experimentId)
    }
    if (record.config.organizationId !== organizationId) {
      throw new ExperimentAccessDeniedError(experimentId, organizationId)
    }
    return record
  }

  /**
   * 列出组织内所有实验。
   */
  list(organizationId: number): ShadowAbExperimentRecord[] {
    return Array.from(this.experiments.values()).filter(
      (r) => r.config.organizationId === organizationId,
    )
  }

  /**
   * 更新已收集样本数。
   */
  incrementSamples(experimentId: string, organizationId: number, count: number): void {
    const record = this.get(experimentId, organizationId)
    record.collectedSamples += count

    // 检查结束条件
    if (record.config.endCondition.kind === 'sample_count') {
      if (record.collectedSamples >= record.config.endCondition.targetCount) {
        this.conclude(experimentId, organizationId)
      }
    }
  }

  /**
   * 更新影子成本。
   */
  addShadowCost(experimentId: string, organizationId: number, costUsd: number): void {
    const record = this.get(experimentId, organizationId)
    record.shadowCostUsd += costUsd
    record.shadowInvocationCount += 1
  }

  /**
   * 检查实验是否仍在运行。
   */
  isRunning(experimentId: string, organizationId: number): boolean {
    try {
      const record = this.get(experimentId, organizationId)
      if (record.status !== 'running') return false

      // 检查时间结束条件
      if (record.config.endCondition.kind === 'time') {
        if (new Date(record.config.endCondition.endsAt).getTime() <= Date.now()) {
          this.conclude(experimentId, organizationId)
          return false
        }
      }

      return true
    } catch {
      return false
    }
  }

  /**
   * 检查影子是否超出预算。
   */
  isShadowBudgetExceeded(experimentId: string, organizationId: number): boolean {
    const record = this.get(experimentId, organizationId)
    if (record.config.shadowBudgetCapUsd === undefined) return false
    return record.shadowCostUsd >= record.config.shadowBudgetCapUsd
  }
}

// ── 错误类 ────────────────────────────────────────────────────

export class ExperimentValidationError extends Error {
  constructor(
    public readonly reasonCode: string,
    public readonly violations: string[],
  ) {
    super(`Experiment validation failed: ${violations.join('; ')}`)
    this.name = 'ExperimentValidationError'
  }
}

export class ExperimentNotFoundError extends Error {
  constructor(experimentId: string) {
    super(`Experiment not found: ${experimentId}`)
    this.name = 'ExperimentNotFoundError'
  }
}

export class ExperimentAccessDeniedError extends Error {
  constructor(experimentId: string, organizationId: number) {
    super(`Access denied: experiment ${experimentId} not in organization ${organizationId}`)
    this.name = 'ExperimentAccessDeniedError'
  }
}
