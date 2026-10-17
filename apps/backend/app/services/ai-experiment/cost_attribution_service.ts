/**
 * CostAttributionService —— 成本归属（§4 成本归属）。
 *
 * 职责：
 * - 影子成本单独归属，不混入生产成本口径
 * - 影子成本受配额约束，越界时停止影子而非停止生产
 * - 调用翻倍在账本中可见
 *
 * 遵循 design D3（成本单独归属 + 配额约束）。
 */

import type { ShadowAbExperimentConfig } from '@aiproj/types'

export interface CostAttributionEntry {
  /** 实验 ID。 */
  experimentId: string
  /** 组织 ID。 */
  organizationId: number
  /** 归因范围：production / shadow。 */
  scope: 'production' | 'shadow'
  /** 成本金额（USD）。 */
  costUsd: number
  /** 调用次数。 */
  invocationCount: number
  /** 时间戳。 */
  timestamp: string
}

export interface CostSummary {
  /** 生产成本。 */
  productionCostUsd: number
  /** 影子成本。 */
  shadowCostUsd: number
  /** 总成本。 */
  totalCostUsd: number
  /** 影子调用次数。 */
  shadowInvocationCount: number
  /** 生产调用次数。 */
  productionInvocationCount: number
}

export class CostAttributionService {
  private entries: CostAttributionEntry[] = []

  /**
   * 记录生产成本。
   */
  recordProductionCost(
    experimentId: string,
    organizationId: number,
    costUsd: number,
  ): CostAttributionEntry {
    const entry: CostAttributionEntry = {
      experimentId,
      organizationId,
      scope: 'production',
      costUsd,
      invocationCount: 1,
      timestamp: new Date().toISOString(),
    }
    this.entries.push(entry)
    return entry
  }

  /**
   * 记录影子成本（单独归属）。
   */
  recordShadowCost(
    experimentId: string,
    organizationId: number,
    costUsd: number,
  ): CostAttributionEntry {
    const entry: CostAttributionEntry = {
      experimentId,
      organizationId,
      scope: 'shadow',
      costUsd,
      invocationCount: 1,
      timestamp: new Date().toISOString(),
    }
    this.entries.push(entry)
    return entry
  }

  /**
   * 获取实验的成本汇总。
   */
  getSummary(experimentId: string): CostSummary {
    const experimentEntries = this.entries.filter((e) => e.experimentId === experimentId)

    const productionEntries = experimentEntries.filter((e) => e.scope === 'production')
    const shadowEntries = experimentEntries.filter((e) => e.scope === 'shadow')

    const productionCostUsd = this.round2(productionEntries.reduce((sum, e) => sum + e.costUsd, 0))
    const shadowCostUsd = this.round2(shadowEntries.reduce((sum, e) => sum + e.costUsd, 0))

    return {
      productionCostUsd,
      shadowCostUsd,
      totalCostUsd: this.round2(productionCostUsd + shadowCostUsd),
      shadowInvocationCount: shadowEntries.reduce((sum, e) => sum + e.invocationCount, 0),
      productionInvocationCount: productionEntries.reduce((sum, e) => sum + e.invocationCount, 0),
    }
  }

  /**
   * 获取组织的成本汇总。
   */
  getOrganizationSummary(organizationId: number): CostSummary {
    const orgEntries = this.entries.filter((e) => e.organizationId === organizationId)

    const productionEntries = orgEntries.filter((e) => e.scope === 'production')
    const shadowEntries = orgEntries.filter((e) => e.scope === 'shadow')

    return {
      productionCostUsd: this.round2(productionEntries.reduce((sum, e) => sum + e.costUsd, 0)),
      shadowCostUsd: this.round2(shadowEntries.reduce((sum, e) => sum + e.costUsd, 0)),
      totalCostUsd: this.round2(orgEntries.reduce((sum, e) => sum + e.costUsd, 0)),
      shadowInvocationCount: shadowEntries.reduce((sum, e) => sum + e.invocationCount, 0),
      productionInvocationCount: productionEntries.reduce((sum, e) => sum + e.invocationCount, 0),
    }
  }

  /**
   * 检查影子是否超出配额。
   * 越界时停止影子而非停止生产。
   */
  checkShadowBudget(experiment: ShadowAbExperimentConfig): {
    exceeded: boolean
    currentCostUsd: number
    capUsd: number
  } {
    if (experiment.shadowBudgetCapUsd === undefined) {
      return { exceeded: false, currentCostUsd: 0, capUsd: Infinity }
    }

    const summary = this.getSummary(experiment.experimentId)
    return {
      exceeded: summary.shadowCostUsd >= experiment.shadowBudgetCapUsd,
      currentCostUsd: summary.shadowCostUsd,
      capUsd: experiment.shadowBudgetCapUsd,
    }
  }

  /**
   * 获取成本看板数据（影子与生产可区分）。
   */
  getCostDashboard(organizationId: number): {
    byExperiment: Map<string, CostSummary>
    total: CostSummary
  } {
    const orgEntries = this.entries.filter((e) => e.organizationId === organizationId)
    const experimentIds = [...new Set(orgEntries.map((e) => e.experimentId))]

    const byExperiment = new Map<string, CostSummary>()
    for (const expId of experimentIds) {
      byExperiment.set(expId, this.getSummary(expId))
    }

    return {
      byExperiment,
      total: this.getOrganizationSummary(organizationId),
    }
  }

  /**
   * 获取所有条目（用于审计）。
   */
  getEntries(experimentId?: string): CostAttributionEntry[] {
    if (experimentId) {
      return this.entries.filter((e) => e.experimentId === experimentId)
    }
    return [...this.entries]
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100
  }
}
