import User from '#models/user'
import type TokenService from '#services/token_service'
import { AuthRequiredException } from '#exceptions/api_exception'
import { symbols } from '@adonisjs/auth'
import type { GuardContract } from '@adonisjs/auth/types'
import type { HttpContext } from '@adonisjs/core/http'
import type { EmitterLike } from '@adonisjs/core/types/events'
import { RuntimeException } from '@adonisjs/core/exceptions'

/**
 * JWT payload 类型（注入 HttpContext 供后续中间件/控制器使用）。
 */
export interface JwtPayload {
  sub: number
  organizationId: number | null
  roleVersion: number
  permissions: string[]
}

/**
 * JWT 守卫（GuardContract 实现）。
 *
 * 使用 jose 校验 access token 签名与有效期；校验通过后把用户注入 ctx.auth.user。
 * 即时失效（禁用用户 / 角色版本变更）由配套的 auth_middleware 在 guard 之后每请求校验。
 */
export default class JwtGuard implements GuardContract<User> {
  /**
   * Guard 驱动名
   */
  readonly driverName = 'jwt' as const

  /**
   * 当前请求是否已尝试认证
   */
  authenticationAttempted = false

  /**
   * 当前请求是否已认证通过
   */
  isAuthenticated = false

  /**
   * 认证成功的用户实例
   */
  user?: User

  /**
   * 从 token 解析出的 payload
   */
  declare payload?: JwtPayload

  constructor(
    private name: string,
    private ctx: HttpContext,
    private emitter: EmitterLike<Record<string, any>>,
    private tokenService: TokenService,
  ) {}

  /**
   * 返回当前认证用户，未认证则抛错。
   */
  getUserOrFail(): User {
    if (!this.user) {
      throw new RuntimeException('Cannot access user during unauthenticated request')
    }
    return this.user
  }

  /**
   * 执行认证。
   */
  async authenticate(): Promise<User> {
    this.authenticationAttempted = true

    if (this.isAuthenticated) {
      return this.getUserOrFail()
    }

    const token = this.getBearerToken()
    if (!token) {
      throw new AuthRequiredException('缺失或无效的 Authorization 头')
    }

    try {
      const payload = await this.tokenService.verifyAccessToken(token)
      const user = await User.find(payload.sub)

      if (!user) {
        throw new AuthRequiredException('用户不存在')
      }

      this.payload = {
        sub: payload.sub,
        organizationId: payload.organizationId ?? null,
        roleVersion: payload.roleVersion ?? 0,
        permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
      }

      this.user = user
      this.isAuthenticated = true

      // 将认证信息附加到 ctx 便于中间件/控制器消费
      this.ctx.authUser = this.user
      this.ctx.authPayload = this.payload

      await this.emitter.emit(`auth:authenticate:${this.name}` as any, { user })
      return user
    } catch (error) {
      this.isAuthenticated = false
      this.user = undefined
      throw error
    }
  }

  /**
   * 静默检查是否已认证。
   */
  async check(): Promise<boolean> {
    try {
      if (this.isAuthenticated) return true
      await this.authenticate()
      return true
    } catch {
      return false
    }
  }

  /**
   * 测试客户端用：以指定用户签发 access token 并返回 headers。
   */
  async authenticateAsClient(user: User): Promise<{ headers: { Authorization: string } }> {
    const permissions: string[] = []
    const accessToken = await this.tokenService.generateAccessToken({
      sub: user.id,
      organizationId: null,
      roleVersion: user.roleVersion,
      permissions,
    })
    return {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  }

  /**
   * 从 Authorization header 提取 Bearer token。
   */
  private getBearerToken(): string | null {
    const authHeader = this.ctx.request.header('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null
    }
    return authHeader.replace('Bearer ', '').trim()
  }

  /**
   * 本 guard 可发出的事件（供 `InferAuthEvents` 推断 `EventsList`）。
   *
   * 必须是「成员静态可知」的对象类型：若声明为 `unknown`，
   * `interface EventsList extends InferAuthEvents<...>` 会报 TS2312。
   */
  declare [symbols.GUARD_KNOWN_EVENTS]: {
    'auth:authenticate:jwt': { user: User }
  }
}
