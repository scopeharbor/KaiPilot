/**
 * v2-5-webhook-batched-delivery -- 出站 webhook 批量投递控制器（design D5/D6）。
 *
 * 全部方法在 `middleware.auth()` 组内，经 OutgoingWebhookBatchDeliveryPolicy 校验
 * `outgoing_webhook:manage` + 组织隔离。
 *
 * 响应：list `{data:[],meta:{...}}`、detail `{data:{...}}`。
 * 错误统一 `{error:{code,message,details?}}`。feature-off -> 503，未授权 -> 403，跨组织 -> 404。
 */
import OutgoingWebhookBatchDeliveryService, {
  OutgoingWebhookBatchFeatureDisabledError,
  OutgoingWebhookBatchNotFoundError,
  OutgoingWebhookBatchNotRetryableError,
  OutgoingWebhookBatchPausedError,
} from '#services/webhooks/outgoing_webhook_batch_delivery_service'
import OutgoingWebhookBatchDeliveryPolicy from '#policies/outgoing_webhook_batch_delivery_policy'
import User from '#models/user'
import {
  FeatureDisabledException,
  PermissionDeniedException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type { OutgoingWebhookBatchStatus } from '@aiproj/types'

@inject()
export default class OutgoingWebhookBatchDeliveriesController {
  constructor(
    private batchDelivery: OutgoingWebhookBatchDeliveryService,
    private policy: OutgoingWebhookBatchDeliveryPolicy,
  ) {}

  private async actor(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    const allowed = await this.policy.manage(user, Number(orgId))
    if (!allowed) {
      throw new PermissionDeniedException('无权管理出站 webhook 批量投递')
    }
    return { userId: Number(user.id), organizationId: Number(orgId) }
  }

  async index(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const page = Math.max(Number(ctx.request.input('page', 1)), 1)
    const perPage = Math.min(Math.max(Number(ctx.request.input('perPage', 20)), 1), 100)
    const status = ctx.request.input('status') as OutgoingWebhookBatchStatus | undefined
    const subscriptionId = ctx.request.input('subscriptionId') as number | undefined
    const result = await this.batchDelivery.list(actor, { page, perPage, status, subscriptionId })
    return ctx.response.ok({ data: result.data, meta: result.meta })
  }

  async show(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const batchId = ctx.params.batchId as string
    if (!batchId || typeof batchId !== 'string') {
      throw new ResourceNotFoundException('outgoing webhook batch delivery')
    }
    try {
      return ctx.response.ok({ data: await this.batchDelivery.getDetail(batchId, actor) })
    } catch (error) {
      throw this.mapDomainError(error)
    }
  }

  async retry(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const batchId = ctx.params.batchId as string
    if (!batchId || typeof batchId !== 'string') {
      throw new ResourceNotFoundException('outgoing webhook batch delivery')
    }
    const reason = ctx.request.input('reason') as string | undefined
    try {
      const result = await this.batchDelivery.manualRetry(batchId, actor, { reason })
      return ctx.response.ok({ data: result })
    } catch (error) {
      throw this.mapDomainError(error)
    }
  }

  private mapDomainError(error: unknown): Error {
    if (error instanceof OutgoingWebhookBatchFeatureDisabledError) {
      return new FeatureDisabledException(error.message)
    }
    if (error instanceof OutgoingWebhookBatchNotFoundError) {
      return new ResourceNotFoundException('outgoing webhook batch delivery')
    }
    if (
      error instanceof OutgoingWebhookBatchNotRetryableError ||
      error instanceof OutgoingWebhookBatchPausedError
    ) {
      return new ValidationException(error.message)
    }
    return error instanceof Error ? error : new Error(String(error))
  }
}
