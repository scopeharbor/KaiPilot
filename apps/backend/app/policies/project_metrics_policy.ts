import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { PROJECT_VIEW, TASK_VIEW, type Permission } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * 项目度量与计算引擎守卫策略（design D4 映射矩阵 7）。
 *
 * - viewEvm      → project:view（指标卡 + S 曲线）
 * - viewBurndown → project:view 或 task:view
 * - viewSpc      → project:view 或 task:view
 * - viewLob      → task:view
 * - viewPareto   → project:view
 * - viewRaci     → task:view
 * - viewObs      → project:view
 *
 * 跨租户/项目不存在统一由 rbac 中间件（注册路由规则）在路由层返回 404；
 * 本策略负责控制器层兜底拒绝（403）。全部为只读幂等 GET（RL-06）。
 */
@inject()
export default class ProjectMetricsPolicy {
  constructor(private rbac: RbacService) {}

  async authorizeEvm(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(user, organizationId, projectId, [PROJECT_VIEW], '无权查看 EVM 指标')
  }

  async authorizeBurndown(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(
      user,
      organizationId,
      projectId,
      [PROJECT_VIEW, TASK_VIEW],
      '无权查看燃尽图',
    )
  }

  async authorizeSpc(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(
      user,
      organizationId,
      projectId,
      [PROJECT_VIEW, TASK_VIEW],
      '无权查看控制图',
    )
  }

  async authorizeLob(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(user, organizationId, projectId, [TASK_VIEW], '无权查看 LOB 流水')
  }

  async authorizePareto(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(user, organizationId, projectId, [PROJECT_VIEW], '无权查看帕累托分析')
  }

  async authorizeRaci(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(user, organizationId, projectId, [TASK_VIEW], '无权查看 RACI 矩阵')
  }

  async authorizeObs(user: User, organizationId: number, projectId: number): Promise<void> {
    await this.authorizeAny(user, organizationId, projectId, [PROJECT_VIEW], '无权查看 OBS 树')
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
