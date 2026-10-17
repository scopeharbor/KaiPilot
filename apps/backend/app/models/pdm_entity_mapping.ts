/**
 * v2-pdm-migration-compatibility —— PdmEntityMapping Model（Section 3.5）。
 *
 * V1 ↔ PDM 实体映射。唯一约束确保同一来源不重复。
 * 组织隔离：通过 organization_id 列 + `forOrganization` helper。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class PdmEntityMapping extends BaseModel {
  public static table = 'pdm_entity_mappings'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare sourceKind: string

  @column()
  declare sourceTable: string

  @column()
  declare sourceId: number

  @column()
  declare sourceHash: string

  @column()
  declare pdmEntityType: string | null

  @column()
  declare pdmEntityId: string | null

  @column()
  declare migrationRunId: number

  @column()
  declare status: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /** 组织隔离查询 helper。 */
  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }
}
