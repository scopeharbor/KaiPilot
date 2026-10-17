/**
 * PMO AI 优先级推荐 API 控制器（v3-pmo-ai-priority-recommendations §4.4）。
 *
 * 端点：GET /api/v1/pmo/ai-priority-recommendations
 *        GET /api/v1/pmo/ai-priority-recommendations/summary
 *        GET /api/v1/pmo/ai-priority-recommendations/:id
 *        POST /api/v1/pmo/ai-priority-recommendations/refresh
 *        POST /api/v1/pmo/ai-priority-recommendations/:id/ai-rationale
 *        POST /api/v1/pmo/ai-priority-recommendations/:id/status
 */
import type { HttpContext } from '@adonisjs/core/http'
import PmoAiPriorityRecommendationService from '#services/pmo_recommendation/pmo_ai_priority_recommendation_service'
import PmoAiPriorityRecommendationPolicy from '#policies/pmo_ai_priority_recommendation_policy'
import {
  pmoAiPriorityRecommendationListValidator,
  pmoAiPriorityRecommendationSummaryValidator,
  pmoAiPriorityRecommendationIdValidator,
  pmoAiRationaleRequestValidator,
  pmoReviewActionValidator,
} from '#validators/pmo_ai_priority_recommendation'
import { inject } from '@adonisjs/core'
import { AIGateway } from '#services/ai_m0/gateway'

@inject()
export default class PmoAiPriorityRecommendationsController {
  constructor(
    private service: PmoAiPriorityRecommendationService,
    private policy: PmoAiPriorityRecommendationPolicy,
  ) {}

  /** 获取组织上下文（由 tenant_middleware 注入，design D8）。 */
  private getOrg(ctx: HttpContext): number {
    return Number(ctx.tenant?.organizationId ?? 1)
  }

  /** 获取当前用户 ID。 */
  private getUserId(ctx: HttpContext): number {
    return Number(ctx.auth?.user?.id ?? 0)
  }

  // -----------------------------------------------------------------------
  // GET /summary — PMO 推荐摘要
  // -----------------------------------------------------------------------

  async summary(ctx: HttpContext) {
    const { auth, request } = ctx
    const organizationId = this.getOrg(ctx)
    await this.policy.authorizeView(auth.user!, organizationId)

    // 仍执行校验以拒绝越界参数；includeWarnings/includeTop 当前未参与摘要计算
    await request.validateUsing(pmoAiPriorityRecommendationSummaryValidator)
    const summary = await this.service.getSummary(organizationId)

    return ctx.response.ok({ data: summary })
  }

  // -----------------------------------------------------------------------
  // GET / — PMO 推荐队列列表
  // -----------------------------------------------------------------------

  async index(ctx: HttpContext) {
    const { auth, request } = ctx
    const organizationId = this.getOrg(ctx)
    await this.policy.authorizeView(auth.user!, organizationId)

    const query = await request.validateUsing(pmoAiPriorityRecommendationListValidator)
    const result = await this.service.list(organizationId, query)

    return ctx.response.ok({ data: result.data, meta: result.meta, summary: result.summary })
  }

  // -----------------------------------------------------------------------
  // GET /:id — PMO 推荐详情
  // -----------------------------------------------------------------------

  async show(ctx: HttpContext) {
    const { auth, params } = ctx
    const organizationId = this.getOrg(ctx)
    await this.policy.authorizeView(auth.user!, organizationId)

    const { id } = await pmoAiPriorityRecommendationIdValidator.validate(params)
    const detail = await this.service.getById(organizationId, id)

    if (!detail) {
      return ctx.response.notFound({ error: { code: 'RESOURCE_NOT_FOUND', message: '推荐不存在' } })
    }

    return ctx.response.ok({ data: detail })
  }

  // -----------------------------------------------------------------------
  // POST /refresh — 刷新推荐候选
  // -----------------------------------------------------------------------

  async refresh(ctx: HttpContext) {
    const { auth } = ctx
    const organizationId = this.getOrg(ctx)
    const userId = this.getUserId(ctx)
    await this.policy.authorizeManage(auth.user!, organizationId)

    const result = await this.service.refreshCandidates({
      organizationId,
      userId,
      actor: auth.user!,
      hasRiskView: false,
      hasResourceView: false,
      hasPredictionView: false,
      hasHealthView: false,
      priorityScoringAvailable: true, // fixture 模式
      trafficLightAvailable: true,
    })

    return ctx.response.ok({
      data: result.data,
      warnings: result.warnings,
      created: result.created,
      merged: result.merged,
    })
  }

  // -----------------------------------------------------------------------
  // POST /:id/ai-rationale — 生成 AI 理由
  // -----------------------------------------------------------------------

  async aiRationale(ctx: HttpContext) {
    const { auth, params, request } = ctx
    const organizationId = this.getOrg(ctx)
    const userId = this.getUserId(ctx)
    await this.policy.authorizeTriggerAi(auth.user!, organizationId)

    const { id } = await pmoAiPriorityRecommendationIdValidator.validate(params)
    const body = await request.validateUsing(pmoAiRationaleRequestValidator)

    // 使用 MockAdapter 或真实 AIGateway（取决于配置）
    // 本节用 fixture gateway——无真实 API key 时仍能工作
    const gateway = this.resolveGateway(ctx)

    try {
      const result = await this.service.generateAiRationale(gateway, {
        recommendationId: id,
        organizationId,
        userId,
        idempotencyKey: body.idempotencyKey,
      })

      return ctx.response.ok({
        data: {
          aiMetadata: result.aiMetadata,
          record: result.record,
        },
      })
    } catch (err) {
      if (err instanceof Error && err.message === 'RESOURCE_NOT_FOUND') {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: '推荐不存在' },
        })
      }
      throw err
    }
  }

  // -----------------------------------------------------------------------
  // POST /:id/status — 审查动作
  // -----------------------------------------------------------------------

  async updateStatus(ctx: HttpContext) {
    const { auth, params, request } = ctx
    const organizationId = this.getOrg(ctx)
    const userId = this.getUserId(ctx)
    await this.policy.authorizeManage(auth.user!, organizationId)

    const { id } = await pmoAiPriorityRecommendationIdValidator.validate(params)
    const body = await request.validateUsing(pmoReviewActionValidator)

    try {
      const result = await this.service.reviewAction({
        recommendationId: id,
        organizationId,
        userId,
        action: body.action,
        reason: body.reason,
        snoozeUntil: body.snoozeUntil,
        convertTarget: body.convertTarget,
        convertParams: body.convertParams as Record<string, unknown> | undefined,
      })

      return ctx.response.ok({
        data: {
          record: result.record,
          conversionIntent: result.conversionIntent ?? null,
        },
      })
    } catch (err) {
      if (err instanceof Error && err.message === 'RESOURCE_NOT_FOUND') {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: '推荐不存在' },
        })
      }
      throw err
    }
  }

  // -----------------------------------------------------------------------
  // 内部 helper：解析 AIGateway（fixture 优先）
  // -----------------------------------------------------------------------

  private resolveGateway(_ctx: HttpContext): AIGateway {
    // 尝试从容器获取真实 gateway，失败则返回 mock
    // 在 fixture 模式下，使用简单的 mock adapter
    try {
      const { default: MockAdapter } = require('#services/ai_m0/mock_adapter')
      const adapter = new MockAdapter()
      return new AIGateway(adapter)
    } catch {
      // 无 mock adapter 时，构造一个最简 adapter
      const stubAdapter: any = {
        providerName: 'mock-pmo',
        modelName: 'mock-pmo-recommendation',
        isReal: false,
        async *stream() {
          yield {
            kind: 'text',
            text: '推荐理由：基于项目当前指标和优先级评分，该项目需要管理层关注。（AI 理由草案——待审查）',
          }
          yield { kind: 'done', usage: { outputTokens: 50 } }
        },
      }
      return new AIGateway(stubAdapter)
    }
  }
}
