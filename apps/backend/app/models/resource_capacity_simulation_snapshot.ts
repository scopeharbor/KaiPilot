import { BaseModel } from '@adonisjs/lucid/orm'
import { column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import ResourceCapacityScenario from './resource_capacity_scenario.js'

/** 不可变模拟快照：确定性引擎输出 + digest；stale_state 标记 TOCTOU 失效。 */
export default class ResourceCapacitySimulationSnapshot extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column({ columnName: 'scenario_id' })
  declare scenarioId: number

  @column({ columnName: 'loop_id' })
  declare loopId: number

  @column({ columnName: 'engine_version' })
  declare engineVersion: string

  @column({ columnName: 'scenario_revision' })
  declare scenarioRevision: number

  @column({
    prepare: (value: unknown[]) => JSON.stringify(value),
    consume: (value: string) => (value ? JSON.parse(value) : []),
  })
  declare rowsJson: unknown[]

  // SQLite 无 decimal 列型，按仓库既有做法以字符串承载小时数（两位小数）。
  @column({ columnName: 'gap_delta_hours' })
  declare gapDeltaHours: string

  @column({ columnName: 'contention_delta_count' })
  declare contentionDeltaCount: number

  @column({ columnName: 'confidence_band' })
  declare confidenceBand: 'high' | 'medium' | 'low'

  @column({
    prepare: (value: unknown[]) => JSON.stringify(value),
    consume: (value: string) => (value ? JSON.parse(value) : []),
  })
  declare warningsJson: unknown[]

  @column({ columnName: 'simulation_digest' })
  declare simulationDigest: string

  @column({ columnName: 'stale_state' })
  declare staleState: 'current' | 'stale'

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => ResourceCapacityScenario, { foreignKey: 'scenarioId' })
  declare scenario: BelongsTo<typeof ResourceCapacityScenario>
}
