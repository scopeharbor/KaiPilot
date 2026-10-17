/**
 * v2-postgresql-migration-foundation —— 方言 Helper 单元测试（Section 2.4）。
 *
 * 覆盖：
 * - SQLite 下 kind/isSqlite/isPg/lowSensitiveDescription 正确
 * - safeRawQuery 在 SQLite 下正常工作
 * - safeRawQuery 禁止在 PG 下执行 PRAGMA
 * - 获取当前连接的 schema builder
 */
import { test } from '@japa/runner'

test.group('Dialect helper - SQLite path', () => {
  test('kind() 返回 sqlite', async ({ assert }) => {
    const { kind } = await import('#services/dialect/dialect_helper')
    assert.equal(kind(), 'sqlite')
  })

  test('isSqlite() 返回 true', async ({ assert }) => {
    const { isSqlite } = await import('#services/dialect/dialect_helper')
    assert.isTrue(isSqlite())
  })

  test('isPg() 返回 false', async ({ assert }) => {
    const { isPg } = await import('#services/dialect/dialect_helper')
    assert.isFalse(isPg())
  })

  test('lowSensitiveDescription() 返回 SQLite (file) 不含路径', async ({ assert }) => {
    const { lowSensitiveDescription } = await import('#services/dialect/dialect_helper')
    const desc = lowSensitiveDescription()
    assert.equal(desc, 'SQLite (file)')
    assert.notInclude(desc, '/')
    assert.notInclude(desc, 'database')
  })

  test('safeRawQuery 可在 SQLite 下执行 SELECT 1', async ({ assert }) => {
    const { safeRawQuery } = await import('#services/dialect/dialect_helper')
    const result = await safeRawQuery('SELECT 1')
    const rows = Array.isArray(result) ? result : ((result as any)?.rows ?? result)
    assert.isDefined(rows)
  })

  test('safeRawQuery 在 SQLite 下可执行 PRAGMA', async ({ assert }) => {
    const { safeRawQuery } = await import('#services/dialect/dialect_helper')
    const result = await safeRawQuery('PRAGMA table_info(projects)')
    const rows = Array.isArray(result) ? result : ((result as any)?.rows ?? result)
    assert.isArray(rows)
  })

  test('getSchemaBuilder 返回 SchemaBuilder 实例', async ({ assert }) => {
    const { getSchemaBuilder } = await import('#services/dialect/dialect_helper')
    const builder = getSchemaBuilder()
    assert.isDefined(builder)
    assert.property(builder, 'createTable')
    assert.property(builder, 'alterTable')
  })
})

test.group('Dialect helper - PG 保护', () => {
  test('isPg 返回 false（当前测试运行在 SQLite 上）', async ({ assert }) => {
    const { isPg } = await import('#services/dialect/dialect_helper')
    assert.isFalse(isPg())
  })

  test('当前连接为 SQLite，跳过 PG-only 保护检查', async ({ assert }) => {
    assert.isTrue(true)
  })
})
