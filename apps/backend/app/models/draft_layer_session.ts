/**
 * v2-ai-draft-layer-preview-diff-apply —— DraftLayerSession Model（task 2.5）。
 *
 * 组织隔离：所有查询经 forOrganization helper 自动附加 organization_id。
 */
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import DraftLayerChange from './draft_layer_change.js'
import DraftLayerPreview from './draft_layer_preview.js'
import DraftLayerApplyResult from './draft_layer_apply_result.js'
import type {
  DraftLayerSessionStatus,
  DraftLayerSourceType,
  DraftLayerSessionSummary,
} from '@aiproj/types'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class DraftLayerSession extends BaseModel {
  public static table = 'ai_draft_layer_sessions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare createdByUserId: number

  @column()
  declare sourceType: DraftLayerSourceType

  @column()
  declare compilerRunId: number | null

  @column()
  declare pdmArtifactId: string | null

  @column()
  declare pdmHash: string | null

  @column()
  declare status: DraftLayerSessionStatus

  @column()
  declare version: number

  @column.dateTime()
  declare expiresAt: DateTime | null

  @column(jsonColumn)
  declare summary: DraftLayerSessionSummary | null

  @column(jsonColumn)
  declare metadata: Record<string, unknown> | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @hasMany(() => DraftLayerChange, { foreignKey: 'sessionId' })
  declare changes: HasMany<typeof DraftLayerChange>

  @hasMany(() => DraftLayerPreview, { foreignKey: 'sessionId' })
  declare previews: HasMany<typeof DraftLayerPreview>

  @hasMany(() => DraftLayerApplyResult, { foreignKey: 'sessionId' })
  declare applyResults: HasMany<typeof DraftLayerApplyResult>

  /** 组织隔离查询 helper。 */
  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }
}
