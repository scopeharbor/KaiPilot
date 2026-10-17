import { describe, expect, it } from 'vitest'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import {
  addMissingDeferredOrganizationFks,
  DEFERRED_TABLES,
} from '../../database/migrations/1839300000001_add_pg_org_fk_for_deferred_tables.js'

type RawCall = { sql: string; bindings?: unknown[] }

function fakeDb(results: unknown[]) {
  const calls: RawCall[] = []
  const db = {
    async rawQuery(sql: string, bindings?: unknown[]) {
      calls.push({ sql, bindings })
      return results.shift() ?? { rows: [] }
    },
  } as unknown as QueryClientContract
  return { db, calls }
}

describe('PostgreSQL deferred organization FK reconciliation', () => {
  it('fresh PG 在较晚建表尚不存在时安全跳过，不再触发 regclass cast 错误', async () => {
    const { db, calls } = fakeDb([{ rows: [{ table_oid: null }] }])

    await addMissingDeferredOrganizationFks(db, ['unified_ai_invocation_ledger'])

    expect(calls).toEqual([
      {
        sql: 'SELECT to_regclass(?) AS table_oid',
        bindings: ['public.unified_ai_invocation_ledger'],
      },
    ])
  })

  it('表存在且 constraint 缺失时补 FK，重复存在时不再 ALTER', async () => {
    const first = fakeDb([{ rows: [{ table_oid: '42' }] }, { rows: [] }, { rows: [] }])
    await addMissingDeferredOrganizationFks(first.db, ['unified_ai_invocation_ledger'])
    expect(first.calls).toHaveLength(3)
    expect(first.calls[2]?.sql).toContain(
      'ADD CONSTRAINT "fk_unified_ai_invocation_ledger_organization"',
    )
    expect(first.calls[2]?.sql).toContain('REFERENCES "public"."organizations"("id")')

    const repeated = fakeDb([{ rows: [{ table_oid: '42' }] }, { rows: [{ '?column?': 1 }] }])
    await addMissingDeferredOrganizationFks(repeated.db, ['unified_ai_invocation_ledger'])
    expect(repeated.calls).toHaveLength(2)
  })

  it('拒绝未受信任的 identifier，并锁定旧迁移清单确实含较晚创建的首张表', async () => {
    const { db, calls } = fakeDb([])
    await expect(
      addMissingDeferredOrganizationFks(db, ['unsafe;drop table users']),
    ).rejects.toThrow('Invalid deferred table identifier')
    expect(calls).toHaveLength(0)
    expect(DEFERRED_TABLES[0]).toBe('unified_ai_invocation_ledger')
  })
})
