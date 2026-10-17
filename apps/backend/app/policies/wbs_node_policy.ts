import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import { TASK_VIEW, WBS_CREATE, WBS_DELETE, WBS_MOVE, WBS_UPDATE, type Permission } from '#rbac'
import RbacService from '#services/rbac_service'
import { inject } from '@adonisjs/core'

@inject()
export default class WbsNodePolicy {
  constructor(private rbac: RbacService) {}

  async authorizeView(user: User, organizationId: number, projectId: number) {
    return this.assert(TASK_VIEW, user, organizationId, projectId, '无权查看 WBS')
  }

  async authorizeCreate(user: User, organizationId: number, projectId: number) {
    return this.assert(WBS_CREATE, user, organizationId, projectId, '无权创建 WBS 节点')
  }

  async authorizeUpdate(user: User, organizationId: number, projectId: number) {
    return this.assert(WBS_UPDATE, user, organizationId, projectId, '无权更新 WBS 节点')
  }

  async authorizeDelete(user: User, organizationId: number, projectId: number) {
    return this.assert(WBS_DELETE, user, organizationId, projectId, '无权删除 WBS 节点')
  }

  async authorizeMove(user: User, organizationId: number, projectId: number) {
    return this.assert(WBS_MOVE, user, organizationId, projectId, '无权移动 WBS 节点')
  }

  private async assert(
    permission: Permission,
    user: User,
    organizationId: number,
    projectId: number,
    message: string,
  ) {
    const result = await this.rbac.check(user, permission, organizationId, projectId)
    if (!result.allowed) throw new PermissionDeniedException(message)
  }
}
