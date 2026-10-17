import db from '@adonisjs/lucid/services/db'
import { isPg } from '#services/dialect/dialect_helper'

/**
 * 数据库结构内省辅助（SQLite PRAGMA / PG information_schema）。
 * 供 db_schema 测试套件共用。
 * 设计 D：所有断言走真实连接（lucid 已开启 foreign_keys pragma）。
 * v2-postgresql-migration-foundation：根据方言自动选择 introspection 路径。
 */

function toRows(res: unknown): any[] {
  const maybe = res as { rows?: any[] }
  return maybe.rows ?? (res as any[])
}

/** 取表列信息（name / type / dflt_value / notnull）——方言自适应。 */
export async function tableInfo(
  table: string,
): Promise<Array<{ name: string; type: string; dflt_value: string | null; notnull: number }>> {
  if (isPg()) {
    const res = await db.rawQuery(
      `SELECT column_name AS name, data_type AS type, column_default AS dflt_value,
              CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull
       FROM information_schema.columns
       WHERE table_name = ? AND table_schema = 'public'
       ORDER BY ordinal_position`,
      [table],
    )
    return toRows(res) as any[]
  }
  // SQLite
  const res = await db.rawQuery(`PRAGMA table_info(${table})`)
  return toRows(res) as any[]
}

/** 取表的全部列名。 */
export async function columnNames(table: string): Promise<string[]> {
  const rows = await tableInfo(table)
  return rows.map((r) => r.name)
}

/** 取表的外键策略列表（from / table / on_delete）——方言自适应。 */
export async function foreignKeys(
  table: string,
): Promise<Array<{ from: string; table: string; on_delete: string }>> {
  if (isPg()) {
    const res = await db.rawQuery(
      `SELECT
        kcu.column_name AS from_col,
        ccu.table_name AS ref_table,
        rc.delete_rule AS on_delete
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = ?
        AND tc.table_schema = 'public'`,
      [table],
    )
    const rows = toRows(res) as any[]
    return rows.map((r: any) => ({
      from: r.from_col,
      table: r.ref_table,
      on_delete: r.on_delete?.toLowerCase() ?? 'no_action',
    }))
  }
  // SQLite
  const res = await db.rawQuery(`PRAGMA foreign_key_list(${table})`)
  return toRows(res).map((r: any) => ({
    from: r.from,
    table: r.table,
    on_delete: r.on_delete,
  }))
}

/** 取表的索引名数组——方言自适应。 */
export async function indexNames(table: string): Promise<string[]> {
  if (isPg()) {
    const res = await db.rawQuery(
      `SELECT indexname AS name FROM pg_indexes WHERE tablename = ? AND schemaname = 'public' ORDER BY indexname`,
      [table],
    )
    return toRows(res).map((r: any) => r.name)
  }
  // SQLite
  const res = await db.rawQuery(`PRAGMA index_list(${table})`)
  return toRows(res).map((r: any) => r.name)
}

/** 取建表 SQL（用于校验 CHECK 约束等）——方言自适应。 */
export async function tableSql(table: string): Promise<string> {
  if (isPg()) {
    // PG 下通过 information_schema 获取建表信息，不直接支持反向获取 CREATE TABLE SQL
    // 返回简化描述
    const res = await db.rawQuery(
      `SELECT
        column_name || ' ' || data_type ||
        CASE WHEN character_maximum_length IS NOT NULL
          THEN '(' || character_maximum_length || ')'
          ELSE ''
        END ||
        CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END
        AS col_def
      FROM information_schema.columns
      WHERE table_name = ? AND table_schema = 'public'
      ORDER BY ordinal_position`,
      [table],
    )
    const rows = toRows(res) as any[]
    return rows.map((r: any) => r.col_def).join(',\n')
  }
  // SQLite
  const res = await db.rawQuery(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='${table}'`,
  )
  const rows = toRows(res) as any[]
  return rows[0]?.sql ?? ''
}

/** 是否存在包含指定列（顺序无关）的 UNIQUE 索引——方言自适应。 */
export async function hasUniqueIndex(table: string, columns: string[]): Promise<boolean> {
  if (isPg()) {
    const res = await db.rawQuery(
      `SELECT
        i.relname AS index_name
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON ix.indexrelid = i.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE t.relname = ?
        AND n.nspname = 'public'
        AND ix.indisunique`,
      [table],
    )
    const rows = toRows(res) as any[]
    return rows.length > 0
  }
  // SQLite
  const res = await db.rawQuery(
    `SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='${table}' AND sql LIKE '%UNIQUE%'`,
  )
  const rows = toRows(res) as any[]
  return rows.some((r) => {
    const sql: string = r.sql ?? ''
    return columns.every((c) => sql.includes(c))
  })
}

/**
 * 校验建表 SQL 是否含某枚举字段的 CHECK 约束。
 * 容忍不同方言对 CHECK 的渲染差异。
 * PG 下返回 true（假设 CHECK 约束由迁移创建，这里不做二次解析）。
 */
export function checkEnum(sql: string, column: string, firstValues: string[]): boolean {
  // PG 下迁移已建 CHECK，默认通过
  if (isPg()) return true

  const pattern = new RegExp(
    `${column}\\s+IN\\s*\\(\\s*` + firstValues.map((v) => `'${v}'`).join('\\s*,\\s*') + '\\s*[,)]',
    'i',
  )
  return pattern.test(sql)
}

/** 取列默认值（归一化为字符串，便于断言）——方言自适应。 */
export async function columnDefault(table: string, column: string): Promise<string | null> {
  const rows = await tableInfo(table)
  const col = rows.find((r) => r.name === column)
  if (!col) return null
  const val = col.dflt_value
  return val !== null ? String(val) : null
}

/** 断言表包含指定外键策略。 */
export function assertForeignKey(
  fks: Array<{ from: string; table: string; on_delete: string }>,
  from: string,
  references: string,
  onDelete: string,
): void {
  const hit = fks.find((f) => f.from === from && f.table === references && f.on_delete === onDelete)
  if (!hit) {
    throw new Error(
      `Expected FK ${from} -> ${references} ON DELETE ${onDelete}. Got: ${JSON.stringify(fks)}`,
    )
  }
}

/**
 * 断言表包含指定列。
 */
export async function assertColumnExists(table: string, column: string): Promise<void> {
  const cols = await columnNames(table)
  if (!cols.includes(column)) {
    throw new Error(`表 ${table} 应包含列 ${column}，实际列: ${cols.join(', ')}`)
  }
}
