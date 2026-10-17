/**
 * v3-plugin-action-preview-boundary —— PluginPilotItem Model（pilot fixture domain）。
 *
 * 仅由核心 pilot adapter 在确认事务中写入；是本 change 唯一允许因插件动作确认而
 * 变化的正式表（「正式表全景 zero-diff」断言的豁免对象，且仅限 confirm 之后）。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class PluginPilotItem extends BaseModel {
  public static table = 'plugin_pilot_items'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  @column()
  declare title: string

  @column()
  declare content: string

  @column()
  declare sourceProposalUid: string | null

  @column()
  declare createdBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoUpdate: true })
  declare updatedAt: DateTime | null

  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }
}
