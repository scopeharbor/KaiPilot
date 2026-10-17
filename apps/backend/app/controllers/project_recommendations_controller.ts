import RecommendationService from '#services/recommendation/recommendation_service'
import RecommendationPolicy from '#policies/recommendation_policy'
import {
  listRecommendationsValidator,
  refreshRecommendationsValidator,
  updateRecommendationStatusValidator,
  generateAiExplanationValidator,
  approveAiExplanationValidator,
  rejectAiExplanationValidator,
  convertRecommendationValidator,
} from '#validators/recommendation'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

/**
 * ProjectRecommendationsController —— 推荐 HTTP 处理器。
 *
 * 嵌套路由：/api/v1/projects/:projectId/recommendations
 *
 * v2-ai-smart-recommendations / design D5
 */
@inject()
export default class ProjectRecommendationsController {
  constructor(
    private service: RecommendationService,
    private policy: RecommendationPolicy,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgId(ctx: HttpContext): number {
    return ctx.tenant!.organizationId
  }

  /**
   * GET /projects/:projectId/recommendations — 列表
   */
  async index(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)

    if (!(await this.policy.canView(user, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无查看推荐权限' },
      })
    }

    const payload = await ctx.request.validateUsing(listRecommendationsValidator, {
      data: ctx.request.qs(),
    })

    try {
      const result = await this.service.list({
        projectId,
        organizationId,
        status: payload.status as any,
        sourceType: payload.sourceType as any,
        severity: payload.severity as any,
        stale: payload.stale,
        q: payload.q,
        page: payload.page || 1,
        perPage: payload.perPage || 20,
        sort: payload.sort,
      })
      return ctx.response.ok(result)
    } catch (err: any) {
      return this.handleError(ctx, err)
    }
  }

  /**
   * GET /projects/:projectId/recommendations/summary — 摘要
   */
  async summary(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)

    if (!(await this.policy.canView(user, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无查看推荐权限' },
      })
    }

    try {
      const result = await this.service.getSummary(organizationId, projectId)
      return ctx.response.ok(result)
    } catch (err: any) {
      return this.handleError(ctx, err)
    }
  }

  /**
   * GET /projects/:projectId/recommendations/:id — 详情
   */
  async show(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const recommendationId = Number(ctx.params.id)

    if (!(await this.policy.canView(user, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无查看推荐权限' },
      })
    }

    try {
      const record = await this.service.getById(recommendationId, organizationId, projectId)
      return ctx.response.ok({ data: record })
    } catch (err: any) {
      return this.handleError(ctx, err)
    }
  }

  /**
   * POST /projects/:projectId/recommendations/refresh — 刷新推荐候选
   */
  async refresh(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)

    if (!(await this.policy.canManage(user, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无管理推荐权限' },
      })
    }

    const payload = await ctx.request.validateUsing(refreshRecommendationsValidator)

    try {
      const result = await this.service.refreshProjectRecommendations({
        organizationId,
        projectId,
        userId: user.id,
        hasRiskView: false,
        hasResourceView: false,
        hasChangeImpactView: false,
        sources: payload.sources as any,
      })
      return ctx.response.ok(result)
    } catch (err: any) {
      return this.handleError(ctx, err)
    }
  }

  /**
   * PUT /projects/:projectId/recommendations/:id/status — 更新推荐状态
   */
  async updateStatus(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const recommendationId = Number(ctx.params.id)

    if (!(await this.policy.canManage(user, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无管理推荐权限' },
      })
    }

    const payload = await ctx.request.validateUsing(updateRecommendationStatusValidator)

    try {
      const record = await this.service.updateStatus(
        recommendationId,
        organizationId,
        projectId,
        user.id,
        payload.status as any,
        payload.reason ?? undefined,
      )
      return ctx.response.ok({ data: record })
    } catch (err: any) {
      return this.handleError(ctx, err)
    }
  }

  /**
   * POST /projects/:projectId/recommendations/:id/ai-explanation — 生成 AI 解释
   */
  async generateAiExplanation(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const recommendationId = Number(ctx.params.id)

    if (!(await this.policy.canTriggerAi(user, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无触发 AI 解释权限' },
      })
    }

    const payload = await ctx.request.validateUsing(generateAiExplanationValidator)

    try {
      const result = await this.service.generateAiExplanation(
        recommendationId,
        organizationId,
        projectId,
        user.id,
        payload.idempotencyKey ?? undefined,
      )
      return ctx.response.ok({ data: result })
    } catch (err: any) {
      return this.handleError(ctx, err)
    }
  }

  /**
   * POST /projects/:projectId/recommendations/:id/ai-explanation/approve — 确认 AI 解释
   */
  async approveAiExplanation(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const recommendationId = Number(ctx.params.id)

    if (!(await this.policy.canManage(user, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无管理推荐权限' },
      })
    }

    const payload = await ctx.request.validateUsing(approveAiExplanationValidator)

    try {
      const record = await this.service.updateAiExplanation(
        recommendationId,
        organizationId,
        projectId,
        {
          status: 'approved',
          approvedBy: user.id,
          approvedAt: new Date().toISOString(),
          notes: payload.notes ?? null,
        },
      )
      return ctx.response.ok({ data: record })
    } catch (err: any) {
      return this.handleError(ctx, err)
    }
  }

  /**
   * POST /projects/:projectId/recommendations/:id/ai-explanation/reject — 拒绝 AI 解释
   */
  async rejectAiExplanation(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const recommendationId = Number(ctx.params.id)

    if (!(await this.policy.canManage(user, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无管理推荐权限' },
      })
    }

    const payload = await ctx.request.validateUsing(rejectAiExplanationValidator)

    try {
      const record = await this.service.updateAiExplanation(
        recommendationId,
        organizationId,
        projectId,
        {
          status: 'rejected',
          rejectedBy: user.id,
          rejectedAt: new Date().toISOString(),
          rejectReason: payload.reason,
        },
      )
      return ctx.response.ok({ data: record })
    } catch (err: any) {
      return this.handleError(ctx, err)
    }
  }

  /**
   * POST /projects/:projectId/recommendations/:id/convert — 转换推荐
   */
  async convert(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const recommendationId = Number(ctx.params.id)

    if (!(await this.policy.canManage(user, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无管理推荐权限' },
      })
    }

    const payload = await ctx.request.validateUsing(convertRecommendationValidator)

    try {
      const result = await this.service.convertRecommendation(
        recommendationId,
        organizationId,
        projectId,
        user.id,
        payload.convertTo,
        payload.params ?? undefined,
      )
      return ctx.response.ok({ data: result })
    } catch (err: any) {
      return this.handleError(ctx, err)
    }
  }

  // -----------------------------------------------------------------------
  // 内部辅助
  // -----------------------------------------------------------------------

  private handleError(ctx: HttpContext, error: any): any {
    if (error.message === 'RESOURCE_NOT_FOUND' || error.status === 404) {
      return ctx.response.notFound({ error: { code: 'RESOURCE_NOT_FOUND', message: '资源不存在' } })
    }

    if (error.code === 'E_VALIDATION_ERROR') {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'VALIDATION_ERROR',
          message: '请求参数校验失败',
          details: error.messages ?? error.message,
        },
      })
    }

    if (error.message?.startsWith('RECOMMENDATION_')) {
      return ctx.response.conflict({ error: { code: error.message, message: error.message } })
    }

    return ctx.response.internalServerError({
      error: { code: 'INTERNAL_ERROR', message: '服务异常' },
    })
  }
}
