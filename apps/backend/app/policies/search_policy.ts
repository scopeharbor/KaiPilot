// v2-advanced-search — 搜索 Policy
// RBAC 检查：确保未认证、跨组织、跨项目和已撤权访问被拒绝或隐藏

import { inject } from '@adonisjs/core'
import type User from '#models/user'
import OrganizationMember from '#models/organization_member'
import ProjectMember from '#models/project_member'

/**
 * 搜索权限策略（v2-advanced-search）。
 */
@inject()
export default class SearchPolicy {
  /**
   * 授权用户执行搜索。
   * 确保用户属于当前组织。
   */
  async authorize(user: User, organizationId: number): Promise<void> {
    // 成员行**或**组织所有者：owner 可能没有 organization_members 行。
    const belongs = await OrganizationMember.belongsToOrganization(organizationId, user.id)
    if (!belongs) {
      throw new Error('PERMISSION_DENIED')
    }
  }

  /**
   * 获取用户在当前组织中有权限访问的项目 ID 列表。
   */
  async getAllowedProjectIds(user: User, organizationId: number): Promise<number[]> {
    const memberships = await ProjectMember.query()
      .where('user_id', user.id)
      .whereIn('project_id', (b) => {
        b.from('projects')
          .select('id')
          .where('organization_id', organizationId)
          .whereNull('deleted_at')
      })

    return memberships.map((m) => Number(m.projectId))
  }

  /**
   * 检查用户是否有审计日志查看权限。
   */
  async canViewAuditLogs(user: User, organizationId: number): Promise<boolean> {
    const membership = await user
      .related('organizationMembers')
      .query()
      .where('organization_id', organizationId)
      .first()

    if (!membership) return false

    const role = membership.role
    return ['owner', 'admin', 'project_manager'].includes(role)
  }
}
