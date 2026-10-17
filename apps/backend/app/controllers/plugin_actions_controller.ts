/**
 * v3-plugin-action-preview-boundary —— 插件写入动作统一边界 API。
 *
 *   GET  /api/v1/organizations/:organizationId/plugin-actions/:proposalUid            详情
 *   POST /api/v1/organizations/:organizationId/plugin-actions/:proposalUid/preview    生成/刷新标准预览
 *   POST /api/v1/organizations/:organizationId/plugin-actions/:proposalUid/decision   reject/discard/modify
 *   POST /api/v1/organizations/:organizationId/plugin-actions/:proposalUid/confirm    一次性句柄确认执行
 *
 * 错误映射（低敏）：not-found → 404；权限 → 403；新鲜度/冲突 → 409；
 * 形状/句柄/dry-run → 400。错误消息不泄露目标内容或来源全文。
 */
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { PluginActionBoundaryService } from '#services/plugin_action_boundary/boundary_service'
import { ActionBoundaryError } from '#services/plugin_action_boundary/adapter_registry'
import PluginActionPolicy from '#policies/plugin_action_policy'
import {
  validateConfirmPayload,
  validateDecisionPayload,
} from '#validators/plugin_action_validator'

type ReasonStatus = 400 | 403 | 404 | 409

const REASON_STATUS: Record<string, ReasonStatus> = {
  'adapter-missing': 400,
  'adapter-not-host-owned': 400,
  'adapter-descriptor-invalid': 400,
  'action-kind-unknown': 400,
  'action-proposal-invalid': 400,
  'action-payload-too-large': 400,
  'action-sensitive-material': 400,
  'handle-invalid': 400,
  'handle-expired': 400,
  'dry-run-blocking': 400,
  'handle-consumed': 409,
  'preview-stale': 409,
  'source-signature-stale': 409,
  'install-not-enabled': 409,
  'plugin-version-mismatch': 409,
  'apply-failed': 409,
  'audit-failed': 409,
  'cross-scope-denied': 404,
  'permission-denied': 403,
}

@inject()
export default class PluginActionsController {
  constructor(
    private boundary: PluginActionBoundaryService,
    private policy: PluginActionPolicy,
  ) {}

  private orgId(ctx: HttpContext): number | null {
    const parsed = Number(ctx.params.organizationId)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  /** 统一错误出口：ActionBoundaryError → 稳定 HTTP 状态 + 非泄露消息。 */
  #error(ctx: HttpContext, error: unknown): void {
    if (error instanceof ActionBoundaryError) {
      const notFound = error.message.includes('not found')
      if (notFound || error.reasonCode === 'cross-scope-denied') {
        // 跨组织/不存在：统一 404 非泄露
        ctx.response.notFound({
          error: { code: 'RESOURCE_NOT_FOUND', message: '无法找到该提案' },
        })
        return
      }
      const status = REASON_STATUS[error.reasonCode] ?? 400
      const code =
        error.reasonCode === 'permission-denied'
          ? 'PERMISSION_DENIED'
          : status === 400
            ? 'VALIDATION_ERROR'
            : 'CONFLICT'
      ctx.response.status(status).json({
        error: { code, message: error.message, details: { reasonCode: error.reasonCode } },
      })
      return
    }
    throw error
  }

  /** GET /:proposalUid */
  async show(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    if (!organizationId) {
      return ctx.response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: '非法组织标识' },
      })
    }
    const user = ctx.auth.user!
    if (!(await this.policy.view(user, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无权查看插件动作' },
      })
    }
    try {
      const detail = await this.boundary.detail(organizationId, String(ctx.params.proposalUid))
      return ctx.response.ok({ data: detail })
    } catch (error) {
      this.#error(ctx, error)
    }
  }

  /** POST /:proposalUid/preview */
  async preview(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    if (!organizationId) {
      return ctx.response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: '非法组织标识' },
      })
    }
    const user = ctx.auth.user!
    const actorPermissions = await this.policy.resolveActorPermissions(user, organizationId)
    if (!actorPermissions.includes('plugin_action:view')) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无权查看插件动作' },
      })
    }
    try {
      const preview = await this.boundary.generatePreview({
        organizationId,
        proposalUid: String(ctx.params.proposalUid),
        actorUserId: user.id,
        actorPermissions,
      })
      return ctx.response.ok({ data: preview })
    } catch (error) {
      this.#error(ctx, error)
    }
  }

  /** POST /:proposalUid/decision */
  async decide(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    if (!organizationId) {
      return ctx.response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: '非法组织标识' },
      })
    }
    const user = ctx.auth.user!
    if (!(await this.policy.view(user, organizationId))) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '无权处理插件动作' },
      })
    }
    const payload = validateDecisionPayload(ctx.request.body() as Record<string, unknown>)
    if (!payload.valid || !payload.decision) {
      return ctx.response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: '请求参数不合法',
          details: { errors: payload.errors },
        },
      })
    }
    try {
      const out = await this.boundary.decide({
        organizationId,
        projectId: null,
        proposalUid: String(ctx.params.proposalUid),
        actorUserId: user.id,
        decision: payload.decision,
        userModifiedValue: payload.decision === 'modify' ? payload.userModifiedValue : undefined,
      })
      return ctx.response.ok({ data: out })
    } catch (error) {
      this.#error(ctx, error)
    }
  }

  /** POST /:proposalUid/confirm */
  async confirm(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    if (!organizationId) {
      return ctx.response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: '非法组织标识' },
      })
    }
    const user = ctx.auth.user!
    const actorPermissions = await this.policy.resolveActorPermissions(user, organizationId)
    if (!actorPermissions.includes('plugin_action:confirm')) {
      return ctx.response.forbidden({
        error: { code: 'PERMISSION_DENIED', message: '没有执行该操作的权限' },
      })
    }
    const payload = validateConfirmPayload(ctx.request.body() as Record<string, unknown>)
    if (!payload.valid) {
      return ctx.response.badRequest({
        error: {
          code: 'VALIDATION_ERROR',
          message: '缺少确认句柄',
          details: { errors: payload.errors },
        },
      })
    }
    try {
      const outcome = await this.boundary.confirm({
        organizationId,
        proposalUid: String(ctx.params.proposalUid),
        handleValue: payload.handle,
        actorUserId: user.id,
        actorPermissions,
      })
      return ctx.response.ok({ data: outcome })
    } catch (error) {
      this.#error(ctx, error)
    }
  }
}
