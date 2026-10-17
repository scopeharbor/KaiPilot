import ResourceSkillMatrixPolicy from '#policies/resource_skill_matrix_policy'
import ResourceSkillMatrixService from '#services/resource_skill_matrix_service'
import AuditService from '#services/audit_service'
import {
  buildMatrixReadAudit,
  buildMatrixDrillDownAudit,
  buildMatrixDeniedAudit,
} from '#services/resource_skill_matrix_audit'
import {
  resourceSkillMatrixSummaryValidator,
  resourceSkillMatrixMatrixValidator,
  resourceSkillMatrixCoverageValidator,
  resourceSkillMatrixGapsValidator,
  resourceSkillMatrixCandidatesValidator,
  resourceSkillMatrixSkillDetailValidator,
  resourceSkillMatrixDrillDownValidator,
  validateDateWindow,
  parseCsvNumbers,
  parseCsvStrings,
} from '#validators/resource_skill_matrix'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import type { ResourceSkillMatrixQuery } from '@aiproj/types'

function resolveOrgId(ctx: HttpContext): number {
  const tenantOrgId = (ctx as any).tenant?.organizationId
  if (typeof tenantOrgId === 'number') return tenantOrgId

  const headerOrgId = Number(ctx.request.header('X-Organization-Id'))
  if (!Number.isNaN(headerOrgId) && headerOrgId > 0) return headerOrgId

  throw new Error('缺少 organizationId（ctx.tenant 和 X-Organization-Id header 均不可用）')
}

function buildQuery(raw: Record<string, unknown>): ResourceSkillMatrixQuery {
  const projectIds = parseCsvNumbers(raw.projectIds as string)
  const skillKeys = parseCsvStrings(raw.skillKeys as string)
  const resourceStatuses = parseCsvStrings(raw.resourceStatuses as string)
  const requirementStatuses = parseCsvStrings(raw.requirementStatuses as string)

  return {
    scope: raw.scope as ResourceSkillMatrixQuery['scope'],
    projectIds: projectIds.length > 0 ? projectIds : undefined,
    skillKeys: skillKeys.length > 0 ? skillKeys : undefined,
    resourceStatuses: resourceStatuses.length > 0 ? resourceStatuses : undefined,
    requirementStatuses: requirementStatuses.length > 0 ? requirementStatuses : undefined,
    includeSkillAdvisory: raw.includeSkillAdvisory as boolean | undefined,
    from: raw.from as string | undefined,
    to: raw.to as string | undefined,
    topN: raw.topN as number | undefined,
    groupBy: raw.groupBy as ResourceSkillMatrixQuery['groupBy'],
    sort: raw.sort as ResourceSkillMatrixQuery['sort'],
    search: raw.search as string | undefined,
    page: raw.page as number | undefined,
    perPage: raw.perPage as number | undefined,
  }
}

@inject()
export default class ResourceSkillMatrixController {
  constructor(
    private service: ResourceSkillMatrixService,
    private policy: ResourceSkillMatrixPolicy,
    private audit: AuditService,
  ) {}

  /**
   * GET /api/v1/organizations/:organizationId/resource-skill-matrix/summary
   */
  async summary(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = resolveOrgId(ctx)
    await this.authorize(user, organizationId)

    const raw = await resourceSkillMatrixSummaryValidator.validate(ctx.request.qs())
    const query = buildQuery(raw)

    // 验证日期窗口
    const dateValidation = validateDateWindow(query.from, query.to)
    if (!dateValidation.valid) {
      return ctx.response.unprocessableEntity({
        error: { code: 'VALIDATION_ERROR', message: dateValidation.reason },
      })
    }
    query.from = dateValidation.from
    query.to = dateValidation.to

    const access = await this.policy.resolveDimensionAccess(user, organizationId)
    query.includeSkillAdvisory = access.canViewSkillDetails

    const result = await this.service.getSummaryWithCacheInfo(user, organizationId, query, access)

    await this.audit.log(
      buildMatrixReadAudit({
        organizationId,
        actorId: Number(user.id),
        queryShape: query as unknown as Record<string, unknown>,
        matrixWarningCount: result.summary.warnings.length,
        gapCount: result.summary.totalGaps,
        candidateCount: result.summary.totalCandidateResources,
        advisoryCount: result.summary.totalSkillAdvisories,
        sourceCount: result.summary.meta.sourceFreshness.length,
        cacheHit: result.cacheHit,
        cacheDegraded: result.cacheDegraded,
      }),
    )

    return ctx.response.ok({ data: result.summary })
  }

  /**
   * GET /api/v1/organizations/:organizationId/resource-skill-matrix/matrix
   */
  async matrix(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = resolveOrgId(ctx)
    await this.authorize(user, organizationId)

    const raw = await resourceSkillMatrixMatrixValidator.validate(ctx.request.qs())
    const query = buildQuery(raw)

    const dateValidation = validateDateWindow(query.from, query.to)
    if (!dateValidation.valid) {
      return ctx.response.unprocessableEntity({
        error: { code: 'VALIDATION_ERROR', message: dateValidation.reason },
      })
    }
    query.from = dateValidation.from
    query.to = dateValidation.to

    const access = await this.policy.resolveDimensionAccess(user, organizationId)
    query.includeSkillAdvisory = access.canViewSkillDetails

    const result = await this.service.getMatrix(user, organizationId, query, access)

    await this.audit.log(
      buildMatrixReadAudit({
        organizationId,
        actorId: Number(user.id),
        queryShape: query as unknown as Record<string, unknown>,
        matrixWarningCount: result.warnings.length,
        gapCount: result.rows.filter((r) => r.gapSeverity !== 'none').length,
        candidateCount: result.rows.reduce((sum, r) => sum + r.candidateResources.length, 0),
        advisoryCount: result.rows.reduce((sum, r) => sum + r.skillAdvisory.length, 0),
        sourceCount: result.meta.sourceFreshness.length,
      }),
    )

    return ctx.response.ok({ data: result })
  }

  /**
   * GET /api/v1/organizations/:organizationId/resource-skill-matrix/coverage
   */
  async coverage(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = resolveOrgId(ctx)
    await this.authorize(user, organizationId)

    const raw = await resourceSkillMatrixCoverageValidator.validate(ctx.request.qs())
    const query = buildQuery(raw)

    const dateValidation = validateDateWindow(query.from, query.to)
    if (!dateValidation.valid) {
      return ctx.response.unprocessableEntity({
        error: { code: 'VALIDATION_ERROR', message: dateValidation.reason },
      })
    }

    const access = await this.policy.resolveDimensionAccess(user, organizationId)
    const result = await this.service.getSummary(user, organizationId, query, access)

    return ctx.response.ok({
      data: { coverages: result.coverageBySkill },
      meta: result.meta,
    })
  }

  /**
   * GET /api/v1/organizations/:organizationId/resource-skill-matrix/gaps
   */
  async gaps(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = resolveOrgId(ctx)
    await this.authorize(user, organizationId)

    const raw = await resourceSkillMatrixGapsValidator.validate(ctx.request.qs())
    const query = buildQuery(raw)

    const dateValidation = validateDateWindow(query.from, query.to)
    if (!dateValidation.valid) {
      return ctx.response.unprocessableEntity({
        error: { code: 'VALIDATION_ERROR', message: dateValidation.reason },
      })
    }

    const access = await this.policy.resolveDimensionAccess(user, organizationId)
    const result = await this.service.getSummary(user, organizationId, query, access)

    return ctx.response.ok({
      data: { gaps: result.criticalGaps },
      meta: result.meta,
    })
  }

  /**
   * GET /api/v1/organizations/:organizationId/resource-skill-matrix/candidates
   */
  async candidates(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = resolveOrgId(ctx)
    await this.authorize(user, organizationId)

    const raw = await resourceSkillMatrixCandidatesValidator.validate({
      ...ctx.request.qs(),
      skillKey: ctx.request.qs().skillKey,
    })
    const query = buildQuery(raw)

    const dateValidation = validateDateWindow(query.from, query.to)
    if (!dateValidation.valid) {
      return ctx.response.unprocessableEntity({
        error: { code: 'VALIDATION_ERROR', message: dateValidation.reason },
      })
    }

    const access = await this.policy.resolveDimensionAccess(user, organizationId)
    const result = await this.service.getMatrix(user, organizationId, query, access)

    const row = result.rows.find((r) => r.skillKey === raw.skillKey)
    if (!row) {
      return ctx.response.ok({
        data: { skillKey: raw.skillKey, candidates: [] },
        meta: result.meta,
      })
    }

    return ctx.response.ok({
      data: { skillKey: raw.skillKey, candidates: row.candidateResources },
      meta: result.meta,
    })
  }

  /**
   * GET /api/v1/organizations/:organizationId/resource-skill-matrix/skill-detail
   */
  async skillDetail(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = resolveOrgId(ctx)
    await this.authorize(user, organizationId)

    const raw = await resourceSkillMatrixSkillDetailValidator.validate(ctx.request.qs())
    const query = buildQuery({
      ...raw,
      skillKeys: [raw.skillKey],
    })

    const dateValidation = validateDateWindow(query.from, query.to)
    if (!dateValidation.valid) {
      return ctx.response.unprocessableEntity({
        error: { code: 'VALIDATION_ERROR', message: dateValidation.reason },
      })
    }

    const access = await this.policy.resolveDimensionAccess(user, organizationId)
    const result = await this.service.getMatrix(user, organizationId, query, access)

    const row = result.rows.find((r) => r.skillKey === raw.skillKey)
    if (!row) {
      return ctx.response.ok({
        data: {
          skillKey: raw.skillKey,
          skillLabel: raw.skillKey,
          resourceCount: 0,
          requirementCount: 0,
          coverageRatio: 0,
          gapSeverity: 'none',
          resources: [],
          advisory: [],
          evidenceRefs: [],
          warnings: [],
        },
        meta: result.meta,
      })
    }

    return ctx.response.ok({
      data: {
        skillKey: row.skillKey,
        skillLabel: row.skillLabel,
        resourceCount: row.resourceCount,
        requirementCount: row.requirementCount,
        coverageRatio: row.coverageRatio,
        gapSeverity: row.gapSeverity,
        resources: row.candidateResources,
        advisory: row.skillAdvisory,
        evidenceRefs: row.evidenceRefs,
        warnings: row.warnings,
      },
      meta: result.meta,
    })
  }

  /**
   * GET /api/v1/organizations/:organizationId/resource-skill-matrix/drill-down
   */
  async drillDown(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = resolveOrgId(ctx)
    await this.authorize(user, organizationId)

    const raw = await resourceSkillMatrixDrillDownValidator.validate({
      ...ctx.request.qs(),
      itemType: ctx.request.qs().itemType,
      skillKey: ctx.request.qs().skillKey,
    })

    // 下钻二次授权
    await this.policy.authorizeDrillDown(user, organizationId, raw.itemType)

    const query = buildQuery({ ...raw, skillKeys: [raw.skillKey] })
    const access = await this.policy.resolveDimensionAccess(user, organizationId)
    const result = await this.service.getMatrix(user, organizationId, query, access)

    const row = result.rows.find((r) => r.skillKey === raw.skillKey)

    await this.audit.log(
      buildMatrixDrillDownAudit({
        organizationId,
        actorId: Number(user.id),
        itemType: raw.itemType,
        skillKey: raw.skillKey,
        itemId: 0,
        queryShape: query as unknown as Record<string, unknown>,
      }),
    )

    return ctx.response.ok({
      data: {
        items:
          raw.itemType === 'resource'
            ? (row?.candidateResources ?? []).map((r) => ({
                itemId: r.resourceId,
                itemType: 'resource' as const,
                itemName: r.resourceName,
                skillKey: raw.skillKey,
                details: r as unknown as Record<string, unknown>,
                evidenceRefs: row?.evidenceRefs ?? [],
                warnings: [],
              }))
            : [],
      },
      meta: result.meta,
    })
  }

  private async authorize(user: User, organizationId: number): Promise<void> {
    try {
      await this.policy.authorizeView(user, organizationId)
    } catch (error) {
      await this.audit.log(
        buildMatrixDeniedAudit({
          organizationId,
          actorId: Number(user.id),
          denyReason: 'resource_skill_matrix_view_denied',
        }),
      )
      throw error
    }
  }
}
