import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { TASK_VIEW, TASK_UPDATE } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * TaskExternalLinkPolicy —— 外部链接权限门禁。
 *
 * 设计 D5/D6: `task:view` 控制读访问，`task:update` 控制写操作。
 * 跨组织/项目访问统一由调用方（Controller）传入正确的 orgId/projectId。
 */
@inject()
export default class TaskExternalLinkPolicy {
  constructor(private rbac: RbacService) {}

  /**
   * 是否允许查看任务外部链接。
   * 需要用户至少对所在项目拥有 task:view 权限。
   */
  async canView(user: User, organizationId: number, projectId: number): Promise<boolean> {
    const result = await this.rbac.check(user, TASK_VIEW, organizationId, projectId)
    return result.allowed
  }

  /**
   * 是否允许增删改任务外部链接。
   * 需要用户对所在项目拥有 task:update 权限。
   */
  async canMutate(user: User, organizationId: number, projectId: number): Promise<boolean> {
    const result = await this.rbac.check(user, TASK_UPDATE, organizationId, projectId)
    return result.allowed
  }
}
