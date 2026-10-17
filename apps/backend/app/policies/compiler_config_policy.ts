/**
 * v2-5-compiler-config-management-api（tasks 2.2/4.2）—— CompilerConfigPolicy。
 *
 * canViewConfig：查看 Compiler 配置（切片 1/2，沿用编译查看权限级别）。
 * canManageConfig：编排/版本化 Compiler 配置（切片 3，限管理员角色）。
 * 拒绝返回不泄漏存在性。
 */
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { AI_COMPILER_CONFIG_VIEW, AI_COMPILER_CONFIG_MANAGE } from '#start/rbac/permissions'
import type { PermissionCheckResult } from '#types/auth'

@inject()
export default class CompilerConfigPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 是否可以查看 Compiler 配置（切片 1/2）。 */
  async canViewConfig(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, AI_COMPILER_CONFIG_VIEW, organizationId)
  }

  /** 是否可以编排/版本化 Compiler 配置（切片 3，限管理员角色）。 */
  async canManageConfig(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, AI_COMPILER_CONFIG_MANAGE, organizationId)
  }
}
