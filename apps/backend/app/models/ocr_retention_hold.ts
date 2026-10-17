import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type {
  OcrRetentionHoldScopeKind,
  OcrRetentionHoldReasonCode,
  OcrRetentionHoldStatus,
} from '@aiproj/types'
import User from './user.js'

/**
 * OCR 保留 hold 模型（v3-ocr-result-persistence-and-retention §3.4）。
 *
 * 低敏设计：只存 reason_code（枚举）和有限 note（≤200 字符）。
 * scope_hash 是组织+项目+scope 身份的低敏哈希。
 */
export default class OcrRetentionHold extends BaseModel {
  static table = 'ocr_retention_holds'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare scopeKind: OcrRetentionHoldScopeKind

  @column()
  declare scopeHash: string

  @column()
  declare reasonCode: OcrRetentionHoldReasonCode

  @column()
  declare note: string | null

  @column()
  declare status: OcrRetentionHoldStatus

  @column()
  declare setBy: number

  @column.dateTime()
  declare setAt: DateTime

  @column()
  declare releasedBy: number | null

  @column.dateTime()
  declare releasedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User, { foreignKey: 'setBy' })
  declare setter: BelongsTo<typeof User>
}
