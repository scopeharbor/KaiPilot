/**
 * v3-skill-eval-system —— SkillEvalPolicy（D10）。
 *
 * 评估权限判定 + 组织隔离。判定链复用 RbacService（与 rbac_middleware 同一条），
 * 超管放行在其内部处理。
 */
import type { HttpContext } from '@adonisjs/core/http'
import RbacService from '#services/rbac_service'
import { AI_COMPILER_SKILL_EVAL } from '#start/rbac/permissions'

export default class SkillEvalPolicy {
  #rbac: RbacService

  constructor(rbac: RbacService = new RbacService()) {
    this.#rbac = rbac
  }

  /**
   * 评估执行 / 查看报告 / 查看效果指标。
   */
  async eval(ctx: HttpContext): Promise<boolean> {
    const user = ctx.auth.user
    if (!user) return false

    const organizationId = ctx.tenant?.organizationId
    if (organizationId === null || organizationId === undefined) return false

    const projectIdParam = ctx.request.param('projectId')
    const projectId = projectIdParam ? Number(projectIdParam) : undefined

    const result = await this.#rbac.check(user, AI_COMPILER_SKILL_EVAL, organizationId, projectId)
    return result.allowed
  }
}
