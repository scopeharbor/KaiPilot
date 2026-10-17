import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

declare module '@adonisjs/core/http' {
  interface HttpContext {
    auditContext?: { requestId: string; ip: string; userAgent: string }
  }
}

/**
 * 审计上下文中间件（design D6）。
 *
 * 挂载在 auth/rbac 之后，从当前请求提取 requestId、客户端 IP 与 User-Agent，
 * 注入 `ctx.auditContext`，供 controller 在调用 `AuditService.log` 时合并进 metadata。
 *
 * 登录类事件（login/refresh/logout）由 AuthController 自行读取 IP/UA（不依赖本中间件）。
 */
export default class AuditContextMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    ctx.auditContext = {
      requestId: ctx.request.id() ?? '',
      ip: ctx.request.ip(),
      userAgent: ctx.request.header('user-agent') ?? '',
    }
    return next()
  }
}
