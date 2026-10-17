import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'
import pg from 'pg'

/**
 * PostgreSQL int8（bigint，OID 20）默认以字符串返回：自增主键是 bigint、外键列却是 integer，
 * 同一实体在 JSON 里出现 `"id":"7"` 与 `"parentId":7` 两种类型。前端按全等组树 / 连依赖时
 * 全部对不上（实测导入 125 个 WBS 节点只显示根节点、甘特图 163 条依赖显示为 0）。
 * SQLite 两边都是数字，测试一直走 SQLite，所以从未暴露。
 * 在安全整数范围内解析为数字，与 SQLite 行为一致；超出范围保留字符串，不丢精度。
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : value
})

/**
 * 数据库双连接配置（DEBT-01 偿还）。
 *
 * 通过 `DB_CONNECTION` 环境变量选择连接类型：
 * - `sqlite`（默认）：文件型 SQLite，零外部依赖。
 * - `pg`：PostgreSQL，需本机 PG 服务与完整连接参数。
 *
 * SQLite 与 PG 共享同一套迁移目录，方言差异集中处理。
 * 测试环境强制使用独立 SQLite 文件（避免污染开发库）或独立 PG 测试参数。
 */

function buildSqliteConfig() {
  const isTest = process.env.NODE_ENV === 'test'
  return {
    client: 'better-sqlite3' as const,

    connection: {
      filename: isTest ? env.get('DB_TEST_DATABASE', 'test.sqlite') : env.get('DB_DATABASE'),
    },

    useNullAsDefault: true,

    // SQLite 外键 PRAGMA：仅 SQLite 连接执行，PG 连接不执行（D4）。
    pool: {
      afterCreate(
        connection: { pragma(source: string): unknown },
        done: (error: Error | null, connection: unknown) => void,
      ) {
        connection.pragma('foreign_keys = ON')
        done(null, connection)
      },
    },

    migrations: {
      naturalSort: true,
      paths: ['database/migrations'],
      // 不得设置 disableForeignKeys：迁移期 FK 被剥掉会让守卫 3.2 全面失败。
    },

    schemaGeneration: {
      enabled: true,
      rulesPaths: ['./database/schema_rules.ts'],
    },
  }
}

function buildPgConfig() {
  const sslEnabled = env.get('DB_SSL', false)

  return {
    client: 'pg' as const,

    connection: {
      host: env.get('DB_HOST'),
      port: env.get('DB_PORT', 5432),
      user: env.get('DB_USER'),
      password: env.get('DB_PASSWORD'),
      // 单一命名契约：PG database 名也读 DB_DATABASE（SQLite 下同名单元表示文件路径）。
      // env.ts 无条件强制 DB_DATABASE，不存在独立的 DB_PG_DATABASE 变量。
      database: env.get('DB_DATABASE'),
      ssl: sslEnabled
        ? {
            rejectUnauthorized: env.get('DB_SSL_REJECT_UNAUTHORIZED', false),
          }
        : false,
    },

    pool: {
      min: env.get('DB_POOL_MIN', 2),
      max: env.get('DB_POOL_MAX', 10),
    },

    migrations: {
      naturalSort: true,
      paths: ['database/migrations'],
    },
  }
}

const activeConnection = env.get('DB_CONNECTION', 'sqlite')

const dbConfig = defineConfig({
  connection: activeConnection,

  connections: {
    sqlite: buildSqliteConfig(),
    pg: buildPgConfig(),
  },
})

export default dbConfig
