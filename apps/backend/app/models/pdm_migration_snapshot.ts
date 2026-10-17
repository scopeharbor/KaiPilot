/**
 * v2-pdm-migration-compatibility —— PdmMigrationSnapshot Model（Section 3.5）。
 *
 * 迁移快照。支持回滚：payload 保存快照时点的完整数据。
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

export default class PdmMigrationSnapshot extends BaseModel {
  public static table = 'pdm_migration_snapshots'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare migrationRunId: number

  @column()
  declare snapshotKind: string

  @column()
  declare entityRef: string | null

  @column(jsonColumn)
  declare payload: Record<string, unknown> | null

  @column()
  declare payloadHash: string

  @column()
  declare isRollbackReady: boolean

  @column()
  declare createdByUserId: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
