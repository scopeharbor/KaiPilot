import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import {
  PROJECT_UPDATE,
  PROJECT_VIEW,
  TASK_CREATE,
  TASK_UPDATE,
  TASK_VIEW,
  type Permission,
} from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * 需求策略（design D4 映射矩阵 2）。
 *
 * - view   → task:view 或 project:view
 * - create → task:create 或 project:update
 * - update → task:update 或 project:update（含验收准则状态流转/绑定/解绑）
 * - delete → project:update
 *
 * 跨租户/项目不存在统一由 rbac 中间件（注册路由规则）在路由层返回 404；
 * 本策略负责控制器层兜底拒绝（403）。
 */
@inject()
export default class RequirementPolicy {
  constructor(private rbac: RbacService) {}

  async authorizeView(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(
      user,
      organizationId,
      projectId,
      [TASK_VIEW, PROJECT_VIEW],
      '无权查看需求',
    )
  }

  async authorizeCreate(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(
      user,
      organizationId,
      projectId,
      [TASK_CREATE, PROJECT_UPDATE],
      '无权创建需求',
    )
  }

  async authorizeUpdate(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(
      user,
      organizationId,
      projectId,
      [TASK_UPDATE, PROJECT_UPDATE],
      '无权修改需求',
    )
  }

  async authorizeDelete(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(user, organizationId, projectId, [PROJECT_UPDATE], '无权删除需求')
  }

  private async authorizeAny(
    user: User,
    organizationId: number,
    projectId: number,
    permissions: Permission[],
    message: string,
  ): Promise<void> {
    if (user.isSuperAdmin) return
    for (const permission of permissions) {
      const result = await this.rbac.check(user, permission, organizationId, projectId)
      if (result.allowed) return
    }
    throw new PermissionDeniedException(message)
  }
}
