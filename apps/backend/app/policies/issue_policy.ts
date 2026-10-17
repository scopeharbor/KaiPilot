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
 * 议题缺陷策略（design D4 映射矩阵 3）。
 *
 * - view         → task:view 或 project:view
 * - create       → task:create
 * - update       → task:update（内容编辑）
 * - changeStatus → task:update（状态机流转）
 * - delete       → project:update
 *
 * 跨租户/项目不存在统一由 rbac 中间件（注册路由规则）在路由层返回 404；
 * 本策略负责控制器层兜底拒绝（403）。
 */
@inject()
export default class IssuePolicy {
  constructor(private rbac: RbacService) {}

  async authorizeView(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(
      user,
      organizationId,
      projectId,
      [TASK_VIEW, PROJECT_VIEW],
      '无权查看议题',
    )
  }

  async authorizeCreate(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(user, organizationId, projectId, [TASK_CREATE], '无权登记议题')
  }

  async authorizeUpdate(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(user, organizationId, projectId, [TASK_UPDATE], '无权修改议题')
  }

  async authorizeChangeStatus(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<void> {
    await this.authorizeAny(user, organizationId, projectId, [TASK_UPDATE], '无权推进议题状态')
  }

  async authorizeDelete(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(user, organizationId, projectId, [PROJECT_UPDATE], '无权删除议题')
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
