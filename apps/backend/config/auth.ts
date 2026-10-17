import { defineConfig } from '@adonisjs/auth'
import { sessionGuard, sessionUserProvider } from '@adonisjs/auth/session'
import type {
  GuardConfigProvider,
  InferAuthenticators,
  InferAuthEvents,
} from '@adonisjs/auth/types'
import type { HttpContext } from '@adonisjs/core/http'
import type { ApplicationService } from '@adonisjs/core/types'
import type JwtGuard from '#middleware/jwt_guard'

/**
 * JWT 守卫配置提供者。
 * 把自研 JwtGuard 注册到 @adonisjs/auth 的 AuthManager。
 *
 * 注意：JwtGuard / TokenService 经**动态 import** 在 resolver 内按需加载，
 * 而非顶层 eager import——否则 auth_provider 在 boot 早期加载本配置时会连带拉起
 * `#models/user`，其 `withAuthFinder(hash)` 会在 hash 服务就绪（app.booted）之前
 * 捕获到 undefined，导致 user.save() 全链路崩溃。
 */
export function jwtGuard(): GuardConfigProvider<(ctx: HttpContext) => JwtGuard> {
  return {
    async resolver(_name: string, app: ApplicationService) {
      const { default: JwtGuardImpl } = await import('#middleware/jwt_guard')
      const { default: TokenService } = await import('#services/token_service')
      const tokenService = await app.container.make(TokenService)
      const emitter = await app.container.make('emitter')
      return (ctx: HttpContext) => new JwtGuardImpl('jwt', ctx, emitter, tokenService)
    },
  }
}

const authConfig = defineConfig({
  /**
   * Default guard used when no guard is explicitly specified.
   */
  default: 'jwt',

  guards: {
    /**
     * JWT guard for stateless API authentication.
     */
    jwt: jwtGuard(),

    /**
     * Web session guard (kept for compatibility).
     */
    web: sessionGuard({
      useRememberMeTokens: false,
      provider: sessionUserProvider({
        model: () => import('#models/user'),
      }),
    }),
  },
})

export default authConfig

/**
 * Inferring types from the configured auth guards.
 */
declare module '@adonisjs/auth/types' {
  export interface Authenticators extends InferAuthenticators<typeof authConfig> {}
}
declare module '@adonisjs/core/types' {
  interface EventsList extends InferAuthEvents<InferAuthenticators<typeof authConfig>> {}
}
