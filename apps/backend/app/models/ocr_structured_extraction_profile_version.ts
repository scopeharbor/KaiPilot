import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type { OcrExtractionProfileStatus, OcrExtractionProfileSchema } from '@aiproj/types'
import OcrStructuredExtractionProfile from './ocr_structured_extraction_profile.js'

export default class OcrStructuredExtractionProfileVersion extends BaseModel {
  static table = 'ocr_structured_extraction_profile_versions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare profileId: number

  @column()
  declare version: number

  @column()
  declare status: OcrExtractionProfileStatus

  @column({
    prepare: (v: OcrExtractionProfileSchema) => JSON.stringify(v),
    consume: (v: unknown): OcrExtractionProfileSchema => {
      if (typeof v === 'string') return JSON.parse(v)
      return v as OcrExtractionProfileSchema
    },
    serialize: (v: unknown) => v,
  })
  declare schemaDefinitionJson: OcrExtractionProfileSchema

  @column()
  declare createdBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => OcrStructuredExtractionProfile, { foreignKey: 'profileId' })
  declare profile: BelongsTo<typeof OcrStructuredExtractionProfile>
}
