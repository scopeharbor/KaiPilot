/**
 * v3-chart-gallery-data-foundation —— ProjectCharter Model（W1.4）。
 *
 * 项目章程实体：字段结构对齐 AI 草案 charter 规范（title/vision/scope/objectives/
 * success_criteria/start_date/end_date），并承载审批治理生命周期。
 *
 * - objectives / successCriteria：字符串数组 JSON（prepare/consume 序列化）
 * - approvalStatus 状态机：draft → pending_approval → approved / rejected
 * - 已 approved 章程禁止直接修改（服务层校验）；version 由服务层在升版时递增
 */
import { BaseModel, beforeFetch, beforeFind, belongsTo, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Project from './project.js'
import User from './user.js'

/** 章程审批状态机枚举 */
export type ProjectCharterApprovalStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class ProjectCharter extends BaseModel {
  public static table = 'project_charters'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare title: string

  @column()
  declare vision: string

  @column()
  declare scope: string

  /** 关键可衡量目标列表（JSON 字符串数组）。 */
  @column(jsonColumn)
  declare objectives: string[]

  /** 成功验收准则列表（JSON 字符串数组）。 */
  @column(jsonColumn)
  declare successCriteria: string[]

  @column.date()
  declare startDate: DateTime

  @column.date()
  declare endDate: DateTime

  @column()
  declare businessCase: string | null

  @column()
  declare approvalStatus: ProjectCharterApprovalStatus

  /** 审批人（approve 决议时写入）。 */
  @column()
  declare approvedBy: number | null

  /** 审批生效时间戳。 */
  @column.dateTime()
  declare approvedAt: DateTime | null

  /** 章程版本号，升版流转时递增。 */
  @column()
  declare version: number

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

  @belongsTo(() => User, { foreignKey: 'approvedBy' })
  declare approver: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'updatedBy' })
  declare updater: BelongsTo<typeof User>

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof ProjectCharter>) {
    query.whereNull('deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof ProjectCharter>) {
    query.whereNull('deleted_at')
  }
}
