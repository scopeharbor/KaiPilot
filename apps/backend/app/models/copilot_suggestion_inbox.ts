import { DateTime } from 'luxon'
import { BaseModel, column, beforeSave } from '@adonisjs/lucid/orm'
import type {
  InboxEntryState,
  InboxProblemKind,
  InboxSeverity,
  InboxExpiryReasonKind,
  InboxDedupeKey,
  InboxSourceRef,
} from '@aiproj/types'

/**
 * copilot_suggestion_inbox Model（v3-copilot-suggestion-inbox §3.4）。
 *
 * 组织隔离约定：所有查询必须附加 organization_id 过滤。
 * 只存状态与去重元数据，**不存建议正文**。
 * 内容按引用回源读取，权限沿用来源自身模型。
 */
export default class CopilotSuggestionInbox extends BaseModel {
  static table = 'copilot_suggestion_inbox'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare state: InboxEntryState

  @column()
  declare problemKind: InboxProblemKind

  @column()
  declare severity: InboxSeverity

  @column({
    // 库列名带 _json 后缀，属性名不带；缺 columnName 会让 Lucid 写到不存在的列。
    columnName: 'dedupe_key_json',
    prepare: (v: InboxDedupeKey) => JSON.stringify(v),
    // SQLite 返回字符串；PostgreSQL 的 json 列驱动已解析为对象，
    // 无条件 JSON.parse 会抛 `"[object Object]" is not valid JSON`，查询接口整条 500。
    consume: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as InboxDedupeKey,
  })
  declare dedupeKey: InboxDedupeKey

  @column({
    columnName: 'source_refs_json',
    prepare: (v: InboxSourceRef[]) => JSON.stringify(v),
    consume: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as InboxSourceRef[],
  })
  declare sourceRefs: InboxSourceRef[]

  @column()
  declare expiryReason: InboxExpiryReasonKind | null

  @column()
  declare expiryDetail: string | null

  @column.dateTime()
  declare readAt: DateTime | null

  @column.dateTime()
  declare actionedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ── Scopes（组织隔离约定）─────────────────────────────────────────────

  static scopeInOrganization(query: any, organizationId: number) {
    query.where('organization_id', organizationId)
  }

  static scopeByProject(query: any, projectId: number) {
    query.where('project_id', projectId)
  }

  static scopeByState(query: any, state: InboxEntryState) {
    query.where('state', state)
  }

  static scopeBySeverity(query: any, severity: InboxSeverity) {
    query.where('severity', severity)
  }

  static scopeByProblemKind(query: any, problemKind: InboxProblemKind) {
    query.where('problem_kind', problemKind)
  }

  // ── Guards ──────────────────────────────────────────────────────────────

  /**
   * 终态守卫：**已经处于**终态（adopted / dismissed / expired）的条目不可再修改状态以外的字段。
   *
   * 判据必须用「保存前的状态」而非 `entry.state`（本次要写入的新状态）。用新状态会与
   * `guardExpiredRequiresReason` 直接矛盾：后者要求 `expired` 必须带 expiryReason，
   * 前者却禁止在同一次保存里写 expiryReason —— 于是 `state='expired'` 永远存不进去，
   * 整条过期链路不可用（实测 refresh 会抛 "Terminal state expired only allows..."）。
   * 改看原状态后，「迁入终态」这一次可以连原因一起写，之后条目才被冻结，
   * 与本守卫注释的原意一致。
   */
  @beforeSave()
  static async guardTerminalState(entry: CopilotSuggestionInbox) {
    if (entry.$isPersisted) {
      const dirty = Object.keys(entry.$dirty)
      const terminalStates = new Set(['adopted', 'dismissed', 'expired'])
      const previousState = (entry.$original as { state?: string }).state
      if (previousState !== undefined && terminalStates.has(previousState)) {
        // $dirty 的键是模型属性名；updated_at 两种写法都列上，避免命名口径差异漏放行。
        const allowedFields = new Set(['state', 'updated_at', 'updatedAt'])
        for (const field of dirty) {
          if (!allowedFields.has(field)) {
            throw new Error(
              `Terminal state "${previousState}" only allows state and updated_at changes.`,
            )
          }
        }
      }
    }
  }

  /**
   * expired 守卫：过期原因必填。
   */
  @beforeSave()
  static async guardExpiredRequiresReason(entry: CopilotSuggestionInbox) {
    if (entry.state === 'expired' && !entry.expiryReason) {
      throw new Error('Expired entries must have an expiryReason.')
    }
  }
}
