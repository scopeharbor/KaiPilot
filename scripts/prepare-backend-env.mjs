#!/usr/bin/env node
/**
 * 从 apps/backend/.env.example 生成 apps/backend/.env 与 .env.test：本机 SQLite、内存限流、
 * 随机密钥（每次运行都不同，只用于本机试用、测试或本次 CI，不要用于对外部署）。
 *
 * 用法：node scripts/prepare-backend-env.mjs [--if-missing] [--root <仓库根目录>]
 *   --if-missing  已有 apps/backend/.env 时什么都不做（CI 使用，不覆盖已有的环境文件）
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const randomSecret = () => randomBytes(32).toString('base64url')

/**
 * @param {string} rootDir 仓库根目录
 * @param {{ ifMissing?: boolean, devDatabase?: string, testDatabase?: string }} [opts]
 * @returns {{ written: boolean }}
 */
export function prepareBackendEnv(
  rootDir,
  { ifMissing = false, devDatabase = 'tmp/dev.sqlite', testDatabase = 'tmp/test.sqlite' } = {},
) {
  const backend = join(rootDir, 'apps', 'backend')
  if (ifMissing && existsSync(join(backend, '.env'))) return { written: false }
  const example = join(backend, '.env.example')
  if (!existsSync(example)) throw new Error('apps/backend/.env.example 不存在，无法生成环境文件')
  const overrides = {
    NODE_ENV: 'development',
    APP_KEY: randomSecret(),
    JWT_ACCESS_SECRET: randomSecret(),
    AI_CONNECTION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    INTEGRATION_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    AIPROJ_DATABASE_MODE: 'local',
    DB_CONNECTION: 'sqlite',
    DB_DATABASE: devDatabase,
    LIMITER_STORE: 'memory',
  }
  const seen = new Set()
  const out = readFileSync(example, 'utf8')
    .split('\n')
    .map((line) => {
      const m = /^([A-Z0-9_]+)=/.exec(line)
      if (!m || !(m[1] in overrides)) return line
      seen.add(m[1])
      return `${m[1]}=${overrides[m[1]]}`
    })
  for (const [k, v] of Object.entries(overrides)) if (!seen.has(k)) out.push(`${k}=${v}`)
  writeFileSync(join(backend, '.env'), out.join('\n'))
  writeFileSync(
    join(backend, '.env.test'),
    [
      'NODE_ENV=test',
      'DB_CONNECTION=sqlite',
      `DB_TEST_DATABASE=${testDatabase}`,
      'AIPROJ_DATABASE_MODE=local',
      '',
    ].join('\n'),
  )
  mkdirSync(join(backend, 'tmp'), { recursive: true })
  return { written: true }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      'if-missing': { type: 'boolean', default: false },
      root: { type: 'string', default: process.cwd() },
    },
  })
  const { written } = prepareBackendEnv(resolve(values.root), { ifMissing: values['if-missing'] })
  console.log(
    written
      ? '已生成 apps/backend/.env 与 .env.test（随机密钥）'
      : '已有 apps/backend/.env，未改动',
  )
}
