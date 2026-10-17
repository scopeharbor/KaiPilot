import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/**
 * 一次性恢复码（认证器丢失时的兜底入口）。
 *
 * 只存 sha256 哈希；明文整批生成后仅在那一次响应里返回，服务端此后无从还原。
 * 消费即写 `usedAt`，同一条码不可二次使用。
 */
export default class UserTwoFactorRecoveryCode extends BaseModel {
  static table = 'user_two_factor_recovery_codes'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'user_id' })
  declare userId: number

  @column({ columnName: 'code_hash', serializeAs: null })
  declare codeHash: string

  @column.dateTime({ columnName: 'used_at' })
  declare usedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
