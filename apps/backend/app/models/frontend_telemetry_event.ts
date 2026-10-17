/**
 * v3-ai-quality-cost-console-deferred-p1 —— FrontendTelemetryEvent 模型。
 *
 * 前端 AI 使用事件持久化：只含事件种类、会话 ID、类别与计数字段。
 * 组织隔离：全部查询附加 organization_id 过滤。
 *
 * @aiproj/backend
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class FrontendTelemetryEvent extends BaseModel {
  static table = 'frontend_telemetry_events'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'organization_id' })
  declare organizationId: number

  @column({ columnName: 'session_id' })
  declare sessionId: string

  @column({ columnName: 'event_kind' })
  declare eventKind: string

  /**
   * 事件发生时间（ISO 8601 字符串直存）。
   * 窗口查询按 ISO 字符串字典序比较，存 ISO 才能保证比较正确（SQLite 文本比较）。
   */
  @column({ columnName: 'occurred_at' })
  declare occurredAt: string

  @column({ columnName: 'has_submitted' })
  declare hasSubmitted: boolean | null

  @column({ columnName: 'turn_count' })
  declare turnCount: number | null

  @column({ columnName: 'intent_class' })
  declare intentClass: string | null

  @column({ columnName: 'chip_id' })
  declare chipId: string | null

  @column({ columnName: 'chip_source' })
  declare chipSource: string | null

  @column({ columnName: 'action_id' })
  declare actionId: string | null

  @column({ columnName: 'action_label' })
  declare actionLabel: string | null

  @column({ columnName: 'created_at' })
  declare createdAt: Date
}
