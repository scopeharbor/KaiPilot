import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * 放宽 `multi_project_dependency_previews.operation` 的 CHECK，追加 `'delete'`。
 *
 * 背景：CRUD 规范要求 delete 也走 preview/confirm 两段式，但原 CHECK 只允许
 * `create/update/archive/restore`，delete 分支无法落预览行。
 *
 * 沿用 1990000000003 的「新建 + 拷贝 + 换名」重建先例（SQLite 不支持 ALTER CHECK）。
 * 列定义取自实测 DDL，含 1992000000000 新增的 `endpoints` 列；既有行零变化。
 * down 先删除 delete 预览行（收窄前必须清理，否则重建即违反 CHECK）。
 */
const COLUMNS = [
  'id',
  'preview_id',
  'organization_id',
  'operation',
  'dependency_id',
  'permission_fingerprint',
  'proposed_diff',
  'duplicate_check',
  'cycle_check',
  'lifecycle_check',
  'self_dependency_check',
  'freshness_signature',
  'warning_codes',
  'confirmation_hash',
  'idempotency_key',
  'source_signature',
  'actor_user_id',
  'expires_at',
  'consumed',
  'created_at',
  'endpoints',
].join(', ')

function createTableSql(tableName: string, operations: string): string {
  return `
    CREATE TABLE ${tableName} (
      id integer not null primary key autoincrement,
      preview_id varchar(64) not null,
      organization_id bigint not null,
      operation varchar(10) not null,
      dependency_id bigint null,
      permission_fingerprint varchar(64) not null,
      proposed_diff json not null,
      duplicate_check json null,
      cycle_check json null,
      lifecycle_check json null,
      self_dependency_check json null,
      freshness_signature varchar(64) not null,
      warning_codes json null,
      confirmation_hash varchar(64) not null,
      idempotency_key varchar(64) not null,
      source_signature varchar(64) not null,
      actor_user_id bigint not null,
      expires_at datetime not null,
      consumed boolean not null default '0',
      created_at datetime not null,
      endpoints json null,
      foreign key(organization_id) references organizations(id) on delete CASCADE,
      foreign key(dependency_id) references multi_project_dependencies(id) on delete CASCADE,
      foreign key(actor_user_id) references users(id),
      check (operation IN (${operations}))
    )
  `
}

const INDEXES = [
  'CREATE UNIQUE INDEX `multi_project_dependency_previews_preview_id_unique` on `multi_project_dependency_previews` (`preview_id`)',
  'CREATE INDEX `multi_project_dependency_previews_organization_id_index` on `multi_project_dependency_previews` (`organization_id`)',
  'CREATE INDEX `multi_project_dependency_previews_preview_id_confirmation_hash_index` on `multi_project_dependency_previews` (`preview_id`, `confirmation_hash`)',
  'CREATE INDEX `multi_project_dependency_previews_organization_id_expires_at_index` on `multi_project_dependency_previews` (`organization_id`, `expires_at`)',
  'CREATE INDEX `multi_project_dependency_previews_idempotency_key_actor_user_id_index` on `multi_project_dependency_previews` (`idempotency_key`, `actor_user_id`)',
]

const WITH_DELETE = "'create','update','archive','restore','delete'"
const WITHOUT_DELETE = "'create','update','archive','restore'"

export default class extends BaseSchema {
  // 表重建需手动 PRAGMA foreign_keys=OFF（SQLite 不支持事务内切换外键强制）
  public static disableTransactions = true

  protected tableName = 'multi_project_dependency_previews'

  async up() {
    await this.#rebuild(WITH_DELETE, null)
  }

  async down() {
    // 收窄前先清掉不再合法的行，否则重建时的 CHECK 直接失败
    await this.#rebuild(
      WITHOUT_DELETE,
      "DELETE FROM multi_project_dependency_previews WHERE operation = 'delete'",
    )
  }

  async #rebuild(operations: string, preCleanupSql: string | null) {
    const client = this.db.dialect.name
    if (client !== 'sqlite3' && client !== 'better-sqlite3') {
      // PG：直接换约束
      await this.db.rawQuery(
        `ALTER TABLE ${this.tableName} DROP CONSTRAINT IF EXISTS ${this.tableName}_operation_check`,
      )
      if (preCleanupSql) await this.db.rawQuery(preCleanupSql)
      await this.db.rawQuery(
        `ALTER TABLE ${this.tableName} ADD CONSTRAINT ${this.tableName}_operation_check CHECK (operation IN (${operations}))`,
      )
      return
    }

    const tmp = `${this.tableName}__rebuild`
    await this.db.rawQuery('PRAGMA foreign_keys = OFF')
    await this.db.rawQuery('BEGIN')
    try {
      if (preCleanupSql) await this.db.rawQuery(preCleanupSql)
      await this.db.rawQuery(createTableSql(tmp, operations))
      await this.db.rawQuery(
        `INSERT INTO ${tmp} (${COLUMNS}) SELECT ${COLUMNS} FROM ${this.tableName}`,
      )
      await this.db.rawQuery(`DROP TABLE ${this.tableName}`)
      await this.db.rawQuery(`ALTER TABLE ${tmp} RENAME TO ${this.tableName}`)
      for (const sql of INDEXES) await this.db.rawQuery(sql)
      await this.db.rawQuery('COMMIT')
    } catch (error) {
      await this.db.rawQuery('ROLLBACK')
      throw error
    } finally {
      await this.db.rawQuery('PRAGMA foreign_keys = ON')
    }
  }
}
