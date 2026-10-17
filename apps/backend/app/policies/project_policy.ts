import RbacService from '#services/rbac_service'
import type User from '#models/user'
import { inject } from '@adonisjs/core'

/**
 * 项目策略：薄封装 RBAC，附加业务级守卫（归档只读、删除档位）。
 */
@inject()
export default class ProjectPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('project:view', user, organizationId, projectId)
  }

  async update(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('project:update', user, organizationId, projectId)
  }

  async delete(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('project:delete', user, organizationId, projectId)
  }

  async manageMembers(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.allows('project:member:manage', user, organizationId, projectId)
  }

  private async allows(
    permission: 'project:view' | 'project:update' | 'project:delete' | 'project:member:manage',
    user: User,
    organizationId: number,
    projectId?: number,
  ): Promise<boolean> {
    const result = await this.rbac.check(user, permission, organizationId, projectId)
    return result.allowed
  }
}
