/**
 * v2-pdm-migration-compatibility —— PdmMigrationRun Model（Section 3.5）。
 *
 * 迁移运行态。组织隔离：所有查询经 `forOrganization` helper 自动附加 organization_id。
 */
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import PdmEntityMapping from './pdm_entity_mapping.js'
import PdmMigrationSnapshot from './pdm_migration_snapshot.js'
import PdmMigrationReport from './pdm_migration_report.js'
import type { MigrationRunStatus } from '#services/pdm_migration/types'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class PdmMigrationRun extends BaseModel {
  public static table = 'pdm_migration_runs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare requestedByUserId: number

  @column()
  declare status: MigrationRunStatus

  @column()
  declare currentPhase: string | null

  @column(jsonColumn)
  declare scopeJson: Record<string, unknown> | null

  @column(jsonColumn)
  declare countsJson: Record<string, unknown> | null

  @column()
  declare latestReportId: number | null

  @column()
  declare errorSummary: string | null

  @column()
  declare rollbackInfo: string | null

  @column.dateTime()
  declare startedAt: DateTime | null

  @column.dateTime()
  declare completedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @hasMany(() => PdmEntityMapping, { foreignKey: 'migrationRunId' })
  declare mappings: HasMany<typeof PdmEntityMapping>

  @hasMany(() => PdmMigrationSnapshot, { foreignKey: 'migrationRunId' })
  declare snapshots: HasMany<typeof PdmMigrationSnapshot>

  @hasMany(() => PdmMigrationReport, { foreignKey: 'migrationRunId' })
  declare reports: HasMany<typeof PdmMigrationReport>

  /** 组织隔离查询 helper。 */
  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }
}
