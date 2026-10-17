/**
 * v3-ocr-provider-observability-cost-controls — OCR provider attempt Lucid 模型。
 *
 * 每次 OCR provider 调用 attempt 的低敏记录。
 * 不存 prompt/output body/API key/Authorization header/full extracted text。
 */

import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type {
  OcrProviderAttemptStatus,
  OcrProviderErrorCategory,
  OcrProviderWarningCode,
  OcrCostStatus,
} from '@aiproj/types'

export default class OcrProviderAttempt extends BaseModel {
  public static readonly table = 'ocr_provider_attempts'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare ocrJobId: number

  @column()
  declare pageId: number | null

  @column()
  declare attemptNumber: number

  @column()
  declare provider: string

  @column()
  declare model: string

  @column()
  declare connectionId: number | null

  @column()
  declare modelId: number | null

  @column()
  declare capabilityMode: string | null

  @column()
  declare status: OcrProviderAttemptStatus

  @column()
  declare latencyMs: number | null

  @column()
  declare inputTokens: number | null

  @column()
  declare outputTokens: number | null

  @column()
  declare totalTokens: number | null

  @column()
  declare cacheReadTokens: number | null

  @column()
  declare cacheWriteTokens: number | null

  @column()
  declare audioTokens: number | null

  @column()
  declare reasoningTokens: number | null

  @column()
  declare contextTokens: number | null

  @column()
  declare estimatedCost: number | null

  @column()
  declare currency: string | null

  @column()
  declare costStatus: OcrCostStatus | null

  @column()
  declare pricingSnapshotId: string | null

  @column()
  declare inputHash: string | null

  @column()
  declare outputRef: string | null

  @column()
  declare outputHash: string | null

  @column()
  declare budgetDecisionRef: string | null

  @column()
  declare rateLimitDecisionRef: string | null

  @column()
  declare errorCategory: OcrProviderErrorCategory

  @column({
    prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
    consume: (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v,
  })
  declare warningCodes: OcrProviderWarningCode[] | null

  @column()
  declare idempotencyKey: string

  @column.dateTime()
  declare occurredAt: DateTime

  // Retention fields
  @column()
  declare retentionLifecycle: string | null

  @column()
  declare retentionSensitivity: string | null

  @column.dateTime()
  declare retentionEligibleAt: DateTime | null

  @column.dateTime()
  declare purgedAt: DateTime | null

  @column()
  declare tombstoneId: number | null

  @column()
  declare retentionPolicyHash: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // Organization isolation scopes
  static filterOrganization(organizationId: number) {
    return this.query().where('organization_id', organizationId)
  }

  static filterProject(organizationId: number, projectId: number) {
    return this.query().where('organization_id', organizationId).where('project_id', projectId)
  }

  static filterJob(organizationId: number, projectId: number, ocrJobId: number) {
    return this.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('ocr_job_id', ocrJobId)
  }
}
