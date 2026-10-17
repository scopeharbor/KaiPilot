import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import type Risk from '#models/risk'
import RbacService from '#services/rbac_service'
import { RISK_MANAGE, RISK_UPDATE_OWN, RISK_VIEW, type Permission } from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class RiskPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(RISK_VIEW, user, organizationId, projectId)
  }

  async manage(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(RISK_MANAGE, user, organizationId, projectId)
  }

  async updateOwn(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(RISK_UPDATE_OWN, user, organizationId, projectId)
  }

  /**
   * 判断用户是否可修改指定风险的非状态字段。
   * - risk:manage → 全部可改
   * - risk:update_own → 仅自身负责的风险，且禁止状态推进
   */
  async canUpdate(
    user: User,
    organizationId: number,
    projectId: number,
    risk: Risk,
  ): Promise<boolean> {
    if (await this.manage(user, organizationId, projectId)) return true
    if (await this.updateOwn(user, organizationId, projectId)) {
      return risk.ownerId === user.id
    }
    return false
  }

  /**
   * 判断用户是否可推进状态。
   * - risk:manage → 可推进
   * - risk:update_own → 禁止状态推进
   */
  async canTransitionStatus(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<boolean> {
    return this.manage(user, organizationId, projectId)
  }

  async authorizeView(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.view(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权查看风险')
    }
  }

  async authorizeManage(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.manage(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权管理风险')
    }
  }

  async authorizeUpdate(
    user: User,
    organizationId: number,
    projectId: number,
    risk: Risk,
  ): Promise<void> {
    if (!(await this.canUpdate(user, organizationId, projectId, risk))) {
      throw new PermissionDeniedException('无权修改此风险')
    }
  }

  async authorizeTransitionStatus(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<void> {
    if (!(await this.canTransitionStatus(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权推进风险状态')
    }
  }

  private async allows(
    permission: Permission,
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, permission, organizationId, projectId)
    return result.allowed
  }
}
