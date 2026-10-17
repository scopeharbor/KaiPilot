import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * basic-comments —— 调整 comments 表结构以匹配 V1 规格。
 *
 * 变更：
 * - 新增 organization_id（必填，组织级数据隔离）
 * - 新增 task_id（可空，任务级评论绑定）
 * - 新增 body、body_format（正文与格式）
 * - 新增 deleted_by（软删除操作者）
 * - 添加索引
 *
 * SQLite 兼容性说明：
 * SQLite 的 ALTER TABLE 仅支持 ADD COLUMN，不支持 ADD CONSTRAINT / DROP COLUMN。
 * 索引通过 CREATE INDEX 独立添加，不在 ALTER TABLE 内内联。
 * 回滚使用原始 SQL，避免 Knex 表重建引发的问题。
 *
 * 历史字段保留但 V1 不使用：
 * - entity_type/entity_id（V1 改用 task_id）
 * - parent_id（V1 扁平评论，V2 候选）
 * - content/content_json（V1 改用 body）
 * - is_internal（V1 不区分对内对外）
 *
 * v2-postgresql-migration-foundation（DEBT-01）：PG 迁移兼容性。
 * SQLite 使用 pragma_table_info 和 PRAGMA 语法；PG 使用 information_schema
 * 和标准 SQL DDL。
 */
export default class extends BaseSchema {
  protected tableName = 'comments'

  async up() {
    const dialect = this.db.dialect.name
    let hasOrgColumn = false

    if (dialect === 'sqlite3') {
      // SQLite：通过 pragma_table_info 检查列是否存在
      hasOrgColumn = await this.db
        .rawQuery(
          "SELECT COUNT(*) AS cnt FROM pragma_table_info('comments') WHERE name='organization_id'",
        )
        .then((r: any) => Number(r[0]?.cnt ?? 0) > 0)
    } else if (dialect === 'postgres') {
      // PG：通过 information_schema 检查列是否存在
      hasOrgColumn = await this.db
        .rawQuery(
          "SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_name='comments' AND column_name='organization_id' AND table_schema='public'",
        )
        .then((r: any) => {
          const rows = r.rows ?? [r[0]]
          return Number(rows[0]?.cnt ?? 0) > 0
        })
    }

    if (!hasOrgColumn) {
      // SQLite: ADD COLUMN — 逐列添加，不在 ALTER TABLE 内加索引或约束
      // PG: ALTER TABLE ADD COLUMN 同样支持逐列添加
      this.schema.alterTable(this.tableName, (table) => {
        table.bigInteger('organization_id').unsigned().notNullable().defaultTo(0)
        table.bigInteger('task_id').unsigned().nullable()
        table.text('body').nullable()
        table.string('body_format', 10).nullable().defaultTo('plain')
        table.bigInteger('deleted_by').unsigned().nullable()
      })

      // 外键（SQLite 需在 ALTER TABLE 外独立添加；PG 可在 ALTER TABLE 内联，这里统一在外部）
      this.schema.alterTable(this.tableName, (table) => {
        table
          .foreign('organization_id')
          .references('id')
          .inTable('organizations')
          .onDelete('CASCADE')
        table.foreign('task_id').references('id').inTable('tasks').onDelete('CASCADE')
        table.foreign('deleted_by').references('id').inTable('users').onDelete('SET NULL')
      })

      // 索引独立创建（SQLite/Knex 在 ALTER TABLE 内创建索引会触发表重建）
      this.schema.raw(
        `CREATE INDEX IF NOT EXISTS comments_org_project_index ON comments (organization_id, project_id)`,
      )
      this.schema.raw(`CREATE INDEX IF NOT EXISTS comments_task_id_index ON comments (task_id)`)

      // CHECK 约束在 PG 下通过 ALTER TABLE 添加
      if (dialect === 'postgres') {
        this.schema.raw(
          `ALTER TABLE comments ADD CONSTRAINT comments_body_format_check CHECK (body_format IN ('plain', 'markdown'))`,
        )
      }
      // SQLite 下 body_format CHECK 约束无法通过 ALTER TABLE ADD CONSTRAINT 添加，
      // 由应用层 Validator 保证，不依赖数据库约束。
    }
  }

  async down() {
    const dialect = this.db.dialect.name

    if (dialect === 'sqlite3') {
      // SQLite 不支持 DROP COLUMN，使用原始 SQL 删除索引
      this.schema.raw('DROP INDEX IF EXISTS comments_org_project_index')
      this.schema.raw('DROP INDEX IF EXISTS comments_task_id_index')
      // 无法在 SQLite 中移除已添加的列或外键，但迁移回滚后数据库会被测试框架重建
      // 此处仅清理索引，列和外键在下次迁移重建时会被覆盖
    } else if (dialect === 'postgres') {
      // PG 支持完整的 DROP COLUMN
      this.schema.alterTable(this.tableName, (table) => {
        table.dropColumns('organization_id', 'task_id', 'body', 'body_format', 'deleted_by')
      })
      // 同时删除外键约束（PG 自动命名）
      this.schema.raw('DROP INDEX IF EXISTS comments_org_project_index')
      this.schema.raw('DROP INDEX IF EXISTS comments_task_id_index')
    }
  }
}
