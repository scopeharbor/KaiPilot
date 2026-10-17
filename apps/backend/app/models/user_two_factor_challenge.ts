import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/**
 * 挑战用途。
 * - `verify`：账号已绑定认证器，登录时校验一次性口令/恢复码；
 * - `enroll`：账号尚未绑定，在登录流程里扫码完成首次绑定（enrollment-at-login）。
 */
export type TwoFactorChallengePurpose = 'verify' | 'enroll'

/**
 * 登录第二因子挑战（密码已验证、会话尚未建立的中间态）。
 *
 * 刻意**不复用** `auth_access_tokens`：挑战令牌与 refresh token 同表，一旦任何路径
 * 漏判 token 用途就等于跳过第二因子直接拿会话。独立表让「它不是会话凭证」成为
 * 结构性事实，而不是靠调用方自觉。
 *
 * 只存令牌 sha256；明文仅在密码校验通过那一次响应里返回。
 */
export default class UserTwoFactorChallenge extends BaseModel {
  static table = 'user_two_factor_challenges'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'user_id' })
  declare userId: number

  @column({ columnName: 'token_hash', serializeAs: null })
  declare tokenHash: string

  @column()
  declare purpose: TwoFactorChallengePurpose

  @column()
  declare attempts: number

  @column.dateTime({ columnName: 'expires_at' })
  declare expiresAt: DateTime

  @column.dateTime({ columnName: 'consumed_at' })
  declare consumedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
