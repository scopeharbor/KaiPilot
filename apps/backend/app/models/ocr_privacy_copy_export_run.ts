/**
 * OCR 隐私复制/导出运行记录模型（v3-ocr-privacy-policy-controls §3.4）
 *
 * 存储用户确认执行的复制/导出操作运行记录：
 * - runKey 提供幂等性
 * - previewHash 验证预览未过期
 * - status 跟踪运行生命周期
 * - 计数与哈希（低敏，不含完整 OCR 文本）
 */
import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { OcrPrivacyWarningCode } from '@aiproj/types'

export default class OcrPrivacyCopyExportRun extends BaseModel {
  static table = 'ocr_privacy_copy_export_runs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare runKey: string

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare sourceScopeKind: string

  @column()
  declare purpose: string

  @column()
  declare format: string

  @column()
  declare previewHash: string

  @column()
  declare policyHash: string

  @column()
  declare status: string

  @column()
  declare outputMode: string

  @column()
  declare recordCount: number

  @column()
  declare characterCount: number

  @column()
  declare pageCount: number

  @column({
    prepare: (v: string[]) => JSON.stringify(v),
    consume: (v: unknown): string[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as string[]
    },
    serialize: (v: unknown) => v,
  })
  declare contentHashes: string[]

  @column({
    prepare: (v: OcrPrivacyWarningCode[]) => JSON.stringify(v),
    consume: (v: unknown): OcrPrivacyWarningCode[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as OcrPrivacyWarningCode[]
    },
    serialize: (v: unknown) => v,
  })
  declare warningCodes: OcrPrivacyWarningCode[]

  @column()
  declare confirmedBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
