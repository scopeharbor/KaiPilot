/**
 * v2-pdm-migration-compatibility —— PdmMigrationReport Model（Section 3.5）。
 *
 * 迁移报告。通过 migration_run_id 间接关联组织。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class PdmMigrationReport extends BaseModel {
  public static table = 'pdm_migration_reports'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare migrationRunId: number

  @column()
  declare reportType: string

  @column()
  declare severity: string

  @column()
  declare blockingCount: number

  @column()
  declare warningCount: number

  @column()
  declare infoCount: number

  @column(jsonColumn)
  declare payload: Record<string, unknown> | null

  @column.dateTime()
  declare generatedAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
