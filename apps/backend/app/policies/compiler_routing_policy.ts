/**
 * v2-5-compiler-dynamic-routing-management-ui（tasks 3.4/5.7）—— CompilerRoutingPolicy。
 *
 * canViewRouting：查看/模拟路由规则与决策（沿用编译查看权限级别）。
 * canManageRouting：编排/版本化路由规则（限管理员角色）。
 * 拒绝返回不泄漏存在性。
 */
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { AI_COMPILER_ROUTING_VIEW, AI_COMPILER_ROUTING_MANAGE } from '#start/rbac/permissions'
import type { PermissionCheckResult } from '#types/auth'

@inject()
export default class CompilerRoutingPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 是否可以查看路由规则与决策（切片 A/C）。 */
  async canViewRouting(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, AI_COMPILER_ROUTING_VIEW, organizationId)
  }

  /** 是否可以编排/版本化路由规则（切片 B，限管理员角色）。 */
  async canManageRouting(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, AI_COMPILER_ROUTING_MANAGE, organizationId)
  }
}
