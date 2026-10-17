/**
 * v3-triz-innovation-workbench —— TRIZ Innovation Workbench API。
 *
 * HTTP 入口只做请求解析、权限校验和响应格式化。
 * 读端点保持 side-effect free；comparison / narrative / handoff 只有显式调用才写工作台元数据。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import TrizInnovationPolicy from '#policies/triz_innovation_policy'
import InnovationWorkbenchService from '#services/triz_innovation/innovation_workbench_service'
import InnovationSourceService from '#services/triz_innovation/innovation_source_service'
import InnovationScoringService from '#services/triz_innovation/innovation_scoring_service'
import InnovationNarrativeService from '#services/triz_innovation/innovation_narrative_service'
import InnovationHandoffService from '#services/triz_innovation/innovation_handoff_service'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  innovationAddOptionValidator,
  innovationComparisonValidator,
  innovationCreateSchemeValidator,
  innovationHandoffValidator,
  innovationListValidator,
  innovationNarrativeValidator,
  innovationRemoveOptionValidator,
  innovationSourcesValidator,
  innovationUpdateSchemeValidator,
} from '#validators/triz_innovation'
import { PermissionDeniedException, ValidationException } from '#exceptions/api_exception'
import type User from '#models/user'
import type { InnovationOption, InnovationReviewState, InnovationSourceType } from '@aiproj/types'

@inject()
export default class TrizInnovationController {
  constructor(
    private policy: TrizInnovationPolicy,
    private workbench: InnovationWorkbenchService,
    private sources: InnovationSourceService,
    private scoring: InnovationScoringService,
    private narrative: InnovationNarrativeService,
    private handoffService: InnovationHandoffService,
    private audit: AuditService,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgIdOf(ctx: HttpContext): number {
    return Number(ctx.tenant!.organizationId)
  }

  private projectIdFrom(ctx: HttpContext): number {
    return Number(ctx.params.projectId)
  }

  private schemeIdFrom(ctx: HttpContext): string {
    return String(ctx.params.schemeId)
  }

  private requestIdOf(ctx: HttpContext): string | null {
    return ctx.request.id() ?? null
  }

  private async guardView(ctx: HttpContext): Promise<void> {
    const allowed = await this.policy.view(
      this.currentUser(ctx),
      this.orgIdOf(ctx),
      this.projectIdFrom(ctx),
    )
    if (!allowed) {
      await this.auditPermissionDenied(ctx, 'view')
      throw new PermissionDeniedException('无权查看 TRIZ 创新工作台')
    }
  }

  private async guardManage(ctx: HttpContext): Promise<void> {
    const allowed = await this.policy.manage(
      this.currentUser(ctx),
      this.orgIdOf(ctx),
      this.projectIdFrom(ctx),
    )
    if (!allowed) {
      await this.auditPermissionDenied(ctx, 'manage')
      throw new PermissionDeniedException('无权管理 TRIZ 创新工作台方案')
    }
  }

  private async guardNarrative(ctx: HttpContext): Promise<void> {
    const allowed = await this.policy.narrative(
      this.currentUser(ctx),
      this.orgIdOf(ctx),
      this.projectIdFrom(ctx),
    )
    if (!allowed) {
      await this.auditPermissionDenied(ctx, 'narrative')
      throw new PermissionDeniedException('无权生成 TRIZ 创新工作台说明')
    }
  }

  private async guardHandoff(ctx: HttpContext): Promise<void> {
    const allowed = await this.policy.handoff(
      this.currentUser(ctx),
      this.orgIdOf(ctx),
      this.projectIdFrom(ctx),
    )
    if (!allowed) {
      await this.auditPermissionDenied(ctx, 'handoff')
      throw new PermissionDeniedException('无权创建 TRIZ 创新工作台待审核草案')
    }
  }

  private async auditPermissionDenied(ctx: HttpContext, action: string): Promise<void> {
    const user = this.currentUser(ctx)
    await this.audit.log({
      event: AuditEvent.TRIZ_INNOVATION_PERMISSION_DENIED,
      userId: user.id,
      organizationId: this.orgIdOf(ctx),
      projectId: this.projectIdFrom(ctx),
      entityType: 'triz_innovation_workbench',
      entityId: null,
      requestId: this.requestIdOf(ctx),
      metadata: { action },
    })
  }

  async sourcesIndex(ctx: HttpContext) {
    await this.guardView(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const params = await ctx.request.validateUsing(innovationSourcesValidator, {
      data: { projectId, ...ctx.request.qs() },
    })

    const data = await this.sources.listSources(user, orgId, params.projectId, {
      includeDraft: params.includeDraft,
    })
    return ctx.response.ok({ data })
  }

  async index(ctx: HttpContext) {
    await this.guardView(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const params = await ctx.request.validateUsing(innovationListValidator, {
      data: { projectId, ...ctx.request.qs() },
    })

    const result = await this.workbench.list(orgId, params.projectId, {
      page: params.page,
      perPage: params.perPage,
      status: params.status,
    })
    return ctx.response.ok({
      data: result.data.map((record) => this.workbench.toDTO(record)),
      meta: result.meta,
    })
  }

  async store(ctx: HttpContext) {
    await this.guardManage(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const body = await ctx.request.validateUsing(innovationCreateSchemeValidator, {
      data: { projectId, ...ctx.request.body() },
    })

    const record = await this.workbench.createScheme({
      organizationId: orgId,
      projectId: body.projectId,
      userId: user.id,
      name: body.name,
      note: body.note ?? null,
      requestId: this.requestIdOf(ctx),
    })
    return ctx.response.created({ data: this.workbench.toDTO(record) })
  }

  async show(ctx: HttpContext) {
    await this.guardView(ctx)
    const record = await this.workbench.getBySchemeId(
      this.orgIdOf(ctx),
      this.projectIdFrom(ctx),
      this.schemeIdFrom(ctx),
    )
    return ctx.response.ok({ data: this.workbench.toDTO(record) })
  }

  async update(ctx: HttpContext) {
    await this.guardManage(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const body = await ctx.request.validateUsing(innovationUpdateSchemeValidator, {
      data: { projectId, ...ctx.request.body() },
    })

    const record = await this.workbench.updateScheme(
      orgId,
      body.projectId,
      this.schemeIdFrom(ctx),
      user.id,
      {
        name: body.name,
        note: body.note,
        reviewState: body.reviewState as InnovationReviewState | undefined,
      },
      this.requestIdOf(ctx),
    )
    return ctx.response.ok({ data: this.workbench.toDTO(record) })
  }

  async abandon(ctx: HttpContext) {
    await this.guardManage(ctx)
    const user = this.currentUser(ctx)
    const record = await this.workbench.abandonScheme(
      this.orgIdOf(ctx),
      this.projectIdFrom(ctx),
      this.schemeIdFrom(ctx),
      user.id,
      this.requestIdOf(ctx),
    )
    return ctx.response.ok({ data: this.workbench.toDTO(record) })
  }

  async addOption(ctx: HttpContext) {
    await this.guardManage(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const body = await ctx.request.validateUsing(innovationAddOptionValidator, {
      data: { projectId, ...ctx.request.body() },
    })

    let option: InnovationOption
    try {
      option = await this.sources.buildOption(user, orgId, body.projectId, {
        origin: body.origin as InnovationOption['origin'],
        sourceRefs: body.sourceRefs.map((ref) => ({
          ...ref,
          sourceType: ref.sourceType as InnovationSourceType,
        })),
        selectedPathId: body.selectedPathId ?? null,
        principleIds: body.principleIds,
        name: body.name,
        description: body.description ?? null,
        applicability: body.applicability,
        nonApplicability: body.nonApplicability,
      })
    } catch (error) {
      throw new ValidationException(error instanceof Error ? error.message : '候选路径来源不可用')
    }
    option.createdBy = user.id

    const record = await this.workbench.addOption(
      orgId,
      body.projectId,
      this.schemeIdFrom(ctx),
      user.id,
      option,
      this.requestIdOf(ctx),
    )
    return ctx.response.created({ data: this.workbench.toDTO(record) })
  }

  async removeOption(ctx: HttpContext) {
    await this.guardManage(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const body = await ctx.request.validateUsing(innovationRemoveOptionValidator, {
      data: { projectId, optionId: String(ctx.params.optionId) },
    })

    const record = await this.workbench.removeOption(
      orgId,
      body.projectId,
      this.schemeIdFrom(ctx),
      user.id,
      body.optionId,
      this.requestIdOf(ctx),
    )
    return ctx.response.ok({ data: this.workbench.toDTO(record) })
  }

  async compare(ctx: HttpContext) {
    await this.guardManage(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const params = await ctx.request.validateUsing(innovationComparisonValidator, {
      data: { projectId },
    })
    const record = await this.workbench.getBySchemeId(
      orgId,
      params.projectId,
      this.schemeIdFrom(ctx),
    )
    const comparison = this.scoring.compareScheme(record.payload)
    const updated = await this.workbench.saveScoresAndComparison(
      orgId,
      params.projectId,
      record.schemeId,
      {
        scores: this.scoring.scoreScheme(record.payload),
        comparisonRef: this.scoring.comparisonRef(record.payload),
      },
    )
    await this.audit.log({
      event: AuditEvent.TRIZ_INNOVATION_COMPARISON_GENERATED,
      userId: this.currentUser(ctx).id,
      organizationId: orgId,
      projectId: params.projectId,
      entityType: 'triz_innovation_scheme',
      entityId: record.id,
      requestId: this.requestIdOf(ctx),
      metadata: {
        schemeId: record.schemeId,
        optionIds: comparison.cells.map((cell) => cell.optionId),
        comparisonRef: updated.payload.comparisonRef,
        warningTotal: comparison.warnings.length,
        modelCostRecorded: comparison.modelCostRecorded,
      },
    })

    return ctx.response.ok({
      data: {
        scheme: this.workbench.toDTO(updated),
        comparison,
      },
    })
  }

  async generateNarrative(ctx: HttpContext) {
    await this.guardNarrative(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const params = await ctx.request.validateUsing(innovationNarrativeValidator, {
      data: { projectId },
    })
    const record = await this.workbench.getBySchemeId(
      orgId,
      params.projectId,
      this.schemeIdFrom(ctx),
    )
    const comparison = this.scoring.compareScheme(record.payload)
    const narrative = await this.narrative.generateNarrative({
      organizationId: orgId,
      projectId: params.projectId,
      userId: user.id,
      scheme: record.payload,
      comparison,
      requestId: this.requestIdOf(ctx),
    })
    const updated = await this.workbench.saveNarrative(
      orgId,
      params.projectId,
      record.schemeId,
      narrative,
    )

    return ctx.response.ok({
      data: {
        scheme: this.workbench.toDTO(updated),
        comparison,
        narrative,
      },
    })
  }

  async draftHandoff(ctx: HttpContext) {
    await this.guardHandoff(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const body = await ctx.request.validateUsing(innovationHandoffValidator, {
      data: { projectId, ...ctx.request.body() },
    })

    const result = await this.handoffService.createHandoff({
      user,
      organizationId: orgId,
      projectId: body.projectId,
      schemeId: this.schemeIdFrom(ctx),
      optionIds: body.optionIds,
      note: body.note ?? null,
      requestId: this.requestIdOf(ctx),
    })

    const statusCode = result.handoffStatus === 'candidate_created' ? 201 : 422
    return ctx.response.status(statusCode).send({ data: result })
  }
}
