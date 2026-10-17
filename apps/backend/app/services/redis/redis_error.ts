/**
 * v2-redis-minimum-runtime-support —— Redis 错误分类（design D6/D8）。
 *
 * 把原始 Redis/ioredis 错误压缩为低敏分类，禁止把 password、完整连接串或原始异常正文
 * 暴露到健康检查、就绪门禁、日志或错误响应。沿用 HealthController.pingDatabase 的范式。
 */
export type RedisErrorCategory = 'connection_refused' | 'auth_failed' | 'timeout' | 'unknown'

/**
 * 将任意错误分类为低敏类别。
 * 仅读取 message 关键词，绝不回传原始文本。
 */
export function classifyRedisError(err: unknown): RedisErrorCategory {
  const raw = err instanceof Error ? (err.message ?? '') : typeof err === 'string' ? err : ''
  const msg = raw.toLowerCase()

  if (
    msg.includes('noauth') ||
    msg.includes('wrongpass') ||
    msg.includes('auth') ||
    msg.includes('authentication')
  ) {
    return 'auth_failed'
  }
  if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('timed out')) {
    return 'timeout'
  }
  if (
    msg.includes('econnrefused') ||
    msg.includes('refused') ||
    msg.includes('enotfound') ||
    msg.includes('econnreset') ||
    msg.includes('ehostunreach') ||
    msg.includes('connection') ||
    msg.includes('closed') ||
    msg.includes('getaddrinfo')
  ) {
    return 'connection_refused'
  }
  return 'unknown'
}

/** 分类到简体中文下一步建议（脱敏，供就绪门禁/命令输出）。 */
export function redisErrorAdvice(category: RedisErrorCategory): string {
  switch (category) {
    case 'connection_refused':
      return '确认本机 Redis 服务已启动且 REDIS_HOST/REDIS_PORT 正确'
    case 'auth_failed':
      return '认证失败：确认所配置的 Redis 认证凭据与实例一致'
    case 'timeout':
      return '确认网络连通与 REDIS_CONNECT_TIMEOUT 设置，Redis 未过载'
    default:
      return '检查后端日志中的分类错误并重试就绪门禁'
  }
}
