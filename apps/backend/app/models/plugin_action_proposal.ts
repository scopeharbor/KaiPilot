/**
 * v3-plugin-action-preview-boundary —— PluginActionProposal Model。
 *
 * 组织隔离：所有查询经 forOrganization helper 自动附加 organization_id。
 * 一次性句柄：handle_value + handle_consumed_at；消费必须走 CAS（row_version）。
 * applied_receipt_json 在 apply 成功后固化，支撑幂等重放返回同一 receipt。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type {
  PluginActionPreview,
  PluginActionProposal,
  PluginActionSourceRef,
  PluginActionResultStatus,
} from '@aiproj/types'

/** JSON 字段序列化器（与 AuditLog/PluginChangeRequest 一致）。 */
const jsonColumn = <T>() =>
  column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? null : JSON.stringify(value),
    consume: (value: unknown) =>
      value === null || value === undefined
        ? null
        : typeof value === 'string'
          ? (JSON.parse(value) as T)
          : value,
    serialize: (value: unknown) => value,
  })

export type PluginActionRowStatus =
  'proposed' | 'previewed' | 'rejected' | 'discarded' | 'applied' | 'stale'

export interface PluginActionAppliedReceipt {
  proposalId: string
  status: 'applied' | 'modified'
  idempotencyKey: string
  writtenRefs: readonly string[]
  auditLogId: number
  auditCreatedAt: string
  appliedAt: string
}

export default class PluginActionProposalModel extends BaseModel {
  public static table = 'plugin_action_proposals'

  @column({ isPrimary: true })
  declare id: number

  // ── Server-owned scope ──
  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  // ── Identity ──
  @column()
  declare proposalUid: string

  @column()
  declare schemaVersion: string

  @column()
  declare actionKind: string

  // ── Lifecycle ──
  @column()
  declare status: PluginActionRowStatus

  // ── Bounded canonical input & source refs ──
  @jsonColumn<Record<string, unknown>>()
  declare inputPayload: Record<string, unknown>

  @jsonColumn<readonly PluginActionSourceRef[]>()
  declare sourceRefs: readonly PluginActionSourceRef[]

  @column()
  declare proposedBy: number | null

  // ── Preview ──
  @jsonColumn<PluginActionPreview>()
  declare previewJson: PluginActionPreview | null

  @column()
  declare previewDigest: string | null

  @column.dateTime()
  declare previewExpiresAt: DateTime | null

  @column()
  declare targetRevision: string | null

  // ── Idempotency ──
  @column()
  declare idempotencyKey: string | null

  // ── One-time confirm handle ──
  @column()
  declare handleValue: string | null

  @column()
  declare handleActorUserId: number | null

  @column.dateTime()
  declare handleExpiresAt: DateTime | null

  @column.dateTime()
  declare handleConsumedAt: DateTime | null

  // ── Result ──
  @column()
  declare resultStatus: PluginActionResultStatus | null

  @jsonColumn<PluginActionAppliedReceipt>()
  declare appliedReceiptJson: PluginActionAppliedReceipt | null

  @column.dateTime()
  declare appliedAt: DateTime | null

  // ── Concurrency & lifecycle ──
  @column()
  declare rowVersion: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoUpdate: true })
  declare updatedAt: DateTime | null

  /** Scope: 按组织过滤（组织隔离强制入口；跨组织查询恒为空 → 404 非泄露）。 */
  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }

  /** 行数据 → 契约 proposal envelope（不含行级状态）。 */
  toEnvelope(): PluginActionProposal {
    return {
      schemaVersion: this.schemaVersion as PluginActionProposal['schemaVersion'],
      actionKind: this.actionKind as PluginActionProposal['actionKind'],
      scope: { organizationId: this.organizationId, projectId: this.projectId },
      inputPayload: this.inputPayload,
      sourceRefs: this.sourceRefs,
      createdAt: this.createdAt.toISO() ?? undefined,
    }
  }
}
