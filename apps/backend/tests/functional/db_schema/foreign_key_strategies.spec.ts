import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import Database from 'better-sqlite3'

/** 单值插入返回 id（兼容 number | number[]）。 */
async function insertId(table: string, row: Record<string, unknown>): Promise<number> {
  const r = await db.table(table).insert(row)
  return Array.isArray(r) ? r[0] : r
}

/** 构造 user → org → project 链，返回关键 id。 */
async function buildChain(suffix: string) {
  const now = new Date().toISOString()
  const userId = await insertId('users', {
    full_name: `u-${suffix}`,
    email: `${suffix}@test.local`,
    password: 'x',
    created_at: now,
    updated_at: now,
  })
  const orgId = await insertId('organizations', {
    owner_id: userId,
    name: `org-${suffix}`,
    slug: `slug-${suffix}`,
    created_at: now,
    updated_at: now,
  })
  return { userId, orgId, now }
}

/**
 * 任务 6.1-6.5 — 外键策略集成测试。
 * 真实插入数据，验证 CASCADE / RESTRICT / SET NULL 三种策略在 PRAGMA foreign_keys=ON 下生效，
 * 反证关闭时不生效；并核对迁移可执行（全表就位 + adonis_schema 全 ran）。
 */
test.group('外键策略集成', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('6.1 CASCADE：删除 task 关联依赖自动删除', async ({ assert }) => {
    const { orgId, userId, now } = await buildChain(`casc-${Date.now()}`)
    const projectId = await insertId('projects', {
      organization_id: orgId,
      name: 'p',
      created_by: userId,
      created_at: now,
      updated_at: now,
    })
    const t1 = await insertId('tasks', {
      project_id: projectId,
      name: 't1',
      created_at: now,
      updated_at: now,
    })
    const t2 = await insertId('tasks', {
      project_id: projectId,
      name: 't2',
      created_at: now,
      updated_at: now,
    })
    await db.table('task_dependencies').insert({
      predecessor_id: t1,
      successor_id: t2,
      created_at: now,
      updated_at: now,
    })

    await db.from('tasks').where('id', t1).delete()

    const deps = await db.from('task_dependencies').where('predecessor_id', t1)
    assert.equal(deps.length, 0, '前置任务删除后，依赖记录应级联删除')
  })

  test('6.2 RESTRICT：删除仍拥有组织的用户被拒绝', async ({ assert }) => {
    const { userId } = await buildChain(`rest-${Date.now()}`)

    try {
      await db.from('users').where('id', userId).delete()
      assert.fail('应被 RESTRICT 阻止')
    } catch (e) {
      assert.match((e as Error).message, /FOREIGN KEY|constraint/i)
    }
  })

  test('6.3 SET NULL：删除 updated_by 用户后项目字段置空', async ({ assert }) => {
    const s = `setn-${Date.now()}`
    const now = new Date().toISOString()
    // created_by 用一个不会被删的用户；updated_by 用将被删的另一个用户
    const creatorId = await insertId('users', {
      email: `${s}-c@test.local`,
      password: 'x',
      created_at: now,
      updated_at: now,
    })
    const orgId = await insertId('organizations', {
      owner_id: creatorId,
      name: `org-${s}`,
      slug: `slug-${s}`,
      created_at: now,
      updated_at: now,
    })
    const updaterId = await insertId('users', {
      email: `${s}-u@test.local`,
      password: 'x',
      created_at: now,
      updated_at: now,
    })
    const projectId = await insertId('projects', {
      organization_id: orgId,
      name: 'p',
      created_by: creatorId,
      updated_by: updaterId,
      created_at: now,
      updated_at: now,
    })

    await db.from('users').where('id', updaterId).delete()

    const proj = await db.from('projects').where('id', projectId).first()
    assert.isNotNull(proj, '项目记录应保留')
    assert.isNull(proj.updated_by, 'updated_by 应被置 NULL')
  })

  test('6.4 PRAGMA：lucid 连接外键开启；关闭下约束失效（反证）', async ({ assert }) => {
    // 正：lucid 连接 foreign_keys = 1
    const res = await db.rawQuery('PRAGMA foreign_keys')
    const rows = ((res as any).rows ?? res) as any[]
    assert.equal(rows[0].foreign_keys, 1, 'lucid 连接应开启外键')

    // 反证：独立连接关闭外键后，RESTRICT 不再生效（子行成为孤儿也不报错）
    // 必须跟随 DB_TEST_DATABASE：并行会话用专属库跑全量时，写死 test.sqlite 会打开另一个空文件
    const raw = new Database(process.env.DB_TEST_DATABASE ?? 'test.sqlite')
    raw.pragma('foreign_keys = OFF')
    const before = raw.prepare('SELECT COUNT(*) AS n FROM task_dependencies').get() as { n: number }
    // 尝试删除一个被引用的 task（若存在），关闭外键时不应抛错
    const aTask = raw.prepare('SELECT id FROM tasks LIMIT 1').get() as { id: number } | undefined
    if (aTask) {
      raw.prepare('DELETE FROM tasks WHERE id = ?').run(aTask.id)
      // 关闭外键 → 删除 task 既不抛错，也不级联删除依赖（依赖计数不变）
      const after = raw.prepare('SELECT COUNT(*) AS n FROM task_dependencies').get() as {
        n: number
      }
      assert.equal(after.n, before.n, '外键关闭时删除 task 不应级联删除依赖')
    }
    raw.close()
  })

  test('6.5 迁移可执行：16 业务表就位 + adonis_schema 全 ran', async ({ assert }) => {
    const expected = [
      'users',
      'organizations',
      'organization_members',
      'projects',
      'project_roles',
      'project_members',
      'tasks',
      'task_dependencies',
      'milestones',
      'wbs_nodes',
      'comments',
      'attachments',
      'change_requests',
      'documents',
      'reports',
      'audit_logs',
    ]
    const res = await db.rawQuery(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'adonis_%'",
    )
    const tables = (((res as any).rows ?? res) as any[]).map((r) => r.name).sort()
    for (const t of expected) {
      assert.include(tables, t, `业务表 ${t} 应存在`)
    }

    // adonis_schema：每行即一条已执行迁移（16 业务表 + users + access_tokens）
    const schemaRes = await db.rawQuery('SELECT COUNT(*) AS n FROM adonis_schema')
    const rows = ((schemaRes as any).rows ?? schemaRes) as any[]
    assert.isAtLeast(rows[0].n, 16, '应至少执行 16 条业务表迁移')
  })
})
