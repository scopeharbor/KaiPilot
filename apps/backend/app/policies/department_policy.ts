import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { DEPARTMENT_MANAGE, DEPARTMENT_VIEW, ORG_MANAGE, ORG_VIEW, type Permission } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * 部门树（OBS）策略（design D4 映射矩阵 6，组织级 scope，无 projectId）。
 *
 * - view   → org:view 或 department:view（细粒度别名）
 * - manage → org:manage 或 department:manage（细粒度别名）
 *
 * 组织级跨租户资源（跨组织 department id）由 DepartmentService.departmentOrFail
 * 在服务层返回 404；本策略负责控制器层兜底拒绝（403）。
 */
@inject()
export default class DepartmentPolicy {
  constructor(private rbac: RbacService) {}

  async authorizeView(user: User, organizationId: number): Promise<void> {
    await this.authorizeAny(user, organizationId, [ORG_VIEW, DEPARTMENT_VIEW], '无权查看部门')
  }

  async authorizeManage(user: User, organizationId: number): Promise<void> {
    await this.authorizeAny(user, organizationId, [ORG_MANAGE, DEPARTMENT_MANAGE], '无权管理部门')
  }

  private async authorizeAny(
    user: User,
    organizationId: number,
    permissions: Permission[],
    message: string,
  ): Promise<void> {
    if (user.isSuperAdmin) return
    for (const permission of permissions) {
      const result = await this.rbac.check(user, permission, organizationId)
      if (result.allowed) return
    }
    throw new PermissionDeniedException(message)
  }
}
