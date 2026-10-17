/**
 * v3-triz-to-delivery-closed-loop —— TRIZ 交付闭环 Policy（task 3.9）。
 *
 * 动作矩阵（roles.ts 已映射六角色）：
 * - view：summary/items/detail 只读（member/collaborator/observer 亦可）
 * - link / verify / reopen / request_ai：仅 admin/PM（人工职责）
 *
 * 边界：
 * - 此处只做顶层 RBAC 判定；来源（decision log/evidence source）与目标实体
 *   （task/milestone/risk/change_request）的可见性仍由 adapter 经各自领域 Policy
 *   二次授权，本 Policy 不替代。
 * - automation/system/AI/plugin actor 不持有用户身份，天然无法通过认证进入；
 *   verify/reopen 在 Service 层另有 human-actor 断言双保险（guards.ts）。
 */
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import {
  TRIZ_DELIVERY_LOOP_VIEW,
  TRIZ_DELIVERY_LOOP_LINK,
  TRIZ_DELIVERY_LOOP_VERIFY,
  TRIZ_DELIVERY_LOOP_REOPEN,
  TRIZ_DELIVERY_LOOP_REQUEST_AI,
} from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class TrizDeliveryLoopPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, TRIZ_DELIVERY_LOOP_VIEW, organizationId, projectId)
    return result.allowed
  }

  async link(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const { allowed } = await this.rbac.check(
      user,
      TRIZ_DELIVERY_LOOP_LINK,
      organizationId,
      projectId,
    )
    return allowed
  }

  async verify(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const { allowed } = await this.rbac.check(
      user,
      TRIZ_DELIVERY_LOOP_VERIFY,
      organizationId,
      projectId,
    )
    return allowed
  }

  async reopen(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const { allowed } = await this.rbac.check(
      user,
      TRIZ_DELIVERY_LOOP_REOPEN,
      organizationId,
      projectId,
    )
    return allowed
  }

  async requestAi(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const { allowed } = await this.rbac.check(
      user,
      TRIZ_DELIVERY_LOOP_REQUEST_AI,
      organizationId,
      projectId,
    )
    return allowed
  }
}
