import type User from '#models/user'
import RbacService from '#services/rbac_service'
import {
  AI_TRIGGER,
  TRIZ_EVOLUTION_TREND_ANALYSIS_VIEW,
  TRIZ_EVOLUTION_TREND_ANALYSIS_MANAGE,
} from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class TrizEvolutionTrendPolicy {
  constructor(private rbac: RbacService) {}

  /**
   * 查看进化趋势分析运行与快照。
   * 要求 triz_evolution_trend_analysis:view 权限。
   */
  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(
      user,
      TRIZ_EVOLUTION_TREND_ANALYSIS_VIEW,
      organizationId,
      projectId,
    )
    return result.allowed
  }

  /**
   * 管理进化趋势分析（创建运行、审查候选、创建预览）。
   * 要求 triz_evolution_trend_analysis:manage 权限。
   */
  async manage(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(
      user,
      TRIZ_EVOLUTION_TREND_ANALYSIS_MANAGE,
      organizationId,
      projectId,
    )
    return result.allowed
  }

  /**
   * AI 解释请求。
   * 要求 view 权限 + ai:trigger。
   */
  async aiExplain(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const canView = await this.view(user, organizationId, projectId)
    if (!canView) return false
    const canTrigger = await this.rbac.check(user, AI_TRIGGER, organizationId, projectId)
    return canTrigger.allowed
  }
}
