// v3-resource-capacity-forecasting-closed-loop §7 —— Policy。
// 组织可见性（跨租零泄露）+ 入口权限 + drill-down 目标重授权。
import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import {
  RESOURCE_CAPACITY_LOOP_MANAGE,
  RESOURCE_CAPACITY_LOOP_VIEW,
  RESOURCE_VIEW,
  type Permission,
} from '#start/rbac/permissions'

@inject()
export default class ResourceCapacityLoopPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 非成员一律 RESOURCE_NOT_FOUND，不泄露组织内任何闭环对象存在性。 */
  async assertOrganizationVisible(user: User, organizationId: number): Promise<void> {
    if (user.isSuperAdmin) return
    const { default: OrganizationModel } = await import('#models/organization')
    const organization = await OrganizationModel.find(organizationId)
    if (!organization) throw new ResourceNotFoundException('组织不存在')
    if (Number(organization.ownerId) === Number(user.id)) return
    const { default: OrganizationMemberModel } = await import('#models/organization_member')
    const membership = await OrganizationMemberModel.query()
      .where('organization_id', organizationId)
      .where('user_id', user.id)
      .first()
    if (!membership) throw new ResourceNotFoundException('组织不存在')
  }

  async canView(user: User, organizationId: number): Promise<boolean> {
    return this.checkAny(user, organizationId, [RESOURCE_CAPACITY_LOOP_VIEW, RESOURCE_VIEW])
  }

  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canView(user, organizationId))) {
      throw new PermissionDeniedException('无权查看资源容量闭环')
    }
  }

  async authorizeManage(user: User, organizationId: number): Promise<void> {
    if (!(await this.check(user, RESOURCE_CAPACITY_LOOP_MANAGE, organizationId))) {
      throw new PermissionDeniedException('无权管理资源容量闭环')
    }
  }

  private check(user: User, permission: Permission, organizationId: number): Promise<boolean> {
    return this.rbac
      .check(user, permission, organizationId)
      .then((r) => r.allowed)
      .catch(() => false)
  }

  private async checkAny(
    user: User,
    organizationId: number,
    permissions: Permission[],
  ): Promise<boolean> {
    for (const p of permissions) {
      if (await this.check(user, p, organizationId)) return true
    }
    return false
  }
}
