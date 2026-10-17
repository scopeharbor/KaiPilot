import { NotificationSchema } from '#database/schema'
import User from './user.js'
import Organization from './organization.js'
import Project from './project.js'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'

/**
 * 通知模型（基于 NotificationSchema 基类）。
 *
 * 通知是接收人私有资源，核心访问路径为 recipient_id + organization_id。
 * 目标引用使用多态 target_type/target_id，支持任务、里程碑、报表等多种类型。
 *
 * V2 扩展（v2-notification-center）：
 * - hiddenAt：用户隐藏通知时间戳（可空），用于通知中心忽略/隐藏功能
 */
export default class Notification extends NotificationSchema {
  /** 接收用户。 */
  @belongsTo(() => User, { foreignKey: 'recipientId' })
  declare recipient: BelongsTo<typeof User>

  /** 所属组织。 */
  @belongsTo(() => Organization, { foreignKey: 'organizationId' })
  declare organization: BelongsTo<typeof Organization>

  /** 可选关联项目（用于权限过滤）。 */
  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  /**
   * 附加信息（JSON）。显式序列化：PG 驱动会把对象自动转成 jsonb，SQLite 不会——
   * 幂等重发时更新已有通知会报「SQLite3 can only bind numbers, strings…」（个人版导出冒烟发现）。
   */
  @column({
    prepare: (value: Record<string, unknown> | null) =>
      value === null || value === undefined ? null : JSON.stringify(value),
    consume: (value: string | Record<string, unknown> | null) =>
      typeof value === 'string' ? JSON.parse(value) : value,
  })
  declare metadata: Record<string, unknown> | null

  /** 隐藏/忽略时间戳（V2 通知中心新增）。 */
  @column.dateTime({ autoCreate: false })
  declare hiddenAt: DateTime | null
}
