/**
 * v2-redis-minimum-runtime-support —— 限流器 store 策略（design D4, task 3.3）。
 *
 * 限流语义（SEC-03 登录失败锁定 / SEC-10 认证端点速率限制）静默降级会造成安全预期与实际不符，
 * 故 `LIMITER_STORE=redis` 但 Redis 未启用时必须在启动/配置阶段失败，而非静默回退内存。
 *
 * 纯函数，便于单元测试；config/limiter.ts 在模块加载（boot）阶段调用，失败即中止启动。
 */
export type LimiterStore = 'memory' | 'redis'

/**
 * 解析生效限流 store，并在非法组合时抛出清晰错误（不含任何密钥）。
 * - memory（默认）：始终允许。
 * - redis：仅当 redisEnabled 为 true 时允许；否则抛错。
 */
export function resolveLimiterStore(limiterStore: string, redisEnabled: boolean): LimiterStore {
  if (limiterStore === 'redis') {
    if (!redisEnabled) {
      throw new Error(
        'LIMITER_STORE=redis 需要 REDIS_ENABLED=true。' +
          '请启用 Redis，或将 LIMITER_STORE 设为 memory。' +
          '（限流语义禁止静默回退内存，以免 SEC-03/SEC-10 安全预期与实际不符）',
      )
    }
    return 'redis'
  }
  return 'memory'
}
