import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'

/** 能发起插入的 Lucid 客户端：seeder 里既可能是 `this.client`，也可能是事务句柄。 */
type InsertClient = QueryClientContract | TransactionClientContract

/**
 * 把驱动回传的**主键态**归一成 number。
 *
 * PG 的 `bigint`（`bigIncrements` 建的列）经 node-pg 默认解析成**字符串**，
 * SQLite 则给数字。不归一就会出现 `'3' !== 3` 这种恒真比较，
 * 让「幂等 = 无操作」的判据说谎。
 */
export function normalizeId(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const id = Number(value)
  if (!Number.isSafeInteger(id)) {
    throw new Error(`无法把 ${String(value)} 归一成主键 id（超出安全整数范围或不是数字）`)
  }
  return id
}

/**
 * 把驱动回传的**布尔态**归一成 boolean。
 *
 * SQLite 没有布尔类型，回传 `0/1`；PG 回传 `false/true`。
 * seeder 里 `existing.is_active !== 1` 这类判据因此在 PG 上**恒真**——
 * 行数不变，但每次重跑都会发一条无意义的 UPDATE 并改写 `updated_at`。
 */
export function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized !== '' && normalized !== '0' && normalized !== 'false'
  }
  return Boolean(value)
}

/**
 * 插入一行并取回自增主键——**跨方言唯一安全的写法**。
 *
 * knex 的 `.insert()` **不带** `.returning()` 时，返回值随方言而变：
 * - `better-sqlite3`：`[lastInsertRowid]`，即数字数组；
 * - `pg`：一个 `Result` 对象（`{ command, rowCount, rows, ... }`）。
 *
 * 所以历史上遍布 seeder 的 `Array.isArray(r) ? r[0] : r` 只在 SQLite 上成立；
 * 在 PostgreSQL 上 `Array.isArray` 为假，整个 `Result` 对象会被当作 id 继续写进外键，
 * 报成 `invalid input syntax for type bigint: "{"command":"INSERT",...}"`。
 * 因为部署目标机主库是 PostgreSQL，这等于 `db:seed` 在部署库上根本跑不起来。
 *
 * 带上 `.returning('id')` 后两种方言形状一致，都是 `[{ id: N }]`（knex 3.3 实测）。
 * 这里仍做一次归一化 + 显式断言，避免日后 knex 改形状时又变成静默写坏数据。
 */
export async function insertReturningId(
  client: InsertClient,
  table: string,
  values: Record<string, unknown>,
): Promise<number> {
  const rows = await client.table(table).insert(values).returning('id')

  const first = Array.isArray(rows) ? rows[0] : rows
  const raw =
    first !== null && typeof first === 'object'
      ? (first as { id?: unknown }).id
      : (first as unknown)

  const id = normalizeId(raw)
  if (id === null) {
    throw new Error(`插入 ${table} 后未取回主键 id（knex 返回：${JSON.stringify(rows)}）`)
  }
  return id
}
