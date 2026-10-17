import PmoInvestmentDistributionPolicy from '#policies/pmo_investment_distribution_policy'
import PmoInvestmentDistributionService from '#services/pmo_investment_distribution_service'
import AuditService from '#services/audit_service'
import {
  buildInvestmentDistributionDeniedAudit,
  buildInvestmentDistributionDrillDownAudit,
  buildInvestmentDistributionReadAudit,
} from '#services/pmo_investment_distribution_audit'
import {
  pmoInvestmentDistributionDrillDownValidator,
  pmoInvestmentDistributionSummaryValidator,
  pmoInvestmentDistributionTrendValidator,
} from '#validators/pmo_investment_distribution'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import {
  PMO_INVESTMENT_BUCKET_STATUSES,
  PMO_INVESTMENT_DEFAULT_TOP_N,
  type PmoInvestmentBucket,
  type PmoInvestmentDistributionDimension,
  type PmoInvestmentDistributionQuery,
} from '@aiproj/types'

function resolveOrgId(ctx: HttpContext): number {
  const tenantOrgId = (ctx as any).tenant?.organizationId
  if (typeof tenantOrgId === 'number') return tenantOrgId

  const headerOrgId = Number(ctx.request.header('X-Organization-Id'))
  if (!Number.isNaN(headerOrgId) && headerOrgId > 0) return headerOrgId

  throw new Error('缺少 organizationId（ctx.tenant 和 X-Organization-Id header 均不可用）')
}

function countRedacted(buckets: readonly PmoInvestmentBucket[]): number {
  return buckets.filter(
    (bucket) =>
      bucket.status === PMO_INVESTMENT_BUCKET_STATUSES.REDACTED ||
      bucket.status === PMO_INVESTMENT_BUCKET_STATUSES.FORBIDDEN,
  ).length
}

@inject()
export default class PmoInvestmentDistributionController {
  constructor(
    private service: PmoInvestmentDistributionService,
    private policy: PmoInvestmentDistributionPolicy,
    private audit: AuditService,
  ) {}

  async catalogue(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = resolveOrgId(ctx)
    await this.authorize(user, organizationId)
    return ctx.response.ok({ data: this.service.getSupportedCatalogue() })
  }

  async summary(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = resolveOrgId(ctx)
    await this.authorize(user, organizationId)

    const raw = await pmoInvestmentDistributionSummaryValidator.validate(ctx.request.qs())
    const query = raw as PmoInvestmentDistributionQuery
    const result = await this.service.getSummaryWithCacheInfo(
      user,
      organizationId,
      query,
      await this.resolveAccess(user, organizationId, query.dimension),
    )

    await this.audit.log(
      buildInvestmentDistributionReadAudit({
        organizationId,
        actorId: Number(user.id),
        meta: result.summary.meta,
        warnings: result.summary.warnings,
        bucketCount: result.summary.buckets.length,
        redactedBucketCount: countRedacted(result.summary.buckets),
        topN: query.topN ?? PMO_INVESTMENT_DEFAULT_TOP_N,
        cacheHit: result.cacheHit,
      }),
    )

    return ctx.response.ok({ data: result.summary })
  }

  async trends(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = resolveOrgId(ctx)
    await this.authorize(user, organizationId)

    const raw = await pmoInvestmentDistributionTrendValidator.validate(ctx.request.qs())
    const query = raw as PmoInvestmentDistributionQuery
    const result = await this.service.getTrends(
      user,
      organizationId,
      query,
      await this.resolveAccess(user, organizationId, query.dimension),
    )

    await this.audit.log(
      buildInvestmentDistributionReadAudit({
        organizationId,
        actorId: Number(user.id),
        meta: result.meta,
        warnings: result.warnings,
        bucketCount: result.data.reduce((sum, bucket) => sum + bucket.buckets.length, 0),
        redactedBucketCount: result.data.reduce(
          (sum, bucket) => sum + countRedacted(bucket.buckets),
          0,
        ),
        topN: query.topN ?? PMO_INVESTMENT_DEFAULT_TOP_N,
      }),
    )

    return ctx.response.ok({ data: result.data, meta: result.meta, warnings: result.warnings })
  }

  async drillDown(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = resolveOrgId(ctx)
    await this.authorize(user, organizationId)

    const raw = await pmoInvestmentDistributionDrillDownValidator.validate({
      bucketKey: ctx.params.bucketKey,
      ...ctx.request.qs(),
    })
    const query = raw as PmoInvestmentDistributionQuery & { bucketKey: string }
    const result = await this.service.getDrillDown(
      user,
      organizationId,
      query,
      await this.resolveAccess(user, organizationId, query.dimension),
    )

    await this.audit.log(
      buildInvestmentDistributionDrillDownAudit({
        organizationId,
        actorId: Number(user.id),
        meta: result.meta,
        warnings: result.warnings,
        bucketCount: 0,
        redactedBucketCount: 0,
        topN: query.topN ?? PMO_INVESTMENT_DEFAULT_TOP_N,
        bucketKey: query.bucketKey,
        itemCount: result.data.length,
      }),
    )

    return ctx.response.ok({ data: result.data, meta: result.meta, warnings: result.warnings })
  }

  /**
   * 组合查看权限校验；拒绝时先落低敏拒绝审计再抛出，
   * 审计里不带任何组合规模、桶标签或项目信息（§4.15）。
   */
  private async authorize(user: User, organizationId: number): Promise<void> {
    try {
      await this.policy.authorizeView(user, organizationId)
    } catch (error) {
      await this.audit.log(
        buildInvestmentDistributionDeniedAudit({
          organizationId,
          actorId: Number(user.id),
          denyReason: 'portfolio_view_denied',
        }),
      )
      throw error
    }
  }

  private async resolveAccess(
    user: User,
    organizationId: number,
    dimension?: PmoInvestmentDistributionDimension,
  ) {
    const canViewResourceFacts = await this.policy
      .canViewResourceFacts(user, organizationId)
      .catch(() => false)
    const dimensionAccess = dimension
      ? await this.policy.canViewDimension(user, organizationId, dimension).catch(() => false)
      : true
    return {
      canViewResourceFacts,
      canViewPeopleDimensions: dimension === 'manager' ? dimensionAccess : true,
      canViewDepartmentDimension: dimension === 'department' ? dimensionAccess : true,
      canViewTrafficLightDimension: dimension === 'traffic_light_status' ? dimensionAccess : true,
      canViewStrategicThemeDimension: dimension === 'strategic_theme' ? dimensionAccess : true,
    }
  }
}
