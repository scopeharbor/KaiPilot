import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { OcrExtractionProfileStatus, OcrExtractionProfileScope } from '@aiproj/types'

export default class OcrStructuredExtractionProfile extends BaseModel {
  static table = 'ocr_structured_extraction_profiles'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  @column()
  declare name: string

  @column()
  declare scope: OcrExtractionProfileScope

  @column()
  declare status: OcrExtractionProfileStatus

  @column()
  declare schemaKey: string

  @column()
  declare currentVersion: number

  @column()
  declare totalRuns: number

  @column()
  declare description: string | null

  @column()
  declare createdBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
