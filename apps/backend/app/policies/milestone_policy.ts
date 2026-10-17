import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { MILESTONE_DELETE, MILESTONE_UPDATE, MILESTONE_VIEW, type Permission } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * 里程碑策略：薄封装 RBAC 的项目级权限判定（design D4）。
 *
 * 扁平路由 `/milestones/:id`（无 projectId，rbac 中间件无法在路由层判定）依赖本策略在
 * controller 内做写/查权限守卫；组织隔离由 `MilestoneService.findInOrgOrFail` 保证（跨组织 404）。
 */
@inject()
export default class MilestonePolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(MILESTONE_VIEW, user, organizationId, projectId)
  }

  async update(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(MILESTONE_UPDATE, user, organizationId, projectId)
  }

  async delete(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(MILESTONE_DELETE, user, organizationId, projectId)
  }

  async authorizeView(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.view(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权查看该里程碑')
    }
  }

  async authorizeUpdate(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.update(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权编辑该里程碑')
    }
  }

  async authorizeDelete(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.delete(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权删除该里程碑')
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
