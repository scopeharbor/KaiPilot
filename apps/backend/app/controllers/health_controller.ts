import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'
import { isPg, lowSensitiveDescription } from '#services/dialect/dialect_helper'
import env from '#start/env'
import { getSocketIo } from '#providers/socketio_provider'
import { checkRedisHealth } from '#services/redis/redis_health'

/**
 * 健康检查控制器
 *
 * 提供三个健康端点——综合（index）、就绪（ready）、存活（live）。
 * 遵循 D2 语义分离与 D8 零业务数据约束。
 * 响应字段白名单：status / version / timestamp / checks。(D8)
 *
 * v2-postgresql-migration-foundation（Section 3）：
 * - 数据库探活同时支持 SQLite 和 PostgreSQL
 * - PG 下可以安全使用 query timeout
 * - 健康响应包含低敏连接类型（connection），不暴露敏感细节
 */
export default class HealthController {
  /**
   * 读取 package.json 的 version 字段（D5）。
   * 运行时读，避免硬编码。
   */
  private version: string | null = null

  private async getVersion(): Promise<string> {
    if (this.version !== null) return this.version

    const tryRead = async (paths: string[]): Promise<string | null> => {
      for (const p of paths) {
        try {
          const raw = await readFile(p, 'utf-8')
          return JSON.parse(raw).version ?? null
        } catch {
          // continue to next path
        }
      }
      return null
    }

    // 开发/生产：从 import.meta.url 推断；测试：从 CWD 读
    const dirName = dirname(fileURLToPath(import.meta.url))
    const fromMeta = join(dirName, '..', '..', '..', 'package.json')
    const fromCwd = join(process.cwd(), 'package.json')

    const version = await tryRead([fromMeta, fromCwd])
    this.version = version ?? 'unknown'
    return this.version as string
  }

  /**
   * GET /api/v1/health — 综合健康检查（D3 向后兼容）
   *
   * 始终返回 HTTP 200；DB 正常时 status:'ok'，DB 不可达时 status:'degraded'。
   * 响应保留顶层 status 供旧消费者只读该字段。
   */
  async index(ctx: HttpContext) {
    const version = await this.getVersion()
    const timestamp = new Date().toISOString()

    const dbResult = await this.pingDatabase()
    const overallStatus = dbResult.status === 'up' ? 'ok' : 'degraded'

    const realtimeResult = this.pingRealtime()
    const redisResult = await checkRedisHealth()

    return ctx.response.ok({
      status: overallStatus,
      version,
      timestamp,
      checks: {
        database: dbResult,
        realtime: realtimeResult,
        redis: redisResult,
      },
    })
  }

  /**
   * GET /api/v1/health/ready — 就绪探针（D4/D9）
   *
   * DB 正常：HTTP 200 + status:'ok' + checks.database.status:'up'
   * DB 不可达：HTTP 503 + status:'degraded' + checks.database.status:'down'
   */
  async ready(ctx: HttpContext) {
    const version = await this.getVersion()
    const timestamp = new Date().toISOString()

    const dbResult = await this.pingDatabase()
    // Redis 为可选加速/限流增强，非核心可用性依赖：disabled/down 不拉低 ready（design D6）。
    // 仅纳入响应供可见性观察，就绪 200/503 判定只看数据库。
    const redisResult = await checkRedisHealth()

    if (dbResult.status === 'up') {
      return ctx.response.ok({
        status: 'ok',
        version,
        timestamp,
        checks: {
          database: dbResult,
          redis: redisResult,
        },
      })
    }

    return ctx.response.status(503).send({
      status: 'degraded',
      version,
      timestamp,
      checks: {
        database: dbResult,
        redis: redisResult,
      },
    })
  }

  /**
   * GET /api/v1/health/live — 存活探针（D2）
   *
   * 极轻量进程级响应，不探任何外部依赖。
   * 始终返回 HTTP 200 + { status: 'ok' }。
   */
  async live(ctx: HttpContext) {
    return ctx.response.ok({ status: 'ok' })
  }

  /**
   * 执行 DB 探活（SELECT 1）。
   *
   * SQLite（better-sqlite3 同步驱动）：查询同步执行，不会挂起，故不设 timeout。
   * knex 的 `.timeout(ms, { cancel: true })` 对 better-sqlite3 会抛
   * "Query cancelling not supported for this dialect"，故 SQLite 不使用 timeout。
   *
   * PostgreSQL（pg 异步驱动）：支持 query cancel，可使用 timeout。(DEBT-01 关闭点)
   *
   * 成功返回 { status: 'up', latencyMs, connection }。
   * 失败返回 { status: 'down', error: '<类别>' }，
   * error 仅含分类（connection_refused / locked / unknown），不含原始错误文本（D8）。
   */
  private async pingDatabase(): Promise<{
    status: 'up' | 'down'
    latencyMs?: number
    connection?: string
    error?: string
  }> {
    const start = Date.now()
    try {
      if (isPg()) {
        // PG 下使用 query timeout（pg 驱动支持 cancel）
        await db.rawQuery('SELECT 1').timeout(5000, { cancel: true })
      } else {
        // SQLite 下不使用 timeout（better-sqlite3 不支持 cancel）
        await db.rawQuery('SELECT 1')
      }
      const latencyMs = Date.now() - start
      return { status: 'up', latencyMs, connection: lowSensitiveDescription() }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message?.toLowerCase() || '' : ''
      let error: string
      if (
        errMsg.includes('refused') ||
        errMsg.includes('econnrefused') ||
        errMsg.includes('connection') ||
        errMsg.includes('enoent') ||
        errMsg.includes('unable')
      ) {
        error = 'connection_refused'
      } else if (errMsg.includes('lock')) {
        error = 'locked'
      } else if (errMsg.includes('timeout')) {
        error = 'timeout'
      } else {
        error = 'unknown'
      }
      return { status: 'down', error }
    }
  }

  /**
   * 实时通道低敏状态检查（v2-realtime-websocket-minimum 7.3）。
   *
   * 只暴露是否启用与在线连接数，不含令牌、用户身份或敏感字段。
   * io 未就绪/停用时不视为 degraded —— REST 不受影响。
   */
  private pingRealtime(): {
    enabled: boolean
    status: 'up' | 'disabled'
    connections?: number
  } {
    const enabled = env.get('REALTIME_ENABLED', true)
    if (!enabled) {
      return { enabled: false, status: 'disabled' }
    }

    const io = getSocketIo()
    if (!io) {
      return { enabled: true, status: 'disabled' }
    }

    // 使用 engine.clientsCount 获取低敏连接数（不含 userId 等身份信息）
    const connections = io.engine?.clientsCount ?? 0
    return { enabled: true, status: 'up', connections }
  }
}
