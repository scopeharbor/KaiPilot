/**
 * CompilerAbBudgetIntegration —— A/B budget preflight/postflight（§3.3）。
 *
 * 将 real-model A/B path 接入既有 budget guard 抽象，位于 disabled-by-default
 * feature flag 之后（A/B real-model 默认关闭）。
 *
 * 不直接依赖 BudgetGuard 实现，只依赖接口类型，保持可测试性。
 */

import type { CompilerAbAuthorizationGate as CompilerAbAuthorizationGateType } from '@aiproj/types'

// ── Budget Decision Types ──────────────────────────────────────

export interface BudgetPreflightRequest {
  /** 预估 token 消耗。 */
  estimatedTokens: number
  /** 预估成本（USD）。 */
  estimatedCostUsd: number
  /** 已用 token（来自外部 tracker）。 */
  usedTokens: number
  /** 已用成本（USD）。 */
  usedCostUsd: number
  /** Token 硬上限。 */
  tokenCeiling: number
  /** 成本硬上限（USD）。 */
  costCeilingUsd: number
  /** 是否启用软预算警告。 */
  softWarningEnabled: boolean
  /** 软预算阈值（比例 0..1）。 */
  softWarningThreshold: number
}

export interface BudgetPreflightResponse {
  /** 是否允许通过。 */
  allowed: boolean
  /** 拒绝原因。 */
  reason?: string
  /** 决策类型。 */
  decision: 'hard_block' | 'soft_warning' | 'pass'
  /** 已用百分比。 */
  usedPercent: number
}

export interface BudgetPostflightRequest {
  /** 实际消耗 token。 */
  actualTokens: number
  /** 实际成本（USD）。 */
  actualCostUsd: number
}

export interface BudgetPostflightResponse {
  /** 更新后的累积。 */
  cumulativeTokens: number
  /** 更新后的累积成本。 */
  cumulativeCostUsd: number
  /** 是否超出任何阈值。 */
  exceededThreshold: boolean
  /** 告警消息。 */
  warnings: string[]
}

// ── Budget Integration ────────────────────────────────────────

export class CompilerAbBudgetIntegration {
  private cumulativeTokens = 0
  private cumulativeCostUsd = 0

  /** AB real-model 默认关闭。 */
  private realModelEnabled = false

  constructor(
    private readonly auth: CompilerAbAuthorizationGateType,
    initialTokens = 0,
    initialCost = 0,
  ) {
    this.cumulativeTokens = initialTokens
    this.cumulativeCostUsd = initialCost
  }

  /**
   * 启用 real-model path（由 feature flag 或 test seam 控制）。
   */
  setRealModelEnabled(enabled: boolean): void {
    this.realModelEnabled = enabled
  }

  /**
   * 是否允许 real-model A/B 执行。
   */
  isRealModelEnabled(): boolean {
    return this.realModelEnabled
  }

  /**
   * Preflight：调用 real provider 前检查预算。
   * 硬预算阻止调用；软预算记录 warning。
   */
  preflight(req: BudgetPreflightRequest): BudgetPreflightResponse {
    if (!this.realModelEnabled) {
      return {
        allowed: false,
        reason: 'Real-model A/B is disabled',
        decision: 'hard_block',
        usedPercent: this.getUsedPercent(req),
      }
    }

    const tokenCeiling = req.tokenCeiling
    const costCeiling = req.costCeilingUsd

    // Hard block: token
    const projectedTokens = this.cumulativeTokens + req.estimatedTokens
    if (projectedTokens > tokenCeiling) {
      return {
        allowed: false,
        decision: 'hard_block',
        reason: `Token ceiling: ${projectedTokens} > ${tokenCeiling}`,
        usedPercent: this.getUsedPercent(req),
      }
    }

    // Hard block: cost
    const projectedCost = this.cumulativeCostUsd + req.estimatedCostUsd
    if (projectedCost > costCeiling) {
      return {
        allowed: false,
        decision: 'hard_block',
        reason: `Cost ceiling: $${projectedCost.toFixed(4)} > $${costCeiling.toFixed(4)}`,
        usedPercent: this.getUsedPercent(req),
      }
    }

    // Soft warning
    const usedPct = this.getUsedPercent(req)
    if (req.softWarningEnabled && usedPct >= req.softWarningThreshold) {
      return {
        allowed: true,
        decision: 'soft_warning',
        reason: `Budget usage ${(usedPct * 100).toFixed(1)}% approaching limit`,
        usedPercent: usedPct,
      }
    }

    return {
      allowed: true,
      decision: 'pass',
      usedPercent: usedPct,
    }
  }

  /**
   * Postflight：真实模型调用后更新累积预算。
   * 返回更新状态。
   */
  postflight(req: BudgetPostflightRequest): BudgetPostflightResponse {
    this.cumulativeTokens += req.actualTokens
    this.cumulativeCostUsd += req.actualCostUsd

    const warnings: string[] = []
    if (this.cumulativeTokens > this.auth.tokenCeiling!) {
      warnings.push(
        `Token usage ${this.cumulativeTokens} exceeds ceiling ${this.auth.tokenCeiling}`,
      )
    }
    if (this.cumulativeCostUsd > this.auth.costCeilingUsd!) {
      warnings.push(
        `Cost $${this.cumulativeCostUsd.toFixed(4)} exceeds ceiling $${this.auth.costCeilingUsd!.toFixed(4)}`,
      )
    }

    return {
      cumulativeTokens: this.cumulativeTokens,
      cumulativeCostUsd: this.cumulativeCostUsd,
      exceededThreshold: warnings.length > 0,
      warnings,
    }
  }

  private getUsedPercent(req: BudgetPreflightRequest): number {
    const used = Math.max(
      this.cumulativeTokens / Math.max(req.tokenCeiling, 1),
      this.cumulativeCostUsd / Math.max(req.costCeilingUsd, 0.001),
    )
    return Math.min(1, Math.max(0, used))
  }
}
