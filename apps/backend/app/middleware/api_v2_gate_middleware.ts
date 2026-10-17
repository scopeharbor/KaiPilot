/**
 * API v2 特性门禁中间件
 *
 * 当 `API_V2_ENABLED` 未设置或为 false 时，
 * 所有 `/api/v2` 请求返回 503 + feature-disabled 错误。
 */
import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'

export default class ApiV2GateMiddleware {
  async handle(ctx: HttpContext, next: () => Promise<void>) {
    const enabled = env.get('API_V2_ENABLED', false)
    if (!enabled) {
      ctx.response.status(503).json({
        error: {
          code: 'FEATURE_DISABLED',
          message: 'API v2 is disabled. Set API_V2_ENABLED=true to enable.',
          details: null,
        },
      })
      return
    }
    await next()
  }
}
