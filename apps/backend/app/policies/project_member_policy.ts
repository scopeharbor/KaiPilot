import RbacService from '#services/rbac_service'
import type User from '#models/user'
import { inject } from '@adonisjs/core'

/**
 * 项目成员策略：薄封装 RBAC，承载成员管理判定（design D1/D10）。
 *
 * 实际越权拦截由 rbac_middleware 按 ROUTE_PERMISSION_RULES 完成；
 * 本层提供可注入的业务级判定能力，供 service/测试复用，与 ProjectPolicy 对称。
 */
@inject()
export default class ProjectMemberPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('project:view', user, organizationId, projectId)
  }

  async manageMembers(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('project:member:manage', user, organizationId, projectId)
  }

  private async allows(
    permission: 'project:view' | 'project:member:manage',
    user: User,
    organizationId: number,
    projectId?: number,
  ): Promise<boolean> {
    const result = await this.rbac.check(user, permission, organizationId, projectId)
    return result.allowed
  }
}
