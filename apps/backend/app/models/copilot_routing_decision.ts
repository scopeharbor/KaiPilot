/**
 * v3-copilot-routing-decision-ledger（任务 3.5）—— CopilotRoutingDecisionModel。
 *
 * Copilot 路由决策账本模型。组织隔离：所有查询经 organization_id 过滤。
 * 禁存原始用户输入全文（只存归一化意图摘要）。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class CopilotRoutingDecisionModel extends BaseModel {
  public static table = 'copilot_routing_decisions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare recordId: string

  @column()
  declare catalogVersion: string

  @column()
  declare intentClass: string | null

  @column()
  declare subIntentId: string | null

  @column()
  declare intentSummary: string

  @column(jsonColumn)
  declare destinationOrder: string[]

  @column(jsonColumn)
  declare confidences: number[]

  @column()
  declare clarificationRoundCount: number

  @column()
  declare ambiguous: boolean

  @column(jsonColumn)
  declare unavailabilityKinds: string[]

  @column()
  declare ruleHitCount: number

  @column()
  declare fallbackCount: number

  @column()
  declare scope: string

  // ── 改道分类（账本增量字段）──

  @column()
  declare userDestination: string | null

  @column()
  declare redirectClass: string

  @column()
  declare attributionConfidence: string

  // ── 输入元组 hash 与幂等键 ──

  @column()
  declare inputTupleHash: string

  @column()
  declare idempotencyKey: string

  // ── trace 引用 ──

  @column()
  declare traceId: string | null

  // ── 时间戳 ──

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  /** 组织隔离查询 helper。 */
  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }
}
