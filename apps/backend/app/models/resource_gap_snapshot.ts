import { BaseModel } from '@adonisjs/lucid/orm'
import { column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Organization from './organization.js'
import User from './user.js'

/**
 * ResourceGapSnapshot —— 资源缺口分析缓存快照模型（v3-resource-gap-analysis §6.2 / §11.2）。
 *
 * 红线：
 *   - payload 仅存低敏字段（gapId/severity/dimension/metric/gapHours/reasons）
 *   - 禁止存储 PII、原始 evidence、prompt、模型输出
 *   - 源签名 + 授权指纹实现缓存失效
 */
export default class ResourceGapSnapshot extends BaseModel {
  static table = 'resource_gap_snapshots'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare actorId: number

  @column()
  declare cacheKey: string

  @column({
    prepare: (value: Record<string, unknown>) => JSON.stringify(value),
    consume: (value: string) => (value ? JSON.parse(value) : null),
  })
  declare payload: Record<string, unknown>

  @column()
  declare sourceSignature: string

  @column()
  declare authFingerprint: string

  @column()
  declare metricVersion: string

  @column()
  declare ttlSeconds: number

  @column()
  declare degraded: boolean

  @column()
  declare degradedReasons: string | null

  @column.dateTime()
  declare calculatedAt: DateTime

  @column.dateTime()
  declare expiresAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => User, { foreignKey: 'actorId' })
  declare actor: BelongsTo<typeof User>
}
