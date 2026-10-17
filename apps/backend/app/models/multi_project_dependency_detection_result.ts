import { BaseModel } from '@adonisjs/lucid/orm'
import { column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Organization from './organization.js'
import MultiProjectDependencyDetectionRun from './multi_project_dependency_detection_run.js'
import type {
  DetectionRuleId,
  DetectionSeverity,
  DetectionConfidenceBand,
  DetectionResultStatus,
  DetectionWarningCode,
  DetectionRedactionState,
  DetectionAiAdvisory,
} from '@aiproj/types'

export default class MultiProjectDependencyDetectionResult extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare runId: number

  @column()
  declare ruleId: DetectionRuleId

  @column()
  declare severity: DetectionSeverity

  @column()
  declare confidence: DetectionConfidenceBand

  @column()
  declare status: DetectionResultStatus

  @column()
  declare fingerprint: string

  @column()
  declare rationale: string

  @column()
  declare evidenceSummary: string | null

  @column()
  declare evidenceHash: string | null

  @column({
    prepare: (value: string[] | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | null) => (value ? JSON.parse(value) : null),
  })
  declare affectedEndpointHashes: string[] | null

  @column({
    prepare: (value: Record<string, string> | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | null) => (value ? JSON.parse(value) : null),
  })
  declare sourceFreshness: Record<string, string> | null

  @column({
    prepare: (value: DetectionWarningCode[] | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | null) => (value ? JSON.parse(value) : null),
  })
  declare warnings: DetectionWarningCode[] | null

  @column()
  declare redactionState: DetectionRedactionState

  @column()
  declare draftEligible: boolean

  @column()
  declare ignoreReasonHash: string | null

  @column({
    prepare: (value: DetectionAiAdvisory | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | null) => (value ? JSON.parse(value) : null),
  })
  declare aiAdvisory: DetectionAiAdvisory | null

  @column.dateTime()
  declare expiresAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => MultiProjectDependencyDetectionRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof MultiProjectDependencyDetectionRun>
}
