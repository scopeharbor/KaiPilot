import type { HttpContext } from '@adonisjs/core/http'
export default class TrizPluginPackController {
  async health(ctx: HttpContext) {
    return ctx.response.ok({ status: 'ok' })
  }
  async contributions(ctx: HttpContext) {
    return ctx.response.ok({ data: [] })
  }
  async execute(ctx: HttpContext) {
    return ctx.response.ok({ data: null })
  }
}
