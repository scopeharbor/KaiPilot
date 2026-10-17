import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Organization from './organization.js'
import User from './user.js'

/**
 * v3-pmo-portfolio-grouping-views —— PMO 组合分组视图持久化 Model。
 *
 * 约束：
 * - 视图配置只保存低敏 query shape（白名单字段），不保存结果/证据。
 * - 系统预设由 seed/代码内置，不落本表。
 * - organization_id 强制组织隔离。
 * - deleted_at 软删除。
 */
export default class PmoGroupingView extends BaseModel {
  static table = 'pmo_grouping_views'

  @column({ isPrimary: true })
  declare id: number

  /** API 暴露的唯一标识（UUID 字符串，不泄露自增 ID）。 */
  @column()
  declare viewId: string

  /** 组织 ID（红线：组织隔离）。 */
  @column()
  declare organizationId: number

  /** 视图范围：system / personal / organization。 */
  @column()
  declare scope: string

  /** 视图创建者（personal 视图的 owner）。 */
  @column()
  declare ownerUserId: number | null

  /** 视图名称。 */
  @column()
  declare name: string

  /** 视图描述。 */
  @column()
  declare description: string | null

  /** 定义版本标识。 */
  @column()
  declare definitionVersion: string

  /** 查询定义（JSON string，低敏 query shape）。 */
  @column()
  declare queryDefinition: string

  /** 是否为个人默认视图（0/1）。 */
  @column()
  declare isDefault: number

  /** 是否为组织默认视图（0/1）。 */
  @column()
  declare isOrgDefault: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @column.dateTime()
  declare deletedAt: DateTime | null

  // ─── Relations ──────────────────────────────────────────────────────────────

  @belongsTo(() => Organization, { foreignKey: 'organizationId' })
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => User, { foreignKey: 'ownerUserId' })
  declare owner: BelongsTo<typeof User>
}
