import { DateTime } from 'luxon'
import { BaseModel, column, beforeSave } from '@adonisjs/lucid/orm'
import type { CopilotScope, CopilotSessionStatus, CopilotSessionAttribution } from '@aiproj/types'

/**
 * copilot_sessions Model（v3-copilot-session-persistence-and-history §3.5）。
 *
 * 组织隔离约定：所有查询必须附加 organization_id 过滤。
 * 归属引用以 JSON 存储，读写时需序列化/反序列化。
 */
export default class CopilotSession extends BaseModel {
  static table = 'copilot_sessions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare scope: CopilotScope

  // 列名是 attribution_json，不是属性名推导出的 attribution：
  // 缺了 columnName，Lucid 会往不存在的 `attribution` 列写，
  // 每一次建会话都 `no column named attribution`——回合端点因此全线 500。
  @column({
    columnName: 'attribution_json',
    prepare: (v: CopilotSessionAttribution) => JSON.stringify(v),
    // SQLite 返回字符串；PostgreSQL 的 json 列驱动已解析，无条件 JSON.parse 会抛错。
    consume: (v: unknown) =>
      (typeof v === 'string' ? JSON.parse(v) : v) as CopilotSessionAttribution,
  })
  declare attribution: CopilotSessionAttribution

  @column()
  declare status: CopilotSessionStatus

  @column()
  declare title: string

  @column()
  declare archived: boolean

  @column()
  declare actorId: number

  @column()
  declare sessionId: string

  @column()
  declare idempotencyKey: string

  @column.dateTime()
  declare retentionExpiresAt: DateTime | null

  @column.dateTime()
  declare lastCleanupCheckAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ── Scopes（组织隔离约定）─────────────────────────────────────────────

  static scopeInOrganization(query: any, organizationId: number) {
    query.where('organization_id', organizationId)
  }

  static scopeActive(query: any) {
    query.where('archived', false)
  }

  static scopeByActor(query: any, actorId: number) {
    query.where('actor_id', actorId)
  }

  static scopeByScope(query: any, scope: CopilotScope) {
    query.where('scope', scope)
  }

  static scopeByStatus(query: any, status: CopilotSessionStatus) {
    query.where('status', status)
  }

  // ── Guards ──────────────────────────────────────────────────────────────

  /**
   * 归档为软状态，禁止通过 Model.delete() 删除。
   * 删除必须走 service 层的真实删除逻辑（清除摘要与 source refs）。
   */
  @beforeSave()
  static async guardArchivedStatus(session: CopilotSession) {
    // 只约束**已归档**的会话。原先的条件是 `session.$isPersisted`——对每一条已持久化
    // 会话都生效，于是活跃会话的任何常规更新（追加消息后回写等）只要碰到
    // 允许清单之外的字段就抛错，回合端点直接 500。守卫名与错误文案说的都是
    // 「Archived sessions…」，条件漏了归档判定。
    // 用保存前的持久化值判定，这样「取消归档」本身不会被自己挡住。
    const wasArchived = Boolean(
      (session.$original as Record<string, unknown> | undefined)?.archived,
    )
    if (session.$isPersisted && wasArchived) {
      const dirty = Object.keys(session.$dirty)
      // 归档后只允许修改标题和归档状态
      const allowedFields = new Set([
        'title',
        'archived',
        'status',
        'updated_at',
        'retention_expires_at',
        'last_cleanup_check_at',
      ])
      for (const field of dirty) {
        if (!allowedFields.has(field)) {
          throw new Error(
            'Archived sessions can only be renamed or unarchived. Use service layer for deletion.',
          )
        }
      }
    }
  }
}
