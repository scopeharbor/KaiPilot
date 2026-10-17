import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import Project from './project.js'
import type {
  InnovationScheme,
  InnovationSchemeStatus,
  InnovationReviewState,
  InnovationHandoffStatus,
} from '@aiproj/types'

/**
 * TRIZ 创新工作台方案模型（v3-triz-innovation-workbench §2.2）。
 *
 * 一行 = 一个 InnovationScheme（方案篮子）。options/scores/narrative 等存为 JSON payload。
 * payload 仅含低敏 refs/hash/summary/status；组织 + 项目双隔离由查询强制。
 */
export default class TrizInnovationScheme extends BaseModel {
  static table = 'triz_innovation_schemes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare schemeId: string

  @column()
  declare name: string

  @column()
  declare status: InnovationSchemeStatus

  @column()
  declare reviewState: InnovationReviewState

  @column()
  declare schemeHash: string

  @column()
  declare handoffStatus: InnovationHandoffStatus

  @column()
  declare draftSessionRef: string | null

  @column()
  declare idempotencyKey: string | null

  @column({
    prepare: (v: InnovationScheme | null) => (v ? JSON.stringify(v) : '{}'),
    consume: (v: unknown): InnovationScheme => {
      if (!v) return {} as InnovationScheme
      if (typeof v === 'string') return JSON.parse(v) as InnovationScheme
      return v as InnovationScheme
    },
    serialize: (v: unknown) => v,
  })
  declare payload: InnovationScheme

  @column()
  declare createdBy: number

  @column.dateTime()
  declare reviewedAt: DateTime | null

  @column.dateTime()
  declare abandonedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>
}
