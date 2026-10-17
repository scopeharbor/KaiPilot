/**
 * v2-5-compiler-cache-management-api（tasks 3.2/5.2）—— CompilerCachePolicy。
 *
 * canViewCache：只读盘点 / 失效预览（切片 1/2）。
 * canManageCache：受控按范围失效写入（切片 3，限管理员角色）。
 * 拒绝返回不泄漏资源存在性或规模（由 Controller 统一 PERMISSION_DENIED 响应保证）。
 */
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { AI_COMPILER_CACHE_VIEW, AI_COMPILER_CACHE_MANAGE } from '#start/rbac/permissions'
import type { PermissionCheckResult } from '#types/auth'

@inject()
export default class CompilerCachePolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 是否可以查看/预览 Compiler 缓存（切片 1/2）。 */
  async canViewCache(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, AI_COMPILER_CACHE_VIEW, organizationId)
  }

  /** 是否可以执行受控缓存失效（切片 3，限管理员角色）。 */
  async canManageCache(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, AI_COMPILER_CACHE_MANAGE, organizationId)
  }
}
