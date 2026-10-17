import { test } from '@japa/runner'
import {
  insertReturningId,
  normalizeBoolean,
  normalizeId,
} from '#database/support/insert_returning_id'

/**
 * seeder 跨方言取键工具的单元测试。
 *
 * knex `.insert().returning('id')` 在 better-sqlite3 与 pg 上都回 `[{ id }]`，
 * 但 PG 的 bigint 以字符串回传、布尔列回 true/false，SQLite 回数字与 0/1。
 * 这里用假客户端穷举驱动可能回传的形状；真实驱动的形状由
 * tests/functional/db_schema/seeder_cross_dialect.spec.ts 覆盖。
 */

/** 只实现 `table().insert().returning()` 这一条链的假客户端，记录调用参数。 */
function fakeClient(rows: unknown) {
  const calls: { table?: string; values?: unknown; returning?: string } = {}
  const client = {
    table(name: string) {
      calls.table = name
      return {
        insert(values: unknown) {
          calls.values = values
          return {
            returning(column: string) {
              calls.returning = column
              return Promise.resolve(rows)
            },
          }
        },
      }
    },
  }
  return { client: client as unknown as Parameters<typeof insertReturningId>[0], calls }
}

test.group('normalizeId：主键跨方言归一', () => {
  test('SQLite 数字与 PG bigint 字符串归一成同一个 number', ({ assert }) => {
    assert.strictEqual(normalizeId(3), 3)
    assert.strictEqual(normalizeId('3'), 3)
    assert.strictEqual(normalizeId(3), normalizeId('3'))
  })

  test('null / undefined 透传为 null（可空外键）', ({ assert }) => {
    assert.isNull(normalizeId(null))
    assert.isNull(normalizeId(undefined))
  })

  test('超出安全整数或不是数字时显式抛错，不静默丢精度', ({ assert }) => {
    assert.throws(() => normalizeId('9007199254740993'), /无法把/)
    assert.throws(() => normalizeId('abc'), /无法把/)
    assert.throws(() => normalizeId({ command: 'INSERT' }), /无法把/)
  })
})

test.group('normalizeBoolean：布尔列跨方言归一', () => {
  test('SQLite 的 0/1 与 PG 的 true/false 归一成同一个 boolean', ({ assert }) => {
    assert.isTrue(normalizeBoolean(1))
    assert.isTrue(normalizeBoolean(true))
    assert.isFalse(normalizeBoolean(0))
    assert.isFalse(normalizeBoolean(false))
    assert.strictEqual(normalizeBoolean(1), normalizeBoolean(true))
    assert.strictEqual(normalizeBoolean(0), normalizeBoolean(false))
  })

  test('字符串形态按文本语义归一', ({ assert }) => {
    assert.isTrue(normalizeBoolean('1'))
    assert.isTrue(normalizeBoolean('true'))
    assert.isTrue(normalizeBoolean(' TRUE '))
    assert.isFalse(normalizeBoolean('0'))
    assert.isFalse(normalizeBoolean('false'))
    assert.isFalse(normalizeBoolean(''))
  })

  test('null / undefined 视为 false', ({ assert }) => {
    assert.isFalse(normalizeBoolean(null))
    assert.isFalse(normalizeBoolean(undefined))
  })
})

test.group('insertReturningId：插入并取回主键', () => {
  test('始终带 returning(id)，并原样透传表名与插入值', async ({ assert }) => {
    const { client, calls } = fakeClient([{ id: 7 }])
    const values = { email: 'a@example.com' }

    assert.strictEqual(await insertReturningId(client, 'users', values), 7)
    assert.deepEqual(calls, { table: 'users', values, returning: 'id' })
  })

  test('两方言 returning 共同形态 [{ id: N }]', async ({ assert }) => {
    assert.strictEqual(await insertReturningId(fakeClient([{ id: 3 }]).client, 't', {}), 3)
  })

  test('PG bigint 以字符串回传 [{ id: "N" }] 时归一成 number', async ({ assert }) => {
    const id = await insertReturningId(fakeClient([{ id: '3' }]).client, 't', {})
    assert.strictEqual(id, 3)
    assert.isNumber(id)
  })

  test('兜底：裸数组 [N] 与裸值 N', async ({ assert }) => {
    assert.strictEqual(await insertReturningId(fakeClient([3]).client, 't', {}), 3)
    assert.strictEqual(await insertReturningId(fakeClient(3).client, 't', {}), 3)
  })

  test('取不到主键时抛含表名的错，绝不把非主键值当 id 往下传', async ({ assert }) => {
    const unusable: unknown[] = [
      [],
      [{}],
      [{ name: 'x' }],
      undefined,
      // 2026-09-10 线上故障原形：pg 不带 returning 时回的 Result 对象
      { command: 'INSERT', rowCount: 1, rows: [] },
    ]
    for (const rows of unusable) {
      await assert.rejects(
        () => insertReturningId(fakeClient(rows).client, 'organizations', {}),
        /organizations/,
      )
    }
  })
})
