/**
 * v3-ocr-provider-observability-cost-controls — OCR 预算决策 Lucid 模型。
 *
 * 组织/项目/作业维度的预算 preflight/postflight 判定记录。
 */

import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type {
  OcrBudgetDecisionStatus,
  OcrBudgetScope,
  OcrBudgetSoftLimitAction,
  OcrProviderWarningCode,
} from '@aiproj/types'

export default class OcrProviderBudgetDecision extends BaseModel {
  public static readonly table = 'ocr_provider_budget_decisions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare ocrJobId: number | null

  @column()
  declare pageId: number | null

  @column()
  declare scope: OcrBudgetScope

  @column()
  declare status: OcrBudgetDecisionStatus

  @column()
  declare estimatedCost: number | null

  @column()
  declare currency: string | null

  @column()
  declare budgetLimit: number | null

  @column()
  declare budgetUsed: number | null

  @column()
  declare softLimitAction: OcrBudgetSoftLimitAction | null

  @column({
    prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
    consume: (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v,
  })
  declare warningCodes: OcrProviderWarningCode[] | null

  @column()
  declare idempotencyKey: string

  @column({
    prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
    consume: (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v,
  })
  declare metadata: Record<string, unknown> | null

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
}
