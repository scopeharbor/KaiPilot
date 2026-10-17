import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import OkrCascadeAlignmentService from '#services/okr_cascade_alignment_service'
import OkrPolicy from '#policies/okr_policy'
import {
  okrCascadePlanCreateValidator,
  okrCascadePlanListQueryValidator,
  okrCascadeItemConfirmValidator,
  okrCascadeItemRejectValidator,
  okrRelationCreateValidator,
  okrRelationUpdateValidator,
  okrRelationListQueryValidator,
  okrHealthQueryValidator,
  okrMatrixQueryValidator,
  okrAiCascadeSuggestionValidator,
} from '#validators/okr'
import { ValidationException } from '#exceptions/api_exception'

@inject()
export default class OkrCascadeAlignmentController {
  constructor(
    private readonly service: OkrCascadeAlignmentService,
    private readonly policy: OkrPolicy,
  ) {}

  private getOrganizationId(ctx: HttpContext): number {
    const id = Number(ctx.params.organizationId)
    if (!Number.isFinite(id) || id <= 0) {
      throw new ValidationException('无效的组织 ID')
    }
    return id
  }

  // ── Cascade Plans ────────────────────────────────────────────────────────

  async createCascadePlan({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const input = await okrCascadePlanCreateValidator.validate(request.body())
    const result = await this.service.createCascadePlan(organizationId, input as any, auth.user!)
    return response.status(201).json(result)
  }

  async listCascadePlans({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const query = await okrCascadePlanListQueryValidator.validate(request.qs())
    const result = await this.service.listCascadePlans(organizationId, query as any, auth.user!)
    return response.json(result)
  }

  async getCascadePlan({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const planId = Number(request.params().planId)
    const result = await this.service.getCascadePlan(planId, auth.user!)
    return response.json(result)
  }

  async confirmCascadeItems({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const planId = Number(request.params().planId)
    const input = await okrCascadeItemConfirmValidator.validate(request.body())
    const result = await this.service.confirmCascadeItems(planId, input as any, auth.user!)
    return response.json(result)
  }

  async rejectCascadeItems({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const planId = Number(request.params().planId)
    const input = await okrCascadeItemRejectValidator.validate(request.body())
    const result = await this.service.rejectCascadeItems(planId, input as any, auth.user!)
    return response.json(result)
  }

  // ── Cross-Objective Relations ────────────────────────────────────────────

  async createRelation({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const input = await okrRelationCreateValidator.validate(request.body())
    const result = await this.service.createRelation(organizationId, input as any, auth.user!)
    return response.status(201).json(result)
  }

  async updateRelation({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const relationId = Number(request.params().relationId)
    const input = await okrRelationUpdateValidator.validate(request.body())
    const result = await this.service.updateRelation(relationId, input as any, auth.user!)
    return response.json(result)
  }

  async archiveRelation({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const relationId = Number(request.params().relationId)
    const result = await this.service.archiveRelation(relationId, auth.user!)
    return response.json(result)
  }

  async getRelation({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const relationId = Number(request.params().relationId)
    const result = await this.service.getRelation(relationId, auth.user!)
    return response.json(result)
  }

  async listRelations({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const query = await okrRelationListQueryValidator.validate(request.qs())
    const result = await this.service.listRelations(organizationId, query as any, auth.user!)
    return response.json(result)
  }

  // ── Health ───────────────────────────────────────────────────────────────

  async getHealth({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    await this.policy.assertOrganizationVisible(auth.user!, organizationId)
    const objectiveId = Number(request.params().objectiveId)
    const result = await this.service.getHealth(objectiveId, auth.user!)
    return response.json(result)
  }

  async listHealth({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const query = await okrHealthQueryValidator.validate(request.qs())
    const result = await this.service.listHealth(organizationId, query as any, auth.user!)
    return response.json(result)
  }

  // ── Matrix ───────────────────────────────────────────────────────────────

  async getMatrix({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const query = await okrMatrixQueryValidator.validate(request.qs())
    const result = await this.service.getMatrix(organizationId, query as any, auth.user!)
    return response.json(result)
  }

  // ── AI Cascade Suggestions ───────────────────────────────────────────────

  async generateAiCascadeSuggestions({ request, response, auth }: HttpContext) {
    const organizationId = this.getOrganizationId({ request, params: request.params() } as any)
    const input = await okrAiCascadeSuggestionValidator.validate(request.body())
    const result = await this.service.generateAiCascadeSuggestions(
      organizationId,
      input as any,
      auth.user!,
    )
    return response.json(result)
  }
}
