import limiter from '@adonisjs/limiter/services/main'

/**
 * 第二因子尝试节流（OWASP MFA：Apply strict attempt limits）。
 *
 * 与 `LoginThrottleService` 分开计数，因为防的是**不同攻击**：登录锁定防的是猜密码，
 * 这里防的是「已经拿到密码、开始暴力猜 6 位码」。6 位码只有 10^6 种，且校验窗口
 * ±1 步意味着任一时刻有 3 个码有效——不限速的话在线爆破是完全可行的。
 *
 * 单个挑战票据自身还有 `MAX_CHALLENGE_ATTEMPTS` 上限，但攻击者可以反复用密码换新票据
 * 绕过它；本服务按 **用户 + IP** 计数，覆盖跨票据的重试，是那道上限的补充而非替代。
 */
export default class TwoFactorThrottleService {
  /** 计数窗口内允许的最大失败次数。 */
  static readonly MAX_ATTEMPTS = 10

  /** 计数与锁定窗口。 */
  static readonly WINDOW = '15 mins'

  private store = limiter.use({
    requests: TwoFactorThrottleService.MAX_ATTEMPTS,
    duration: TwoFactorThrottleService.WINDOW,
    blockDuration: TwoFactorThrottleService.WINDOW,
  })

  /**
   * 计数键：用户 ID + 客户端 IP。
   *
   * 同时带上两者：只按 IP 会让同一办公网出口的同事互相拖累；只按用户则允许
   * 攻击者换 IP 无限重试同一账号——但那仍受该用户自身计数约束，所以组合键
   * 在「防爆破」与「不误伤」之间是合适的折中。
   */
  key(userId: number, ip: string): string {
    return `2fa:${userId}:${ip}`
  }

  /** 当前用户+IP 是否已被锁定。 */
  async isThrottled(userId: number, ip: string): Promise<boolean> {
    return this.store.isBlocked(this.key(userId, ip))
  }

  /** 记录一次失败；达到阈值即锁定整个窗口。 */
  async recordFailure(userId: number, ip: string): Promise<void> {
    const key = this.key(userId, ip)
    const result = await this.store.increment(key)
    if (result.remaining <= 0) {
      await this.store.block(key, TwoFactorThrottleService.WINDOW)
    }
  }

  /** 验证成功后清空计数——正常用户偶尔输错不该累积成锁定。 */
  async clear(userId: number, ip: string): Promise<void> {
    await this.store.delete(this.key(userId, ip))
  }
}
