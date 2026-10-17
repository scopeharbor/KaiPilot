/**
 * v3-cross-project-resource-allocation — feature-off 守卫中间件（任务 3.4）。
 *
 * flag 关闭时返回低敏不可用状态（不暴露路由和功能是否存在），开启时放行。
 */
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import env from '#start/env'

/**
 * 跨项目资源调配 feature flag 中间件。
 * CROSS_PROJECT_ALLOCATION_ENABLED=true 才放行相关端点。
 */
export default class CrossProjectAllocationFeatureGuard {
  async handle(ctx: HttpContext, next: NextFn) {
    const enabled = env.get('CROSS_PROJECT_ALLOCATION_ENABLED', false)

    if (!enabled) {
      return ctx.response.status(404).json({
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Feature not available',
        },
      })
    }

    return next()
  }
}
