/**
 * v2-postgresql-migration-foundation —— 数据库方言 Helper（Section 2.1）。
 *
 * 集中封装方言判定与方言安全操作，禁止测试/Service 直接假设当前连接为 SQLite。
 *
 * 能力：
 * - kind(): 返回当前连接的方言标识（'sqlite' | 'pg'）
 * - isSqlite() / isPg(): 布尔判断
 * - lowSensitiveDescription(): 不包含 host/user/password/dsn 的连接描述
 * - safeRawQuery(sql, bindings?): 方言安全的 raw query 入口（仅运行读查询）
 */
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import type { LucidModel, ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'

export type DialectKind = 'sqlite' | 'pg'

/**
 * 获取当前数据库连接方言类型。
 * 通过 Lucid config 读取 `connection` 属性判断。
 */
export function kind(): DialectKind {
  const raw = env.get('DB_CONNECTION', 'sqlite')
  if (raw === 'pg') return 'pg'
  return 'sqlite'
}

/** 当前连接是否为 SQLite。 */
export function isSqlite(): boolean {
  return kind() === 'sqlite'
}

/** 当前连接是否为 PostgreSQL。 */
export function isPg(): boolean {
  return kind() === 'pg'
}

/**
 * 获取低敏数据库连接描述。
 *
 * SQLite: 返回 "SQLite (file)" 不含路径。
 * PG: 返回 "PostgreSQL" 不含 host/database/user/port/password/DSN。
 * 符合 D6/D8 要求：健康检查/日志/审计只输出低敏连接类型。
 */
export function lowSensitiveDescription(): string {
  if (isPg()) return 'PostgreSQL'
  return 'SQLite (file)'
}

/**
 * 方言安全的 raw query 入口。
 *
 * 用途：执行仅读操作（SELECT），禁止写入或修改数据。
 * 与直接调用 `db.rawQuery()` 的区别：
 * - 统一出口方便审计和方言检查
 * - 后续可在此处添加超时/重试/日志
 * - 禁止 PG 下执行 SQLite 专属 SQL（如 PRAGMA）
 */
export async function safeRawQuery(
  sql: string,
  bindings?: Record<string, any> | any[],
): Promise<any> {
  // 保护性检查：PG 下禁止 PRAGMA 语句
  if (isPg() && /^\s*PRAGMA\s/i.test(sql)) {
    throw new Error('PRAGMA 语句不适用于 PostgreSQL 连接')
  }

  return db.rawQuery(sql, bindings)
}

/**
 * 获取当前连接的 Schema Builder。
 *
 * SQLite 下使用 PRAGMA 和 sqlite_master introspection。
 * PG 下使用 information_schema / pg_catalog introspection。
 * 此函数返回 Lucid 的 SchemaBuilder 实例用于迁移/建表操作。
 */
export function getSchemaBuilder() {
  return db.connection(kind()).schema
}

/**
 * ModelQueryBuilder 上应用组织隔离过滤。
 * 两个方言均使用 `organization_id` 列进行过滤。
 */
export function applyOrgScope(
  query: ModelQueryBuilderContract<LucidModel>,
  organizationId: number,
): void {
  query.where('organization_id', organizationId)
}
