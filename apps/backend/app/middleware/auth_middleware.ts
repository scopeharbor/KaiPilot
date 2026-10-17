import type User from '#models/user'
import { AccountInactiveException, RoleVersionMismatchException } from '#exceptions/api_exception'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Auth middleware authenticates HTTP requests using the JWT guard
 * and enforces per-request freshness checks (design D9):
 *
 * 1. 调用 JWT guard 校验签名/有效期；
 * 2. 每请求索引化核对 user.isActive（禁用用户即时失效）；
 * 3. 核对 token 内 roleVersion 与 DB 当前值（角色变更即时传播）。
 *
 * 任一检查失败返回 401/403，客户端应触发 refresh 重载最新权限。
 */
export default class AuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = (await ctx.auth.authenticateUsing(['jwt'])) as User

    // 即时失效检查（D9）：禁用用户 / roleVersion 不一致
    if (!user.isActive) {
      throw new AccountInactiveException('账户已被禁用')
    }

    const payload = ctx.authPayload
    if (payload && user.roleVersion !== payload.roleVersion) {
      throw new RoleVersionMismatchException('角色已变更，请刷新令牌')
    }

    return next()
  }
}
