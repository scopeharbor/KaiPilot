import { BaseModel } from '@adonisjs/lucid/orm'
import { column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Organization from './organization.js'
import User from './user.js'

/**
 * 组织级资源容量预测闭环 loop（编排元数据所有者）。
 * 状态机：draft → simulated → selected → handed-off → observing → reviewed → closed，
 * 任意非终态可转 cancelled；row_version 乐观锁。
 */
export default class ResourceCapacityLoop extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column({ columnName: 'owner_user_id' })
  declare ownerUserId: number

  @column()
  declare title: string

  /** 封闭状态（迁移 CHECK 约束）。 */
  @column()
  declare state: string

  /** day / week / month（封闭枚举）。 */
  @column()
  declare granularity: string

  @column({ columnName: 'window_start' })
  declare windowStart: string

  @column({ columnName: 'window_end' })
  declare windowEnd: string

  /** 乐观锁版本。 */
  @column({ columnName: 'row_version' })
  declare rowVersion: number

  @column({ columnName: 'feature_version' })
  declare featureVersion: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => User, { foreignKey: 'ownerUserId' })
  declare owner: BelongsTo<typeof User>
}
