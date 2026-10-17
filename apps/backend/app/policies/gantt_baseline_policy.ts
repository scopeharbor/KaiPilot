import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import { TASK_UPDATE, TASK_VIEW } from '#rbac'
import RbacService from '#services/rbac_service'
import { inject } from '@adonisjs/core'

@inject()
export default class GanttBaselinePolicy {
  constructor(private rbac: RbacService) {}

  async authorizeView(user: User, organizationId: number, projectId: number) {
    if (user.isSuperAdmin) return
    const result = await this.rbac.check(user, TASK_VIEW, organizationId, projectId)
    if (!result.allowed) throw new PermissionDeniedException('无权查看甘特基线')
  }

  async authorizeSave(user: User, organizationId: number, projectId: number) {
    if (user.isSuperAdmin) return
    const result = await this.rbac.check(user, TASK_UPDATE, organizationId, projectId)
    if (!result.allowed) throw new PermissionDeniedException('无权保存甘特基线')
  }
}
