import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-collaboration-comments-mentions —— V2 评论表扩展迁移。
 *
 * 在 V1 basic-comments（entity_type/entity_id/parent_id/body/body_format/
 * edited_at/deleted_at 已有）基础上新增：
 * - status（open/resolved）
 * - resolved_by（解决操作者）
 * - resolved_at（解决时间）
 *
 * V1 已有但 V2 正式启用的字段：
 * - entity_type、entity_id（V1 保留未用，V2 统一实体评论启用）
 * - parent_id（V1 保留未用，V2 一级回复启用）
 *
 * 兼容性：
 * - 保留 task_id 可空（V1 任务级评论向下兼容）
 * - 保留 content/content_json/is_internal 历史字段（不做数据迁移）
 * - 所有新字段允许 NULL，不破坏已有数据
 */
export default class extends BaseSchema {
  protected tableName = 'comments'

  async up() {
    const dialect = this.db.dialect.name

    // 检查 status 列是否存在（幂等）
    const hasStatus = await this.hasColumn(dialect, 'status')
    if (!hasStatus) {
      this.schema.alterTable(this.tableName, (table) => {
        // 评论状态：open / resolved
        table.string('status', 20).nullable().defaultTo('open')
        // 解决操作者
        table.bigInteger('resolved_by').unsigned().nullable()
        // 解决时间
        table.timestamp('resolved_at').nullable()
      })

      // 外键
      this.schema.alterTable(this.tableName, (table) => {
        table.foreign('resolved_by').references('id').inTable('users').onDelete('SET NULL')
      })

      // 索引
      this.schema.raw(
        `CREATE INDEX IF NOT EXISTS comments_entity_type_entity_id_index ON comments (entity_type, entity_id)`,
      )
      this.schema.raw(`CREATE INDEX IF NOT EXISTS comments_parent_id_index ON comments (parent_id)`)
      this.schema.raw(`CREATE INDEX IF NOT EXISTS comments_status_index ON comments (status)`)
    }

    // 补充 V1 未保证的默认值
    if (dialect === 'sqlite3') {
      // SQLite：通过 pragma_table_info 检查 entity_type 是否有值
      await this.db.rawQuery(
        "UPDATE comments SET entity_type = CASE WHEN task_id IS NOT NULL THEN 'task' ELSE 'project' END WHERE entity_type IS NULL",
      )
    } else if (dialect === 'postgres') {
      await this.db.rawQuery(
        "UPDATE comments SET entity_type = CASE WHEN task_id IS NOT NULL THEN 'task' ELSE 'project' END WHERE entity_type IS NULL",
      )
    }
  }

  async down() {
    const dialect = this.db.dialect.name

    if (dialect === 'sqlite3') {
      // SQLite 不支持 DROP COLUMN，只删除索引
      this.schema.raw('DROP INDEX IF EXISTS comments_entity_type_entity_id_index')
      this.schema.raw('DROP INDEX IF EXISTS comments_parent_id_index')
      this.schema.raw('DROP INDEX IF EXISTS comments_status_index')
    } else if (dialect === 'postgres') {
      this.schema.alterTable(this.tableName, (table) => {
        table.dropColumns('status', 'resolved_by', 'resolved_at')
      })
      this.schema.raw('DROP INDEX IF EXISTS comments_entity_type_entity_id_index')
      this.schema.raw('DROP INDEX IF EXISTS comments_parent_id_index')
      this.schema.raw('DROP INDEX IF EXISTS comments_status_index')
    }
  }

  private async hasColumn(dialect: string, column: string): Promise<boolean> {
    if (dialect === 'sqlite3') {
      const r = await this.db
        .rawQuery(
          `SELECT COUNT(*) AS cnt FROM pragma_table_info('${this.tableName}') WHERE name='${column}'`,
        )
        .then((rows: any) => Number(rows[0]?.cnt ?? 0) > 0)
      return r
    }
    if (dialect === 'postgres') {
      const r = await this.db
        .rawQuery(
          `SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_name='${this.tableName}' AND column_name='${column}' AND table_schema='public'`,
        )
        .then((result: any) => {
          const rows = result.rows ?? [result[0]]
          return Number(rows[0]?.cnt ?? 0) > 0
        })
      return r
    }
    return false
  }
}
