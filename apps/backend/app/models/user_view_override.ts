/**
 * UserViewOverride —— `user_view_overrides` 表模型（§2.5 P0）。
 *
 * 存储用户对视图的差量覆盖，不修改共享配置。
 */
import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import CustomView from './custom_view.js'
import User from './user.js'

export default class UserViewOverride extends BaseModel {
  static table = 'user_view_overrides'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare userId: number

  @column()
  declare viewId: number

  @column()
  declare overridePath: string

  @column({
    prepare: (value: unknown) => JSON.stringify(value),
    // SQLite 返回 JSON 字符串；PostgreSQL 的 json 列驱动已解析，无条件 JSON.parse 会抛错。
    // overrideValue 本身可能就是字符串（如 "dark"）：PG 下驱动返回裸字符串 dark，
    // 不是合法 JSON，解析失败即说明它已是解析后的原值，原样返回。
    consume: (value: unknown) => {
      if (typeof value !== 'string') return value
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    },
  })
  declare overrideValue: unknown

  @column({ columnName: 'schema_version' })
  declare schemaVersion: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => CustomView, { foreignKey: 'viewId' })
  declare customView: BelongsTo<typeof CustomView>

  @belongsTo(() => User, { foreignKey: 'userId' })
  declare user: BelongsTo<typeof User>
}
