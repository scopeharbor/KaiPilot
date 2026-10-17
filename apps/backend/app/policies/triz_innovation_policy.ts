import type User from '#models/user'
import RbacService from '#services/rbac_service'
import {
  AI_TRIGGER,
  CONTRADICTION_VIEW,
  TRIZ_INNOVATION_HANDOFF,
  TRIZ_INNOVATION_MANAGE,
  TRIZ_INNOVATION_VIEW,
} from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * TRIZ 创新工作台权限策略（v3-triz-innovation-workbench §2.3）。
 *
 * view  控制工作台来源列表/方案列表/详情/Dashboard 摘要（需 contradiction:view，复用矛盾可见性）。
 * manage 控制 创建/更新/废弃方案、增删 option、生成对比。
 * handoff 控制 创建 Draft Layer 候选输入。
 * narrative（可选 AI 说明）需 view + ai:trigger。
 * 组织与项目存在性由 Controller/Service 负责。
 */
@inject()
export default class TrizInnovationPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const innovation = await this.rbac.check(user, TRIZ_INNOVATION_VIEW, organizationId, projectId)
    if (!innovation.allowed) return false
    // 复用矛盾可见性：工作台来源基于矛盾，无 contradiction:view 不应看到来源
    const contradiction = await this.rbac.check(user, CONTRADICTION_VIEW, organizationId, projectId)
    return contradiction.allowed
  }

  async manage(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, TRIZ_INNOVATION_MANAGE, organizationId, projectId)
    return result.allowed
  }

  async handoff(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, TRIZ_INNOVATION_HANDOFF, organizationId, projectId)
    return result.allowed
  }

  async narrative(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const canView = await this.view(user, organizationId, projectId)
    if (!canView) return false
    const canTrigger = await this.rbac.check(user, AI_TRIGGER, organizationId, projectId)
    return canTrigger.allowed
  }
}
