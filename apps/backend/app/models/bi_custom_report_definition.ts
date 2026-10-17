/**
 * BiCustomReportDefinition model —— 自定义 BI 报表定义。
 *
 * v3-bi-custom-report-builder §3.1
 */
import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
// JSON 列直接绑定 @aiproj/types 契约类型：避免读回时全靠 as 断言掩盖契约缺口
import type {
  BiCustomReportDataSourceRef,
  BiCustomReportFieldKey,
  BiCustomReportFilter,
  BiCustomReportGroup,
  BiCustomReportLayout,
  BiCustomReportScope,
  BiCustomReportSort,
  BiCustomReportVisibility,
  BiCustomReportVisualization,
  BiCustomReportWarning,
} from '@aiproj/types'
import Organization from './organization.js'

export default class BiCustomReportDefinition extends BaseModel {
  static table = 'bi_custom_report_definitions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare definitionId: string

  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  @column()
  declare portfolioId: number | null

  @column()
  declare scope: BiCustomReportScope

  @column()
  declare visibility: BiCustomReportVisibility

  @column()
  declare ownerActorId: number

  @column()
  declare version: number

  @column()
  declare definitionHash: string

  @column()
  declare title: string

  @column()
  declare description: string | null

  @column({
    consume: (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value),
    prepare: (value: unknown) => JSON.stringify(value),
  })
  declare dataSources: BiCustomReportDataSourceRef[]

  @column({
    consume: (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value),
    prepare: (value: unknown) => JSON.stringify(value),
  })
  declare fields: BiCustomReportFieldKey[]

  @column({
    consume: (value: unknown) =>
      value === null ? null : typeof value === 'string' ? JSON.parse(value) : value,
    prepare: (value: unknown) => (value === null ? null : JSON.stringify(value)),
  })
  declare filters: BiCustomReportFilter[] | null

  @column({
    consume: (value: unknown) =>
      value === null ? null : typeof value === 'string' ? JSON.parse(value) : value,
    prepare: (value: unknown) => (value === null ? null : JSON.stringify(value)),
  })
  declare groups: BiCustomReportGroup[] | null

  @column({
    consume: (value: unknown) =>
      value === null ? null : typeof value === 'string' ? JSON.parse(value) : value,
    prepare: (value: unknown) => (value === null ? null : JSON.stringify(value)),
  })
  declare sorts: BiCustomReportSort[] | null

  @column({
    consume: (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value),
    prepare: (value: unknown) => JSON.stringify(value),
  })
  declare visualizations: BiCustomReportVisualization[]

  @column({
    consume: (value: unknown) =>
      value === null ? null : typeof value === 'string' ? JSON.parse(value) : value,
    prepare: (value: unknown) => (value === null ? null : JSON.stringify(value)),
  })
  declare layout: BiCustomReportLayout | null

  @column({
    consume: (value: unknown) =>
      value === null ? null : typeof value === 'string' ? JSON.parse(value) : value,
    prepare: (value: unknown) => (value === null ? null : JSON.stringify(value)),
  })
  declare warnings: BiCustomReportWarning[] | null

  @column()
  declare isDefault: boolean

  @column.dateTime()
  declare archivedAt: DateTime | null

  @column()
  declare createdBy: number

  @column()
  declare updatedBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Organization, { foreignKey: 'organizationId' })
  declare organization: BelongsTo<typeof Organization>
}
