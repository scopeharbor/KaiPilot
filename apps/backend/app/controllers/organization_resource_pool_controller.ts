import OrganizationResourcePoolPolicy from '#policies/organization_resource_pool_policy'
import OrganizationResourcePoolService from '#services/organization_resource_pool_service'
import {
  organizationResourcePoolParamsValidator,
  organizationResourcePoolSummaryValidator,
  organizationResourcePoolResourcesValidator,
  organizationResourcePoolCapacityValidator,
  organizationResourcePoolSkillsValidator,
  organizationResourcePoolConflictsValidator,
  organizationResourcePoolDemandGapsValidator,
  organizationResourcePoolDrillDownValidator,
  parseProjectIdsParam,
} from '#validators/organization_resource_pool'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import { normalizeOrganizationResourcePoolQuery } from '@aiproj/types'

/**
 * 组织资源池 Controller（v3-organization-resource-pool §5.1）。
 *
 * 职责严格限定：认证 → 参数解析与校验 → Policy 调用 → Service 调用 → 响应格式化。
 * 聚合口径、脱敏与降级逻辑全部在 OrganizationResourcePoolService。
 * 路由：`GET /api/v1/organizations/:organizationId/resource-pool/*`
 */
@inject()
export default class OrganizationResourcePoolController {
  constructor(
    private readonly service: OrganizationResourcePoolService,
    private readonly policy: OrganizationResourcePoolPolicy,
  ) {}

  // ── Catalogue ────────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-pool/catalogue */
  async catalogue(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await organizationResourcePoolParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await organizationResourcePoolSummaryValidator.validate(qs)
    const query = normalizeOrganizationResourcePoolQuery(validated as never)
    const access = await this.policy.resolveAccess(user, organizationId)

    const result = await this.service.getSummary(user, organizationId, query, access)
    return ctx.response.ok({ data: result })
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-pool/summary */
  async summary(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await organizationResourcePoolParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await organizationResourcePoolSummaryValidator.validate(qs)
    const query = normalizeOrganizationResourcePoolQuery(validated as never)
    const access = await this.policy.resolveAccess(user, organizationId)

    const result = await this.service.getSummary(user, organizationId, query, access)
    return ctx.response.ok({ data: result })
  }

  // ── Resources ────────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-pool/resources */
  async resources(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await organizationResourcePoolParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await organizationResourcePoolResourcesValidator.validate({
      ...qs,
      projectIds: parseProjectIdsParam(qs.projectIds),
    })
    const query = normalizeOrganizationResourcePoolQuery(validated as never)
    const access = await this.policy.resolveAccess(user, organizationId)

    const { rows, total } = await this.service.listResources(user, organizationId, query, access)
    return ctx.response.ok({
      data: rows,
      meta: {
        total,
        page: query.page,
        perPage: query.perPage,
        totalPages: Math.ceil(total / query.perPage),
      },
    })
  }

  // ── Capacity ─────────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-pool/capacity */
  async capacity(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await organizationResourcePoolParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await organizationResourcePoolCapacityValidator.validate({
      ...qs,
      projectIds: parseProjectIdsParam(qs.projectIds),
    })
    const query = normalizeOrganizationResourcePoolQuery(validated as never)
    const access = await this.policy.resolveAccess(user, organizationId)

    const result = await this.service.getCapacityMatrix(user, organizationId, query, access)
    return ctx.response.ok({ data: result })
  }

  // ── Skills ───────────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-pool/skills */
  async skills(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await organizationResourcePoolParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await organizationResourcePoolSkillsValidator.validate(qs)
    const query = normalizeOrganizationResourcePoolQuery(validated as never)
    const access = await this.policy.resolveAccess(user, organizationId)

    const result = await this.service.getSkills(user, organizationId, query, access)
    return ctx.response.ok({ data: result })
  }

  // ── Conflicts ────────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-pool/conflicts */
  async conflicts(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await organizationResourcePoolParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await organizationResourcePoolConflictsValidator.validate(qs)
    const query = normalizeOrganizationResourcePoolQuery(validated as never)
    const access = await this.policy.resolveAccess(user, organizationId)

    const { conflicts, total } = await this.service.getConflicts(
      user,
      organizationId,
      query,
      access,
    )
    return ctx.response.ok({
      data: conflicts,
      meta: {
        total,
        page: query.page,
        perPage: query.perPage,
        totalPages: Math.ceil(total / query.perPage),
      },
    })
  }

  // ── Demand Gaps ──────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-pool/demand-gaps */
  async demandGaps(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await organizationResourcePoolParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await organizationResourcePoolDemandGapsValidator.validate(qs)
    const query = normalizeOrganizationResourcePoolQuery(validated as never)
    const access = await this.policy.resolveAccess(user, organizationId)

    const { gaps, total } = await this.service.getDemandGaps(user, organizationId, query, access)
    return ctx.response.ok({
      data: gaps,
      meta: {
        total,
        page: query.page,
        perPage: query.perPage,
        totalPages: Math.ceil(total / query.perPage),
      },
    })
  }

  // ── Drill-Down ───────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-pool/drill-down */
  async drillDown(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await organizationResourcePoolParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await organizationResourcePoolDrillDownValidator.validate(qs)

    const result = await this.service.drillDown(
      user,
      organizationId,
      validated.kind,
      validated.targetId,
      validated.resourceId,
      validated.projectId,
      validated.taskId,
    )

    return ctx.response.ok({ data: result })
  }
}
