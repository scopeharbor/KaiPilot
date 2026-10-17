/**
 * AI Trace Spans —— 细粒度 AI 调用链追踪模型。
 *
 * 组织隔离：所有查询路径必须附加 organization_id 过滤。
 * 低敏：不存 prompt、模型输出、原始载荷、secret、Authorization。
 */

import { BaseModel, column, beforeCreate } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import { createId } from '@paralleldrive/cuid2'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class AiTraceSpan extends BaseModel {
  public static table = 'ai_trace_spans'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare traceId: string

  @column()
  declare spanId: string

  @column()
  declare parentSpanId: string | null

  @column()
  declare spanType: string

  @column.dateTime()
  declare startedAt: DateTime

  @column.dateTime()
  declare endedAt: DateTime | null

  @column()
  declare durationMs: number | null

  @column()
  declare status: string

  @column()
  declare errorKind: string | null

  @column()
  declare errorRef: string | null

  @column()
  declare conversationId: string | null

  @column()
  declare workflowName: string | null

  @column()
  declare isOrphan: boolean

  @column()
  declare orphanBreakReason: string | null

  @column()
  declare selfDurationMs: number | null

  @column()
  declare onCriticalPath: boolean

  @column()
  declare estimatedCost: number | null

  @column()
  declare inputTokens: number | null

  @column()
  declare outputTokens: number | null

  @column(jsonColumn)
  declare metadata: Record<string, unknown> | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ── 组织隔离查询辅助 ──

  /** 按组织隔离查询。所有查询路径必须附加 organization_id。 */
  static forOrganization(organizationId: number) {
    return this.query().where('organization_id', organizationId)
  }

  /** 按 traceId 查询完整调用链。 */
  static forTrace(organizationId: number, traceId: string) {
    return this.query()
      .where('organization_id', organizationId)
      .where('trace_id', traceId)
      .orderBy('started_at', 'asc')
  }

  /** 按 conversationId 查询关联 span。 */
  static forConversation(organizationId: number, conversationId: string) {
    return this.query()
      .where('organization_id', organizationId)
      .where('conversation_id', conversationId)
      .orderBy('started_at', 'asc')
  }

  // ── 生命周期钩子 ──

  @beforeCreate()
  static generateSpanId(model: AiTraceSpan) {
    if (!model.spanId) model.spanId = createId()
  }
}
