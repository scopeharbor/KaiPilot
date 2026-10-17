/**
 * v3-chart-gallery-data-foundation —— CommunicationPlan Model（W1.4）。
 *
 * 项目沟通管理计划实体：规范沟通事件类型、受众、频次、渠道与交付物，
 * 支持与既有周期报表服务联动（reportTemplateKey）。
 *
 * - isActive 启停开关：关闭用软关闭而非物理删除（is_active=false 保留配置）
 * - 责任人 owner（users RESTRICT）；软删除 + 组织隔离
 */
import { BaseModel, beforeFetch, beforeFind, belongsTo, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Project from './project.js'
import User from './user.js'

/** 沟通事件类型 */
export type CommunicationType = 'meeting' | 'report' | 'email' | 'instant_message'

/** 沟通频次 */
export type CommunicationFrequency =
  'daily' | 'weekly' | 'biweekly' | 'monthly' | 'milestone_driven' | 'ad_hoc'

/** 沟通渠道 */
export type CommunicationChannel =
  'in_person' | 'video_conference' | 'email' | 'wechat_work' | 'feishu' | 'pdf_export'

export default class CommunicationPlan extends BaseModel {
  public static table = 'communication_plans'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  /** 沟通事项责任人。 */
  @column()
  declare ownerId: number

  @column()
  declare name: string

  @column()
  declare communicationType: CommunicationType

  @column()
  declare purpose: string

  @column()
  declare frequency: CommunicationFrequency

  @column()
  declare channel: CommunicationChannel

  @column()
  declare audience: string

  @column()
  declare deliverable: string | null

  /** 关联的周期报表模板标识（与报表服务联动，非 FK）。 */
  @column()
  declare reportTemplateKey: string | null

  /** 计划是否生效（启停开关）。SQLite 下 boolean 以 0/1 存取，consume 归一化。 */
  @column({
    prepare: (value: boolean) => value,
    consume: (value: boolean | number) => Boolean(value),
  })
  declare isActive: boolean

  @column()
  declare createdBy: number

  @column()
  declare updatedBy: number | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ── 关联 ──
  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => User, { foreignKey: 'ownerId' })
  declare owner: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'updatedBy' })
  declare updater: BelongsTo<typeof User>

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof CommunicationPlan>) {
    query.whereNull('deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof CommunicationPlan>) {
    query.whereNull('deleted_at')
  }
}
