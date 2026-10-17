import env from '#start/env'
import { defineConfig, stores } from '@adonisjs/limiter'
import type { InferLimiters } from '@adonisjs/limiter/types'
import { isRedisEnabled, REDIS_LIMITER_KEY_PREFIX } from '#config/redis'
import { resolveLimiterStore } from '#services/redis/limiter_store_policy'

/**
 * 限流器配置（design D6；v2-redis-minimum-runtime-support D4）。
 *
 * 默认 `memory`（单进程本机启动，多进程/重启会丢状态，单机可接受）。
 * `redis` store 仅在 Redis 启用时可选，承载跨进程/跨重启的限流状态：
 * - SEC-03 登录失败锁定（同一账户失败 5 次锁 30 分钟）
 * - SEC-10 认证端点速率限制（100 次/分钟）
 *
 * `LIMITER_STORE=redis` 但 `REDIS_ENABLED` 未开时，resolveLimiterStore 在此抛错中止启动，
 * 禁止静默回退内存（关联 DEBT-01：内存→共享 store 的迁移点）。
 */
const activeStore = resolveLimiterStore(env.get('LIMITER_STORE'), isRedisEnabled())

const limiterConfig = defineConfig({
  default: activeStore,

  stores: {
    /**
     * 内存存储：默认。多进程/重启会丢状态，单机可接受。
     */
    memory: stores.memory({}),

    /**
     * Redis 存储：opt-in。使用 config/redis.ts 的 `main` 连接，独立键前缀隔离键空间。
     * 仅在 Redis 启用且 LIMITER_STORE=redis 时成为 default 并被实际使用。
     */
    redis: stores.redis({
      connectionName: 'main',
      keyPrefix: REDIS_LIMITER_KEY_PREFIX,
    }),
  },
})

export default limiterConfig

declare module '@adonisjs/limiter/types' {
  export interface LimitersList extends InferLimiters<typeof limiterConfig> {}
}
