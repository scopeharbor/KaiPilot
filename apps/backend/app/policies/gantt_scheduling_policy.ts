import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { TASK_UPDATE } from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class GanttSchedulingPolicy {
  constructor(private rbac: RbacService) {}

  async authorize(user: User, organizationId: number, projectId: number) {
    if (user.isSuperAdmin) return
    const result = await this.rbac.check(user, TASK_UPDATE, organizationId, projectId)
    if (!result.allowed) {
      throw new PermissionDeniedException('无权调整项目排程')
    }
  }
}
