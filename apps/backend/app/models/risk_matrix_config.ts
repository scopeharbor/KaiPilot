import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Project from './project.js'

export default class RiskMatrixConfig extends BaseModel {
  static table = 'risk_matrix_configs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare probabilityLevels: number

  @column()
  declare impactLevels: number

  /**
   * JSON 列：SQLite 不支持原生 JSON 绑定，
   * 需要 prepare/consume 进行序列化/反序列化。
   */
  @column({
    prepare: (value: unknown) => JSON.stringify(value),
    consume: (value: string) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare zones: Record<string, unknown>[]

  @column()
  declare defaultBasis: string

  @column()
  declare cellLimit: number

  @column()
  declare isActive: boolean

  @column()
  declare createdBy: number | null

  @column()
  declare updatedBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>
}
