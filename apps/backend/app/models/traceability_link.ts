/**
 * v2-traceability-source-attribution —— TraceabilityLink Model（task 2.2）。
 *
 * 组织隔离：forOrganization helper。
 * 软删除：deletedAt 不为空表示已逻辑删除。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class TraceabilityLink extends BaseModel {
  public static table = 'traceability_links'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  @column()
  declare sourceEntityType: string

  @column()
  declare sourceEntityId: string

  @column()
  declare targetEntityType: string

  @column()
  declare targetEntityId: string

  @column()
  declare relationType: string

  @column()
  declare direction: string

  @column()
  declare strength: number

  @column()
  declare sourceAttributionId: number | null

  @column()
  declare createdBy: number

  @column.dateTime()
  declare deletedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /** 组织隔离查询 helper。 */
  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }

  /** 按项目查询。 */
  static forProject(orgId: number, projectId: number) {
    return this.forOrganization(orgId).where('project_id', projectId)
  }

  /** 活跃记录（未软删除）。 */
  static active() {
    return this.query().whereNull('deleted_at')
  }
}
