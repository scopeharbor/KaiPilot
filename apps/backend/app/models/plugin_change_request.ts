/**
 * v3-plugin-approval-change-flow —— PluginChangeRequest Model（统一变更请求）。
 *
 * 组织隔离：所有查询经 forOrganization helper 自动附加 organization_id。
 * 状态机：draft / pending-approval / approved / rejected / awaiting-confirmation /
 *        applied / withdrawn / expired / failed（转移表见 @aiproj/types）。
 * 并发控制：rowVersion 乐观锁，所有状态推进必须 CAS（compare-and-swap）。
 * diff_json 为不可变 before/after 低敏摘要；创建后禁止改写。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type {
  PluginChangeCanonicalDiff,
  PluginChangeRequestState,
  PluginChangeKind,
} from '@aiproj/types'

/** JSON 字段序列化器：处理 better-sqlite3 的对象绑定问题（与 AuditLog 一致）。 */
const jsonColumn = () =>
  column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? null : JSON.stringify(value),
    consume: (value: unknown) =>
      value === null || value === undefined
        ? null
        : typeof value === 'string'
          ? (JSON.parse(value) as PluginChangeCanonicalDiff)
          : value,
    serialize: (value: unknown) => value,
  })

export default class PluginChangeRequest extends BaseModel {
  public static table = 'plugin_change_requests'

  @column({ isPrimary: true })
  declare id: number

  // ── Server-owned scope ──
  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  // ── Request identity ──
  @column()
  declare requestUid: string

  // ── Kind & state ──
  @column()
  declare kind: PluginChangeKind

  @column()
  declare state: PluginChangeRequestState

  // ── Target ──
  @column()
  declare pluginId: string

  @column()
  declare requestedBy: string

  @column()
  declare targetRevision: string

  // ── Immutable before/after summary ──
  @jsonColumn()
  declare diffJson: PluginChangeCanonicalDiff

  @column()
  declare diffDigest: string

  @column()
  declare permissionDigest: string

  @column()
  declare compatibilityDigest: string

  // ── Approval policy（SQLite 读回为 0/1，显式双向转换）──
  @column({
    consume: (value: unknown) => (value === null || value === undefined ? false : Boolean(value)),
  })
  declare approvalRequired: boolean

  @column()
  declare approvedBy: string | null

  // ── Active confirm handle ──
  @column()
  declare handleDigest: string | null

  @column()
  declare handleActorRef: string | null

  @column.dateTime()
  declare handleExpiresAt: DateTime | null

  // ── Concurrency & lifecycle ──
  @column()
  declare rowVersion: number

  @column.dateTime()
  declare expiresAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoUpdate: true })
  declare updatedAt: DateTime | null

  /**
   * Scope: 按组织过滤（组织隔离强制入口）。
   */
  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }
}
