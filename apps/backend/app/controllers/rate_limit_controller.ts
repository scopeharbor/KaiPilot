/**
 * v3-global-ai-rate-limiting §8.2 — 限流状态控制器。
 *
 * 新增 controller 与 `/api/v1` 路由，挂 auth、Policy、validator 与统一 envelope。
 * 组织隔离：全部查询路径附加 `organization_id` 过滤。
 */

import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import RateLimitQueryService from '#services/rate_limiting/rate_limit_query_service'
import RateLimitPolicy from '#policies/rate_limit_policy'
import { rateLimitStatusValidator } from '#validators/rate_limit'

@inject()
export default class RateLimitController {
  constructor(
    private readonly queryService: RateLimitQueryService,
    private readonly policy: RateLimitPolicy,
  ) {}

  /**
   * GET /api/v1/organizations/:organizationId/ai-rate-limits/status
   * 查询当前窗口限流状态。
   */
  async status(ctx: HttpContext) {
    await this.policy.view(ctx)

    const organizationId = ctx.tenant?.organizationId
    if (organizationId === null || organizationId === undefined) {
      return ctx.response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: '缺少组织上下文' },
      })
    }

    const payload = await ctx.request.validateUsing(rateLimitStatusValidator)

    const result = await this.queryService.getStatus({
      organizationId: Number(organizationId),
      connectionId: payload.connectionId ?? undefined,
      modelId: payload.modelId ?? undefined,
    })

    return ctx.response.ok({ data: result })
  }
}
