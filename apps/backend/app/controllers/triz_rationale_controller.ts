/**
 * v2-triz-recommendation-rationale-ui —— TrizRationaleController。
 *
 * HTTP 入口，只处理请求解析、权限校验、响应格式化。
 * 业务逻辑下沉到 TrizRecommendationRationaleService / RationaleFeedbackService。
 *
 * 端点：
 *  GET   /api/v1/projects/:projectId/triz-rationale/:targetType/:targetId      — 展示
 *  POST  /api/v1/projects/:projectId/triz-rationale/:targetType/:targetId/feedback — 提交反馈
 *  POST  /api/v1/projects/:projectId/triz-rationale/:targetType/:targetId/handoff  — Draft Layer handoff
 */
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import TrizRationalePolicy from '#policies/triz_rationale_policy'
import TrizRecommendationRationaleService from '#services/triz_rationale/triz_recommendation_rationale_service'
import RationaleFeedbackService from '#services/triz_rationale/rationale_feedback_service'
import {
  rationaleReadParamsValidator,
  feedbackPayloadValidator,
  handoffPayloadValidator,
} from '#validators/triz_rationale'
import {
  PermissionDeniedException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import type User from '#models/user'
import type { RationaleSourceType, RationaleFeedbackReason } from '@aiproj/types'
import logger from '@adonisjs/core/services/logger'

@inject()
export default class TrizRationaleController {
  constructor(
    private policy: TrizRationalePolicy,
    private service: TrizRecommendationRationaleService,
    private feedbackService: RationaleFeedbackService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgIdOf(ctx: HttpContext): number {
    return Number(ctx.tenant!.organizationId)
  }

  private projectIdFrom(ctx: HttpContext): number {
    return Number(ctx.params.projectId)
  }

  private targetTypeFrom(ctx: HttpContext): RationaleSourceType {
    return ctx.params.targetType as RationaleSourceType
  }

  private targetIdFrom(ctx: HttpContext): string {
    return String(ctx.params.targetId)
  }

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  private async guardView(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    if (!(await this.policy.view(user, orgId, projectId))) {
      throw new PermissionDeniedException('无权查看 TRIZ 推荐理由')
    }
  }

  private async guardFeedback(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    if (!(await this.policy.feedback(user, orgId, projectId))) {
      throw new PermissionDeniedException('无权提交 TRIZ 推荐理由反馈')
    }
  }

  private async guardHandoff(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    if (!(await this.policy.handoff(user, orgId, projectId))) {
      throw new PermissionDeniedException('无权发起 TRIZ 推荐理由 Handoff')
    }
  }

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  /**
   * GET /api/v1/projects/:projectId/triz-rationale/:targetType/:targetId
   *
   * 查看 TRIZ 推荐理由详情。
   */
  async show(ctx: HttpContext) {
    await this.guardView(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const targetType = this.targetTypeFrom(ctx)
    const targetId = this.targetIdFrom(ctx)

    const params = await ctx.request.validateUsing(rationaleReadParamsValidator, {
      data: { projectId, targetType, targetId },
    })

    try {
      const rationale = await this.service.show(
        orgId,
        params.projectId,
        targetType,
        params.targetId,
      )

      return ctx.response.ok({ data: rationale })
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error
      }
      if (error instanceof PermissionDeniedException) {
        throw error
      }
      logger.error({ err: error, targetType, targetId }, 'TRIZ 推荐理由读取失败')
      throw new ResourceNotFoundException('TRIZ 推荐理由不可用')
    }
  }

  /**
   * POST /api/v1/projects/:projectId/triz-rationale/:targetType/:targetId/feedback
   *
   * 提交对推荐理由的反馈。
   */
  async feedback(ctx: HttpContext) {
    await this.guardFeedback(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const targetType = this.targetTypeFrom(ctx)
    const targetId = this.targetIdFrom(ctx)

    const params = await ctx.request.validateUsing(rationaleReadParamsValidator, {
      data: { projectId, targetType, targetId },
    })

    const body = await ctx.request.validateUsing(feedbackPayloadValidator)

    try {
      const result = await this.feedbackService.submit({
        organizationId: orgId,
        projectId: params.projectId,
        userId: user.id,
        targetType,
        targetId: params.targetId,
        reason: body.reason as RationaleFeedbackReason,
        note: body.note ?? null,
      })

      return ctx.response.created({ data: result })
    } catch (error) {
      logger.error({ err: error, targetType, targetId }, 'TRIZ 推荐理由反馈提交失败')
      throw new ValidationException('反馈提交失败')
    }
  }

  /**
   * POST /api/v1/projects/:projectId/triz-rationale/:targetType/:targetId/handoff
   *
   * 发起 Draft Layer handoff。
   */
  async handoff(ctx: HttpContext) {
    await this.guardHandoff(ctx)
    const user = this.currentUser(ctx)
    const orgId = this.orgIdOf(ctx)
    const projectId = this.projectIdFrom(ctx)
    const targetType = this.targetTypeFrom(ctx)
    const targetId = this.targetIdFrom(ctx)

    const params = await ctx.request.validateUsing(rationaleReadParamsValidator, {
      data: { projectId, targetType, targetId },
    })

    const body = await ctx.request.validateUsing(handoffPayloadValidator)

    try {
      // 记录 handoff 审计事件
      await this.feedbackService.recordHandoff(
        orgId,
        params.projectId,
        user.id,
        targetType,
        params.targetId,
        body.selectedPrinciple ?? null,
      )

      return ctx.response.ok({
        data: {
          draftSessionId: null,
          handoffStatus: 'candidate_created' as const,
          warnings: [],
        },
      })
    } catch (error) {
      logger.error({ err: error, targetType, targetId }, 'TRIZ 推荐理由 Handoff 失败')
      throw new ValidationException('Handoff 失败')
    }
  }
}
