/**
 * v2-redis-minimum-runtime-support —— Redis 连接生命周期 Provider（design D1/D2, task 1.4）。
 *
 * 职责：应用就绪阶段，若 REDIS_ENABLED=true，则对单节点 `main` 连接做一次探活，
 * 更新运行期可达性标记（供可用性工厂）。不可达时只记录分类错误并保持后端可启动，
 * 禁止因 Redis 不可达导致进程崩溃或默认请求整体失败。
 *
 * 未启用时不建立任何连接（零外部依赖）。@adonisjs/redis 的连接是惰性的，
 * 本 provider 是唯一在启动阶段主动触碰连接的入口，且完全消化异常。
 */
import type { ApplicationService } from '@adonisjs/core/types'
import logger from '@adonisjs/core/services/logger'
import { isRedisEnabled } from '#config/redis'

export default class RedisRuntimeProvider {
  constructor(protected app: ApplicationService) {}

  async ready() {
    if (!isRedisEnabled()) {
      logger.info('Redis 未启用（REDIS_ENABLED 未开），限流与缓存走单节点内存实现')
      return
    }

    // 惰性加载探活逻辑，避免在未启用路径加载连接管理。
    const { pingRedis } = await import('#services/redis/redis_connection')
    const result = await pingRedis(5000)

    if (result.reachable) {
      logger.info(
        { latencyMs: result.latencyMs },
        'Redis 已启用并连接成功（单节点），限流器/缓存可选使用 Redis',
      )
    } else {
      // 分类错误，不含 host/password/连接串/原始正文；保持后端可启动，能力回退内存。
      logger.warn(
        { error: result.error },
        'Redis 已启用但连接不可达，已回退单节点内存实现；后端继续启动',
      )
    }
  }
}
