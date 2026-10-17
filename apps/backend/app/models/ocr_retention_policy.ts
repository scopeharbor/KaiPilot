import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { OcrRetentionCategoryPolicy } from '@aiproj/types'

/**
 * OCR 保留策略模型（v3-ocr-result-persistence-and-retention §3.4）。
 *
 * 每条记录代表一个作用域（组织或组织+项目）的保留策略覆盖。
 * categories_json 存储 OcrRetentionCategoryPolicy[]。
 * policy_hash 允许确定性检测策略变更。
 */
export default class OcrRetentionPolicy extends BaseModel {
  static table = 'ocr_retention_policies'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  @column({
    prepare: (v: OcrRetentionCategoryPolicy[]) => JSON.stringify(v),
    consume: (v: unknown): OcrRetentionCategoryPolicy[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as OcrRetentionCategoryPolicy[]
    },
    serialize: (v: unknown) => v,
  })
  declare categoriesJson: OcrRetentionCategoryPolicy[]

  @column()
  declare policyHash: string

  @column()
  declare source: 'organization' | 'project'

  @column()
  declare updatedBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
