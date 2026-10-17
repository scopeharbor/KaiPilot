import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { normalizeResourceGapQuery } from '@aiproj/types'
import ResourceGapAnalysisService from '#services/resource_gap_analysis_service'
import ResourceGapAnalysisPolicy from '#policies/resource_gap_analysis_policy'
import {
  resourceGapParamsValidator,
  resourceGapSummaryValidator,
  resourceGapDimensionValidator,
  resourceGapExplanationValidator,
  resourceGapDrillDownValidator,
  parseCommaParam,
} from '#validators/resource_gap_analysis'

/**
 * ResourceGapAnalysisController —— 资源缺口分析只读 API（v3-resource-gap-analysis §3.6）。
 *
 * 全部端点：
 * - GET /api/v1/organizations/:organizationId/resource-gaps/summary
 * - GET /api/v1/organizations/:organizationId/resource-gaps/by-role
 * - GET /api/v1/organizations/:organizationId/resource-gaps/by-skill
 * - GET /api/v1/organizations/:organizationId/resource-gaps/by-timebucket
 * - GET /api/v1/organizations/:organizationId/resource-gaps/by-project
 * - GET /api/v1/organizations/:organizationId/resource-gaps/by-portfolio
 * - GET /api/v1/organizations/:organizationId/resource-gaps/explanation
 * - GET /api/v1/organizations/:organizationId/resource-gaps/drill-down
 *
 * 红线：所有端点 MUST 仅为 GET；POST/PUT/PATCH/DELETE 路由 MUST 不存在。
 */
@inject()
export default class ResourceGapAnalysisController {
  constructor(
    private readonly service: ResourceGapAnalysisService,
    private readonly policy: ResourceGapAnalysisPolicy,
  ) {}

  // ── Summary ──────────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-gaps/summary */
  async summary(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await resourceGapParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await resourceGapSummaryValidator.validate({
      ...qs,
      metrics: parseCommaParam(qs.metrics),
      skillKeys: parseCommaParam(qs.skillKeys),
      roles: parseCommaParam(qs.roles),
      projectIds: parseCommaParam(qs.projectIds),
      portfolioIds: parseCommaParam(qs.portfolioIds),
    })
    const query = normalizeResourceGapQuery(validated as never)
    const access = await this.policy.resolveAccess(user, organizationId)

    const result = await this.service.getSummary(user, organizationId, query, access)
    return ctx.response.ok({ data: result })
  }

  // ── By-Role ──────────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-gaps/by-role */
  async byRole(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await resourceGapParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await resourceGapDimensionValidator.validate({
      ...qs,
      metrics: parseCommaParam(qs.metrics),
      roles: parseCommaParam(qs.roles),
      projectIds: parseCommaParam(qs.projectIds),
      skillKeys: parseCommaParam(qs.skillKeys),
      portfolioIds: parseCommaParam(qs.portfolioIds),
    })
    const query = normalizeResourceGapQuery({
      ...(validated as Record<string, unknown>),
      type: 'by-role',
    } as never)
    const access = await this.policy.resolveAccess(user, organizationId)

    const result = await this.service.getByDimension(user, organizationId, query, access, 'role')
    return ctx.response.ok({
      data: result.gaps,
      meta: { total: result.gaps.length, page: query.page, perPage: query.perPage },
      warnings: result.warnings,
    })
  }

  // ── By-Skill ─────────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-gaps/by-skill */
  async bySkill(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await resourceGapParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await resourceGapDimensionValidator.validate({
      ...qs,
      metrics: parseCommaParam(qs.metrics),
      skillKeys: parseCommaParam(qs.skillKeys),
      projectIds: parseCommaParam(qs.projectIds),
      portfolioIds: parseCommaParam(qs.portfolioIds),
    })
    const query = normalizeResourceGapQuery({
      ...(validated as Record<string, unknown>),
      type: 'by-skill',
    } as never)
    const access = await this.policy.resolveAccess(user, organizationId)

    const result = await this.service.getByDimension(user, organizationId, query, access, 'skill')
    return ctx.response.ok({
      data: result.gaps,
      meta: { total: result.gaps.length, page: query.page, perPage: query.perPage },
      warnings: result.warnings,
    })
  }

  // ── By-TimeBucket ────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-gaps/by-timebucket */
  async byTimebucket(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await resourceGapParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await resourceGapDimensionValidator.validate({
      ...qs,
      metrics: parseCommaParam(qs.metrics),
      projectIds: parseCommaParam(qs.projectIds),
    })
    const query = normalizeResourceGapQuery({
      ...(validated as Record<string, unknown>),
      type: 'by-timebucket',
    } as never)
    const access = await this.policy.resolveAccess(user, organizationId)

    const result = await this.service.getByDimension(
      user,
      organizationId,
      query,
      access,
      'timeBucket',
    )
    return ctx.response.ok({
      data: result.gaps,
      meta: { total: result.gaps.length, page: query.page, perPage: query.perPage },
      warnings: result.warnings,
    })
  }

  // ── By-Project ───────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-gaps/by-project */
  async byProject(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await resourceGapParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await resourceGapDimensionValidator.validate({
      ...qs,
      metrics: parseCommaParam(qs.metrics),
      projectIds: parseCommaParam(qs.projectIds),
    })
    const query = normalizeResourceGapQuery({
      ...(validated as Record<string, unknown>),
      type: 'by-project',
    } as never)
    const access = await this.policy.resolveAccess(user, organizationId)

    const result = await this.service.getByDimension(user, organizationId, query, access, 'project')
    return ctx.response.ok({
      data: result.gaps,
      meta: { total: result.gaps.length, page: query.page, perPage: query.perPage },
      warnings: result.warnings,
    })
  }

  // ── By-Portfolio ─────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-gaps/by-portfolio */
  async byPortfolio(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await resourceGapParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await resourceGapDimensionValidator.validate({
      ...qs,
      metrics: parseCommaParam(qs.metrics),
      portfolioIds: parseCommaParam(qs.portfolioIds),
    })
    const query = normalizeResourceGapQuery({
      ...(validated as Record<string, unknown>),
      type: 'by-portfolio',
    } as never)
    const access = await this.policy.resolveAccess(user, organizationId)

    const result = await this.service.getByDimension(
      user,
      organizationId,
      query,
      access,
      'portfolio',
    )
    return ctx.response.ok({
      data: result.gaps,
      meta: { total: result.gaps.length, page: query.page, perPage: query.perPage },
      warnings: result.warnings,
    })
  }

  // ── Explanation ──────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-gaps/explanation */
  async explanation(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await resourceGapParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await resourceGapExplanationValidator.validate(qs)
    const access = await this.policy.resolveAccess(user, organizationId)

    const result = await this.service.getExplanation(
      user,
      organizationId,
      validated.gapId,
      validated.includeAi ?? false,
      access,
    )
    return ctx.response.ok({ data: result })
  }

  // ── Drill-Down ───────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-gaps/drill-down */
  async drillDown(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await resourceGapParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await resourceGapDrillDownValidator.validate(qs)
    const access = await this.policy.resolveAccess(user, organizationId)

    const result = await this.service.getDrillDown(
      user,
      organizationId,
      validated.gapId,
      validated.sourceCapability,
      access,
    )
    return ctx.response.ok({ data: result })
  }
}
