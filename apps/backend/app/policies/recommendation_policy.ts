import type User from '#models/user'
import type Project from '#models/project'
import RbacService from '#services/rbac_service'
import { RECOMMENDATION_VIEW, RECOMMENDATION_MANAGE, PREDICTION_TRIGGER_AI } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * RecommendationPolicy —— 推荐权限守卫（v2-ai-smart-recommendations §5.2）。
 *
 * 三层权限：
 *   - view（查看推荐列表、摘要、详情）
 *   - manage（刷新、接受、忽略、稍后、转换）
 *   - trigger_ai（触发 AI 解释）
 */
@inject()
export default class RecommendationPolicy {
  constructor(private readonly rbac: RbacService) {}

  async canView(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, RECOMMENDATION_VIEW, Number(organizationId))
    return result.allowed
  }

  async canManage(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, RECOMMENDATION_MANAGE, Number(organizationId))
    return result.allowed
  }

  async canTriggerAi(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, PREDICTION_TRIGGER_AI, Number(organizationId))
    return result.allowed
  }

  async authorizeView(project: Project, user: User): Promise<void> {
    if (!(await this.canView(user, Number(project.organizationId)))) {
      throw new Error('PERMISSION_DENIED')
    }
  }

  async authorizeManage(project: Project, user: User): Promise<void> {
    if (!(await this.canManage(user, Number(project.organizationId)))) {
      throw new Error('PERMISSION_DENIED')
    }
  }

  async authorizeTriggerAi(project: Project, user: User): Promise<void> {
    if (!(await this.canTriggerAi(user, Number(project.organizationId)))) {
      throw new Error('PERMISSION_DENIED')
    }
  }
}
