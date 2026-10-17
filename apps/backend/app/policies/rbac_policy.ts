import RbacService from '#services/rbac_service'
import type { Permission } from '#rbac'
import type User from '#models/user'
import type { PermissionCheckResult, RbacContext } from '#types/auth'
import { inject } from '@adonisjs/core'

/**
 * RBAC Policy 层（五层架构的 Policy，design D5）。
 *
 * 说明（与 design 差异，已回写）：D5 原写「实现为 AdonisJS Bouncer abilities/policies」。
 * 实测 `@adonisjs/bouncer` 非本项目既有依赖；为避免仅为形式引入新依赖，采用**服务背书的 Policy 类**
 * 承载同一判定链（系统管理员放行 → scope 判定 → 最小权限取交集 → 默认拒绝），
 * 消费权限标识串、不散落角色硬编码，语义与 Bouncer ability 等价。中间件与控制器统一经本层判权。
 */
@inject()
export default class RbacPolicy {
  constructor(private rbac: RbacService) {}

  /**
   * 判定用户在指定 scope 下是否具备某权限（ability）。
   */
  async authorize(
    user: User,
    permission: Permission,
    scope: RbacContext,
  ): Promise<PermissionCheckResult> {
    return this.rbac.check(user, permission, scope.organizationId, scope.projectId)
  }

  /**
   * 布尔便捷判定（无需 reason 时）。
   */
  async allows(user: User, permission: Permission, scope: RbacContext): Promise<boolean> {
    const result = await this.authorize(user, permission, scope)
    return result.allowed
  }

  /**
   * 取用户在 scope 下的全部有效权限（供 JWT claims / 前端展示）。
   */
  async permissionsFor(
    user: User,
    organizationId: number | null,
    projectId?: number,
  ): Promise<Permission[]> {
    return this.rbac.resolveUserPermissions(user, organizationId, projectId)
  }
}
