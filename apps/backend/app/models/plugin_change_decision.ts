/**
 * v3-plugin-approval-change-flow —— PluginChangeDecision Model（append-only 决策事件）。
 *
 * Append-only Lucid model：禁止 update/delete 作为普通业务操作。
 * 幂等唯一键：(organization_id, decision_uid)，decision_uid 由
 * computeChangeDecisionId(requestId, event, idempotencyKey) 确定性派生。
 * 组织隔离：所有查询经 forOrganization helper 自动附加 organization_id。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type {
  PluginChangeDecisionEventKind,
  PluginChangeErrorCode,
  PluginChangeRequestState,
} from '@aiproj/types'

export default class PluginChangeDecision extends BaseModel {
  public static table = 'plugin_change_decisions'

  @column({ isPrimary: true })
  declare id: number

  // ── Server-owned scope ──
  @column()
  declare organizationId: number

  // ── Request reference ──
  @column()
  declare requestId: number

  // ── Decision identity ──
  @column()
  declare decisionUid: string

  // ── Event ──
  @column()
  declare event: PluginChangeDecisionEventKind

  @column()
  declare actorRef: string

  @column()
  declare idempotencyKey: string

  @column()
  declare fromState: PluginChangeRequestState

  @column()
  declare toState: PluginChangeRequestState

  @column()
  declare reasonCode: PluginChangeErrorCode | null

  // ── Binding 对照 ──
  @column()
  declare diffDigest: string

  // ── Trusted audit receipt ──
  @column()
  declare auditLogId: number | null

  @column.dateTime()
  declare receiptCreatedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // ── Append-only guards ──
  async delete(): Promise<void> {
    throw new Error('plugin_change_decisions immutable: delete forbidden')
  }

  async save(): Promise<this> {
    if (this.$isPersisted) {
      throw new Error('plugin_change_decisions immutable: update forbidden')
    }
    return super.save()
  }

  /**
   * Scope: 按组织过滤（组织隔离强制入口）。
   */
  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }
}
