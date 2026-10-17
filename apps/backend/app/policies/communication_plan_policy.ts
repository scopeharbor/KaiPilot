import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { PROJECT_UPDATE, PROJECT_VIEW } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * 沟通管理计划策略（design D4 映射矩阵 5）。
 * - view   → project:view
 * - manage → project:update（创建/编辑/启停/删除）
 *
 * 跨租户/项目不存在统一由 rbac 中间件（注册路由规则）在路由层返回 404；
 * 本策略负责控制器层兜底拒绝（403）。
 */
@inject()
export default class CommunicationPlanPolicy {
  constructor(private rbac: RbacService) {}

  async authorizeView(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorize(user, PROJECT_VIEW, organizationId, projectId, '无权查看沟通计划')
  }

  async authorizeManage(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorize(user, PROJECT_UPDATE, organizationId, projectId, '无权管理沟通计划')
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
