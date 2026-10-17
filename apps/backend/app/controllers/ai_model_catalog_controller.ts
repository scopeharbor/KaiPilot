import AiConnectionPolicy from '#policies/ai_connection_policy'
import AiModelCatalogService from '#services/ai_model_catalog_service'
import { PermissionDeniedException } from '#exceptions/api_exception'
import {
  catalogMatchValidator,
  catalogRefreshValidator,
  catalogSearchValidator,
} from '#validators/ai_model_catalog'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

/**
 * models.dev 目录代理 API。
 *
 * 读取类接口只需要登录和组织上下文；手动刷新属于 AI 连接管理动作。
 */
@inject()
export default class AiModelCatalogController {
  readonly #catalog = new AiModelCatalogService()

  constructor(private policy: AiConnectionPolicy) {}

  private orgIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  private async authorizeManage(user: User, organizationId: number) {
    const allowed = await this.policy.manage(user, organizationId)
    if (!allowed) throw new PermissionDeniedException('无权刷新 AI 模型目录')
  }

  async search(ctx: HttpContext) {
    this.orgIdOf(ctx)
    const query = await catalogSearchValidator.validate(ctx.request.qs())
    const result = await this.#catalog.search({
      query: query.q,
      providerId: query.providerId,
      limit: query.limit,
    })
    return ctx.response.ok(result)
  }

  async match(ctx: HttpContext) {
    this.orgIdOf(ctx)
    const query = await catalogMatchValidator.validate(ctx.request.qs())
    const result = await this.#catalog.match({
      baseUrl: query.baseUrl,
      modelName: query.modelName,
      limit: query.limit,
    })
    return ctx.response.ok({ data: result })
  }

  async provider(ctx: HttpContext) {
    this.orgIdOf(ctx)
    const result = await this.#catalog.provider(String(ctx.params.providerId ?? ''))
    return ctx.response.ok({ data: result })
  }

  async refresh(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = this.orgIdOf(ctx)
    await this.authorizeManage(user, organizationId)
    const input = await catalogRefreshValidator.validate(ctx.request.body())
    const result = await this.#catalog.refresh(input.force ?? true)
    return ctx.response.ok({ data: result })
  }
}
