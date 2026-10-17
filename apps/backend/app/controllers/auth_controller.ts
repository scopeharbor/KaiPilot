import AuthService from '#services/auth_service'
import GoogleOAuthService, {
  GoogleOAuthException,
} from '#services/integrations/google_oauth_service'
import { userDto } from '#types/dto'
import { loginValidator, refreshValidator, registerValidator } from '#validators/user'
import { twoFactorChallengeValidator, twoFactorLoginValidator } from '#validators/two_factor'
import TwoFactorService from '#services/two_factor_service'
import { inject } from '@adonisjs/core'
import env from '#start/env'
import type { HttpContext } from '@adonisjs/core/http'
import type { AuthContext } from '#types/auth'

/**
 * 认证控制器：register / login / refresh / logout / me。
 * 仅做 HTTP 解析与响应格式化，业务逻辑下沉到 AuthService。
 */
@inject()
export default class AuthController {
  constructor(
    private authService: AuthService,
    private googleOAuth: GoogleOAuthService,
    private twoFactor: TwoFactorService,
  ) {}

  /**
   * 从请求构造审计/节流上下文。
   */
  private context({ request }: HttpContext): AuthContext {
    return {
      ip: request.ip(),
      userAgent: request.header('user-agent'),
      requestId: request.id() ?? null,
    }
  }

  /**
   * POST /api/v1/auth/register
   */
  async register(ctx: HttpContext) {
    const payload = await ctx.request.validateUsing(registerValidator)
    const { user, accessToken, refreshToken } = await this.authService.register({
      fullName: payload.fullName,
      email: payload.email,
      password: payload.password,
      organizationName: payload.organizationName,
    })

    return ctx.response.created({
      data: { user: userDto(user), accessToken, refreshToken },
    })
  }

  /**
   * POST /api/v1/auth/login
   *
   * 两种成功响应形状（前端按 `twoFactorRequired` 判别）：
   * - 无两步验证：`{ user, accessToken, refreshToken }`（与既有契约完全一致，无破坏性变更）；
   * - 有两步验证：`{ twoFactorRequired: true, challengeToken, expiresAt, methods }`——
   *   **不含任何会话凭证**，必须再调 `/auth/login/two-factor` 兑换。
   */
  async login(ctx: HttpContext) {
    const payload = await ctx.request.validateUsing(loginValidator)
    const outcome = await this.authService.attemptLogin(
      { email: payload.email, password: payload.password },
      this.context(ctx),
    )

    if (outcome.twoFactorRequired) {
      return ctx.response.ok({
        data: {
          twoFactorRequired: true,
          challengeToken: outcome.challenge.challengeToken,
          expiresAt: outcome.challenge.expiresAt,
          // 'verify' = 输认证器验证码；'enroll' = 先扫二维码绑定再输验证码。
          purpose: outcome.challenge.purpose,
          methods: outcome.challenge.methods,
          // 绑定挑战是否允许「暂时跳过」（required 策略下为 false）。
          skippable:
            outcome.challenge.purpose === 'enroll' &&
            this.twoFactor.loginEnrollmentMode() === 'optional',
        },
      })
    }

    const { user, accessToken, refreshToken } = outcome.session
    return ctx.response.ok({
      data: { user: userDto(user), accessToken, refreshToken },
    })
  }

  /**
   * POST /api/v1/auth/login/two-factor/enrollment
   *
   * 用绑定挑战票据换该次的二维码内容（otpauth URI + 明文密钥）。
   *
   * 单独一个端点而不是塞进 login 响应：Google OAuth 回调是 302 回前端，塞进登录响应
   * 就得经 URL 传密钥、落进浏览器历史。这里只走 POST body，两条登录路径共用同一套前端。
   */
  async loginTwoFactorEnrollment(ctx: HttpContext) {
    const payload = await ctx.request.validateUsing(twoFactorChallengeValidator)
    const enrollment = await this.twoFactor.enrollmentForChallenge(payload.challengeToken)
    // 响应含明文密钥：禁止任何层级缓存。
    ctx.response.header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    ctx.response.header('Pragma', 'no-cache')
    ctx.response.header('Expires', '0')
    return ctx.response.ok({ data: enrollment })
  }

  /**
   * POST /api/v1/auth/login/two-factor
   *
   * 登录第二步：用挑战票据 + 一次性口令/恢复码换正式会话。
   * 若这次同时完成了首次绑定，响应额外带上仅此一次的恢复码。
   * 未认证端点（会话正是它要产出的东西），与 login 同组挂 authThrottle。
   */
  async loginTwoFactor(ctx: HttpContext) {
    const payload = await ctx.request.validateUsing(twoFactorLoginValidator)
    const { user, accessToken, refreshToken, recoveryCodes, usedRecoveryCode } =
      await this.authService.completeTwoFactorLogin(
        { challengeToken: payload.challengeToken, code: payload.code },
        this.context(ctx),
      )

    // 可能带出恢复码明文（首次绑定那一次）：禁止缓存。
    ctx.response.header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    ctx.response.header('Pragma', 'no-cache')
    ctx.response.header('Expires', '0')
    return ctx.response.ok({
      data: {
        user: userDto(user),
        accessToken,
        refreshToken,
        recoveryCodes,
        // 用恢复码登录的会话：前端据此提示尽快重新绑定认证器。
        usedRecoveryCode,
      },
    })
  }

  /**
   * POST /api/v1/auth/login/two-factor/skip
   *
   * 登录期绑定的「暂时跳过」。只对 `enroll` 挑战、且策略为 `optional` 时有效；
   * 已绑定账号的 `verify` 挑战永远不可跳过。
   */
  async loginTwoFactorSkip(ctx: HttpContext) {
    const payload = await ctx.request.validateUsing(twoFactorChallengeValidator)
    const { user, accessToken, refreshToken } = await this.authService.skipTwoFactorEnrollment(
      { challengeToken: payload.challengeToken },
      this.context(ctx),
    )

    return ctx.response.ok({
      data: { user: userDto(user), accessToken, refreshToken },
    })
  }

  async googleConfig(ctx: HttpContext) {
    const next = typeof ctx.request.input('next') === 'string' ? ctx.request.input('next') : '/'
    const configured = this.googleOAuth.loginConfigured()
    const preflight = this.googleOAuth.loginPreflight()
    return ctx.response.ok({
      data: {
        configured,
        missingEnvKeys: preflight.missingEnvKeys,
        authorizationUrl: configured
          ? this.backendUrl('/api/v1/auth/google/authorize', { next })
          : null,
        // 无秘密 preflight 状态码（configured/disabled/missing_file/unreadable_file/
        // invalid_json/invalid_client_shape/redirect_not_configured），供登录页可操作提示
        preflight: { status: preflight.status },
      },
    })
  }

  async googleAuthorize(ctx: HttpContext) {
    const next = typeof ctx.request.input('next') === 'string' ? ctx.request.input('next') : '/'
    const authorization = this.googleOAuth.loginAuthorizationUrl(next)
    return this.externalRedirect(ctx, authorization.authorizationUrl)
  }

  async googleCallback(ctx: HttpContext) {
    const successUrl = this.frontendUrl('/auth/google/callback', 'GOOGLE_AUTH_SUCCESS_REDIRECT_URL')
    const failureUrl = this.frontendUrl('/login', 'GOOGLE_AUTH_FAILURE_REDIRECT_URL')
    let stage: 'state' | 'token_exchange' | 'userinfo' | 'session' = 'state'
    try {
      const qs = ctx.request.qs()
      if (qs.error) {
        return this.externalRedirect(
          ctx,
          this.withQuery(failureUrl, { google_error: String(qs.error) }),
        )
      }
      const code = typeof qs.code === 'string' ? qs.code : ''
      const state = typeof qs.state === 'string' ? qs.state : ''
      const payload = this.googleOAuth.verifyState(state, 'login')
      stage = 'token_exchange'
      const token = await this.googleOAuth.exchangeCode('login', code)
      stage = 'userinfo'
      const profile = await this.googleOAuth.userInfo(token.access_token)
      stage = 'session'
      const outcome = await this.authService.attemptGoogleLogin(profile, this.context(ctx))

      // 账号启用了两步验证：回跳登录页继续走第二因子，**不下发任何会话凭证**。
      // 挑战令牌放 URL fragment 而非 query——与下方成功回跳同理，fragment 不进
      // 服务端访问日志、不随 Referer 外泄。
      if (outcome.twoFactorRequired) {
        const challengeFragment = new URLSearchParams({
          twoFactorChallenge: outcome.challenge.challengeToken,
          twoFactorExpiresAt: outcome.challenge.expiresAt,
          twoFactorPurpose: outcome.challenge.purpose,
          twoFactorMethods: outcome.challenge.methods.join(','),
          twoFactorSkippable: String(
            outcome.challenge.purpose === 'enroll' &&
              this.twoFactor.loginEnrollmentMode() === 'optional',
          ),
          next: payload.next ?? '/',
        })
        // 注意：这里只放挑战令牌，**不放** TOTP 密钥——密钥由前端另发一次
        // POST /auth/login/two-factor/enrollment 取回，绝不进 URL 与浏览器历史。
        return this.externalRedirect(ctx, `${failureUrl}#${challengeFragment.toString()}`)
      }

      const { user, accessToken, refreshToken } = outcome.session
      const fragment = new URLSearchParams({
        accessToken,
        refreshToken,
        user: Buffer.from(JSON.stringify(userDto(user)), 'utf8').toString('base64url'),
        next: payload.next ?? '/',
      })
      return this.externalRedirect(ctx, `${successUrl}#${fragment.toString()}`)
    } catch (error) {
      // 失败跳转只带 typed code（DGO-08）：GoogleOAuthException 的闭集码或通用码，
      // 绝不把原始错误/响应体塞进 URL；前端登录页负责映射成中文文案。
      const code =
        error instanceof GoogleOAuthException
          ? (error.code ?? 'google_login_failed')
          : 'google_login_failed'
      ctx.logger.warn(
        { stage, errorCode: code, requestId: ctx.request.id() ?? null },
        'Google OAuth callback failed',
      )
      return this.externalRedirect(ctx, this.withQuery(failureUrl, { google_error: code }))
    }
  }

  /**
   * POST /api/v1/auth/refresh
   */
  async refresh(ctx: HttpContext) {
    const payload = await ctx.request.validateUsing(refreshValidator)
    const { user, accessToken, refreshToken } = await this.authService.refresh(
      payload.refreshToken,
      payload.organizationId,
      this.context(ctx),
    )

    return ctx.response.ok({
      data: { user: userDto(user), accessToken, refreshToken },
    })
  }

  /**
   * POST /api/v1/account/logout
   */
  async logout(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const { refreshToken: tokenValue } = ctx.request.only(['refreshToken'])
    await this.authService.logout(user, tokenValue, this.context(ctx))

    return ctx.response.ok({ data: { message: 'Logged out successfully' } })
  }

  /**
   * GET /api/v1/account/profile
   */
  async me(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const result = await this.authService.me(user, ctx.authPayload?.organizationId ?? null)
    return ctx.response.ok({
      data: {
        user: userDto(result.user),
        permissions: result.permissions,
        // 当前生效组织套餐层级（'free' | 'team' | 'enterprise'；无组织为 null）。
        // 前端据此区分「个人免费组织」与「企业组织」（企业能力已由权限集门控）。
        planTier: result.planTier,
      },
    })
  }

  private frontendUrl(path: string, envKey: string): string {
    const configured = env.get(envKey as never) as string | undefined
    if (configured) return configured
    const frontend = env.get('FRONTEND_URL')
    if (frontend) return new URL(path, frontend).toString()
    return new URL(path, env.get('APP_URL')).toString()
  }

  private withQuery(url: string, params: Record<string, string>) {
    const target = new URL(url)
    for (const [key, value] of Object.entries(params)) {
      target.searchParams.set(key, value)
    }
    return target.toString()
  }

  private externalRedirect(ctx: HttpContext, url: string) {
    return ctx.response.status(302).header('Location', url).send(null)
  }

  private backendUrl(path: string, params: Record<string, string>) {
    const target = new URL(path, env.get('APP_URL'))
    for (const [key, value] of Object.entries(params)) {
      target.searchParams.set(key, value)
    }
    return target.toString()
  }
}
