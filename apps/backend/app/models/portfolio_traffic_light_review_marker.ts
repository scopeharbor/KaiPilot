/**
 * v3-pmo-portfolio-traffic-light —— PortfolioTrafficLightReviewMarker Lucid Model。
 *
 * 组织级 PMO 交通灯复核标记实体。每条记录对应一个项目的最新复核状态。
 * 所有查询强制附加 organization_id 过滤（组织隔离红线）。
 * 复核标记仅存储复核元数据，不修改项目、任务、风险、资源等事实。
 */
import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Organization from './organization.js'
import User from './user.js'
import Project from './project.js'
import type { TrafficLightReviewState } from '@aiproj/types'

export default class PortfolioTrafficLightReviewMarker extends BaseModel {
  public static table = 'portfolio_traffic_light_review_markers'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organization_id: number

  @column()
  declare project_id: number

  @column()
  declare actor_id: number

  @column()
  declare review_state: TrafficLightReviewState

  @column()
  declare note: string | null

  @column()
  declare rule_version: string

  @column()
  declare input_signature_hash: string

  @column()
  declare previous_review_state: TrafficLightReviewState | null

  @column()
  declare stale: boolean

  @column.dateTime({ autoCreate: true })
  declare created_at: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updated_at: DateTime

  // ─── Relations ─────────────────────────────────────────────────────────────────

  @belongsTo(() => Organization, { foreignKey: 'organization_id' })
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => User, { foreignKey: 'actor_id' })
  declare actor: BelongsTo<typeof User>

  @belongsTo(() => Project, { foreignKey: 'project_id' })
  declare project: BelongsTo<typeof Project>
}
