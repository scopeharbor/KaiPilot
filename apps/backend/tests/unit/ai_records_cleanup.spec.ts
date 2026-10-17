import { afterEach, describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { cleanupAiRecords } from '../../app/services/ai_records/cleanup_service.js'

// 使用 Lucid 自带的 knex 与真实 SQLite 事务，避免把 mock 删除当作数据保留证据。
const require = createRequire(import.meta.url)
const knex = createRequire(require.resolve('@adonisjs/lucid'))('knex')
const clients: Array<ReturnType<typeof knex>> = []
afterEach(async () => {
  for (const client of clients.splice(0)) await client.destroy()
})
async function fixture() {
  const client = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  })
  clients.push(client)
  await client.raw('PRAGMA foreign_keys = ON')
  await client.schema.createTable('audit_logs', (t: any) => {
    t.increments('id')
    t.text('action')
    t.text('entity_type')
    t.text('severity')
    t.text('metadata')
    t.timestamp('created_at')
  })
  for (const table of [
    'projects',
    'tasks',
    'ai_connections',
    'ai_connection_models',
    'copilot_sessions',
    'unified_ai_invocation_ledger',
  ]) {
    await client.schema.createTable(table, (t: any) => {
      t.increments('id')
      t.text('content')
    })
    await client(table).insert({ content: table + ' 内容' })
  }
  await client.schema.createTable('copilot_messages', (t: any) => {
    t.increments('id')
    t.integer('session_db_id').references('id').inTable('copilot_sessions')
    t.text('content')
  })
  await client('copilot_messages').insert({ session_db_id: 1, content: '私有对话' })
  return client
}

describe('AI 记录清理事务', () => {
  test('盘点不删除；apply 删除父子对话与成本记录，保留业务和设置，重复执行幂等', async () => {
    const client = await fixture()
    const report = await cleanupAiRecords(client)
    expect(report.applied).toBe(false)
    expect(report.total).toBe(3)
    expect(await client('copilot_messages')).toHaveLength(1)
    const applied = await cleanupAiRecords(client, true)
    expect(applied.total).toBe(3)
    const audit = await client('audit_logs').first()
    expect(audit.action).toBe('delete')
    expect(audit.metadata).not.toContain('私有对话')
    for (const table of ['copilot_sessions', 'copilot_messages', 'unified_ai_invocation_ledger'])
      expect(await client(table)).toHaveLength(0)
    for (const table of ['projects', 'tasks', 'ai_connections', 'ai_connection_models'])
      expect(await client(table)).toHaveLength(1)
    const repeated = await cleanupAiRecords(client, true)
    expect(repeated.total).toBe(0)
  })

  test('外键阻断时全部回滚，不留下删了一半的历史', async () => {
    const client = await fixture()
    await client.schema.createTable('protected_business', (t: any) => {
      t.increments('id')
      t.integer('session_id').references('id').inTable('copilot_sessions').onDelete('RESTRICT')
    })
    await client('protected_business').insert({ session_id: 1 })
    await expect(cleanupAiRecords(client, true)).rejects.toThrow()
    expect(await client('copilot_messages')).toHaveLength(1)
    expect(await client('copilot_sessions')).toHaveLength(1)
    expect(await client('unified_ai_invocation_ledger')).toHaveLength(1)
    expect(await client('protected_business')).toHaveLength(1)
    expect(await client('audit_logs')).toHaveLength(0)
  })
})
