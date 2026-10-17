import env from '#start/env'
import { defineConfig } from '@adonisjs/redis'
import type { InferConnections } from '@adonisjs/redis/types'

/**
 * Redis 运行时最小配置（v2-redis-minimum-runtime-support, design D1/D3）。
 *
 * - 默认关闭：`REDIS_ENABLED` 未设或 false 时后端以单节点内存模式运行，禁止建立连接。
 * - 启用时通过分项环境变量建立单节点连接（`main`），承载限流器 redis store 与缓存加速层。
 * - 参数（host/port/password/db/tls/连接超时/重连上限）全部来自环境变量，与 PG 分项风格一致。
 * - 缺 host/port 不在此处抛错（保持内存降级路径始终可启动），由就绪门禁/连接工厂拦截声明可用。
 * - 连接不采用无限重连：本机可选依赖失败即分类降级，不把 Redis 错误冒泡为请求失败（D2）。
 */

/** 启用 Redis 所必需的连接参数（缺失时拒绝声明可用）。 */
export const REQUIRED_REDIS_PARAMS = ['REDIS_HOST', 'REDIS_PORT'] as const

/** Redis 连接键前缀命名空间，隔离本应用键并便于本机排障。 */
export const REDIS_KEY_PREFIX = 'aiproj:'

/** 限流器 redis store 键前缀。 */
export const REDIS_LIMITER_KEY_PREFIX = 'aiproj:limiter:'

/**
 * Redis 是否显式启用（唯一启停入口，默认关闭）。
 * 与 `config/limiter.ts`、连接工厂、健康检查、就绪门禁共用此判定。
 */
export function isRedisEnabled(): boolean {
  return env.get('REDIS_ENABLED', false) === true
}

/**
 * 返回启用 Redis 时缺失的必填连接参数名列表（脱敏，仅参数名）。
 * 空数组表示参数完整。禁止在此返回任何取值。
 */
export function missingRedisParams(): string[] {
  const missing: string[] = []
  if (!env.get('REDIS_HOST')) missing.push('REDIS_HOST')
  if (env.get('REDIS_PORT') === undefined) missing.push('REDIS_PORT')
  return missing
}

/**
 * 低敏连接标识：仅暴露连接类型，禁止 host/port/password/db/连接串。
 * 供健康检查与就绪门禁复用（对齐 D6/D8 字段白名单）。
 */
export function redisLowSensitiveDescription(): string {
  return 'Redis (single-node)'
}

const redisConfig = defineConfig({
  connection: 'main',

  connections: {
    /**
     * 单节点主连接。默认参数（localhost:6379）仅在启用且未显式配置时兜底，
     * 未启用时该连接永不被访问（工厂返回内存实现），故不会产生外部依赖。
     */
    main: {
      host: env.get('REDIS_HOST', 'localhost'),
      port: env.get('REDIS_PORT', 6379),
      password: env.get('REDIS_PASSWORD'),
      db: env.get('REDIS_DB', 0),
      // 不在连接层设 keyPrefix：各消费者（限流器/缓存/探针）显式管理各自命名空间，
      // 避免与限流器 store 的 keyPrefix 叠加。共享前缀常量 REDIS_KEY_PREFIX。
      tls: env.get('REDIS_TLS', false) ? {} : undefined,
      connectTimeout: env.get('REDIS_CONNECT_TIMEOUT', 10_000),
      maxRetriesPerRequest: env.get('REDIS_MAX_RETRIES', 1),
      // 有限重连：超过上限即返回 null 停止重连，交由工厂降级到内存实现。
      retryStrategy(times: number) {
        const max = env.get('REDIS_MAX_RETRIES', 1)
        if (times > max) return null
        return Math.min(times * 200, 2000)
      },
    },
  },
})

export default redisConfig

declare module '@adonisjs/redis/types' {
  export interface RedisConnections extends InferConnections<typeof redisConfig> {}
}
