import RbacService from '#services/rbac_service'
import { CHANGE_IMPACT_MANAGE, CHANGE_IMPACT_VIEW, CHANGE_REQUEST_APPROVE, AI_TRIGGER } from '#rbac'
import { inject } from '@adonisjs/core'
import type User from '#models/user'

/**
 * 影响分析权限策略（v2-change-management-impact-analysis §6.2）。
 * 依赖 RBAC 权限判定，不包含组织隔离（已在 Controller/Service 层处理）。
 */
@inject()
export default class ChangeImpactAnalysisPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, CHANGE_IMPACT_VIEW, organizationId, projectId)
    return result.allowed
  }

  async create(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.view(user, organizationId, projectId)
  }

  async refresh(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, CHANGE_IMPACT_MANAGE, organizationId, projectId)
    return result.allowed
  }

  async confirm(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const canApprove = await this.rbac.check(
      user,
      CHANGE_REQUEST_APPROVE,
      organizationId,
      projectId,
    )
    const canManageImpact = await this.rbac.check(
      user,
      CHANGE_IMPACT_MANAGE,
      organizationId,
      projectId,
    )
    return canApprove.allowed && canManageImpact.allowed
  }

  async viewAiExplanation(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.view(user, organizationId, projectId)
  }

  async generateAiExplanation(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<boolean> {
    if (await this.confirm(user, organizationId, projectId)) return true
    if (user.isSuperAdmin) return true
    const canView = await this.view(user, organizationId, projectId)
    const canTriggerAi = await this.rbac.check(user, AI_TRIGGER, organizationId, projectId)
    return canView && canTriggerAi.allowed
  }

  async approveReference(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.confirm(user, organizationId, projectId)
  }
}
