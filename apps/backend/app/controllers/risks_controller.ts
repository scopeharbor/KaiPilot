import Risk from '#models/risk'
import Project from '#models/project'
import RiskPolicy from '#policies/risk_policy'
import RiskService from '#services/risk_service'
import RiskSuggestionService from '#services/risk_suggestion_service'
import {
  createRiskValidator,
  updateRiskValidator,
  transitionRiskStatusValidator,
  matrixQueryValidator,
  listRisksValidator,
  acceptAiSuggestionValidator,
} from '#validators/risk'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import AuditService, { AuditEvent } from '#services/audit_service'
import type { RiskStatus } from '@aiproj/types'

@inject()
export default class RisksController {
  constructor(
    private riskService: RiskService,
    private suggestionService: RiskSuggestionService,
    private policy: RiskPolicy,
    private audit: AuditService,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private async findRiskInOrg(organizationId: number, riskId: number): Promise<Risk | null> {
    return Risk.query()
      .where('id', riskId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()
  }

  async index(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, ctx.tenant!.organizationId, projectId)

    const filters = await ctx.request.validateUsing(listRisksValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.riskService.list(ctx.tenant!.organizationId, projectId, filters)
    return ctx.response.ok(result)
  }

  async show(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const riskId = Number(ctx.params.id)
    const organizationId = ctx.tenant!.organizationId
    const risk = await this.findRiskInOrg(organizationId, riskId)
    if (!risk)
      return ctx.response.notFound({ error: { code: 'RISK_NOT_FOUND', message: '风险不存在' } })
    await this.policy.authorizeView(user, organizationId, risk.projectId)
    return ctx.response.ok({ data: risk })
  }

  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createRiskValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeManage(user, organizationId, projectId)

    const risk = await this.riskService.create(organizationId, projectId, input, user.id, {
      requestId: ctx.request.id() ?? null,
    })
    return ctx.response.created({ data: risk })
  }

  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateRiskValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const riskId = Number(ctx.params.id)

    // 先查风险判断权限
    const existingRisk = await this.findRiskInOrg(organizationId, riskId)
    if (!existingRisk)
      return ctx.response.notFound({ error: { code: 'RISK_NOT_FOUND', message: '风险不存在' } })
    const projectId = existingRisk.projectId

    await this.policy.authorizeUpdate(user, organizationId, projectId, existingRisk)

    const updated = await this.riskService.update(
      organizationId,
      projectId,
      riskId,
      input,
      user.id,
      {
        requestId: ctx.request.id() ?? null,
      },
    )
    return ctx.response.ok({ data: updated })
  }

  async destroy(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const riskId = Number(ctx.params.id)
    const risk = await this.findRiskInOrg(organizationId, riskId)
    if (!risk)
      return ctx.response.notFound({ error: { code: 'RISK_NOT_FOUND', message: '风险不存在' } })
    const projectId = risk.projectId
    await this.policy.authorizeManage(user, organizationId, projectId)

    await this.riskService.softDelete(organizationId, projectId, riskId, user.id, {
      requestId: ctx.request.id() ?? null,
    })
    return ctx.response.noContent()
  }

  async transitionStatus(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(transitionRiskStatusValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const riskId = Number(ctx.params.id)
    const existingRisk = await this.findRiskInOrg(organizationId, riskId)
    if (!existingRisk)
      return ctx.response.notFound({ error: { code: 'RISK_NOT_FOUND', message: '风险不存在' } })
    const projectId = existingRisk.projectId
    await this.policy.authorizeTransitionStatus(user, organizationId, projectId)

    const risk = await this.riskService.transitionStatus(
      organizationId,
      projectId,
      riskId,
      input.status as RiskStatus,
      user.id,
      { requestId: ctx.request.id() ?? null },
    )
    return ctx.response.ok({ data: risk })
  }

  async matrix(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, ctx.tenant!.organizationId, projectId)

    const { basis } = await ctx.request.validateUsing(matrixQueryValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.riskService.matrix(ctx.tenant!.organizationId, projectId, basis)
    return ctx.response.ok({ data: result })
  }

  async aiSuggestions(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeManage(user, organizationId, projectId)

    // 获取项目上下文
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()

    const result = await this.suggestionService.suggest(
      organizationId,
      projectId,
      {
        title: project?.name ?? '未命名项目',
        description: project?.description ?? undefined,
      },
      user.id,
    )
    return ctx.response.ok({ data: result })
  }

  async acceptAiSuggestion(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(acceptAiSuggestionValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeManage(user, organizationId, projectId)

    const risk = await this.riskService.create(
      organizationId,
      projectId,
      {
        title: input.title,
        description: input.description,
        category: input.category,
        probability: input.probability,
        impact: input.impact,
        mitigationStrategy: input.mitigation ?? null,
        ownerId: input.ownerId ?? null,
        relatedTaskId: input.relatedTaskId ?? null,
        aiMetadata: {
          aiMarker: input.aiMarker,
          suggestionBatchId: input.suggestionBatchId,
        },
      },
      user.id,
    )

    await this.audit.log({
      event: AuditEvent.RISK_AI_ACCEPTED,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'risk',
      entityId: risk.id,
      metadata: {
        suggestionBatchId: input.suggestionBatchId,
        modifiedByUser: input.modifiedByUser ?? false,
      },
    })

    return ctx.response.created({ data: risk })
  }

  async rejectAiSuggestion(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const batchId = ctx.params.batchId
    await this.policy.authorizeManage(user, organizationId, projectId)

    await this.audit.log({
      event: AuditEvent.RISK_AI_REJECTED,
      userId: user.id,
      organizationId,
      projectId,
      metadata: { suggestionBatchId: batchId },
    })

    return ctx.response.ok({ data: { rejected: true } })
  }
}
