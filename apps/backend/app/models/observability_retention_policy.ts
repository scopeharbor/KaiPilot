import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * ObservabilityRetentionPolicy — 组织级观察数据保留策略覆盖。
 *
 * 每个组织一条记录（organization_id UNIQUE）。
 * 默认系统策略不持久化，此表只存覆盖。
 * policy_hash 允许确定性检测策略变更。
 */
export default class ObservabilityRetentionPolicy extends BaseModel {
  static table = 'observability_retention_policies'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'organization_id' })
  declare organizationId: number

  @column({ columnName: 'categories_json' })
  declare categoriesJson: string

  @column({ columnName: 'policy_hash' })
  declare policyHash: string

  @column()
  declare updatedBy: number | null

  @column({ columnName: 'created_at' })
  declare createdAt: Date

  @column({ columnName: 'updated_at' })
  declare updatedAt: Date | null
}
