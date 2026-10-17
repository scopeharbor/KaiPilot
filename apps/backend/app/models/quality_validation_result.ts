import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class QualityValidationResult extends BaseModel {
  public static table = 'quality_validation_results'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare artifactRef: string

  @column()
  declare capabilitySurface: string

  @column()
  declare validatorCategory: string

  @column()
  declare validatorVersion: string

  @column(jsonColumn)
  declare checkResults: Array<{
    checkId: string
    hit: boolean
    severity: string
    locationRef: string | null
    contentHash: string | null
    message: string
  }>

  @column(jsonColumn)
  declare hitCheckIds: string[]

  @column()
  declare confidenceScore: number

  @column()
  declare overallRiskLevel: string

  @column()
  declare canConfirm: boolean

  @column(jsonColumn)
  declare autoFixTrace: {
    attemptedCount: number
    successCount: number
    stillFailingAfterFix: boolean
  } | null

  @column(jsonColumn)
  declare sanitizedReport: Array<{
    checkId: string
    hit: boolean
    severity: string
    locationRef: string | null
    contentHash: string | null
  }>

  @column()
  declare idempotencyKey: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
