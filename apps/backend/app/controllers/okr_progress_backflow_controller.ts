import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import OkrProgressBackflowService from '#services/okr_progress_backflow_service'
import OkrPolicy from '#policies/okr_policy'
import {
  okrBackflowListQueryValidator,
  okrBackflowRecalculateValidator,
  okrBackflowBatchRecalculateValidator,
  okrBackflowConfirmValidator,
  okrBackflowRejectValidator,
} from '#validators/okr'
import { ValidationException } from '#exceptions/api_exception'

@inject()
export default class OkrProgressBackflowController {
  constructor(
    private readonly backflowService: OkrProgressBackflowService,
    private readonly policy: OkrPolicy,
  ) {}

  private getOrganizationId(ctx: HttpContext): number {
    const id = Number(ctx.params.organizationId)
    if (!Number.isFinite(id) || id <= 0) {
      throw new ValidationException('无效的组织 ID')
    }
    return id
  }

  // ── List ──────────────────────────────────────────────────────────────

  async listSuggestions({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const query = await okrBackflowListQueryValidator.validate(request.qs())
    const result = await this.backflowService.listSuggestions(
      organizationId,
      query as any,
      auth.user!,
    )
    return response.json(result)
  }

  // ── Detail ────────────────────────────────────────────────────────────

  async getSuggestion({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const suggestionId = Number(request.params().suggestionId)
    const result = await this.backflowService.getSuggestion(
      organizationId,
      suggestionId,
      auth.user!,
    )
    return response.json(result)
  }

  // ── Recalculate ───────────────────────────────────────────────────────

  async recalculateKeyResult({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const input = await okrBackflowRecalculateValidator.validate(request.body())
    const result = await this.backflowService.recalculateKeyResult(
      organizationId,
      input.keyResultId,
      auth.user!,
    )
    return response.status(201).json({ data: result })
  }

  // ── Batch Recalculate ─────────────────────────────────────────────────

  async batchRecalculate({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const input = await okrBackflowBatchRecalculateValidator.validate(request.body())
    const result = await this.backflowService.batchRecalculate(
      organizationId,
      input.scope as 'objective' | 'cycle',
      input.scopeId,
      input.maxKrCount ?? 100,
      auth.user!,
    )
    return response.status(201).json(result)
  }

  // ── Confirm ───────────────────────────────────────────────────────────

  async confirmSuggestion({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const input = await okrBackflowConfirmValidator.validate(request.body())
    const result = await this.backflowService.confirmSuggestion(
      organizationId,
      input.suggestionId,
      input.note ?? null,
      auth.user!,
    )
    return response.json({ data: result })
  }

  // ── Reject ────────────────────────────────────────────────────────────

  async rejectSuggestion({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const input = await okrBackflowRejectValidator.validate(request.body())
    const result = await this.backflowService.rejectSuggestion(
      organizationId,
      input.suggestionId,
      input.reasonCode as any,
      input.reasonNote,
      auth.user!,
    )
    return response.json({ data: result })
  }
}
