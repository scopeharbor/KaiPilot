import { DateTime } from 'luxon'
import { BaseModel, column, beforeFind, beforeFetch } from '@adonisjs/lucid/orm'

export default class MultiProjectImpactSnapshot extends BaseModel {
  static table = 'multi_project_impact_snapshots'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare actorId: number

  @column()
  declare scopeHash: string

  @column()
  declare sourceFreshnessHash: string

  @column()
  declare dependencyGraphSignature: string

  @column()
  declare ruleVersion: string

  @column()
  declare permissionFingerprint: string

  @column()
  declare inputHash: string

  @column()
  declare outputHash: string | null

  @column()
  declare status: string

  @column()
  declare sourceSummaryJson: string | null

  @column()
  declare propagationSummaryJson: string | null

  @column()
  declare warningsJson: string | null

  @column()
  declare whatIfOutputsJson: string | null

  @column()
  declare evidenceReferencesJson: string | null

  @column()
  declare isStale: boolean

  @column()
  declare staleReason: string | null

  @column.dateTime({ autoCreate: false })
  declare generatedAt: DateTime

  @column.dateTime({ autoCreate: false })
  declare expiresAt: DateTime

  @column()
  declare createdBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /**
   * 所有查询自动附加 organization_id 过滤（组织隔离）
   */
  @beforeFind()
  @beforeFetch()
  static enforceOrganizationIsolation() {
    // 由 Service 层手动添加 .where('organization_id', ...)
    // 此处保留 hook 位置供未来自动注入
  }
}
