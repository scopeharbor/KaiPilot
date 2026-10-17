import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { AI_TRIGGER, TRIZ_RESOURCE_ANALYZER_VIEW, TRIZ_RESOURCE_ANALYZER_MANAGE } from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class TrizResourceAnalyzerPolicy {
  constructor(private rbac: RbacService) {}

  /**
   * 查看资源分析运行与快照。
   * 要求 triz_resource_analyzer:view 权限。
   */
  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(
      user,
      TRIZ_RESOURCE_ANALYZER_VIEW,
      organizationId,
      projectId,
    )
    return result.allowed
  }

  /**
   * 管理资源分析（创建运行、审查候选、创建预览）。
   * 要求 triz_resource_analyzer:manage 权限。
   */
  async manage(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(
      user,
      TRIZ_RESOURCE_ANALYZER_MANAGE,
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
