import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { CopilotMessageRole, CopilotWarningCode, CopilotDegradedReason } from '@aiproj/types'

/**
 * copilot_messages Model（v3-copilot-session-persistence-and-history §3.5）。
 *
 * 组织隔离约定：所有查询必须附加 organization_id 过滤。
 * 有界低敏摘要：content_summary VARCHAR(1024)，结构性放不下全文。
 * source_refs_json 完整存活，不截断。
 */
export default class CopilotMessage extends BaseModel {
  static table = 'copilot_messages'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare sessionDbId: number

  @column()
  declare organizationId: number

  @column()
  declare sessionId: string

  @column()
  declare messageId: string

  @column()
  declare role: CopilotMessageRole

  @column()
  declare contentSummary: string

  @column()
  declare truncated: boolean

  @column({
    // 库列名带 _json 后缀，属性名不带；缺 columnName 会让 Lucid 写到不存在的列。
    columnName: 'source_refs_json',
    prepare: (v: readonly string[]) => JSON.stringify(v),
    // SQLite 返回字符串；PostgreSQL 的 json 列驱动已解析，无条件 JSON.parse 会抛错。
    consume: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as string[],
  })
  declare sourceRefs: string[]

  @column()
  declare routeDecisionId: string | null

  @column()
  declare actionId: string | null

  @column({
    columnName: 'warning_codes_json',
    prepare: (v: readonly CopilotWarningCode[]) => JSON.stringify(v),
    consume: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as CopilotWarningCode[],
  })
  declare warningCodes: CopilotWarningCode[]

  @column()
  declare degradedReason: CopilotDegradedReason | null

  @column()
  declare costLedgerRef: string | null

  @column()
  declare sequence: number

  @column()
  declare idempotencyKey: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // ── Scopes（组织隔离约定）─────────────────────────────────────────────

  static scopeInOrganization(query: any, organizationId: number) {
    query.where('organization_id', organizationId)
  }

  static scopeBySession(query: any, sessionDbId: number) {
    query.where('session_db_id', sessionDbId)
  }

  static scopeBySessionId(query: any, sessionId: string) {
    query.where('session_id', sessionId)
  }

  static scopeOrdered(query: any) {
    query.orderBy('sequence', 'asc')
  }
}
