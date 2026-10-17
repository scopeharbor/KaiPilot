import type User from '#models/user'
import RbacService from '#services/rbac_service'
import {
  AI_TRIGGER,
  CONTRADICTION_VIEW,
  PHYSICAL_CONTRADICTION_ANALYZE,
  PHYSICAL_CONTRADICTION_MANAGE,
} from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * TRIZ 物理矛盾分析器权限策略（v3-triz-physical-contradiction-analyzer §5.2）。
 *
 * analyze 控制创建分析运行、查看运行列表/详情/候选列表（需 contradiction:view）。
 * manage 控制候选审查、确认预览、交接预览。
 * AI 解释需要 analyze + ai:trigger。
 * 组织与项目存在性由 Controller/Service 负责。
 */
@inject()
export default class PhysicalContradictionPolicy {
  constructor(private rbac: RbacService) {}

  async analyze(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const analyze = await this.rbac.check(
      user,
      PHYSICAL_CONTRADICTION_ANALYZE,
      organizationId,
      projectId,
    )
    if (!analyze.allowed) return false
    // 复用矛盾可见性：分析器基于矛盾，无 contradiction:view 不应看到
    const contradiction = await this.rbac.check(user, CONTRADICTION_VIEW, organizationId, projectId)
    return contradiction.allowed
  }

  async manage(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(
      user,
      PHYSICAL_CONTRADICTION_MANAGE,
      organizationId,
      projectId,
    )
    return result.allowed
  }

  async aiExplain(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const canAnalyze = await this.analyze(user, organizationId, projectId)
    if (!canAnalyze) return false
    const canTrigger = await this.rbac.check(user, AI_TRIGGER, organizationId, projectId)
    return canTrigger.allowed
  }
}
