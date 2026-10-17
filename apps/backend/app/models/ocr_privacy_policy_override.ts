/**
 * OCR 隐私策略覆盖模型（v3-ocr-privacy-policy-controls §3.4）
 *
 * 每条记录代表一个作用域（组织级或组织+项目级）的隐私策略覆盖。
 * policy_json 存储 OcrPrivacyPolicyOverrideRequest 的序列化 JSON。
 * policy_hash 允许确定性检测策略变更。
 */
import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { OcrPrivacyPolicyOverrideRequest } from '@aiproj/types'

export default class OcrPrivacyPolicyOverride extends BaseModel {
  static table = 'ocr_privacy_policy_overrides'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  @column({
    prepare: (v: OcrPrivacyPolicyOverrideRequest) => JSON.stringify(v),
    consume: (v: unknown): OcrPrivacyPolicyOverrideRequest => {
      if (!v) return { categoryRules: [], allowedPurposes: [], globalOutputMode: 'full' }
      if (typeof v === 'string') return JSON.parse(v)
      return v as OcrPrivacyPolicyOverrideRequest
    },
    serialize: (v: unknown) => v,
  })
  declare policyJson: OcrPrivacyPolicyOverrideRequest

  @column()
  declare version: number

  @column()
  declare policyHash: string

  @column()
  declare source: string

  @column()
  declare status: string

  @column()
  declare updatedBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
