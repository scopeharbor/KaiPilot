import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-ui-next-chart-gallery —— 迁移：扩容 `diagrams.type` CHECK 白名单加入 `fishbone`。
 *
 * 背景：1784300000000 建表时 CHECK 仅覆盖 `wbs_tree/gantt/dependency_graph/critical_path`；
 * 本 change W1 已将共享契约（packages/types DIAGRAM_TYPES）、后端校验器与路由 validator
 * 同步加入 `fishbone`（鱼骨图因果分析），数据库层必须随之放宽，否则插入即被 CHECK 拒绝。
 *
 * SQLite 不支持直接 ALTER CHECK，采用仓库既有「新建 + 拷贝 + 换名」重建表方式
 * （先例：1784500000000_extend_reports_report_type_check）；
 * 表内数据、索引、外键策略保持不变。PostgreSQL 分支以 DROP/ADD CONSTRAINT 处理。
 *
 * SQL 以纯函数导出（先例：1994000000000 WBS 唯一索引迁移），供 vitest 单元测试
 * 直接断言 up/down 两种方言的语句序列。
 */

const OLD_TYPE_LIST = `('wbs_tree','gantt','dependency_graph','critical_path')`
const NEW_TYPE_LIST = `('wbs_tree','gantt','dependency_graph','critical_path','fishbone')`

const DIAGRAMS_DDL = (tableName: string, checkList: string): string => `
CREATE TABLE ${tableName} (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  organization_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  type VARCHAR(30) NOT NULL,
  title VARCHAR(255) NOT NULL,
  spec TEXT NOT NULL,
  source_hash VARCHAR(128) NULL,
  created_by BIGINT NOT NULL,
  updated_by BIGINT NULL,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL,
  CHECK (type IN ${checkList}),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
)
`

const COPY_COLUMNS = [
  'id',
  'organization_id',
  'project_id',
  'type',
  'title',
  'spec',
  'source_hash',
  'created_by',
  'updated_by',
  'deleted_at',
  'created_at',
  'updated_at',
]

const INDEX_STATEMENTS = [
  'CREATE INDEX diagrams_project_id_type_idx_v2 ON diagrams (project_id, type)',
  'CREATE INDEX diagrams_org_project_deleted_idx_v2 ON diagrams (organization_id, project_id, deleted_at)',
]

function isSqlite(dialect: string): boolean {
  return dialect === 'sqlite3' || dialect === 'better-sqlite3'
}

function sqliteStatements(direction: 'up' | 'down'): string[] {
  const columnList = COPY_COLUMNS.join(', ')
  if (direction === 'up') {
    return [
      DIAGRAMS_DDL('diagrams__new', NEW_TYPE_LIST),
      `INSERT INTO diagrams__new (${columnList}) SELECT ${columnList} FROM diagrams`,
      'DROP TABLE diagrams',
      'ALTER TABLE diagrams__new RENAME TO diagrams',
      ...INDEX_STATEMENTS,
    ]
  }
  return [
    "DELETE FROM diagrams WHERE type = 'fishbone'",
    DIAGRAMS_DDL('diagrams__old', OLD_TYPE_LIST),
    `INSERT INTO diagrams__old (${columnList}) SELECT ${columnList} FROM diagrams`,
    'DROP TABLE diagrams',
    'ALTER TABLE diagrams__old RENAME TO diagrams',
    ...INDEX_STATEMENTS,
  ]
}

function postgresStatements(direction: 'up' | 'down'): string[] {
  const checkList = direction === 'up' ? NEW_TYPE_LIST : OLD_TYPE_LIST
  return [
    'ALTER TABLE diagrams DROP CONSTRAINT IF EXISTS diagrams_type_check',
    `ALTER TABLE diagrams ADD CONSTRAINT diagrams_type_check CHECK (type IN ${checkList})`,
  ]
}

/** 纯 SQL 语句序列（供 vitest 直接断言，up/down × sqlite/postgres）。 */
export function diagramsFishboneTypeStatements(
  direction: 'up' | 'down',
  dialect: string,
): string[] {
  return isSqlite(dialect) ? sqliteStatements(direction) : postgresStatements(direction)
}

export default class extends BaseSchema {
  // SQLite 表重建需要手动 PRAGMA foreign_keys=OFF + 事务包裹
  // （SQLite 不允许在事务内切换外键强制），与 reports 表重建先例一致。
  public static disableTransactions = true

  async up() {
    const client = this.db.dialect.name
    const statements = diagramsFishboneTypeStatements('up', client)
    if (isSqlite(client)) {
      await this.db.rawQuery('PRAGMA foreign_keys = OFF')
      await this.db.rawQuery('BEGIN')
      try {
        for (const statement of statements) {
          await this.db.rawQuery(statement)
        }
        await this.db.rawQuery('COMMIT')
      } catch (error) {
        await this.db.rawQuery('ROLLBACK')
        throw error
      } finally {
        await this.db.rawQuery('PRAGMA foreign_keys = ON')
      }
    } else {
      for (const statement of statements) {
        await this.db.rawQuery(statement)
      }
    }
  }

  async down() {
    const client = this.db.dialect.name
    const statements = diagramsFishboneTypeStatements('down', client)
    if (isSqlite(client)) {
      await this.db.rawQuery('PRAGMA foreign_keys = OFF')
      await this.db.rawQuery('BEGIN')
      try {
        for (const statement of statements) {
          await this.db.rawQuery(statement)
        }
        await this.db.rawQuery('COMMIT')
      } catch (error) {
        await this.db.rawQuery('ROLLBACK')
        throw error
      } finally {
        await this.db.rawQuery('PRAGMA foreign_keys = ON')
      }
    } else {
      for (const statement of statements) {
        await this.db.rawQuery(statement)
      }
    }
  }
}
