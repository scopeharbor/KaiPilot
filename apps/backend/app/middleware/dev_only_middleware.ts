/**
 * ai-structured-output-poc / M0 —— dev-only guard 中间件。
 *
 * 用途：AI M0 sandbox 路由 `/api/v1/dev/ai-m0/*` 只能在 dev/test 环境启用。
 * NODE_ENV=production 时直接 404，避免生产暴露沙箱端点（红线 1 + tasks 1.1 安全约束）。
 *
 * 与 auth/tenant/rbac 中间件的区别：本中间件不依赖任何身份 & 组织隔离机制；
 * 沙箱路由完全绕过正式业务链，草案区与正式数据物理隔离（红线 1 硬保零落库）。
 */

import env from '#start/env'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class DevOnlyMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    if (env.get('NODE_ENV') === 'production') {
      return ctx.response.notFound({
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'AI M0 sandbox is disabled in production.',
        },
      })
    }
    return next()
  }
}
