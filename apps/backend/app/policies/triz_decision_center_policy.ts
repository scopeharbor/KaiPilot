import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { TRIZ_DECISION_VIEW, TRIZ_DECISION_MANAGE } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * v3-triz-decision-center —— TRIZ 决策中心权限策略（tasks 4.1）。
 *
 * view: 查看决策中心摘要/列表/详情/readiness（只读）
 * manage: 创建/补充/废止决策（通过中心编排，复用既有决策日志语义）
 *
 * 设计决策 D3：中心 Policy + 来源二次鉴权。
 * 此处只做顶层权限判定；各 source adapter 内部还需调用对应来源 policy
 * 或 service-level visibility helper 做二次鉴权。
 */
@inject()
export default class TrizDecisionCenterPolicy {
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
