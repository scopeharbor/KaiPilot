import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type { OcrTargetKind, OcrMatchReason, OcrEntityLinkLifecycleStatus } from '@aiproj/types'
import User from './user.js'
import OcrEntityLinkRun from './ocr_entity_link_run.js'
import OcrEntityLinkCandidate from './ocr_entity_link_candidate.js'

export default class OcrEntityLinkConfirmedLink extends BaseModel {
  static table = 'ocr_entity_link_confirmed_links'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare runId: number

  @column()
  declare candidateId: number

  @column()
  declare extractionId: number

  @column()
  declare sourceHash: string

  @column()
  declare selectedTextHash: string

  @column()
  declare spanHash: string

  @column()
  declare targetKind: OcrTargetKind

  @column()
  declare targetId: number

  @column()
  declare normalizedLabel: string

  @column()
  declare confidence: number

  @column()
  declare matchReason: OcrMatchReason

  @column()
  declare ruleVersion: string

  @column()
  declare reviewerId: number

  @column()
  declare lifecycleStatus: OcrEntityLinkLifecycleStatus

  @column()
  declare confirmationHash: string

  @column()
  declare supersededById: number | null

  @column()
  declare supersedeReason: string | null

  @column()
  declare auditRef: string | null

  @column.dateTime()
  declare confirmedAt: DateTime

  @column.dateTime()
  declare supersededAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => OcrEntityLinkRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof OcrEntityLinkRun>

  @belongsTo(() => OcrEntityLinkCandidate, { foreignKey: 'candidateId' })
  declare candidate: BelongsTo<typeof OcrEntityLinkCandidate>

  @belongsTo(() => User, { foreignKey: 'reviewerId' })
  declare reviewer: BelongsTo<typeof User>

  @belongsTo(() => OcrEntityLinkConfirmedLink, { foreignKey: 'supersededById' })
  declare supersededBy: BelongsTo<typeof OcrEntityLinkConfirmedLink>
}
