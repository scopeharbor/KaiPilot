import IntegrationPolicy from '#policies/integration_policy'
import IntegrationService from '#services/integrations/integration_service'
import User from '#models/user'
import { PermissionDeniedException } from '#exceptions/api_exception'
import { integrationCallbackValidator } from '#validators/integration'
import { inject } from '@adonisjs/core'
import env from '#start/env'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class IntegrationsController {
  constructor(
    private integrations: IntegrationService,
    private policy: IntegrationPolicy,
  ) {}

  private orgIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  private async actor(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = this.orgIdOf(ctx)
    const allowed = await this.policy.connect(user, organizationId)
    if (!allowed) throw new PermissionDeniedException('无权连接第三方集成')
    return { userId: Number(user.id), organizationId }
  }

  async index(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    return ctx.response.ok({ data: await this.integrations.listProviders(actor) })
  }

  async show(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    return ctx.response.ok({
      data: await this.integrations.getProvider(ctx.params.provider, actor),
    })
  }

  async authorize(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    return ctx.response.ok({ data: this.integrations.authorize(ctx.params.provider, actor) })
  }

  async qr(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    return ctx.response.ok({ data: this.integrations.qr(ctx.params.provider, actor) })
  }

  async disconnect(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    return ctx.response.ok({
      data: await this.integrations.disconnectForActor(ctx.params.provider, actor),
    })
  }

  async check(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    return ctx.response.ok({ data: await this.integrations.check(ctx.params.provider, actor) })
  }

  async callback(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(integrationCallbackValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.integrations.handleCallback(ctx.params.provider, input)
    const frontendUrl = env.get('FRONTEND_URL')
    if (frontendUrl) {
      const url = new URL('/settings/integrations/callback', frontendUrl)
      url.searchParams.set('provider', result.provider)
      url.searchParams.set('status', result.status)
      url.searchParams.set('codeReceived', result.codeReceived ? '1' : '0')
      url.searchParams.set('message', result.message)
      if ('errorCode' in result && result.errorCode) {
        url.searchParams.set('errorCode', result.errorCode)
      }
      return this.externalRedirect(ctx, url.toString())
    }
    return ctx.response.ok({ data: result })
  }

  private externalRedirect(ctx: HttpContext, url: string) {
    return ctx.response.status(302).header('Location', url).send(null)
  }
}
