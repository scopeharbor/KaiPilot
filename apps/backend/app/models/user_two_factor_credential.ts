import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/** 凭据状态：`pending` = 已生成密钥待确认；`active` = 已生效，登录必须过第二因子。 */
export type TwoFactorCredentialStatus = 'pending' | 'active'

/**
 * 用户 TOTP 凭据（与用户 1:1）。
 *
 * `secretEncrypted` 是 `TwoFactorSecretCipher` 的 AES-256-GCM 密文，模型层不解密——
 * 解密只发生在 `TwoFactorService` 内，且明文密钥绝不进入序列化输出。
 */
export default class UserTwoFactorCredential extends BaseModel {
  static table = 'user_two_factor_credentials'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'user_id' })
  declare userId: number

  @column()
  declare status: TwoFactorCredentialStatus

  /** 密文，永不序列化到 API 响应。 */
  @column({ columnName: 'secret_encrypted', serializeAs: null })
  declare secretEncrypted: string

  /**
   * 「更换认证器」在途密钥（密文）。已生效的绑定期间扫新二维码时先写这里，
   * 确认成功才提升为 `secretEncrypted`——中途放弃或输错都不影响旧认证器继续可用。
   */
  @column({ columnName: 'pending_secret_encrypted', serializeAs: null })
  declare pendingSecretEncrypted: string | null

  @column.dateTime({ columnName: 'pending_started_at' })
  declare pendingStartedAt: DateTime | null

  @column()
  declare algorithm: string

  @column()
  declare digits: number

  @column()
  declare period: number

  @column()
  declare label: string | null

  @column.dateTime({ columnName: 'confirmed_at' })
  declare confirmedAt: DateTime | null

  @column.dateTime({ columnName: 'last_used_at' })
  declare lastUsedAt: DateTime | null

  /** 最近一次成功验证命中的 TOTP 时间步，用于同步口令重放防护。 */
  @column({ columnName: 'last_used_step' })
  declare lastUsedStep: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  get isActive(): boolean {
    return this.status === 'active'
  }
}
