/**
 * v3-ai-automated-evaluation —— 评测评分聚合 RBAC 策略。
 *
 * 只读策略：view 需要当前组织具备 AI 自动评测查看权限。
 * 组织隔离：请求的 organizationId 必须与租户上下文一致。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { PermissionDeniedException } from '#exceptions/api_exception'
import RbacService from '#services/rbac_service'
import { AI_EVALUATION_VIEW } from '#start/rbac/permissions'

export default class EvaluationScorePolicy {
  #rbac: RbacService

  constructor(rbac: RbacService = new RbacService()) {
    this.#rbac = rbac
  }

  /** 检查用户是否可查看组织级评测评分聚合。 */
  async view(ctx: HttpContext): Promise<true> {
    const user = ctx.auth.user
    if (!user) throw new PermissionDeniedException('未认证')

    const organizationId = ctx.tenant?.organizationId
    if (organizationId === null || organizationId === undefined) {
      throw new PermissionDeniedException('缺少组织上下文')
    }

    const result = await this.#rbac.check(user, AI_EVALUATION_VIEW, organizationId, undefined)
    if (!result.allowed) {
      throw new PermissionDeniedException('无权查看评测评分聚合')
    }

    return true
  }
}
