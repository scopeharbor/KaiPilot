#!/usr/bin/env node
/**
 * 容器内 Supabase 数据库选择器（compose.supabase.yaml 专用）。
 *
 * 目标机只需要 Docker：不再依赖宿主机 pnpm 启动器把 DB_HOST 等变量插值进 Compose。
 * 读取只读挂载的 apps/backend/.env（`AIPROJ_DB_ENV_FILE`），按 direct → session pooler
 * 顺序探测（与 scripts/database-selection.ts 同一规则），把选中的连接参数输出为
 * `export KEY='value'` 语句供入口脚本 eval。
 *
 * - stdout 只给入口脚本 eval，绝不写日志；stderr 只输出候选标签与错误码（不含密码/连接串）；
 * - 进程环境变量优先于 env 文件（便于临时覆盖）；
 * - 无可用候选时退出码 2，入口脚本 fail closed。
 */
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const envFile = process.env.AIPROJ_DB_ENV_FILE || '/run/aiproj-db/.env'
const requireBase = process.env.AIPROJ_PG_REQUIRE_BASE || '/app/apps/backend/package.json'

function parseEnvFile(source) {
  const values = {}
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = line.slice(separator + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    for (const [key, value] of Object.entries(values)) {
      const expanded = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (token, name) => {
        return process.env[name] ?? values[name] ?? token
      })
      if (expanded !== value) {
        values[key] = expanded
        changed = true
      }
    }
    if (!changed) break
  }
  return values
}

const pick = (env, key) =>
  process.env[key] !== undefined && process.env[key] !== '' ? process.env[key] : env[key]
const asPort = (value, fallback) => {
  const parsed = Number(value ?? fallback)
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback
}
const asBoolean = (value, fallback) =>
  value === undefined || value === '' ? fallback : String(value).trim().toLowerCase() === 'true'

function buildCandidates(env) {
  const password = pick(env, 'SUPABASE_DB_PASSWORD') || pick(env, 'DB_PASSWORD') || ''
  const database = pick(env, 'SUPABASE_DB_NAME') || 'postgres'
  const ssl = asBoolean(pick(env, 'DB_SSL'), true)
  const rejectUnauthorized = asBoolean(pick(env, 'DB_SSL_REJECT_UNAUTHORIZED'), false)
  const candidates = []
  for (const [label, prefix] of [
    ['Supabase direct', 'SUPABASE_DB_DIRECT'],
    ['Supabase session pooler', 'SUPABASE_DB_POOLER'],
  ]) {
    const host = pick(env, `${prefix}_HOST`)
    const user = pick(env, `${prefix}_USER`)
    if (host && user && password) {
      candidates.push({
        label,
        host,
        port: asPort(pick(env, `${prefix}_PORT`), 5432),
        user,
        password,
        database,
        ssl,
        rejectUnauthorized,
      })
    }
  }
  return candidates
}

async function probe(Client, candidate) {
  const client = new Client({
    host: candidate.host,
    port: candidate.port,
    user: candidate.user,
    password: candidate.password,
    database: candidate.database,
    ssl: candidate.ssl ? { rejectUnauthorized: candidate.rejectUnauthorized } : false,
    connectionTimeoutMillis: 8000,
    query_timeout: 8000,
  })
  try {
    await client.connect()
    await client.query('select 1')
    return true
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN'
    process.stderr.write(`select-database: 探测失败 ${candidate.label}（${code}）\n`)
    return false
  } finally {
    await client.end().catch(() => undefined)
  }
}

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`

async function main() {
  if (!existsSync(envFile)) {
    process.stderr.write(
      `select-database: 找不到数据库配置文件 ${envFile}（请挂载 apps/backend/.env）\n`,
    )
    return 2
  }
  const env = parseEnvFile(readFileSync(envFile, 'utf8'))
  const candidates = buildCandidates(env)
  if (candidates.length === 0) {
    process.stderr.write('select-database: apps/backend/.env 缺少完整的 Supabase 连接参数\n')
    return 2
  }
  const { Client } = createRequire(requireBase)('pg')
  for (const candidate of candidates) {
    if (await probe(Client, candidate)) {
      process.stderr.write(`select-database: 数据库选择 ${candidate.label}\n`)
      const exports = {
        DB_CONNECTION: 'pg',
        DB_HOST: candidate.host,
        DB_PORT: String(candidate.port),
        DB_USER: candidate.user,
        DB_PASSWORD: candidate.password,
        DB_DATABASE: candidate.database,
        DB_SSL: String(candidate.ssl),
        DB_SSL_REJECT_UNAUTHORIZED: String(candidate.rejectUnauthorized),
      }
      for (const [key, value] of Object.entries(exports)) {
        process.stdout.write(`export ${key}=${shellQuote(value)}\n`)
      }
      return 0
    }
  }
  process.stderr.write('select-database: 所有 Supabase 候选均不可达，fail closed\n')
  return 2
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(
      `select-database: 失败 ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(1)
  })
