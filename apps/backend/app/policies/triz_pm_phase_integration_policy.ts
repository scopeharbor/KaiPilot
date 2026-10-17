import type { HttpContext } from '@adonisjs/core/http'
import { AuthRequiredException, PermissionDeniedException } from '#exceptions/api_exception'
import RbacService from '#services/rbac_service'
import {
  TRIZ_PM_PHASE_INTEGRATION_VIEW,
  TRIZ_PM_PHASE_INTEGRATION_MANAGE,
  TRIZ_PM_PHASE_INTEGRATION_EXPLAIN,
  AI_TRIGGER,
  type Permission,
} from '#start/rbac/permissions'

/**
 * TRIZ-PM 阶段整合 Policy（v3-triz-pm-phase-integration §3.9）。
 *
 * view: 查看阶段整合运行/快照（MEMBER+）
 * createRun: 创建分析运行（需要 manage 权限）
 * review: 记录人工审查（需要 manage 权限）
 * explain: 请求 AI 说明（需要 explain + ai:trigger）
 * preview: 创建 handoff preview（需要 view + manage）
 *
 * 判定链复用 RbacService（与 rbac_middleware 同一条）；超管放行与项目级
 * 授权由 RbacService 内部处理。
 */
export default class TrizPmPhaseIntegrationPolicy {
  #rbac: RbacService

  constructor(rbac: RbacService = new RbacService()) {
    this.#rbac = rbac
  }

  async view(ctx: HttpContext): Promise<void> {
    await this.#authorize(ctx, [TRIZ_PM_PHASE_INTEGRATION_VIEW])
  }

  async createRun(ctx: HttpContext): Promise<void> {
    await this.#authorize(ctx, [TRIZ_PM_PHASE_INTEGRATION_MANAGE])
  }

  async review(ctx: HttpContext): Promise<void> {
    await this.#authorize(ctx, [TRIZ_PM_PHASE_INTEGRATION_MANAGE])
  }

  async explain(ctx: HttpContext): Promise<void> {
    await this.#authorize(ctx, [TRIZ_PM_PHASE_INTEGRATION_EXPLAIN, AI_TRIGGER])
  }

  async preview(ctx: HttpContext): Promise<void> {
    await this.#authorize(ctx, [TRIZ_PM_PHASE_INTEGRATION_VIEW, TRIZ_PM_PHASE_INTEGRATION_MANAGE])
  }

  async #authorize(ctx: HttpContext, permissions: Permission[]): Promise<void> {
    const user = await ctx.auth.authenticate()
    if (!user) throw new AuthRequiredException('需要认证')

    const organizationId = ctx.tenant?.organizationId
    if (organizationId === null || organizationId === undefined) {
      throw new PermissionDeniedException('缺少组织上下文')
    }

    const projectIdParam = ctx.request.param('projectId')
    const projectId = projectIdParam ? Number(projectIdParam) : undefined

    for (const permission of permissions) {
      const result = await this.#rbac.check(user, permission, organizationId, projectId)
      if (!result.allowed) {
        throw new PermissionDeniedException(`缺少 TRIZ-PM 阶段整合所需权限：${permission}`)
      }
    }
  }
}
