import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { RESOURCE_MANAGE, RESOURCE_VIEW, type Permission } from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class ResourcePolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(RESOURCE_VIEW, user, organizationId, projectId)
  }

  async manage(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(RESOURCE_MANAGE, user, organizationId, projectId)
  }

  async authorizeView(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.view(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权查看资源')
    }
  }

  async authorizeManage(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.manage(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权管理资源')
    }
  }

  async selfAvailability(
    user: User,
    organizationId: number,
    projectId: number,
    resourceUserId: number | null,
  ): Promise<boolean> {
    if (await this.manage(user, organizationId, projectId)) return true
    return resourceUserId === user.id && (await this.view(user, organizationId, projectId))
  }

  async authorizeSelfAvailability(
    user: User,
    organizationId: number,
    projectId: number,
    resourceUserId: number | null,
  ): Promise<void> {
    if (!(await this.selfAvailability(user, organizationId, projectId, resourceUserId))) {
      throw new PermissionDeniedException('无权更新该资源可用性')
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
