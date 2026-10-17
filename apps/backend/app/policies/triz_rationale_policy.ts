import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { RATIONALE_VIEW, RATIONALE_FEEDBACK, RATIONALE_HANDOFF } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * v2-triz-recommendation-rationale-ui —— TRIZ 推荐理由权限策略。
 *
 * view:    查看推荐理由详情
 * feedback:提交反馈
 * handoff: 发起 Draft Layer handoff
 */
@inject()
export default class TrizRationalePolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, RATIONALE_VIEW, organizationId, projectId)
    return result.allowed
  }

  async feedback(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, RATIONALE_FEEDBACK, organizationId, projectId)
    return result.allowed
  }

  async handoff(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, RATIONALE_HANDOFF, organizationId, projectId)
    return result.allowed
  }
}
