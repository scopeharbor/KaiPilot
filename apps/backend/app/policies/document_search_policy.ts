/**
 * DocumentSearchPolicy（v3-document-full-text-search §4.3）
 *
 * view：拥有 document_search:view 权限的用户可搜索文档
 * manage：拥有 document_search:manage 权限的用户可触发项目级 reindex
 *
 * resolveScope：返回当前用户在该组织中拥有 view 权限的项目 ID 集合。
 *
 * 注：本文件原先调用 `user.hasPermission(perm, orgId)`——User 模型上没有这个方法，
 * 每次调用都会抛 TypeError，文档搜索的三个端点整体 500。改为经 `RbacService`
 * 解析，与 `RbacMiddleware` 用的是同一条判定链（组织权限 ∩ 项目权限，
 * 超级管理员走 `system:admin` 哨兵），也符合「Model 不写业务逻辑」的分层约定。
 */
import { DOCUMENT_SEARCH_VIEW, DOCUMENT_SEARCH_MANAGE } from '#start/rbac/permissions'
import { SYSTEM_ADMIN } from '#start/rbac/permissions'
import type { Permission } from '#start/rbac/permissions'
import type User from '#models/user'
import OrganizationMember from '#models/organization_member'
import RbacService from '#services/rbac_service'
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'

@inject()
export default class DocumentSearchPolicy {
  constructor(private rbacService: RbacService) {}

  /**
   * 断言用户在此组织中有文档搜索 view 权限。
   */
  async view(user: User, organizationId: number): Promise<boolean> {
    return this.has(user, organizationId, DOCUMENT_SEARCH_VIEW)
  }

  /**
   * 断言用户在此组织中有文档搜索 manage（重建索引）权限。
   */
  async manage(user: User, organizationId: number): Promise<boolean> {
    return this.has(user, organizationId, DOCUMENT_SEARCH_MANAGE)
  }

  /**
   * 解析当前用户在该组织中的可搜索项目范围。
   */
  async resolveScope(user: User, organizationId: number): Promise<number[]> {
    try {
      // 成员行**或**组织所有者：owner 可能没有 organization_members 行，
      // 只查成员表会让所有者在自己组织里搜出空结果（比报错更难排查）。
      const belongs = await OrganizationMember.belongsToOrganization(organizationId, user.id)
      if (!belongs) return []

      // 加载用户在该组织所有项目中的角色成员
      const projectMembers = await user
        .related('projectMembers')
        .query()
        .whereHas('project', (q) => q.where('organization_id', organizationId))

      if (!projectMembers || projectMembers.length === 0) return []

      const projectIds: number[] = []
      for (const pm of projectMembers) {
        try {
          // 逐项目走完整判定链，而不是直接读 project_roles.permissions：
          // 后者会漏掉组织级授予的权限，也绕开了超级管理员哨兵。
          const projectId = Number(pm.projectId)
          if (await this.has(user, organizationId, DOCUMENT_SEARCH_VIEW, projectId)) {
            projectIds.push(projectId)
          }
        } catch {
          // 单个项目解析失败不阻断整体
          continue
        }
      }

      return projectIds
    } catch (error) {
      logger.error({ error }, '[DocumentSearchPolicy.resolveScope] 解析失败')
      return []
    }
  }

  private async has(
    user: User,
    organizationId: number,
    permission: Permission,
    projectId?: number,
  ): Promise<boolean> {
    const permissions = await this.rbacService.resolveUserPermissions(
      user,
      organizationId,
      projectId,
    )
    return permissions.includes(SYSTEM_ADMIN) || permissions.includes(permission)
  }
}
