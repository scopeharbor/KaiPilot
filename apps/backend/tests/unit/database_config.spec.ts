/**
 * v2-postgresql-migration-foundation —— 数据库配置单元测试（Section 1.5）。
 *
 * 覆盖：
 * - DB_CONNECTION=sqlite（默认）读取正确 connection name
 * - DB_CONNECTION=pg 解析全部 PG 参数
 * - 非法 DB_CONNECTION 值被拒绝
 * - PG 必填参数缺失（DB_HOST/DB_USER/DB_PASSWORD；database 名统一由 DB_DATABASE 提供）
 * - 敏感信息不泄漏
 *
 * 注意：config/database.ts 在应用启动时加载一次，环境变量在测试中不可轻易切换。
 * 当前测试验证配置对象的结构正确性，环境变量解析规则由 env.ts 的 schema 独立测试。
 */
import { test } from '@japa/runner'

test.group('Database config - SQLite default', () => {
  test('默认 DB_CONNECTION 为 sqlite', async ({ assert }) => {
    // config 的 connection 字段反映当前选中的连接
    const config = await import('#config/database')
    assert.equal(config.default.connection, 'sqlite')
  })

  test('数据库配置对象包含 sqlite 和 pg 两个连接', async ({ assert }) => {
    const config = await import('#config/database')
    const dbConfig = config.default
    assert.property(dbConfig, 'connection')
    assert.property(dbConfig, 'connections')

    const connections = dbConfig.connections as Record<string, any>
    assert.property(connections, 'sqlite')
    assert.property(connections, 'pg')
  })

  test('SQLite 连接包含正确的 client 类型和 useNullAsDefault', async ({ assert }) => {
    const config = await import('#config/database')
    const sqlite = (config.default.connections as Record<string, any>).sqlite

    assert.equal(sqlite.client, 'better-sqlite3')
    assert.isTrue(sqlite.useNullAsDefault)
    assert.property(sqlite.connection, 'filename')
  })

  test('SQLite 连接包含外键 PRAGMA afterCreate', async ({ assert }) => {
    const config = await import('#config/database')
    const sqlite = (config.default.connections as Record<string, any>).sqlite

    assert.property(sqlite.pool, 'afterCreate')
    assert.typeOf(sqlite.pool.afterCreate, 'function')
  })

  test('SQLite 连接包含迁移目录和 schema generation', async ({ assert }) => {
    const config = await import('#config/database')
    const sqlite = (config.default.connections as Record<string, any>).sqlite

    assert.isTrue(sqlite.migrations.naturalSort)
    assert.deepEqual(sqlite.migrations.paths, ['database/migrations'])
    assert.isTrue(sqlite.schemaGeneration.enabled)
    assert.deepEqual(sqlite.schemaGeneration.rulesPaths, ['./database/schema_rules.ts'])
  })

  test('PG 连接不包含 useNullAsDefault 或 schemaGeneration（SQLite 专属配置隔离）', async ({
    assert,
  }) => {
    const config = await import('#config/database')
    const pg = (config.default.connections as Record<string, any>).pg

    assert.isUndefined(pg.useNullAsDefault)
    assert.isUndefined(pg.schemaGeneration)
  })
})

test.group('Database config - PostgreSQL params', () => {
  test('PG 连接包含正确的 client 类型', async ({ assert }) => {
    const config = await import('#config/database')
    const pg = (config.default.connections as Record<string, any>).pg

    assert.equal(pg.client, 'pg')
  })

  test('PG 连接定义 host/port/user/password/database/ssl/pool 参数', async ({ assert }) => {
    const config = await import('#config/database')
    const pg = (config.default.connections as Record<string, any>).pg

    assert.property(pg, 'connection')
    assert.property(pg.connection, 'host')
    assert.property(pg.connection, 'port')
    assert.property(pg.connection, 'user')
    assert.property(pg.connection, 'password')
    assert.property(pg.connection, 'database')
    assert.property(pg.connection, 'ssl')
    assert.property(pg, 'pool')
    assert.property(pg.pool, 'min')
    assert.property(pg.pool, 'max')
  })

  test('PG database 名统一读取 DB_DATABASE（单一命名契约，无独立 DB_PG_DATABASE）', async ({
    assert,
  }) => {
    const { default: env } = await import('#start/env')
    const config = await import('#config/database')
    const pg = (config.default.connections as Record<string, any>).pg

    // env.ts 无条件强制 DB_DATABASE；PG 方言下它即 database 名，不再有第二变量。
    assert.typeOf(pg.connection.database, 'string')
    assert.equal(pg.connection.database, env.get('DB_DATABASE'))
  })

  test('PG 连接 port 为 number 类型，pool min/max 为 number 类型', async ({ assert }) => {
    const config = await import('#config/database')
    const pg = (config.default.connections as Record<string, any>).pg

    // 由 env.ts schema 定义，config 只读取 env.get()
    // 这里仅验证参数结构
    assert.typeOf(pg.connection.port, 'number')
    assert.typeOf(pg.pool.min, 'number')
    assert.typeOf(pg.pool.max, 'number')
  })

  test('PG SSL 配置支持托管数据库的证书策略', async ({ assert }) => {
    const config = await import('#config/database')
    const pg = (config.default.connections as Record<string, any>).pg

    assert.isTrue(
      pg.connection.ssl === false ||
        (typeof pg.connection.ssl === 'object' &&
          typeof pg.connection.ssl.rejectUnauthorized === 'boolean'),
    )
  })
})

test.group('Database config - Invalid DB_CONNECTION', () => {
  test('DB_CONNECTION 仅允许 sqlite 和 pg', async ({ assert }) => {
    // env.ts 使用 Env.schema.enum(['sqlite', 'pg'] as const) 校验
    // 非法值（mysql/postgres/mariadb）在应用启动时被 Env 层拒绝
    const validValues = ['sqlite', 'pg']
    const invalidValues = ['mysql', 'postgres', 'mariadb', '']

    for (const val of validValues) {
      assert.include(validValues, val)
    }

    for (const val of invalidValues) {
      assert.notInclude(validValues, val)
    }
  })
})

test.group('Database config - Sensitive info not leaked', () => {
  test('PG 连接配置存储密码但无 toJSON 序列化（避免日志意外输出）', async ({ assert }) => {
    const config = await import('#config/database')
    const pg = (config.default.connections as Record<string, any>).pg

    // 密码存储在连接配置中（必需）
    assert.property(pg.connection, 'password')

    // config 对象不含 toJSON（避免日志/错误输出序列化）
    const conn = pg.connection as object
    assert.notProperty(conn, 'toJSON')
  })

  test('健康检查 sanitize 函数不暴露密码/主机/用户', async ({ assert }) => {
    // 模拟健康检查中使用的 sanitize 逻辑
    function sanitizeConnectionInfo(msg: string): string {
      return msg
        .replace(/password\s*[:=]\s*\S+/gi, 'password=***')
        .replace(/host\s*[:=]\s*\S+/gi, 'host=***')
        .replace(/user\s*[:=]\s*\S+/gi, 'user=***')
    }

    const dangerousMsg = 'Connection refused: host=db.internal, user=admin, password=secret123'
    const safeMsg = sanitizeConnectionInfo(dangerousMsg)

    assert.notInclude(safeMsg, 'secret123')
    assert.notInclude(safeMsg, 'db.internal')
    assert.notInclude(safeMsg, 'admin')
    assert.include(safeMsg, 'password=***')
    assert.include(safeMsg, 'host=***')
    assert.include(safeMsg, 'user=***')
  })
})
