/**
 * BiCustomReportVersion model —— 自定义 BI 报表定义版本历史。
 *
 * v3-bi-custom-report-builder §3.1
 */
import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class BiCustomReportVersion extends BaseModel {
  static table = 'bi_custom_report_versions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare definitionId: string

  @column()
  declare organizationId: number

  @column()
  declare version: number

  @column()
  declare definitionHash: string

  @column()
  declare title: string

  @column({
    consume: (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value),
    prepare: (value: unknown) => JSON.stringify(value),
  })
  declare snapshot: Record<string, unknown>

  @column()
  declare changeSummary: string | null

  @column()
  declare updatedBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
