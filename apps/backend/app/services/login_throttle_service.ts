import limiter from '@adonisjs/limiter/services/main'

/**
 * 登录失败锁定（SEC-03，design D6）。
 *
 * 同一 email+IP 连续失败 5 次即锁定 30 分钟；锁定期内即便凭证正确也拒绝。
 * 用限流器承载（天然带 TTL + 滑窗），不在 users 表加计数列。
 */
export default class LoginThrottleService {
  /**
   * 允许的最大失败次数
   */
  static readonly MAX_ATTEMPTS = 5

  /**
   * 锁定与计数窗口（30 分钟）
   */
  static readonly WINDOW = '30 mins'

  private store = limiter.use({
    requests: LoginThrottleService.MAX_ATTEMPTS,
    duration: LoginThrottleService.WINDOW,
    blockDuration: LoginThrottleService.WINDOW,
  })

  /**
   * 计数键：邮箱（规范化小写）+ 客户端 IP。
   */
  key(email: string, ip: string): string {
    return `login:${email.toLowerCase()}:${ip}`
  }

  /**
   * 当前 email+IP 是否处于锁定期。
   */
  async isLocked(email: string, ip: string): Promise<boolean> {
    return this.store.isBlocked(this.key(email, ip))
  }

  /**
   * 记录一次登录失败；达到阈值即锁定 30 分钟。
   */
  async recordFailure(email: string, ip: string): Promise<void> {
    const key = this.key(email, ip)
    const res = await this.store.increment(key)
    if (res.remaining <= 0) {
      await this.store.block(key, LoginThrottleService.WINDOW)
    }
  }

  /**
   * 登录成功后清空失败计数。
   */
  async clear(email: string, ip: string): Promise<void> {
    await this.store.delete(this.key(email, ip))
  }
}
