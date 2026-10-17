import TrizResourceAnalyzerPolicy from '#policies/triz_resource_analyzer_policy'
import TrizResourceAnalyzerService from '#services/triz_resource_analyzer_service'
import {
  createResourceAnalysisValidator,
  listResourceAnalysesValidator,
  listResourceSnapshotsValidator,
  listResourceOpportunitiesValidator,
  reviewResourceOpportunityValidator,
} from '#validators/triz_resource_analyzer'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import { AuditEvent } from '#services/audit_service'
import AuditService from '#services/audit_service'

/**
 * TRIZ 资源分析器控制器（v3-triz-resource-analyzer §5.3）。
 *
 * 每个端点先过权限门：view 端点要求 triz_resource_analyzer:view，
 * manage/preview 端点要求 triz_resource_analyzer:manage，explain 额外要求 ai:trigger。
 * 拒绝时统一返回 403 `PERMISSION_DENIED` 并写低敏拒绝审计，不泄露运行数/资源标签/hash。
 */
@inject()
export default class TrizResourceAnalyzerController {
  constructor(
    private service: TrizResourceAnalyzerService,
    private policy: TrizResourceAnalyzerPolicy,
    private auditService: AuditService,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgProject(ctx: HttpContext): { organizationId: number; projectId: number } {
    return {
      organizationId: ctx.tenant!.organizationId,
      projectId: Number(ctx.params.projectId),
    }
  }

  /** 统一权限门：不通过时写低敏拒绝审计并返回 403。 */
  private async guard(
    ctx: HttpContext,
    ability: 'view' | 'manage' | 'aiExplain',
    message: string,
  ): Promise<{ user: User; organizationId: number; projectId: number } | null> {
    const user = this.currentUser(ctx)
    const { organizationId, projectId } = this.orgProject(ctx)
    const allowed = await this.policy[ability](user, organizationId, projectId)

    if (!allowed) {
      await this.auditService.log({
        event: AuditEvent.TRIZ_RESOURCE_PERMISSION_DENIED,
        userId: user.id,
        organizationId,
        projectId,
        metadata: { ability },
      })
      ctx.response.status(403).json({
        error: { code: 'PERMISSION_DENIED', message },
      })
      return null
    }

    return { user, organizationId, projectId }
  }

  async create(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'manage', '无权创建 TRIZ 资源分析运行')
    if (!guard) return
    const { user, organizationId, projectId } = guard

    const payload = await ctx.request.validateUsing(createResourceAnalysisValidator)
    // 校验器里 capacity 可选（缺省即 undefined），契约里是必填可空，进 Service 前补齐成 null
    const result = await this.service.createRun(organizationId, projectId, user.id, {
      ...payload,
      manualResourceDrafts: payload.manualResourceDrafts?.map((d) => ({
        ...d,
        capacity: d.capacity ?? null,
      })),
    })

    return ctx.response.ok({
      data: {
        ...result.run,
        resources: result.resources,
        opportunities: result.opportunities,
      },
    })
  }

  async index(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'view', '无权查看 TRIZ 资源分析运行')
    if (!guard) return
    const { user, organizationId, projectId } = guard

    const filters = await ctx.request.validateUsing(listResourceAnalysesValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.service.listRuns(organizationId, projectId, filters)

    await this.auditService.log({
      event: AuditEvent.TRIZ_RESOURCE_SUMMARY_READ,
      userId: user.id,
      organizationId,
      projectId,
      metadata: { runCount: result.meta.total, page: result.meta.page },
    })

    return ctx.response.ok(result)
  }

  async show(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'view', '无权查看 TRIZ 资源分析运行')
    if (!guard) return
    const { organizationId, projectId } = guard

    const runId = Number(ctx.params.runId)
    const run = await this.service.getRun(organizationId, projectId, runId)
    if (!run) {
      return ctx.response.status(404).json({
        error: { code: 'RESOURCE_NOT_FOUND', message: '分析运行不存在' },
      })
    }

    return ctx.response.ok({ data: run })
  }

  async resources(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'view', '无权查看 TRIZ 资源快照')
    if (!guard) return
    const { user, organizationId, projectId } = guard

    const runId = Number(ctx.params.runId)
    const filters = await ctx.request.validateUsing(listResourceSnapshotsValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.service.listResources(organizationId, projectId, runId, filters)

    await this.auditService.log({
      event: AuditEvent.TRIZ_RESOURCE_SNAPSHOT_READ,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'triz_resource_analysis_run',
      entityId: runId,
      metadata: { resourceCount: result.meta.total },
    })

    return ctx.response.ok(result)
  }

  async opportunities(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'view', '无权查看 TRIZ 资源机会候选')
    if (!guard) return
    const { organizationId, projectId } = guard

    const runId = Number(ctx.params.runId)
    const filters = await ctx.request.validateUsing(listResourceOpportunitiesValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.service.listOpportunities(organizationId, projectId, runId, filters)
    return ctx.response.ok(result)
  }

  async explain(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'aiExplain', '无权生成 TRIZ 资源分析说明')
    if (!guard) return
    const { user, organizationId, projectId } = guard

    const runId = Number(ctx.params.runId)
    const opportunityId = Number(ctx.params.opportunityId)
    const result = await this.service.explainOpportunity(
      organizationId,
      projectId,
      user.id,
      runId,
      opportunityId,
    )
    return ctx.response.ok({ data: result })
  }

  async review(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'manage', '无权审查 TRIZ 资源机会候选')
    if (!guard) return
    const { user, organizationId, projectId } = guard

    const runId = Number(ctx.params.runId)
    const opportunityId = Number(ctx.params.opportunityId)
    const payload = await ctx.request.validateUsing(reviewResourceOpportunityValidator)
    const result = await this.service.reviewOpportunity(
      organizationId,
      projectId,
      user.id,
      runId,
      opportunityId,
      payload,
    )
    return ctx.response.ok({ data: result })
  }

  async workbenchPreview(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'manage', '无权生成 Workbench 预览')
    if (!guard) return
    const { user, organizationId, projectId } = guard

    const result = await this.service.workbenchPreview(
      organizationId,
      projectId,
      user.id,
      Number(ctx.params.runId),
      Number(ctx.params.opportunityId),
    )
    return ctx.response.ok({ data: result })
  }

  async decisionPreview(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'manage', '无权生成决策预览')
    if (!guard) return
    const { user, organizationId, projectId } = guard

    const result = await this.service.decisionPreview(
      organizationId,
      projectId,
      user.id,
      Number(ctx.params.runId),
      Number(ctx.params.opportunityId),
    )
    return ctx.response.ok({ data: result })
  }

  async draftPreview(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'manage', '无权生成草案预览')
    if (!guard) return
    const { user, organizationId, projectId } = guard

    const result = await this.service.draftPreview(
      organizationId,
      projectId,
      user.id,
      Number(ctx.params.runId),
      Number(ctx.params.opportunityId),
    )
    return ctx.response.ok({ data: result })
  }

  async resourcePreview(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'manage', '无权生成资源预览')
    if (!guard) return
    const { user, organizationId, projectId } = guard

    const result = await this.service.resourcePreview(
      organizationId,
      projectId,
      user.id,
      Number(ctx.params.runId),
      Number(ctx.params.opportunityId),
    )
    return ctx.response.ok({ data: result })
  }
}
