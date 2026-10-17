/**
 * v3-unified-ai-budget-and-quota §3.5 — 预算决策 Lucid 模型。
 *
 * 组织隔离约定：所有查询路径必须附加 organization_id 过滤。
 * 低敏：不存 prompt、模型输出、原始载荷、token、secret、Authorization。
 */

import { BaseModel, column, beforeCreate } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class BudgetDecision extends BaseModel {
  static readonly table = 'budget_decisions'

  @column({ isPrimary: true })
  declare id: number

  // ── 归属维度 ──
  @column({ columnName: 'organization_id' })
  declare organizationId: number

  @column({ columnName: 'project_id' })
  declare projectId: number | null

  @column({ columnName: 'user_id' })
  declare userId: number | null

  @column()
  declare capability: string

  @column()
  declare surface: string

  // ── 策略引用 ──
  // serialize 同样要兼容 PostgreSQL json 列驱动已解析的值，否则接口序列化时抛错。
  @column({
    columnName: 'policy_refs',
    serialize: (v: unknown) => (typeof v === 'string' ? JSON.parse(v || '[]') : (v ?? [])),
  })
  declare policyRefs: string[]

  @column({ columnName: 'triggering_scope' })
  declare triggeringScope: string

  @column({ columnName: 'triggering_policy_name' })
  declare triggeringPolicyName: string

  // ── 决策 ──
  @column({ columnName: 'decision_type' })
  declare decisionType: 'preflight' | 'postflight'

  @column()
  declare outcome: 'allow' | 'warn' | 'block' | 'degrade'

  @column({ columnName: 'reason_code' })
  declare reasonCode: string | null

  @column()
  declare reason: string | null

  // ── 窗口 ──
  @column({ columnName: 'window_start', serializeAs: null })
  declare windowStart: DateTime

  @column({ columnName: 'window_end', serializeAs: null })
  declare windowEnd: DateTime

  // ── 用量 ──
  @column({ columnName: 'estimated_cost' })
  declare estimatedCost: number | null

  @column({ columnName: 'actual_cost' })
  declare actualCost: number | null

  @column({ columnName: 'estimated_tokens' })
  declare estimatedTokens: number | null

  @column({ columnName: 'actual_tokens' })
  declare actualTokens: number | null

  @column({ columnName: 'accumulated_cost' })
  declare accumulatedCost: number

  @column({ columnName: 'accumulated_tokens' })
  declare accumulatedTokens: number

  @column()
  declare currency: string

  @column({ columnName: 'cost_status' })
  declare costStatus: string | null

  // ── 幂等与关联 ──
  @column({ columnName: 'idempotency_key' })
  declare idempotencyKey: string

  @column({ columnName: 'ledger_attempt_ref' })
  declare ledgerAttemptRef: string | null

  // ── 降级 ──
  @column({
    serialize: (v: unknown) => (typeof v === 'string' ? (v ? JSON.parse(v) : null) : (v ?? null)),
  })
  declare degradation: Record<string, unknown> | null

  // ── 桥接 ──
  @column({
    serialize: (v: unknown) => (typeof v === 'string' ? (v ? JSON.parse(v) : null) : (v ?? null)),
  })
  declare bridgeRef: Record<string, unknown> | null

  // ── 时间 ──
  @column({ columnName: 'decided_at' })
  declare decidedAt: DateTime

  @column({ columnName: 'created_at', serializeAs: null })
  declare createdAt: DateTime

  @column({ columnName: 'updated_at', serializeAs: null })
  declare updatedAt: DateTime

  // ── 组织隔离查询辅助 ──

  /** 按组织隔离查询。所有查询路径必须附加 organization_id。 */
  static forOrganization(organizationId: number) {
    return this.query().where('organization_id', organizationId)
  }

  /** 按组织 + 能力面查询。 */
  static forCapability(organizationId: number, capability: string) {
    return this.query().where('organization_id', organizationId).where('capability', capability)
  }

  /** 按幂等键查询（防重复扣减）。 */
  static forIdempotencyKey(idempotencyKey: string) {
    return this.query().where('idempotency_key', idempotencyKey).first()
  }

  /** 窗口内累计查询。 */
  static accumulateInWindow(organizationId: number, windowStart: DateTime, windowEnd: DateTime) {
    return this.query()
      .where('organization_id', organizationId)
      .where('window_start', '>=', windowStart.toISO()!)
      .where('window_end', '<=', windowEnd.toISO()!)
  }

  @beforeCreate()
  static setDefaults(model: BudgetDecision) {
    if (!model.createdAt) model.createdAt = DateTime.now()
    if (!model.updatedAt) model.updatedAt = DateTime.now()
  }
}
