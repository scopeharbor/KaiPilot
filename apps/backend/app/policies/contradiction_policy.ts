import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { AI_TRIGGER, CONTRADICTION_MANAGE, CONTRADICTION_VIEW } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * TRIZ 矛盾权限策略。
 *
 * view 控制列表/详情/Dashboard 摘要；manage 控制刷新/确认/忽略；
 * explain 需要 view + ai:trigger。组织与项目存在性由 Controller/Service 负责。
 */
@inject()
export default class ContradictionPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, CONTRADICTION_VIEW, organizationId, projectId)
    return result.allowed
  }

  async manage(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, CONTRADICTION_MANAGE, organizationId, projectId)
    return result.allowed
  }

  async explain(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const canView = await this.view(user, organizationId, projectId)
    if (!canView) return false
    const canTrigger = await this.rbac.check(user, AI_TRIGGER, organizationId, projectId)
    return canTrigger.allowed
  }
}
