/**
 * v3-global-ai-rate-limiting §3.4 — 限流决策 Lucid 模型。
 *
 * 含组织隔离约定：所有查询自动附加 `organization_id` 过滤。
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { DateTime } from 'luxon'

export default class RateLimitDecision extends BaseModel {
  static table = 'rate_limit_decisions'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'organization_id' })
  declare organizationId: number

  @column({ columnName: 'connection_id' })
  declare connectionId: number | null

  @column({ columnName: 'model_id' })
  declare modelId: number | null

  @column({ columnName: 'actor_id' })
  declare actorId: number | null

  @column({ columnName: 'window_start' })
  declare windowStart: Date

  @column({ columnName: 'window_end' })
  declare windowEnd: Date

  @column()
  declare dimension: 'rpm' | 'tpm'

  @column()
  declare layer: 'connection' | 'model' | 'organization' | 'actor'

  @column()
  declare limit: number | null

  @column({ columnName: 'current_count' })
  declare currentCount: number

  @column({ columnName: 'estimated_delta' })
  declare estimatedDelta: number | null

  @column()
  declare decision: 'allow' | 'throttle' | 'reject'

  @column({ columnName: 'retry_after_seconds' })
  declare retryAfterSeconds: number | null

  @column({ columnName: 'triggering_layer' })
  declare triggeringLayer: 'connection' | 'model' | 'organization' | 'actor' | null

  @column({ columnName: 'idempotency_key' })
  declare idempotencyKey: string

  /**
   * 真实 token 用量（§8.7）。结算前为 null；偏差 = actualTokens - estimatedDelta。
   * 单独一列而不复用 currentCount：后者是决策当时的窗口计数，覆盖它等于毁掉证据。
   */
  @column({ columnName: 'actual_tokens' })
  declare actualTokens: number | null

  /** 结算时刻（§8.7）。非空即已结算——postflight 的幂等判定只看这一列。 */
  @column.dateTime({ columnName: 'settled_at' })
  declare settledAt: DateTime | null

  @column({ columnName: 'created_at' })
  declare createdAt: Date

  @column({ columnName: 'updated_at' })
  declare updatedAt: Date
}
