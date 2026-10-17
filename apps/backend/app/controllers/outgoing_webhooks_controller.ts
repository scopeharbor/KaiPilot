/**
 * v2-5-outgoing-webhook-subscription-foundation -- 出站 webhook 订阅管理 HTTP 层（design D5）。
 *
 * 全部管理方法在 `middleware.auth()` 组内，经 OutgoingWebhookPolicy 校验
 * `outgoing_webhook:manage` + 组织隔离。Controller 不写业务逻辑，只做 HTTP 解析与响应格式化。
 *
 * 响应：list `{data:[]}`、create/rotate `{data:{...,secret}}`（一次性明文）、其余 `{data:{...}}`。
 * 错误统一 `{error:{code,message,details?}}`。
 */
import OutgoingWebhookSubscriptionService, {
  OutgoingWebhookEventRejectedError,
  OutgoingWebhookFeatureDisabledError,
  OutgoingWebhookSubscriptionNotFoundError,
} from '#services/webhooks/outgoing_webhook_subscription_service'
import OutgoingWebhookPolicy from '#policies/outgoing_webhook_policy'
import { OutgoingWebhookUrlError } from '#services/webhooks/outgoing_webhook_url_validator'
import User from '#models/user'
import {
  FeatureDisabledException,
  PermissionDeniedException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import {
  createOutgoingWebhookSubscriptionValidator,
  updateOutgoingWebhookSubscriptionValidator,
} from '#validators/outgoing_webhook'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class OutgoingWebhooksController {
  constructor(
    private subscriptions: OutgoingWebhookSubscriptionService,
    private policy: OutgoingWebhookPolicy,
  ) {}

  private async actor(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    const allowed = await this.policy.manage(user, Number(orgId))
    if (!allowed) {
      throw new PermissionDeniedException('无权管理出站 webhook 订阅')
    }
    return { userId: Number(user.id), organizationId: Number(orgId) }
  }

  async index(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    return ctx.response.ok({ data: await this.subscriptions.list(actor) })
  }

  async store(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const input = await ctx.request.validateUsing(createOutgoingWebhookSubscriptionValidator)
    try {
      const created = await this.subscriptions.create(input, actor)
      return ctx.response.created({ data: created })
    } catch (error) {
      throw this.mapDomainError(error)
    }
  }

  async update(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const input = await ctx.request.validateUsing(updateOutgoingWebhookSubscriptionValidator)
    const id = await this.ownedId(ctx, actor)
    try {
      return ctx.response.ok({ data: await this.subscriptions.update(id, input, actor) })
    } catch (error) {
      throw this.mapDomainError(error)
    }
  }

  async deactivate(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const id = await this.ownedId(ctx, actor)
    try {
      return ctx.response.ok({ data: await this.subscriptions.deactivate(id, actor) })
    } catch (error) {
      throw this.mapDomainError(error)
    }
  }

  async rotate(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const id = await this.ownedId(ctx, actor)
    try {
      return ctx.response.ok({ data: await this.subscriptions.rotateSecret(id, actor) })
    } catch (error) {
      throw this.mapDomainError(error)
    }
  }

  private mapDomainError(error: unknown): Error {
    if (error instanceof OutgoingWebhookFeatureDisabledError) {
      return new FeatureDisabledException(error.message)
    }
    if (error instanceof OutgoingWebhookUrlError) {
      return new ValidationException(error.message)
    }
    if (error instanceof OutgoingWebhookEventRejectedError) {
      return new ValidationException(error.message)
    }
    if (error instanceof OutgoingWebhookSubscriptionNotFoundError) {
      return new ResourceNotFoundException('outgoing webhook subscription')
    }
    return error instanceof Error ? error : new Error(String(error))
  }

  private async ownedId(ctx: HttpContext, actor: { organizationId: number }): Promise<number> {
    const id = Number(ctx.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      throw new ResourceNotFoundException('outgoing webhook subscription')
    }
    try {
      await this.subscriptions.getOwnedModel(id, actor)
    } catch (error) {
      if (error instanceof OutgoingWebhookSubscriptionNotFoundError) {
        throw new ResourceNotFoundException('outgoing webhook subscription')
      }
      throw error
    }
    return id
  }
}
