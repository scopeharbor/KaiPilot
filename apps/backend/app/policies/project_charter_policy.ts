import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { CHARTER_APPROVE, PROJECT_UPDATE, PROJECT_VIEW, type Permission } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * 项目章程策略（design D4 映射矩阵 1）。
 *
 * - view   → project:view
 * - update → project:update（创建/编辑）
 * - submit → project:update（提交审批）
 * - approve→ charter:approve（审批决议；组织治理权限）
 *
 * 跨租户/项目不存在统一由 rbac 中间件（注册路由规则）在路由层返回 404；
 * 本策略负责控制器层兜底拒绝（403）。
 */
@inject()
export default class ProjectCharterPolicy {
  constructor(private rbac: RbacService) {}

  async authorizeView(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(user, organizationId, projectId, [PROJECT_VIEW], '无权查看项目章程')
  }

  async authorizeUpdate(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(user, organizationId, projectId, [PROJECT_UPDATE], '无权编辑项目章程')
  }

  async authorizeSubmit(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(user, organizationId, projectId, [PROJECT_UPDATE], '无权提交章程审批')
  }

  async authorizeApprove(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(user, organizationId, projectId, [CHARTER_APPROVE], '无权审批项目章程')
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
