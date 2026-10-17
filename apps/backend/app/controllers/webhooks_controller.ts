/**
 * v2-5-provider-incoming-webhook-foundation —— HTTP 层（design D5/D7/D9/D10）。
 *
 * 接收方法 `receive`：公开、免登录，对原始 body 校验签名后记账，零业务副作用；
 *   状态码映射：签名/缺失 401、时间戳 400、端点禁用/kill switch 403、未知 provider 404、
 *   成功/重复 2xx（幂等一致）。
 * 管理方法：`middleware.auth()` 组内，经 WebhookPolicy 校验 `webhook:manage` + 组织隔离。
 *
 * Controller 不写业务逻辑，只做 HTTP 解析与响应格式化。
 */
import WebhookIngestService from '#services/webhooks/webhook_ingest_service'
import WebhookEndpointService, {
  InvalidWebhookProviderError,
  WebhookEndpointNotFoundError,
} from '#services/webhooks/webhook_endpoint_service'
import WebhookPolicy from '#policies/webhook_policy'
import User from '#models/user'
import {
  PermissionDeniedException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import {
  createWebhookEndpointValidator,
  updateWebhookEndpointValidator,
  listWebhookDeliveriesValidator,
} from '#validators/webhook'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class WebhooksController {
  constructor(
    private ingest: WebhookIngestService,
    private endpoints: WebhookEndpointService,
    private policy: WebhookPolicy,
  ) {}

  /** 公开接收端点：POST /api/v1/webhooks/:provider（注册在 auth 组外）。 */
  async receive(ctx: HttpContext) {
    const provider = String(ctx.params.provider ?? '')
    // bodyparser 解析 JSON 时调用 updateRawBody 保留原始字节（design D1），
    // request.raw() 返回解析前的原始字符串，HMAC 对此计算。
    const raw = ctx.request.raw() ?? ''
    const rawBody = Buffer.from(raw, 'utf8')
    const result = await this.ingest.ingest({
      provider,
      rawBody,
      headers: ctx.request.headers(),
    })

    if (result.status === 'accepted') {
      return ctx.response.ok({ data: { status: 'accepted' } })
    }
    if (result.status === 'duplicate') {
      // 幂等：返回与首次一致的 2xx
      return ctx.response.ok({ data: { status: 'duplicate' } })
    }
    // rejected
    return ctx.response.status(result.httpStatus).send({
      error: {
        code: result.code,
        message: result.message,
        ...(process.env.WEBHOOK_DEBUG === '1'
          ? { debug: { rawLen: rawBody.length, rawHead: rawBody.subarray(0, 40).toString('utf8') } }
          : {}),
      },
    })
  }

  private async actor(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    const allowed = await this.policy.manage(user, Number(orgId))
    if (!allowed) {
      throw new PermissionDeniedException('无权管理 webhook 端点')
    }
    return { userId: Number(user.id), organizationId: Number(orgId) }
  }

  async index(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    return ctx.response.ok({ data: await this.endpoints.list(actor) })
  }

  async store(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const input = await ctx.request.validateUsing(createWebhookEndpointValidator)
    try {
      const created = await this.endpoints.create(input, actor)
      return ctx.response.created({ data: created })
    } catch (error) {
      if (error instanceof InvalidWebhookProviderError) {
        throw new ValidationException(error.message)
      }
      throw error
    }
  }

  async update(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const input = await ctx.request.validateUsing(updateWebhookEndpointValidator)
    const id = await this.ownedId(ctx, actor)
    if (input.timestampToleranceSeconds !== undefined) {
      await this.endpoints.updateTolerance(id, input.timestampToleranceSeconds, actor)
    }
    if (input.enabled !== undefined) {
      await this.endpoints.setEnabled(id, input.enabled, actor)
    }
    return ctx.response.ok({ data: await this.endpoints.getOwned(id, actor) })
  }

  async enable(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const id = await this.ownedId(ctx, actor)
    return ctx.response.ok({ data: await this.endpoints.setEnabled(id, true, actor) })
  }

  async disable(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const id = await this.ownedId(ctx, actor)
    return ctx.response.ok({ data: await this.endpoints.setEnabled(id, false, actor) })
  }

  async rotate(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const id = await this.ownedId(ctx, actor)
    const result = await this.endpoints.rotateSecret(id, actor)
    return ctx.response.ok({ data: { endpoint: result.endpoint, secret: result.secret } })
  }

  async deliveries(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    const id = await this.ownedId(ctx, actor)
    const query = await ctx.request.validateUsing(listWebhookDeliveriesValidator)
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    const result = await this.endpoints.listDeliveries(id, actor, {
      page,
      perPage,
      provider: query.provider,
    })
    return ctx.response.ok({ data: result.data, meta: result.meta })
  }

  private async ownedId(ctx: HttpContext, actor: { organizationId: number }): Promise<number> {
    const id = Number(ctx.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      throw new ResourceNotFoundException('webhook endpoint')
    }
    try {
      await this.endpoints.getOwnedModel(id, actor)
    } catch (error) {
      if (error instanceof WebhookEndpointNotFoundError) {
        throw new ResourceNotFoundException('webhook endpoint')
      }
      throw error
    }
    return id
  }
}
