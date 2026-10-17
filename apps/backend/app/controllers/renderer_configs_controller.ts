/**
 * RendererConfigsController —— 渲染器配置 API 端点（§7.1 P0，§7.2 P0）。
 *
 * 路由前缀：/api/v1/projects/:projectId/renderer-configs
 *
 * 9 端点：
 * - POST /validate          — 校验渲染器配置
 * - POST /preview           — 预览 AI 候选配置
 * - POST /confirm           — 确认 AI 候选并保存为自定义视图
 * - PUT /overrides          — 保存用户覆盖偏好
 * - DELETE /overrides/:viewId — 重置用户覆盖
 */
import RendererConfigValidationService from '#services/renderer/renderer_config_validation_service'
import CustomViewService from '#services/custom_view_service'
import RendererConfigPolicy from '#policies/renderer_config_policy'
import { confirmRendererCandidateValidator } from '#validators/renderer'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import AuditService, { AuditEvent } from '#services/audit_service'

@inject()
export default class RendererConfigsController {
  constructor(
    private validator: RendererConfigValidationService,
    private customViews: CustomViewService,
    private policy: RendererConfigPolicy,
    private audit: AuditService,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  /**
   * POST /projects/:projectId/renderer-configs/validate
   * 校验渲染器配置。
   */
  async validate(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId)

    const config = ctx.request.input('config')
    const result = this.validator.validateProjectConfig(config)

    if (!result.valid) {
      await this.audit.log({
        event: AuditEvent.RENDERER_VALIDATION_FAILED,
        userId: user.id,
        organizationId,
        projectId: Number(ctx.params.projectId),
        entityType: 'renderer_config',
        entityId: null,
        requestId: ctx.request.id() ?? null,
        metadata: {
          errorCount: result.errors.length,
          warningCount: result.warnings.length,
          configHash: result.configHash,
        },
      })
    }

    return ctx.response.ok({
      data: {
        valid: result.valid,
        configHash: result.configHash,
        errors: result.errors,
        warnings: result.warnings,
        schemaVersion: result.schemaVersion,
      },
    })
  }

  /**
   * POST /projects/:projectId/renderer-configs/preview
   * 预览 AI 候选渲染器配置（只读，不持久化）。
   */
  async preview(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId)

    const config = ctx.request.input('config')
    const viewResult = this.validator.validateViewConfig(config)

    return ctx.response.ok({
      data: {
        valid: viewResult.valid,
        warnings: viewResult.warnings,
        errors: viewResult.errors,
      },
    })
  }

  /**
   * POST /projects/:projectId/renderer-configs/confirm
   * 确认 AI 候选并保存为自定义视图。
   */
  async confirm(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(confirmRendererCandidateValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)

    await this.policy.authorizeConfirmCandidate(user, organizationId)

    // 校验配置
    const validation = this.validator.validateViewConfig(input.config)
    if (!validation.valid) {
      return ctx.response.unprocessableEntity({
        error: {
          code: 'VALIDATION_ERROR',
          message: '渲染器配置校验失败',
          details: validation.errors,
        },
      })
    }

    // 保存为自定义视图
    const baseViewType = (input.config as any)?.type ?? 'dashboard'
    const view = await this.customViews.create(
      user,
      {
        ip: ctx.request.ip(),
        userAgent: ctx.request.header('user-agent'),
        requestId: ctx.request.id() ?? null,
      },
      organizationId,
      projectId,
      {
        name: input.name,
        baseViewType: baseViewType,
        visibility: input.visibility,
        config: {
          schemaVersion: 1,
          baseViewType: baseViewType,
          ...input.config,
        },
      },
    )

    await this.audit.log({
      event: AuditEvent.RENDERER_CANDIDATE_CONFIRMED,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'custom_view',
      entityId: view.id,
      requestId: ctx.request.id() ?? null,
      metadata: {
        configHash: validation.configHash,
        sourceArtifactRef: input.sourceArtifactRef,
        visibility: input.visibility,
      },
    })

    return ctx.response.created({
      data: {
        id: view.id,
        name: view.name,
        visibility: view.visibility,
        schemaVersion: view.schemaVersion,
      },
    })
  }

  /**
   * PUT /projects/:projectId/renderer-configs/overrides
   * 保存用户覆盖偏好。
   */
  async saveOverrides(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeSave(user, organizationId)

    // TODO: 实现覆盖偏好保存逻辑
    return ctx.response.ok({
      data: {
        message: '覆盖偏好已保存',
      },
    })
  }

  /**
   * DELETE /projects/:projectId/renderer-configs/overrides/:viewId
   * 重置用户覆盖偏好。
   */
  async resetOverrides(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeSave(user, organizationId)

    // TODO: 实现覆盖偏好重置逻辑
    return ctx.response.ok({
      data: {
        message: '覆盖偏好已重置',
      },
    })
  }
}
