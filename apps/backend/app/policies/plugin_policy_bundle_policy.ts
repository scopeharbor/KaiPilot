import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import OrganizationMember from '#models/organization_member'
import type User from '#models/user'

/**
 * PluginPolicyBundlePolicy — 组织策略包管理 RBAC
 * - view：组织成员可读（模板/副本/激活状态均为组织内低敏治理信息）
 * - manage：仅 owner/admin 可发起 copy/activation 变更（写路径走统一变更流，
 *   审批/确认权限由 plugin_change_request 侧策略二次约束）
 */
@inject()
export default class PluginPolicyBundlePolicy {
  async canView(user: User, organizationId: number): Promise<boolean> {
    return OrganizationMember.belongsToOrganization(organizationId, user.id)
  }

  async canManage(ctx: HttpContext, organizationId: number): Promise<boolean> {
    const user = ctx.auth.user as User | undefined
    if (!user) return false
    const belongs = await OrganizationMember.belongsToOrganization(organizationId, user.id)
    if (!belongs) return false
    const membership = await OrganizationMember.query()
      .where('organization_id', organizationId)
      .where('user_id', user.id)
      .first()
    const role = membership?.role
    return role === 'owner' || role === 'admin'
  }
}
