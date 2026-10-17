/**
 * PortfolioPriorityScoringController —— PMO 优先级评分 API 控制器
 *
 * v3-pmo-priority-scoring-model §3.5
 *
 * 端点：
 *   GET  /api/v1/pmo/priority-scoring/summary     - 评分摘要
 *   GET  /api/v1/pmo/priority-scoring/projects     - 项目评分列表
 *   GET  /api/v1/pmo/priority-scoring/groups       - 分组切片
 *   GET  /api/v1/pmo/priority-scoring/weights      - 权重版本说明
 *   GET  /api/v1/pmo/priority-scoring/projects/:id - 项目评分详情
 */
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import PortfolioPriorityScoringService from '#services/portfolio_priority_scoring_service'
import PortfolioPriorityPolicy from '#policies/portfolio_priority_policy'
import {
  pmoPriorityScoringSummaryValidator,
  pmoPriorityScoringListValidator,
  pmoPriorityScoringGroupsValidator,
  pmoPriorityScoringWeightsValidator,
  pmoPriorityScoringDetailValidator,
} from '#validators/pmo_priority_scoring'
import { DEFAULT_SCORE_VERSION } from '@aiproj/types'

/** 安全降级：从 tenant 或 header 中获取 org id */
function resolveOrgId(ctx: HttpContext): number {
  const orgId = ctx.tenant?.organizationId
  if (orgId !== undefined && orgId !== null) return Number(orgId)
  const headerOrg = ctx.request.header('X-Organization-Id')
  if (headerOrg) return Number(headerOrg)
  throw new Error('无法解析组织 ID')
}

@inject()
export default class PortfolioPriorityScoringController {
  private readonly service: PortfolioPriorityScoringService

  constructor(private readonly policy: PortfolioPriorityPolicy) {
    this.service = new PortfolioPriorityScoringService(this.policy)
  }

  /** GET /api/v1/pmo/priority-scoring/summary */
  async summary(ctx: HttpContext) {
    const orgId = resolveOrgId(ctx)
    await this.policy.authorizeView(ctx.auth.user!, orgId)

    const payload = await pmoPriorityScoringSummaryValidator.validate(ctx.request.qs())
    const result = await this.service.getSummary(
      ctx.auth.user!,
      orgId,
      payload.scoreVersion ?? DEFAULT_SCORE_VERSION,
    )

    return ctx.response.json({ data: result })
  }

  /** GET /api/v1/pmo/priority-scoring/projects */
  async projects(ctx: HttpContext) {
    const orgId = resolveOrgId(ctx)
    await this.policy.authorizeView(ctx.auth.user!, orgId)

    const payload = await pmoPriorityScoringListValidator.validate(ctx.request.qs())
    const result = await this.service.getProjects(ctx.auth.user!, orgId, {
      page: payload.page,
      perPage: payload.perPage,
      sort: payload.sort,
      priorityLevels: payload.priorityLevels,
      scoreVersion: payload.scoreVersion ?? DEFAULT_SCORE_VERSION,
    })

    return ctx.response.json({ data: result.data, meta: result.meta })
  }

  /** GET /api/v1/pmo/priority-scoring/groups */
  async groups(ctx: HttpContext) {
    const orgId = resolveOrgId(ctx)
    await this.policy.authorizeView(ctx.auth.user!, orgId)

    const payload = await pmoPriorityScoringGroupsValidator.validate(ctx.request.qs())
    const result = await this.service.getGroups(ctx.auth.user!, orgId, {
      groupBy: payload.groupBy,
      scoreVersion: payload.scoreVersion ?? DEFAULT_SCORE_VERSION,
      page: payload.page,
      perPage: payload.perPage,
    })

    return ctx.response.json({ data: result.data, meta: result.meta })
  }

  /** GET /api/v1/pmo/priority-scoring/weights */
  async weights(ctx: HttpContext) {
    const orgId = resolveOrgId(ctx)
    await this.policy.authorizeView(ctx.auth.user!, orgId)

    const payload = await pmoPriorityScoringWeightsValidator.validate(ctx.request.qs())
    const result = this.service.getWeights(payload.scoreVersion ?? DEFAULT_SCORE_VERSION)

    return ctx.response.json({ data: result })
  }

  /** GET /api/v1/pmo/priority-scoring/projects/:id */
  async projectDetail(ctx: HttpContext) {
    const orgId = resolveOrgId(ctx)
    const projectId = Number(ctx.params.id)

    await this.policy.authorizeView(ctx.auth.user!, orgId)

    const payload = await pmoPriorityScoringDetailValidator.validate(ctx.request.qs())
    const result = await this.service.getProjectDetail(ctx.auth.user!, orgId, projectId, {
      scoreVersion: payload.scoreVersion ?? DEFAULT_SCORE_VERSION,
      includeGroupSlices: payload.includeGroupSlices,
    })

    if (!result) {
      return ctx.response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '项目不存在或无权查看' },
      })
    }

    return ctx.response.json({ data: result })
  }
}
