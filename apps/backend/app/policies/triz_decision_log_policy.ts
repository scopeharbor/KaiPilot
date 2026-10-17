import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { TRIZ_DECISION_VIEW, TRIZ_DECISION_MANAGE } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * v2-triz-decision-log-traceability —— TRIZ 决策日志权限策略（tasks 4.1–4.2）。
 *
 * view: 查看决策日志列表/详情/subjectLookup
 * manage: 创建/supersede 决策日志
 */
@inject()
export default class TrizDecisionLogPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, TRIZ_DECISION_VIEW, organizationId, projectId)
    return result.allowed
  }

  async manage(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, TRIZ_DECISION_MANAGE, organizationId, projectId)
    return result.allowed
  }
}
