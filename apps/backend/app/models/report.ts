import Project from './project.js'
import User from './user.js'
import { beforeFetch, beforeFind, belongsTo, column } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import { BaseModel } from '@adonisjs/lucid/orm'
import type {
  ReportExportFormat,
  ReportFormatConfig,
  ReportGenerateFilters,
  ReportSnapshot,
  ReportTemplate,
} from '@aiproj/types'

/**
 * Report —— `reports` 表模型（preset-project-reports V1 契约）。
 *
 * 组织隔离：本表无 organization_id 列；Service/Policy 通过 join projects
 * 或先校验 `projectExistsInOrg` 落实组织隔离（design D3）。
 * 序列化：config / formatConfig / dataSnapshot 均以 JSON 文本存储；
 * SQLite 无 jsonb，通过 prepare/consume 显式序列化，避免 String vs JSON 抖动。
 */
export default class Report extends BaseModel {
  static table = 'reports'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare projectId: number

  @column()
  declare title: string

  /**
   * V1 模板存储列：直接复用现有 `report_type` 列。
   * 迁移已扩容 CHECK 白名单包含 delay/workload。
   */
  @column({ columnName: 'report_type' })
  declare template: ReportTemplate

  @column({
    columnName: 'config',
    prepare: (value: ReportGenerateFilters | null | undefined) =>
      value === null || value === undefined ? null : JSON.stringify(value),
    consume: (value: string | ReportGenerateFilters | null) => {
      if (value === null || value === undefined) return {}
      return typeof value === 'string' ? JSON.parse(value) : value
    },
  })
  declare config: ReportGenerateFilters

  @column({
    columnName: 'data_snapshot',
    prepare: (value: ReportSnapshot) => JSON.stringify(value),
    consume: (value: string | ReportSnapshot) =>
      typeof value === 'string' ? JSON.parse(value) : value,
  })
  declare dataSnapshot: ReportSnapshot

  @column({
    columnName: 'format_config',
    prepare: (value: ReportFormatConfig | null | undefined) =>
      value === null || value === undefined ? null : JSON.stringify(value),
    consume: (value: string | ReportFormatConfig | null) => {
      if (value === null || value === undefined) return null
      return typeof value === 'string' ? JSON.parse(value) : value
    },
  })
  declare formatConfig: ReportFormatConfig | null

  @column()
  declare fileFormat: ReportExportFormat | null

  @column({ serialize: (_v: string | null) => undefined })
  declare filePath: string | null

  @column.dateTime()
  declare generatedAt: DateTime | null

  @column()
  declare generatedBy: number | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => User, { foreignKey: 'generatedBy' })
  declare generator: BelongsTo<typeof User>

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof Report>) {
    query.whereNull('deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof Report>) {
    query.whereNull('deleted_at')
  }
}
