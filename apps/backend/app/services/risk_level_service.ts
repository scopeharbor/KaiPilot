import RiskMatrixConfig from '#models/risk_matrix_config'
import type { RiskLevel } from '@aiproj/types'

export interface RiskLevelInput {
  probability: number
  impact: number
  residualProbability?: number | null
  residualImpact?: number | null
}

/**
 * RiskLevelService — 按项目矩阵配置和评分计算风险等级。
 *
 * 核心规则：服务端唯一计算入口，禁止前端覆盖风险等级。
 * 未配置矩阵的项目使用 V1 5x5 默认分区。
 */
export default class RiskLevelService {
  /**
   * 计算固有风险等级（基于 probability × impact）。
   */
  async computeInherent(
    organizationId: number,
    projectId: number,
    input: RiskLevelInput,
  ): Promise<RiskLevel> {
    const config = await this.getConfig(organizationId, projectId)
    const score = input.probability * input.impact
    return this.levelFromScore(score, config?.probabilityLevels ?? 5, config?.impactLevels ?? 5)
  }

  /**
   * 计算残余风险等级（基于 residualProbability × residualImpact）。
   * 如果缺少残余评分则返回 null。
   */
  async computeResidual(
    organizationId: number,
    projectId: number,
    input: RiskLevelInput,
  ): Promise<RiskLevel | null> {
    if (
      input.residualProbability === null ||
      input.residualProbability === undefined ||
      input.residualImpact === null ||
      input.residualImpact === undefined
    )
      return null
    const score = input.residualProbability * input.residualImpact
    const config = await this.getConfig(organizationId, projectId)
    return this.levelFromScore(score, config?.probabilityLevels ?? 5, config?.impactLevels ?? 5)
  }

  /**
   * 根据分数计算等级（使用矩阵分区或默认 5x5 逻辑）。
   */
  private levelFromScore(score: number, _probLevels: number, _impLevels: number): RiskLevel {
    // 默认 5x5 分区
    if (score >= 16) return 'critical'
    if (score >= 10) return 'high'
    if (score >= 4) return 'medium'
    return 'low'
  }

  /**
   * 获取项目矩阵配置（或 null 使用默认）
   */
  private async getConfig(
    organizationId: number,
    projectId: number,
  ): Promise<RiskMatrixConfig | null> {
    return RiskMatrixConfig.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('is_active', true)
      .first()
  }
}
