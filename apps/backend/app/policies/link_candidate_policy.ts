/**
 * v2-5-code-repository-auto-linking —— 链接候选 Policy。
 *
 * 控制候选查看（task:view）和确认/忽略（task:update）的权限。
 * 复用既有 TASK_VIEW / TASK_UPDATE RBAC 常量。
 */

import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { TASK_VIEW, TASK_UPDATE } from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class LinkCandidatePolicy {
  constructor(private rbac: RbacService) {}

  /**
   * 查看候选列表：需要 task:view 权限。
   */
  async canView(user: User, organizationId: number, projectId: number): Promise<boolean> {
    const result = await this.rbac.check(user, TASK_VIEW, organizationId, projectId)
    return result.allowed
  }

  /**
   * 确认/忽略候选：需要 task:update 权限。
   */
  async canMutate(user: User, organizationId: number, projectId: number): Promise<boolean> {
    const result = await this.rbac.check(user, TASK_UPDATE, organizationId, projectId)
    return result.allowed
  }
}
