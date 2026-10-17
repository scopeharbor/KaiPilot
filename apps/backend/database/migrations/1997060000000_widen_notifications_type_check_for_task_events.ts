import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * 迁移：扩容 `notifications.type` CHECK 白名单，加入任务协同事件。
 *
 * 背景（2026-09-25 企业团队演练）：任务受阻 / 完成 / 排期调整 / 前置未完成即开工需要通知
 * 项目经理与负责人；另外 `external_link_status_changed` 早已在代码里使用却不在白名单内。
 * 未放宽前这些插入全部被 CHECK 拒绝，且被通知旁路的 catch 吞掉，表现为「从来没有通知」。
 *
 * SQLite 不支持 ALTER CHECK：读取 sqlite_master 中现有建表语句，只替换白名单后
 * 「新建 + 拷贝 + 换名」，再按原语句重建索引（表结构以线上实际 DDL 为准，不在此硬编码列清单，
 * 避免漏掉后续迁移加的列如 hidden_at）。PostgreSQL 以 DROP/ADD CONSTRAINT 处理。
 */

const BASE_TYPES = [
  'task_assigned',
  'task_unassigned',
  'comment_added',
  'attachment_added',
  'project_archived',
  'project_restored',
  'milestone_due',
  'milestone_overdue',
  'ai_draft_confirmed',
  'ai_draft_imported',
  'report_exported',
  'report_export_failed',
  'general',
]

const ADDED_TYPES = [
  'external_link_status_changed',
  'task_blocked',
  'task_completed',
  'task_schedule_changed',
  'task_predecessor_pending',
]

const quoteList = (types: string[]) => `(${types.map((t) => `'${t}'`).join(',')})`
const OLD_LIST = quoteList(BASE_TYPES)
const NEW_LIST = quoteList([...BASE_TYPES, ...ADDED_TYPES])

function isSqlite(dialect: string): boolean {
  return dialect === 'sqlite3' || dialect === 'better-sqlite3'
}

/** PostgreSQL 语句序列（导出供单测断言）。 */
export function notificationsTypeCheckPgStatements(direction: 'up' | 'down'): string[] {
  const list = direction === 'up' ? NEW_LIST : OLD_LIST
  return [
    ...(direction === 'down'
      ? [`DELETE FROM notifications WHERE type IN ${quoteList(ADDED_TYPES)}`]
      : []),
    'ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check',
    `ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ${list})`,
  ]
}

/** 把建表语句中的 type 白名单从 from 换成 to（导出供单测断言）。 */
export function swapNotificationsTypeList(createSql: string, from: string, to: string): string {
  const compact = (s: string) => s.replace(/\s+/g, '')
  // knex 生成的 SQLite 语句形如 check (type IN ('a','b',…))，大小写与空白不固定，按去空白比对定位
  const pattern = /(type\s+in\s*)\(([^)]*)\)/i
  const match = pattern.exec(createSql)
  if (!match || compact(`(${match[2]})`) !== compact(from)) {
    throw new Error('notifications 建表语句中未找到预期的 type 白名单')
  }
  return createSql.replace(pattern, `$1${to}`)
}

export default class extends BaseSchema {
  public static disableTransactions = true

  async up() {
    await this.apply('up')
  }

  async down() {
    await this.apply('down')
  }

  private async apply(direction: 'up' | 'down') {
    const dialect = this.db.dialect.name
    if (!isSqlite(dialect)) {
      for (const statement of notificationsTypeCheckPgStatements(direction)) {
        await this.db.rawQuery(statement)
      }
      return
    }

    const [from, to] = direction === 'up' ? [OLD_LIST, NEW_LIST] : [NEW_LIST, OLD_LIST]
    const tableRow = (await this.db.rawQuery(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notifications'",
    )) as Array<{ sql: string }>
    const indexRows = (await this.db.rawQuery(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notifications' AND sql IS NOT NULL",
    )) as Array<{ sql: string }>
    const createSql = tableRow[0]?.sql
    if (!createSql) throw new Error('notifications 表不存在')
    const columns = (
      (await this.db.rawQuery('PRAGMA table_info(notifications)')) as Array<{ name: string }>
    )
      .map((c) => `\`${c.name}\``)
      .join(', ')
    const newSql = swapNotificationsTypeList(createSql, from, to).replace(
      /create table\s+[`"]?notifications[`"]?/i,
      'CREATE TABLE `notifications__new`',
    )

    await this.db.rawQuery('PRAGMA foreign_keys = OFF')
    await this.db.rawQuery('BEGIN')
    try {
      if (direction === 'down') {
        await this.db.rawQuery(`DELETE FROM notifications WHERE type IN ${quoteList(ADDED_TYPES)}`)
      }
      await this.db.rawQuery(newSql)
      await this.db.rawQuery(
        `INSERT INTO notifications__new (${columns}) SELECT ${columns} FROM notifications`,
      )
      await this.db.rawQuery('DROP TABLE notifications')
      await this.db.rawQuery('ALTER TABLE notifications__new RENAME TO notifications')
      for (const { sql } of indexRows) await this.db.rawQuery(sql)
      await this.db.rawQuery('COMMIT')
    } catch (error) {
      await this.db.rawQuery('ROLLBACK')
      throw error
    } finally {
      await this.db.rawQuery('PRAGMA foreign_keys = ON')
    }
  }
}
