import AiM0EvaluationService from '#services/ai_m0/evaluation_service'
import { buildEvaluationPlan } from '#services/ai_m0/evaluation_plan'
import { hashInputCases } from '#services/ai_m0/inputs'
import AiConnectionPolicy from '#policies/ai_connection_policy'
import { PermissionDeniedException } from '#exceptions/api_exception'
import { evaluationPlanValidator, executeEvaluationValidator } from '#validators/ai_m0_evaluation'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

@inject()
export default class AiM0EvaluationsController {
  constructor(
    private evaluations: AiM0EvaluationService,
    private policy: AiConnectionPolicy,
  ) {}

  private async context(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = Number(ctx.tenant?.organizationId)
    if (!organizationId || !(await this.policy.manage(user, organizationId))) {
      throw new PermissionDeniedException('无权运行 AI 评测')
    }
    return { organizationId }
  }

  async plan(ctx: HttpContext) {
    await this.context(ctx)
    const input = await ctx.request.validateUsing(evaluationPlanValidator)
    const steps = buildEvaluationPlan(input)
    return ctx.response.ok({
      data: steps,
      meta: {
        inputSetHash: hashInputCases(),
        total: steps.length,
        repetitions: input.mode === 'real' ? 20 : (input.repetitions ?? 1),
        temperature: 0,
      },
    })
  }

  async execute(ctx: HttpContext) {
    const { organizationId } = await this.context(ctx)
    const input = await ctx.request.validateUsing(executeEvaluationValidator)
    const outcome = await this.evaluations.execute(organizationId, input)
    return ctx.response.ok({ data: outcome })
  }
}
