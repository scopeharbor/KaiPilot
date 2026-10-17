import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import OrganizationMember from '#models/organization_member'
import type User from '#models/user'

/**
 * PluginRuntimeHealthPolicy — 诊断读取组织隔离 + RBAC
 * - 仅组织成员可查看本组织诊断
 * - 探针仅组织管理员/owner 可触发
 */
@inject()
export default class PluginRuntimeHealthPolicy {
  async canView(user: User, organizationId: number): Promise<boolean> {
    return OrganizationMember.belongsToOrganization(organizationId, user.id)
  }

  async canProbe(ctx: HttpContext, organizationId: number): Promise<boolean> {
    const user = ctx.auth.user as User | undefined
    if (!user) return false
    const belongs = await OrganizationMember.belongsToOrganization(organizationId, user.id)
    if (!belongs) return false
    // 仅 owner/admin 可探针；简化：检查成员角色包含 owner/admin
    const membership = await OrganizationMember.query()
      .where('organizationId', organizationId)
      .where('userId', user.id)
      .first()
    const role = (membership as any)?.role
    return role === 'owner' || role === 'admin'
  }
}
