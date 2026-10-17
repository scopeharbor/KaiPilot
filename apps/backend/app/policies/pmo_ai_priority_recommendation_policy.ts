import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { PORTFOLIO_VIEW } from '#policies/portfolio_dashboard_policy'
import { RECOMMENDATION_MANAGE } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * PMO AI 优先级推荐权限键（暂不注册到 permissions.ts，等 V3 RBAC baseline 裁决后统一注册）。
 */
export const PMO_AI_PRIORITY_RECOMMENDATIONS_VIEW = 'portfolio:ai-priority-recommendations:view'
export const PMO_AI_PRIORITY_RECOMMENDATIONS_MANAGE = 'portfolio:ai-priority-recommendations:manage'
export const PMO_AI_PRIORITY_RECOMMENDATIONS_AI = 'portfolio:ai-priority-recommendations:ai'

/**
 * PmoAiPriorityRecommendationPolicy —— PMO AI 优先级推荐权限守卫。
 *
 * 权限层级：
 *   - view: 查看推荐队列、摘要、详情
 *   - manage: 审查操作（接受、忽略、稍后、转换）
 *   - ai: 触发 AI 理由生成
 *
 * 降级路径：若 PMO 专用权限未注册，则回退到 portfolio:view + recommendation:manage 组合。
 */
@inject()
export default class PmoAiPriorityRecommendationPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 检查用户是否有 PMO AI 推荐查看权限。 */
  async canView(user: User, organizationId: number): Promise<boolean> {
    const pmoSpecific = await this.rbac.check(
      user,
      PMO_AI_PRIORITY_RECOMMENDATIONS_VIEW,
      Number(organizationId),
    )
    if (pmoSpecific.allowed) return true
    // Fallback: portfolio:view 即允许查看推荐
    const portfolioView = await this.rbac.check(user, PORTFOLIO_VIEW, Number(organizationId))
    return portfolioView.allowed
  }

  /** 检查用户是否有 PMO AI 推荐管理权限。 */
  async canManage(user: User, organizationId: number): Promise<boolean> {
    const pmoSpecific = await this.rbac.check(
      user,
      PMO_AI_PRIORITY_RECOMMENDATIONS_MANAGE,
      Number(organizationId),
    )
    if (pmoSpecific.allowed) return true
    // Fallback: portfolio:view + 项目级 recommendation:manage
    const portfolioView = await this.rbac.check(user, PORTFOLIO_VIEW, Number(organizationId))
    if (!portfolioView.allowed) return false
    const recManage = await this.rbac.check(user, RECOMMENDATION_MANAGE, Number(organizationId))
    return recManage.allowed
  }

  /** 检查用户是否有 AI 理由触发权限。 */
  async canTriggerAi(user: User, organizationId: number): Promise<boolean> {
    const pmoSpecific = await this.rbac.check(
      user,
      PMO_AI_PRIORITY_RECOMMENDATIONS_AI,
      Number(organizationId),
    )
    if (pmoSpecific.allowed) return true
    // Fallback: portfolio:view + 管理权限（拥有管理权限即可触发 AI）
    return this.canManage(user, organizationId)
  }

  /** 断言查看权限。 */
  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canView(user, organizationId))) {
      throw new Error('PERMISSION_DENIED')
    }
  }

  /** 断言管理权限。 */
  async authorizeManage(user: User, organizationId: number): Promise<void> {
    if (!(await this.canManage(user, organizationId))) {
      throw new Error('PERMISSION_DENIED')
    }
  }

  /** 断言 AI 触发权限。 */
  async authorizeTriggerAi(user: User, organizationId: number): Promise<void> {
    if (!(await this.canTriggerAi(user, organizationId))) {
      throw new Error('PERMISSION_DENIED')
    }
  }
}
