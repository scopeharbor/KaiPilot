import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import YAML from 'yaml'
import {
  buildSupabaseCandidates,
  parseDatabaseMode,
  parseEnvFile,
  selectSupabaseCandidate,
  sqliteEnvironment,
} from './database-selection.js'

test('解析数据库模式并拒绝未知值', () => {
  assert.equal(parseDatabaseMode(undefined), 'auto')
  assert.equal(parseDatabaseMode('SUPABASE'), 'supabase')
  assert.throws(() => parseDatabaseMode('mystery'), /只允许 auto、supabase 或 local/)
})

test('解析 env 时保留等号并忽略注释', () => {
  assert.deepEqual(
    parseEnvFile(
      '# 注释\nHOST=localhost\nPORT=3333\nA=one=two\nB="three"\nURL=http://${HOST}:${PORT}\n',
    ),
    {
      HOST: 'localhost',
      PORT: '3333',
      A: 'one=two',
      B: 'three',
      URL: 'http://localhost:3333',
    },
  )
})

test('Supabase 候选固定为 direct 优先、session pooler 次之', () => {
  const candidates = buildSupabaseCandidates({
    DB_PASSWORD: 'secret',
    SUPABASE_DB_DIRECT_HOST: 'db.example.supabase.co',
    SUPABASE_DB_DIRECT_USER: 'postgres',
    SUPABASE_DB_POOLER_HOST: 'pooler.example.supabase.com',
    SUPABASE_DB_POOLER_USER: 'postgres.ref',
  })
  assert.deepEqual(
    candidates.map((candidate) => candidate.id),
    ['direct', 'session-pooler'],
  )
})

test('探测失败时依序尝试下一个 Supabase 候选', async () => {
  const candidates = buildSupabaseCandidates({
    DB_PASSWORD: 'secret',
    SUPABASE_DB_DIRECT_HOST: 'direct',
    SUPABASE_DB_DIRECT_USER: 'postgres',
    SUPABASE_DB_POOLER_HOST: 'pooler',
    SUPABASE_DB_POOLER_USER: 'postgres.ref',
  })
  const attempted: string[] = []
  const selected = await selectSupabaseCandidate(candidates, async (candidate) => {
    attempted.push(candidate.id)
    return candidate.id === 'session-pooler'
  })
  assert.deepEqual(attempted, ['direct', 'session-pooler'])
  assert.equal(selected?.id, 'session-pooler')
})

test('SQLite 降级使用独立的本机文件设置', () => {
  const selected = sqliteEnvironment({ AIPROJ_SQLITE_DATABASE: 'fallback.sqlite' })
  assert.equal(selected.DB_CONNECTION, 'sqlite')
  assert.equal(selected.DB_DATABASE, 'fallback.sqlite')
})

test('Supabase Compose 不建立内置 PG，但继续提供 Redis', () => {
  const document = YAML.parse(readFileSync('compose.supabase.yaml', 'utf8')) as {
    services: Record<string, { depends_on?: Record<string, unknown> }>
    volumes: Record<string, unknown>
  }
  assert.deepEqual(Object.keys(document.services).sort(), [
    'backend',
    'edge',
    'frontend',
    'init-config',
    'migrate',
    'redis',
  ])
  assert.equal(document.services.postgres, undefined)
  assert.equal(document.volumes.pgdata, undefined)
  assert.ok(document.services.redis)
  assert.equal(document.services.migrate.depends_on?.postgres, undefined)
  assert.equal(document.services.backend.depends_on?.postgres, undefined)
})
