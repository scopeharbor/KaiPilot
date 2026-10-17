import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import {
  buildSupabaseCandidates,
  parseDatabaseMode,
  parseEnvFile,
  pgEnvironment,
  selectSupabaseCandidate,
  sqliteEnvironment,
  type DatabaseCandidate,
} from './database-selection.js'

function findRepoRoot(start: string): string {
  let current = start
  const root = parse(current).root
  while (current !== root) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current
    current = dirname(current)
  }
  throw new Error('找不到 pnpm-workspace.yaml，无法定位仓库根目录')
}

const repoRoot = findRepoRoot(process.cwd())
const backendRoot = join(repoRoot, 'apps', 'backend')
const envFile = join(backendRoot, '.env')
const backendRequire = createRequire(join(backendRoot, 'package.json'))
const { Client } = backendRequire('pg') as {
  Client: new (config: Record<string, unknown>) => {
    connect(): Promise<void>
    query(sql: string): Promise<unknown>
    end(): Promise<void>
  }
}

function loadEnvironment(): NodeJS.ProcessEnv {
  const fileValues = parseEnvFile(readFileSync(envFile, 'utf8'))
  return { ...fileValues, ...process.env }
}

async function probe(candidate: DatabaseCandidate): Promise<boolean> {
  const client = new Client({
    host: candidate.host,
    port: candidate.port,
    user: candidate.user,
    password: candidate.password,
    database: candidate.database,
    ssl: candidate.ssl ? { rejectUnauthorized: candidate.rejectUnauthorized } : false,
    connectionTimeoutMillis: 8_000,
    query_timeout: 8_000,
  })
  try {
    await client.connect()
    await client.query('select 1')
    console.log(`数据库探测成功：${candidate.label}`)
    return true
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? 'UNKNOWN')
        : 'UNKNOWN'
    console.warn(`数据库探测失败：${candidate.label}（${code}）`)
    return false
  } finally {
    await client.end().catch(() => undefined)
  }
}

function run(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', shell: false })
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
}

async function selectExternal(env: NodeJS.ProcessEnv): Promise<DatabaseCandidate | null> {
  const candidates = buildSupabaseCandidates(env)
  if (candidates.length === 0) {
    console.warn('没有完整的 Supabase PostgreSQL 连接参数')
    return null
  }
  return selectSupabaseCandidate(candidates, probe)
}

async function localDev(env: NodeJS.ProcessEnv): Promise<number> {
  const mode = parseDatabaseMode(env.AIPROJ_DATABASE_MODE)
  if (mode === 'local') {
    console.log('数据库选择：本机 SQLite（手动 local 模式）')
    return run(process.execPath, ['ace', 'serve', '--watch'], backendRoot, sqliteEnvironment(env))
  }

  const selected = await selectExternal(env)
  if (selected) {
    console.log(`数据库选择：${selected.label}`)
    return run(
      process.execPath,
      ['ace', 'serve', '--watch'],
      backendRoot,
      pgEnvironment(env, selected),
    )
  }
  if (mode === 'supabase') {
    console.error('数据库选择失败：supabase 模式禁止降级')
    return 2
  }
  console.warn('数据库选择：Supabase 不可达，启动阶段自动降级到本机 SQLite')
  return run(process.execPath, ['ace', 'serve', '--watch'], backendRoot, sqliteEnvironment(env))
}

async function dockerUp(env: NodeJS.ProcessEnv): Promise<number> {
  const mode = parseDatabaseMode(env.AIPROJ_DATABASE_MODE)
  let composeFile = 'compose.yaml'
  let effectiveEnv = env

  if (mode !== 'local') {
    const selected = await selectExternal(env)
    if (selected) {
      composeFile = 'compose.supabase.yaml'
      effectiveEnv = pgEnvironment(env, selected)
      console.log(`Docker 数据库选择：${selected.label}（不启动内置 PostgreSQL）`)
    } else if (mode === 'supabase') {
      console.error('Docker 数据库选择失败：supabase 模式禁止降级')
      return 2
    } else {
      console.warn('Docker 数据库选择：Supabase 不可达，启动内置 PostgreSQL 栈')
    }
  } else {
    console.log('Docker 数据库选择：内置 PostgreSQL（手动 local 模式）')
  }

  return run(
    'docker',
    ['compose', '--env-file', 'apps/backend/.env', '-f', composeFile, 'up', '-d', '--build'],
    repoRoot,
    effectiveEnv,
  )
}

async function migrateSupabase(env: NodeJS.ProcessEnv): Promise<number> {
  const selected = await selectExternal(env)
  if (!selected) {
    console.error('无法连接 Supabase，迁移已中止')
    return 2
  }
  console.log(`迁移数据库选择：${selected.label}`)
  return run(
    process.execPath,
    ['ace', 'migration:run', '--force'],
    backendRoot,
    pgEnvironment(env, selected),
  )
}

/** 本机直连 Supabase 建立/升级平台超级管理员（ace admin:create-super，参数透传）。 */
async function adminCreate(env: NodeJS.ProcessEnv, args: string[]): Promise<number> {
  const selected = await selectExternal(env)
  if (!selected) {
    console.error('无法连接 Supabase，建立管理账号已中止')
    return 2
  }
  console.log(`管理账号数据库选择：${selected.label}`)
  return run(
    process.execPath,
    ['ace', 'admin:create-super', ...args],
    backendRoot,
    pgEnvironment(env, selected),
  )
}

/**
 * 目标机 Docker 内建立管理账号：与 docker-up 同一数据库选择，注入 DB_HOST/DB_USER/DB_PASSWORD，
 * 避免直接 `docker compose run` 时 compose 插值缺值报错。
 */
async function dockerAdminCreate(env: NodeJS.ProcessEnv, args: string[]): Promise<number> {
  const mode = parseDatabaseMode(env.AIPROJ_DATABASE_MODE)
  let composeFile = 'compose.yaml'
  let effectiveEnv = env
  if (mode !== 'local') {
    const selected = await selectExternal(env)
    if (selected) {
      composeFile = 'compose.supabase.yaml'
      effectiveEnv = pgEnvironment(env, selected)
    } else if (mode === 'supabase') {
      console.error('Docker 数据库选择失败：supabase 模式禁止降级')
      return 2
    }
  }
  return run(
    'docker',
    [
      'compose',
      '--env-file',
      'apps/backend/.env',
      '-f',
      composeFile,
      'run',
      '--rm',
      '--no-deps',
      'backend',
      'admin-create',
      ...args,
    ],
    repoRoot,
    effectiveEnv,
  )
}

async function main(): Promise<number> {
  const command = process.argv[2]
  const rest = process.argv.slice(3)
  const env = loadEnvironment()
  if (command === 'local-dev') return localDev(env)
  if (command === 'docker-up') return dockerUp(env)
  if (command === 'migrate-supabase') return migrateSupabase(env)
  if (command === 'admin-create') return adminCreate(env, rest)
  if (command === 'docker-admin-create') return dockerAdminCreate(env, rest)
  if (command === 'probe') return (await selectExternal(env)) ? 0 : 2
  console.error(
    '用法：database-launcher.ts <local-dev|docker-up|migrate-supabase|admin-create|docker-admin-create|probe>',
  )
  return 64
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`数据库启动器失败：${message}`)
    process.exitCode = 1
  })
