import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import ProjectPredictionService from '#services/prediction/prediction_service'
import ProjectPredictionPolicy from '#policies/project_prediction_policy'
import Project from '#models/project'
import {
  createPredictionValidator,
  listPredictionsValidator,
  confirmPredictionValidator,
  dismissPredictionValidator,
  approveAiExplanationValidator,
  rejectAiExplanationValidator,
} from '#validators/prediction'
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'

/**
 * ProjectPredictionsController —— 预测快照 HTTP 处理器。
 *
 * 嵌套路由：/api/v1/projects/:projectId/predictions
 *
 * v2-ai-risk-progress-prediction / design D5
 *
 * 错误结构统一：{ error: { code, message, details? } }
 * 跨组织访问统一返回 404（不暴露存在性）。
 */
@inject()
export default class ProjectPredictionsController {
  constructor(
    private predictionService: ProjectPredictionService,
    private policy: ProjectPredictionPolicy,
  ) {}

  /**
   * POST /projects/:projectId/predictions — 创建预测快照
   */
  async store(ctx: HttpContext) {
    try {
      const user = ctx.auth.getUserOrFail() as User
      const projectId = Number(ctx.params.projectId)
      const organizationId = ctx.tenant!.organizationId

      const project = await this.projectOrFail(organizationId, projectId)
      await this.policy.authorizeGenerate(project, user)

      const payload = await ctx.request.validateUsing(createPredictionValidator)

      const hasRiskView = await this.policy.canViewRisk(project, user)
      const hasResourceView = await this.policy.canViewResource(project, user)
      const hasChangeImpactView = await this.policy.canViewChangeImpact(project, user)

      const result = await this.predictionService.createSnapshot({
        organizationId,
        projectId,
        userId: user.id,
        window: payload.window as 7 | 14 | 30 | 60 | 90,
        hasRiskView,
        hasResourceView,
        hasChangeImpactView,
      })

      return ctx.response.created({
        data: result.snapshot,
        warnings: result.warnings,
      })
    } catch (error: any) {
      return this.handleError(ctx, error)
    }
  }

  /**
   * GET /projects/:projectId/predictions — 列表
   */
  async index(ctx: HttpContext) {
    try {
      const user = ctx.auth.getUserOrFail() as User
      const projectId = Number(ctx.params.projectId)
      const organizationId = ctx.tenant!.organizationId

      const project = await this.projectOrFail(organizationId, projectId)
      await this.policy.authorizeView(project, user)

      const payload = await ctx.request.validateUsing(listPredictionsValidator)

      const result = await this.predictionService.list({
        projectId,
        organizationId,
        status: payload.status as any,
        window: payload.window as any,
        page: payload.page || 1,
        perPage: payload.perPage || 20,
        sort: payload.sort,
      })

      return ctx.response.ok(result)
    } catch (error: any) {
      return this.handleError(ctx, error)
    }
  }

  /**
   * GET /projects/:projectId/predictions/latest — 最新快照
   */
  async latest(ctx: HttpContext) {
    try {
      const user = ctx.auth.getUserOrFail() as User
      const projectId = Number(ctx.params.projectId)
      const organizationId = ctx.tenant!.organizationId

      const project = await this.projectOrFail(organizationId, projectId)
      await this.policy.authorizeView(project, user)

      const snapshot = await this.predictionService.getLatest(organizationId, projectId, user.id)
      if (!snapshot) {
        return ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: '暂无预测快照' },
        })
      }

      return ctx.response.ok({ data: snapshot })
    } catch (error: any) {
      return this.handleError(ctx, error)
    }
  }

  /**
   * GET /projects/:projectId/predictions/:id — 详情
   */
  async show(ctx: HttpContext) {
    try {
      const user = ctx.auth.getUserOrFail() as User
      const projectId = Number(ctx.params.projectId)
      const snapshotId = Number(ctx.params.id)
      const organizationId = ctx.tenant!.organizationId

      const project = await this.projectOrFail(organizationId, projectId)
      await this.policy.authorizeView(project, user)

      const snapshot = await this.predictionService.getById(
        snapshotId,
        organizationId,
        projectId,
        user.id,
      )
      return ctx.response.ok({ data: snapshot })
    } catch (error: any) {
      return this.handleError(ctx, error)
    }
  }

  /**
   * POST /projects/:projectId/predictions/:id/confirm — 确认快照
   */
  async confirm(ctx: HttpContext) {
    try {
      const user = ctx.auth.getUserOrFail() as User
      const projectId = Number(ctx.params.projectId)
      const snapshotId = Number(ctx.params.id)
      const organizationId = ctx.tenant!.organizationId

      const project = await this.projectOrFail(organizationId, projectId)
      await this.policy.authorizeConfirm(project, user)

      const payload = await ctx.request.validateUsing(confirmPredictionValidator)

      const snapshot = await this.predictionService.confirm(
        snapshotId,
        organizationId,
        projectId,
        user.id,
        payload.notes ?? undefined,
      )
      return ctx.response.ok({ data: snapshot })
    } catch (error: any) {
      return this.handleError(ctx, error)
    }
  }

  /**
   * POST /projects/:projectId/predictions/:id/dismiss — 清除快照
   */
  async dismiss(ctx: HttpContext) {
    try {
      const user = ctx.auth.getUserOrFail() as User
      const projectId = Number(ctx.params.projectId)
      const snapshotId = Number(ctx.params.id)
      const organizationId = ctx.tenant!.organizationId

      const project = await this.projectOrFail(organizationId, projectId)
      await this.policy.authorizeConfirm(project, user)

      const payload = await ctx.request.validateUsing(dismissPredictionValidator)

      const snapshot = await this.predictionService.dismiss(
        snapshotId,
        organizationId,
        projectId,
        user.id,
        payload.reason,
      )
      return ctx.response.ok({ data: snapshot })
    } catch (error: any) {
      return this.handleError(ctx, error)
    }
  }

  /**
   * POST /projects/:projectId/predictions/:id/ai-explanation — 生成 AI 解释
   */
  async generateAiExplanation(ctx: HttpContext) {
    // 骨架实现：返回空解释
    return ctx.response.ok({
      data: {
        narrative: 'AI 解释功能开发中',
        focusPoints: [],
        suggestedActions: [],
        assumptions: [],
        confidence: 0,
        provider: null,
        model: null,
        status: 'pending' as const,
        failureCode: null,
        failureMessage: null,
        outputHash: null,
        costSummary: null,
        approvedBy: null,
        approvedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectReason: null,
        generatedAt: null,
      },
    })
  }

  /**
   * POST /projects/:projectId/predictions/:id/ai-explanation/approve — 确认 AI 解释
   */
  async approveAiExplanation(ctx: HttpContext) {
    try {
      const user = ctx.auth.getUserOrFail() as User
      const projectId = Number(ctx.params.projectId)
      const snapshotId = Number(ctx.params.id)
      const organizationId = ctx.tenant!.organizationId

      const project = await this.projectOrFail(organizationId, projectId)
      await this.policy.authorizeConfirm(project, user)

      const payload = await ctx.request.validateUsing(approveAiExplanationValidator)

      const snapshot = await this.predictionService.updateAiExplanation(
        snapshotId,
        organizationId,
        projectId,
        {
          status: 'approved',
          approvedBy: user.id,
          approvedAt: new Date().toISOString(),
          notes: payload.notes ?? null,
        },
      )
      return ctx.response.ok({ data: snapshot })
    } catch (error: any) {
      return this.handleError(ctx, error)
    }
  }

  /**
   * POST /projects/:projectId/predictions/:id/ai-explanation/reject — 拒绝 AI 解释
   */
  async rejectAiExplanation(ctx: HttpContext) {
    try {
      const user = ctx.auth.getUserOrFail() as User
      const projectId = Number(ctx.params.projectId)
      const snapshotId = Number(ctx.params.id)
      const organizationId = ctx.tenant!.organizationId

      const project = await this.projectOrFail(organizationId, projectId)
      await this.policy.authorizeConfirm(project, user)

      const payload = await ctx.request.validateUsing(rejectAiExplanationValidator)

      const snapshot = await this.predictionService.updateAiExplanation(
        snapshotId,
        organizationId,
        projectId,
        {
          status: 'rejected',
          rejectedBy: user.id,
          rejectedAt: new Date().toISOString(),
          rejectReason: payload.reason,
        },
      )
      return ctx.response.ok({ data: snapshot })
    } catch (error: any) {
      return this.handleError(ctx, error)
    }
  }

  // -----------------------------------------------------------------------
  // 内部辅助
  // -----------------------------------------------------------------------

  /**
   * 跨组织访问统一返回 404，不暴露资源存在性。
   */
  private async projectOrFail(organizationId: number, projectId: number): Promise<Project> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) {
      throw Object.assign(new Error('RESOURCE_NOT_FOUND'), { status: 404 })
    }
    return project
  }

  /**
   * 统一错误处理：所有异常转换为 { error: { code, message, details? } } 格式。
   * 跨组织访问（RESOURCE_NOT_FOUND）返回 404（不暴露存在性）。
   * 权限不足（PERMISSION_DENIED）返回 403。
   * 校验失败（E_VALIDATION_ERROR 等）返回 422。
   * 业务冲突（PREDICTION_ALREADY_CONFIRMED 等）返回 409。
   */
  private handleError(ctx: HttpContext, error: any): any {
    // 资源不存在（跨组织掩码）
    if (error.message === 'RESOURCE_NOT_FOUND' || error.status === 404) {
      return ctx.response.notFound({ error: { code: 'RESOURCE_NOT_FOUND', message: '资源不存在' } })
    }

    // 权限不足
    if (
      error.code === 'E_PERMISSION_DENIED' ||
      error.code === 'PREDICTION_PERMISSION_DENIED' ||
      error.name === 'PermissionDeniedException'
    ) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: error.message || '权限不足' },
      })
    }

    // 校验错误（VineJS）
    if (error.code === 'E_VALIDATION_ERROR') {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'VALIDATION_ERROR',
          message: '请求参数校验失败',
          details: error.messages ?? error.message,
        },
      })
    }

    // 业务冲突
    if (error.message?.startsWith('PREDICTION_')) {
      return ctx.response.conflict({ error: { code: error.message, message: error.message } })
    }

    // 兜底
    logger.error({ err: error }, 'Project prediction request failed')
    return ctx.response.internalServerError({
      error: { code: 'INTERNAL_ERROR', message: '服务异常' },
    })
  }
}
