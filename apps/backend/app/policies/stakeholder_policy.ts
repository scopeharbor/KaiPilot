import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { PROJECT_UPDATE, PROJECT_VIEW } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * 利害关系人登记表策略（design D4 映射矩阵 4）。
 * - view   → project:view
 * - manage → project:update
 *
 * 跨租户/项目不存在统一由 rbac 中间件（注册路由规则）在路由层返回 404；
 * 本策略负责控制器层兜底拒绝（403）。
 */
@inject()
export default class StakeholderPolicy {
  constructor(private rbac: RbacService) {}

  async authorizeView(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorize(user, PROJECT_VIEW, organizationId, projectId, '无权查看干系人')
  }

  async authorizeManage(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorize(user, PROJECT_UPDATE, organizationId, projectId, '无权管理干系人')
  }

  private async authorize(
    user: User,
    permission: typeof PROJECT_VIEW | typeof PROJECT_UPDATE,
    organizationId: number,
    projectId: number,
    message: string,
  ): Promise<void> {
    if (user.isSuperAdmin) return
    const result = await this.rbac.check(user, permission, organizationId, projectId)
    if (!result.allowed) throw new PermissionDeniedException(message)
  }
}
