import Project from './project.js'
import User from './user.js'
import { DateTime } from 'luxon'
import { BaseModel, beforeFetch, beforeFind, belongsTo, column } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type { CustomViewBaseType, CustomViewConfig, CustomViewVisibility } from '@aiproj/types'

/**
 * CustomView —— `custom_views` 表模型（v2-custom-views-view-config）。
 *
 * 配置 JSON 白名单校验在 Validator/Service 层，模型仅负责序列化。
 * 软删除：所有列表查询默认过滤 deleted_at IS NULL。
 * 默认视图唯一性：由 Service 层在同用户同项目范围内保证。
 */
export default class CustomView extends BaseModel {
  static table = 'custom_views'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare ownerUserId: number

  @column()
  declare name: string

  @column({ columnName: 'base_view_type' })
  declare baseViewType: CustomViewBaseType

  @column()
  declare visibility: CustomViewVisibility

  @column({
    columnName: 'config_json',
    serializeAs: 'config',
    prepare: (value: CustomViewConfig) => JSON.stringify(value),
    consume: (value: string | CustomViewConfig) => {
      if (typeof value === 'string') return JSON.parse(value) as CustomViewConfig
      return value
    },
  })
  declare configJson: CustomViewConfig

  @column({ columnName: 'schema_version' })
  declare schemaVersion: number

  @column()
  declare position: number

  @column({
    columnName: 'is_default',
    prepare: (value: boolean) => (value ? 1 : 0),
    consume: (value: number | boolean) => value === true || value === 1,
  })
  declare isDefault: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => User, { foreignKey: 'ownerUserId' })
  declare owner: BelongsTo<typeof User>

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof CustomView>) {
    query.whereNull('deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof CustomView>) {
    query.whereNull('deleted_at')
  }
}
