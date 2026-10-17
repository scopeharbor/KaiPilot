/**
 * v3-multitenant-database-isolation —— 数据库 schema introspection 服务（任务 3.1）。
 *
 * 只读元数据检查（表列 / 外键 / 索引 / 唯一约束），方言自适应：
 * - SQLite：PRAGMA table_info / foreign_key_list / index_list / index_info + sqlite_master
 * - PostgreSQL：information_schema / pg_catalog 等价查询
 *
 * 约束（spec「Raw SQL and schema introspection MUST be guarded」）：
 * - 仅运行元数据只读查询，绝不返回租户业务行内容
 * - 供迁移守卫测试与追加迁移验证使用；业务查询必须走 scoped helpers（阶段 4）
 *
 * 聚合能力（3.2/3.3/3.4 守卫测试依赖）：
 * - columnInfo / columnNames / foreignKeys / orgForeignKey / indexList / orgLeadingIndex /
 *   uniqueIndexes / hasCompositeUniqueIncludingOrg / tableSql —— 完成 catalog 契约到真实
 *   DB 的核对。
 */
import db from '@adonisjs/lucid/services/db'
import { isPg } from '#services/dialect/dialect_helper'

export interface SchemaColumn {
  name: string
  type: string
  notnull: boolean
  default_value: string | null
}

export interface SchemaForeignKey {
  from: string
  table: string
  on_delete: string
}

export interface SchemaIndex {
  name: string
  unique: boolean
  columns: string[]
}

function toRows(res: unknown): any[] {
  const maybe = res as { rows?: unknown[] }
  return maybe.rows ?? (res as unknown[])
}

/** 表列信息（方言自适应，仅为元数据）。 */
export async function tableColumns(table: string): Promise<SchemaColumn[]> {
  if (isPg()) {
    const res = await db.rawQuery(
      `SELECT column_name AS name, data_type AS type,
              COALESCE(column_default::text, '') AS dflt_value,
              CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull
       FROM information_schema.columns
       WHERE table_name = ? AND table_schema = 'public'
       ORDER BY ordinal_position`,
      [table],
    )
    return toRows(res).map((r: any) => ({
      name: r.name,
      type: r.type,
      notnull: r.notnull === 1,
      default_value: r.dflt_value ? String(r.dflt_value) : null,
    }))
  }
  const res = await db.rawQuery(`PRAGMA table_info(${table})`)
  return toRows(res).map((r: any) => ({
    name: r.name,
    type: r.type,
    notnull: r.notnull === 1,
    default_value: r.dflt_value ? String(r.dflt_value) : null,
  }))
}

/** 所有列名。 */
export async function columnNames(table: string): Promise<string[]> {
  const columns = await tableColumns(table)
  return columns.map((c) => c.name)
}

/** 外键列表（from column → referenced table）。 */
export async function foreignKeys(table: string): Promise<SchemaForeignKey[]> {
  if (isPg()) {
    const res = await db.rawQuery(
      `
      SELECT kcu.column_name AS from_col,
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
    return toRows(res).map((r: any) => ({
      from: r.from_col,
      table: r.ref_table,
      on_delete: r.on_delete?.toLowerCase() ?? 'no_action',
    }))
  }
  const res = await db.rawQuery(`PRAGMA foreign_key_list(${table})`)
  return toRows(res).map((r: any) => ({
    from: r.from,
    table: r.table,
    on_delete: r.on_delete,
  }))
}

/** 是否存在 organization_id → organizations FK。 */
export async function hasOrganizationForeignKey(table: string): Promise<boolean> {
  const fks = await foreignKeys(table)
  return fks.some((f) => f.from === 'organization_id' && f.table === 'organizations')
}

/** 表索引列表（含列顺序）。 */
export async function indexes(table: string): Promise<SchemaIndex[]> {
  if (isPg()) {
    const res = await db.rawQuery(
      `
      SELECT t.relname AS table_name,
             i.relname AS index_name,
             ix.indisunique AS unique,
             ix.indexdef::text AS indexdef
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON ix.indexrelid = i.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE t.relname = ? AND n.nspname = 'public'
      ORDER BY i.relname`,
      [table],
    )
    return toRows(res).map((r: any) => ({
      name: r.index_name,
      unique: !!r.unique,
      columns: parsePgIndexColumns(r.indexdef),
    }))
  }
  const res = await db.rawQuery(`PRAGMA index_list(${table})`)
  const list = toRows(res) as any[]
  const out: SchemaIndex[] = []
  for (const r of list) {
    if (r.origin === 'pk') continue
    const info = toRows(await db.rawQuery(`PRAGMA index_info(${r.name})`)) as any[]
    out.push({
      name: r.name,
      unique: r.unique === 1,
      columns: info.map((c) => c.name),
    })
  }
  return out
}

/** 从 PG indexdef 文本解析 (col1, col2) 列清单（降序/部分索引列忽略修饰符）。 */
function parsePgIndexColumns(indexdef: string): string[] {
  const m = /\(([^)]+)\)/.exec(indexdef)
  if (!m) return []
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^\s*"?([A-Za-z0-9_]+)"?\s*$/, '$1'))
    .filter((s) => s.length > 0 && !/\s/.test(s))
}

/** 存在以 organization_id 开头的索引（org 优先索引，支持高频租户过滤）。 */
export async function hasOrgLeadingIndex(table: string): Promise<boolean> {
  const idx = await indexes(table)
  return idx.some((i) => i.columns[0] === 'organization_id')
}

/** 含 organization_id 的索引（任意位置）。 */
export async function orgIndexes(table: string): Promise<SchemaIndex[]> {
  const idx = await indexes(table)
  return idx.filter((i) => i.columns.includes('organization_id'))
}

/** 全部唯一索引（含列）。 */
export async function uniqueIndexes(table: string): Promise<SchemaIndex[]> {
  const idx = await indexes(table)
  return idx.filter((i) => i.unique)
}

/** 是否存在唯一索引，其列集合恰好包含指定键（顺序无关，仅限唯一索引）。 */
export async function hasUniqueIndexOn(table: string, columns: string[]): Promise<boolean> {
  const uniques = await uniqueIndexes(table)
  const sorted = [...columns].sort()
  return uniques.some((u) => {
    const uSorted = [...u.columns].sort()
    return uSorted.length === sorted.length && uSorted.every((c, i) => c === sorted[i])
  })
}

/** 表是否存在（元数据）。 */
export async function tableExists(table: string): Promise<boolean> {
  try {
    if (isPg()) {
      const res = await db.rawQuery(`SELECT to_regclass('public."${table}"') IS NOT NULL AS exists`)
      return Boolean(toRows(res)[0]?.exists)
    }
    const res = await db.rawQuery(
      `SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='${table}'`,
    )
    return Number(((toRows(res)[0] as any) ?? {}).cnt ?? 0) > 0
  } catch {
    return false
  }
}
