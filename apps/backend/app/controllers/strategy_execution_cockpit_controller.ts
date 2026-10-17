import { inject } from '@adonisjs/core'
import { FeatureDisabledException } from '#exceptions/api_exception'
import StrategyExecutionCockpitPolicy from '#policies/strategy_execution_cockpit_policy'
import StrategyExecutionCockpitService from '#services/strategy_execution_cockpit_service'
import {
  parseCockpitArrayParam,
  strategyExecutionCockpitParamsValidator,
  strategyExecutionCockpitQueryValidator,
} from '#validators/strategy_execution_cockpit'
import type { HttpContext } from '@adonisjs/core/http'
import type { CockpitQuery } from '@aiproj/types'

/**
 * 战略执行驾驶舱 Controller（v3-strategy-execution-cockpit §4.7）。
 *
 * 职责严格限定：认证 → 参数解析与校验 → Policy → Service → 响应格式化。
 * 路由：GET /api/v1/organizations/:organizationId/strategy-execution-cockpit
 */
@inject()
export default class StrategyExecutionCockpitController {
  constructor(
    private readonly cockpit: StrategyExecutionCockpitService,
    private readonly policy: StrategyExecutionCockpitPolicy,
  ) {}

  async show(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()

    if (!this.cockpit.isFeatureEnabled()) {
      throw new FeatureDisabledException('战略执行驾驶舱功能已关闭')
    }

    const { organizationId } = await strategyExecutionCockpitParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs()
    const validated = await strategyExecutionCockpitQueryValidator.validate({
      ...qs,
      scope: parseCockpitArrayParam(qs.scope),
      ownerId: parseCockpitArrayParam(qs.ownerId)?.map(Number),
      status: parseCockpitArrayParam(qs.status),
      theme: parseCockpitArrayParam(qs.theme),
      include: parseCockpitArrayParam(qs.include),
    })
    const query = validated as CockpitQuery

    const access = await this.policy.resolveAccess(user, organizationId)
    const result = await this.cockpit.getSummary(user, organizationId, query, access)

    return ctx.response.ok({ data: result })
  }
}
