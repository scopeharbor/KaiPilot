import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * preset-project-reports —— 最小兼容迁移：扩容 `reports.report_type` CHECK 白名单，
 * 加入 V1 预设模板 `delay` 与 `workload`。
 *
 * 背景：初版 create_reports_table 的 CHECK 只覆盖 `status/progress/risk/resource/cost/milestone/custom`；
 * V1 白名单需要 `progress/delay/workload/milestone`，其中 `delay`/`workload` 缺失。
 *
 * SQLite 不支持直接 ALTER CHECK，采用「新建 + 拷贝 + 换名」重建表方式；
 * 现有索引、外键与列结构保持不变（DEBT-01 未迁 PG，此处兼容 PG 时以 raw ALTER 处理）。
 */
export default class extends BaseSchema {
  protected tableName = 'reports'

  // 需要手动 PRAGMA foreign_keys=OFF + 表重建（SQLite 不支持在事务内切换外键强制）
  public static disableTransactions = true

  async up() {
    const client = this.db.dialect.name
    if (client === 'sqlite3' || client === 'better-sqlite3') {
      await this.db.rawQuery('PRAGMA foreign_keys = OFF')
      await this.db.rawQuery('BEGIN')
      try {
        await this.db.rawQuery(`
          CREATE TABLE reports__new (
            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            title VARCHAR(255) NOT NULL,
            report_type VARCHAR(20) NOT NULL DEFAULT 'status',
            config JSON NULL,
            data_snapshot JSON NULL,
            format_config JSON NULL,
            generated_at DATETIME NULL,
            generated_by INTEGER NULL,
            file_path VARCHAR(500) NULL,
            file_format VARCHAR(10) NULL,
            deleted_at DATETIME NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NULL,
            CHECK (report_type IN ('status','progress','delay','workload','risk','resource','cost','milestone','custom')),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE SET NULL
          )
        `)
        await this.db.rawQuery(`
          INSERT INTO reports__new (
            id, project_id, title, report_type, config, data_snapshot, format_config,
            generated_at, generated_by, file_path, file_format,
            deleted_at, created_at, updated_at
          )
          SELECT
            id, project_id, title, report_type, config, data_snapshot, format_config,
            generated_at, generated_by, file_path, file_format,
            deleted_at, created_at, updated_at
          FROM reports
        `)
        await this.db.rawQuery('DROP TABLE reports')
        await this.db.rawQuery('ALTER TABLE reports__new RENAME TO reports')
        await this.db.rawQuery(
          'CREATE INDEX reports_project_id_report_type_index ON reports (project_id, report_type)',
        )
        await this.db.rawQuery('CREATE INDEX reports_generated_at_index ON reports (generated_at)')
        await this.db.rawQuery('COMMIT')
      } catch (error) {
        await this.db.rawQuery('ROLLBACK')
        throw error
      } finally {
        await this.db.rawQuery('PRAGMA foreign_keys = ON')
      }
    } else {
      // PostgreSQL 分支（DEBT-01 未来）：ALTER TABLE 替换 CHECK。
      await this.db.rawQuery(`
        ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_report_type_check
      `)
      await this.db.rawQuery(`
        ALTER TABLE reports ADD CONSTRAINT reports_report_type_check
        CHECK (report_type IN ('status','progress','delay','workload','risk','resource','cost','milestone','custom'))
      `)
    }
  }

  async down() {
    const client = this.db.dialect.name
    if (client === 'sqlite3' || client === 'better-sqlite3') {
      await this.db.rawQuery('PRAGMA foreign_keys = OFF')
      await this.db.rawQuery('BEGIN')
      try {
        // 回退：删除新增的两类记录后重建旧 CHECK。
        await this.db.rawQuery("DELETE FROM reports WHERE report_type IN ('delay','workload')")
        await this.db.rawQuery(`
          CREATE TABLE reports__old (
            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            title VARCHAR(255) NOT NULL,
            report_type VARCHAR(20) NOT NULL DEFAULT 'status',
            config JSON NULL,
            data_snapshot JSON NULL,
            format_config JSON NULL,
            generated_at DATETIME NULL,
            generated_by INTEGER NULL,
            file_path VARCHAR(500) NULL,
            file_format VARCHAR(10) NULL,
            deleted_at DATETIME NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NULL,
            CHECK (report_type IN ('status','progress','risk','resource','cost','milestone','custom')),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE SET NULL
          )
        `)
        await this.db.rawQuery(`
          INSERT INTO reports__old
          SELECT
            id, project_id, title, report_type, config, data_snapshot, format_config,
            generated_at, generated_by, file_path, file_format,
            deleted_at, created_at, updated_at
          FROM reports
        `)
        await this.db.rawQuery('DROP TABLE reports')
        await this.db.rawQuery('ALTER TABLE reports__old RENAME TO reports')
        await this.db.rawQuery(
          'CREATE INDEX reports_project_id_report_type_index ON reports (project_id, report_type)',
        )
        await this.db.rawQuery('CREATE INDEX reports_generated_at_index ON reports (generated_at)')
        await this.db.rawQuery('COMMIT')
      } catch (error) {
        await this.db.rawQuery('ROLLBACK')
        throw error
      } finally {
        await this.db.rawQuery('PRAGMA foreign_keys = ON')
      }
    } else {
      await this.db.rawQuery(`
        ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_report_type_check
      `)
      await this.db.rawQuery(`
        ALTER TABLE reports ADD CONSTRAINT reports_report_type_check
        CHECK (report_type IN ('status','progress','risk','resource','cost','milestone','custom'))
      `)
    }
  }
}
