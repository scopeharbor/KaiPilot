/**
 * v3-pmo-portfolio-traffic-light —— PMO 组合交通灯 Controller。
 *
 * 职责：HTTP 解析与响应格式化。业务逻辑在 PortfolioTrafficLightService。
 * 路由：/api/v1/pmo/traffic-light/*
 */
import PortfolioTrafficLightService from '#services/portfolio_traffic_light_service'
import PortfolioTrafficLightPolicy from '#policies/portfolio_traffic_light_policy'
import {
  portfolioTrafficLightListValidator,
  portfolioTrafficLightReviewValidator,
} from '#validators/portfolio_traffic_light'
import {
  computeTrafficLightInputSignature,
  type TrafficLightReviewState,
  type TrafficLightWarningCode,
  type TrafficLightStatus,
  type PortfolioTrafficLightSortKey,
  type PortfolioTrafficLightListQuery,
} from '@aiproj/types'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

/**
 * 解析 organizationId：优先从 ctx.tenant（JWT/tenant middleware），
 * 测试/降级时 fallback 到 X-Organization-Id header。
 */
function resolveOrgId(ctx: HttpContext): number {
  const tenantOrgId = (ctx as any).tenant?.organizationId
  if (typeof tenantOrgId === 'number') return tenantOrgId

  const headerOrgId = Number(ctx.request.header('X-Organization-Id'))
  if (!Number.isNaN(headerOrgId) && headerOrgId > 0) return headerOrgId

  throw new Error('缺少 organizationId（ctx.tenant 和 X-Organization-Id header 均不可用）')
}

@inject()
export default class PortfolioTrafficLightController {
  constructor(
    private service: PortfolioTrafficLightService,
    private policy: PortfolioTrafficLightPolicy,
  ) {}

  /** GET /api/v1/pmo/traffic-light */
  async index(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = resolveOrgId(ctx)

    await this.policy.canViewPortfolio(user, organizationId)

    const qs = ctx.request.qs()
    const raw = await portfolioTrafficLightListValidator.validate(qs)
    const query: PortfolioTrafficLightListQuery = {
      page: raw.page,
      perPage: raw.perPage,
      sort: raw.sort as PortfolioTrafficLightSortKey | undefined,
      order: raw.order,
      filterStatus: raw.filterStatus as TrafficLightStatus | TrafficLightStatus[] | undefined,
      filterProjectStatus: raw.filterProjectStatus,
      filterStale: raw.filterStale,
      filterWarningCode: raw.filterWarningCode as TrafficLightWarningCode | undefined,
      filterReviewState: raw.filterReviewState as TrafficLightReviewState | undefined,
    }
    const result = await this.service.list(user, organizationId, query)
    return ctx.response.ok({ data: result.data, meta: result.meta })
  }

  /** GET /api/v1/pmo/traffic-light/counts */
  async counts(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = resolveOrgId(ctx)

    await this.policy.canViewPortfolio(user, organizationId)

    const result = await this.service.counts(user, organizationId)
    return ctx.response.ok({ data: result })
  }

  /** GET /api/v1/pmo/traffic-light/:projectId */
  async show(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = resolveOrgId(ctx)
    const projectId = Number(ctx.params.projectId)

    await this.policy.canViewPortfolio(user, organizationId)

    const item = await this.service.detail(user, organizationId, projectId)
    if (!item) {
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '项目不存在或无权查看' },
      })
    }
    return ctx.response.ok({ data: item })
  }

  /** POST /api/v1/pmo/traffic-light/:projectId/review */
  async review(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = resolveOrgId(ctx)
    const projectId = Number(ctx.params.projectId)

    await this.policy.canManagePortfolio(user, organizationId)

    const payload = await portfolioTrafficLightReviewValidator.validate(ctx.request.body())

    // 获取当前项目详情以计算输入签名
    const item = await this.service.detail(user, organizationId, projectId)
    if (!item) {
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '项目不存在或无权查看' },
      })
    }

    // 计算当前输入签名
    const inputSig = computeTrafficLightInputSignature({
      healthDiagnosisUpdatedAt: item.sourceFreshness.lastUpdatedAt,
      predictionUpdatedAt: item.sourceFreshness.lastUpdatedAt,
      riskSummaryUpdatedAt: item.sourceFreshness.lastUpdatedAt,
      resourceSummaryUpdatedAt: item.sourceFreshness.lastUpdatedAt,
      dashboardUpdatedAt: item.sourceFreshness.lastUpdatedAt,
      taskOverdueCount:
        item.severityCounts.critical +
        item.severityCounts.high +
        item.severityCounts.medium +
        item.severityCounts.low,
      milestoneStatusSummary: null,
      changeImpactCount: item.severityCounts.high,
      availableSources: [],
    })

    const marker = await this.service.upsertReview(
      organizationId,
      projectId,
      user.id,
      payload.reviewState as TrafficLightReviewState,
      payload.note ?? null,
      inputSig,
    )

    return ctx.response.ok({ data: marker })
  }
}
