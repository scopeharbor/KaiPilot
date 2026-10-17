/**
 * v3-plugin-permission-audit-and-observation —— PluginPermissionDecision Model（task 3.3）。
 *
 * Append-only Lucid model：禁止 update/delete 作为普通业务操作。
 * 组织隔离：所有查询经 forOrganization helper 自动附加 organization_id。
 * server-owned scope 列仅用于过滤与访问控制。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/**
 * JSON 字段序列化器：与 AuditLog 一致，处理 better-sqlite3 的对象绑定问题。
 */
const jsonColumn = () =>
  column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? null : JSON.stringify(value),
    consume: (value: unknown) =>
      value === null || value === undefined
        ? null
        : typeof value === 'string'
          ? JSON.parse(value)
          : value,
    serialize: (value: unknown) => value,
  })

export default class PluginPermissionDecision extends BaseModel {
  public static table = 'plugin_permission_decisions'

  @column({ isPrimary: true })
  declare id: number

  // ── Server-owned scope（仅用于过滤与访问控制） ──
  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  // ── Decision identity ──
  @column()
  declare decisionId: string

  @column()
  declare inputFingerprint: string

  // ── Mode / Operation / Outcome ──
  @column()
  declare mode: string

  @column()
  declare operation: string

  @column()
  declare outcome: string

  // ── Reasons ──
  @column()
  declare primaryReason: string

  @jsonColumn()
  declare reasonCodes: string[]

  // ── Low-sensitive refs ──
  @jsonColumn()
  declare permissionRefs: string[] | null

  @column()
  declare seamRef: string | null

  @column()
  declare manifestDigestRef: string | null

  @column()
  declare grantDigestRef: string | null

  @column()
  declare installRef: string | null

  // ── Scope / Actor / Plugin hash refs ──
  @column()
  declare actorRefHash: string

  @column()
  declare pluginRefHash: string | null

  @column()
  declare contributionRefHash: string | null

  // ── Correlation / Idempotency ──
  @column()
  declare correlationRef: string | null

  @column()
  declare idempotencyRef: string | null

  // ── Audit receipt ──
  @column()
  declare auditLogId: number | null

  @column()
  declare auditSchemaVersion: string | null

  // ── Metadata ──
  @column()
  declare latencyBucket: string | null

  @column()
  declare schemaVersion: string

  // ── Timestamps ──
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // ── Append-only guards ──
  async delete(): Promise<void> {
    throw new Error('plugin_permission_decisions immutable: delete forbidden')
  }

  async save(): Promise<this> {
    if (this.$isPersisted) {
      throw new Error('plugin_permission_decisions immutable: update forbidden')
    }
    return super.save()
  }

  /**
   * Scope: only return decisions for a given organization.
   * 所有查询必须经过此 helper，确保组织隔离。
   */
  static forOrganization(query: ReturnType<typeof PluginPermissionDecision.query>, orgId: number) {
    return query.where('organizationId', orgId)
  }
}
