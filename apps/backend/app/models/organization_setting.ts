import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * 组织设置模型：存储组织级的键值对设置。
 * 用于 ASR 授权开关、功能开关等组织级配置。
 */
export default class OrganizationSetting extends BaseModel {
  static table = 'organization_settings'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare key: string

  @column()
  declare value: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
