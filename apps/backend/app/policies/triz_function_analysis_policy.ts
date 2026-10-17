import type User from '#models/user'
import RbacService from '#services/rbac_service'
import {
  AI_TRIGGER,
  CONTRADICTION_VIEW,
  FUNCTION_ANALYSIS_VIEW,
  FUNCTION_ANALYSIS_MANAGE,
} from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * TRIZ 功能分析图权限策略（v3-triz-function-analysis-diagram §3.5）。
 *
 * view 控制创建分析运行、查看运行列表/详情/图/问题候选（需 FUNCTION_ANALYSIS_VIEW + CONTRADICTION_VIEW）。
 * manage 控制问题候选审查、Workbench 预览、Decision 预览、Handoff 预览。
 * AI 解释需要 view + ai:trigger。
 * 组织与项目存在性由 Controller/Service 负责。
 */
@inject()
export default class TrizFunctionAnalysisPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const faView = await this.rbac.check(user, FUNCTION_ANALYSIS_VIEW, organizationId, projectId)
    if (!faView.allowed) return false
    const contradiction = await this.rbac.check(user, CONTRADICTION_VIEW, organizationId, projectId)
    return contradiction.allowed
  }

  async manage(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, FUNCTION_ANALYSIS_MANAGE, organizationId, projectId)
    return result.allowed
  }

  async aiExplain(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const canView = await this.view(user, organizationId, projectId)
    if (!canView) return false
    const canTrigger = await this.rbac.check(user, AI_TRIGGER, organizationId, projectId)
    return canTrigger.allowed
  }
}
