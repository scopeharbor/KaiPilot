import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { DIAGRAM_VIEW, DIAGRAM_MANAGE, type Permission } from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class DiagramPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(DIAGRAM_VIEW, user, organizationId, projectId)
  }

  async manage(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(DIAGRAM_MANAGE, user, organizationId, projectId)
  }

  async authorizeView(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.view(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权查看图表')
    }
  }

  async authorizeManage(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.manage(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权管理图表')
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
