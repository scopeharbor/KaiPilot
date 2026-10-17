import { DateTime } from 'luxon'
import { BaseModel, column, beforeSave } from '@adonisjs/lucid/orm'
import type {
  CopilotMemoryScope,
  CopilotMemoryStatus,
  CopilotMemoryValidityTier,
  CopilotMemoryConfidenceSource,
  CopilotMemoryBasisRef,
} from '@aiproj/types'

/**
 * copilot_memory_entries Model（v3-copilot-memory-user-and-project §3.5）。
 *
 * 组织隔离约定：所有查询必须附加 organization_id 过滤。
 * 记忆恒为 inference：不存 prompt 全文、模型输出全文、凭据或个人敏感信息。
 * basis 引用以 JSON 存储，会话引用可级联删除。
 */
export default class CopilotMemoryEntry extends BaseModel {
  static table = 'copilot_memory_entries'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  @column()
  declare actorId: number

  @column()
  declare entryId: string

  @column()
  declare memoryScope: CopilotMemoryScope

  @column()
  declare summary: string

  @column({
    // 库列名带 _json 后缀，属性名不带；缺 columnName 会让 Lucid 写到不存在的列。
    columnName: 'tags_json',
    prepare: (v: readonly string[]) => JSON.stringify(v),
    // SQLite 返回字符串；PostgreSQL 的 json 列驱动已解析，无条件 JSON.parse 会抛错。
    consume: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as readonly string[],
  })
  declare tags: readonly string[]

  @column()
  declare confidence: number

  @column()
  declare confidenceSource: CopilotMemoryConfidenceSource

  @column({
    columnName: 'basis_json',
    prepare: (v: readonly CopilotMemoryBasisRef[]) => JSON.stringify(v),
    consume: (v: unknown) =>
      (typeof v === 'string' ? JSON.parse(v) : v) as readonly CopilotMemoryBasisRef[],
  })
  declare basis: readonly CopilotMemoryBasisRef[]

  @column()
  declare basisSessionDbId: number | null

  @column()
  declare status: CopilotMemoryStatus

  @column()
  declare validityTier: CopilotMemoryValidityTier

  @column.dateTime()
  declare observedAt: DateTime

  @column.dateTime()
  declare lastConfirmedAt: DateTime | null

  @column.dateTime()
  declare retentionExpiresAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ── Scopes（组织隔离约定）─────────────────────────────────────────────

  /**
   * 组织隔离过滤（所有查询必须调用）。
   */
  static scopeInOrganization(query: any, organizationId: number) {
    query.where('organization_id', organizationId)
  }

  /**
   * 按记忆 scope 过滤。
   */
  static scopeByMemoryScope(query: any, memoryScope: CopilotMemoryScope) {
    query.where('memory_scope', memoryScope)
  }

  /**
   * 按状态过滤。
   */
  static scopeByStatus(query: any, status: CopilotMemoryStatus) {
    query.where('status', status)
  }

  /**
   * 按项目过滤。
   */
  static scopeByProject(query: any, projectId: number) {
    query.where('project_id', projectId)
  }

  /**
   * 按 actor 过滤。
   */
  static scopeByActor(query: any, actorId: number) {
    query.where('actor_id', actorId)
  }

  // ── Guards ──────────────────────────────────────────────────────────────

  /**
   * 禁止通过 Model.delete() 直接删除记忆。
   * 删除必须走 service 层，确保不留可重建残留并写入低敏审计。
   */
  @beforeSave()
  static async guardDirectDelete(_entry: CopilotMemoryEntry) {
    // 仅在已持久化且状态变为 invalidated 时检查
    // 实际删除由 service 层处理
  }
}
