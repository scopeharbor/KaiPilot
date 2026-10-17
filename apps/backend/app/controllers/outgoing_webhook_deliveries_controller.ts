/**
 * v2-5-outgoing-webhook-delivery-ledger -- 出站 webhook 投递账本 HTTP 层（design D5/D6）。
 *
 * 全部方法在 `middleware.auth()` 组内，经 OutgoingWebhookDeliveryPolicy 校验
 * `outgoing_webhook:manage` + 组织隔离。Controller 不写业务逻辑，只做 HTTP 解析与响应格式化。
 *
 * 响应：list `{data:[],meta:{...}}`、detail/attempts `{data:{...}|[]}`、retry `{data:{...}}`。
 * 错误统一 `{error:{code,message,details?}}`。feature-off -> 503，未授权 -> 403，跨组织 -> 404。
 */
import OutgoingWebhookDeliveryService, {
  OutgoingWebhookDeliveryFeatureDisabledError,
  OutgoingWebhookDeliveryNotFoundError,
  OutgoingWebhookDeliveryNotRetryableError,
  OutgoingWebhookDeliveryPausedError,
} from '#services/webhooks/outgoing_webhook_delivery_service'
import OutgoingWebhookDeliveryPolicy from '#policies/outgoing_webhook_delivery_policy'
import User from '#models/user'
import {
  FeatureDisabledException,
  PermissionDeniedException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import {
  listOutgoingWebhookDeliveriesValidator,
  manualRetryOutgoingWebhookDeliveryValidator,
} from '#validators/outgoing_webhook_delivery'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type { ListOutgoingWebhookDeliveriesRequest } from '@aiproj/types'

@inject()
export default class OutgoingWebhookDeliveriesController {
  constructor(
    private deliveries: OutgoingWebhookDeliveryService,
    private policy: OutgoingWebhookDeliveryPolicy,
  ) {}

  private async actor(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    const allowed = await this.policy.manage(user, Number(orgId))
    if (!allowed) {
      throw new PermissionDeniedException('无权管理出站 webhook 投递账本')
    }
    return { userId: Number(user.id), organizationId: Number(orgId) }
  }

  private pathId(ctx: HttpContext): number {
    const id = Number(ctx.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      throw new ResourceNotFoundException('outgoing webhook delivery')
    }
    return id
  }

  async index(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const query = await ctx.request.validateUsing(listOutgoingWebhookDeliveriesValidator)
    const result = await this.deliveries.list(actor, query as ListOutgoingWebhookDeliveriesRequest)
    return ctx.response.ok({ data: result.data, meta: result.meta })
  }

  async show(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const id = this.pathId(ctx)
    try {
      return ctx.response.ok({ data: await this.deliveries.getDetail(id, actor) })
    } catch (error) {
      throw this.mapDomainError(error)
    }
  }

  async attempts(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const id = this.pathId(ctx)
    try {
      return ctx.response.ok({ data: await this.deliveries.listAttempts(id, actor) })
    } catch (error) {
      throw this.mapDomainError(error)
    }
  }

  async retry(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const id = this.pathId(ctx)
    const input = await ctx.request.validateUsing(manualRetryOutgoingWebhookDeliveryValidator)
    try {
      return ctx.response.ok({ data: await this.deliveries.manualRetry(id, actor, input) })
    } catch (error) {
      throw this.mapDomainError(error)
    }
  }

  async pause(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const id = this.pathId(ctx)
    try {
      return ctx.response.ok({ data: await this.deliveries.pauseEvent(id, actor) })
    } catch (error) {
      throw this.mapDomainError(error)
    }
  }

  async unpause(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const id = this.pathId(ctx)
    try {
      return ctx.response.ok({ data: await this.deliveries.unpauseEvent(id, actor) })
    } catch (error) {
      throw this.mapDomainError(error)
    }
  }

  private mapDomainError(error: unknown): Error {
    if (error instanceof OutgoingWebhookDeliveryFeatureDisabledError) {
      return new FeatureDisabledException(error.message)
    }
    if (error instanceof OutgoingWebhookDeliveryNotFoundError) {
      return new ResourceNotFoundException('outgoing webhook delivery')
    }
    if (
      error instanceof OutgoingWebhookDeliveryNotRetryableError ||
      error instanceof OutgoingWebhookDeliveryPausedError
    ) {
      return new ValidationException(error.message)
    }
    return error instanceof Error ? error : new Error(String(error))
  }
}
