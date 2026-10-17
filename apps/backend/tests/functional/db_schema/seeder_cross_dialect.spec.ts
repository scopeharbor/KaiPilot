import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import { insertReturningId, normalizeId } from '#database/support/insert_returning_id'

/**
 * seeder 跨方言冒烟：用真实驱动守住「取回的主键可当外键」与「重跑 = 无操作」。
 *
 * 连接跟随测试套件配置（默认 SQLite），因此在 PostgreSQL 测试连接下运行即是 PG 验证。
 * 只比行数抓不到 PG 上判据恒真导致的无意义 UPDATE（行数不变，但 updated_at 被改写），
 * 所以这里给稳定行打上哨兵 updated_at，重跑后断言哨兵原样保留。
 *
 * 全新库上 seeder 按字母序执行、依赖数据要到第二轮才齐，故先跑两轮再取基线。
 */

const SENTINEL_UPDATED_AT = '2000-01-01 00:00:00'

const DEV_USER_EMAILS = [
  'admin@aiproj.local',
  'superadmin@aiproj.local',
  'org-admin@aiproj.local',
  'org-member@aiproj.local',
  'org-viewer@aiproj.local',
]

// KMS 种子（企业版）：个人版没有 KMS 表与种子，相关断言随标记剥离

const SEEDED_TABLES = [
  'users',
  'organizations',
  'organization_members',
  'projects',
  'project_roles',
  'project_members',
  'tasks',
  'resources',
  'resource_allocations',
  'wbs_nodes',
  'ai_connections',
  'ai_connection_models',
]

async function countRows(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of SEEDED_TABLES) {
    const [row] = await db.from(table).count('* as total')
    // PG 的 count 以字符串回传
    counts[table] = Number(row.total)
  }
  return counts
}

test.group('seeder 跨方言冒烟', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('真实驱动下 insertReturningId 取回的主键是 number 且可作外键', async ({ assert }) => {
    const trx = await db.transaction()
    try {
      const now = '2026-01-01 00:00:00'
      const userId = await insertReturningId(trx, 'users', {
        full_name: '跨方言取键探针',
        email: 'seeder-cross-dialect-probe@aiproj.local',
        password: 'not-a-real-hash',
        auth_provider: 'local',
        is_active: 1,
        created_at: now,
        updated_at: now,
      })
      assert.isNumber(userId)
      assert.isTrue(Number.isSafeInteger(userId) && userId > 0)

      // 原故障就发生在「把取回值写进下一张表的外键」这一步
      const organizationId = await insertReturningId(trx, 'organizations', {
        owner_id: userId,
        name: '跨方言取键探针组织',
        slug: 'seeder-cross-dialect-probe',
        plan_tier: 'free',
        created_at: now,
        updated_at: now,
      })
      assert.isNumber(organizationId)

      const organization = await trx.from('organizations').where('id', organizationId).first()
      assert.strictEqual(normalizeId(organization.owner_id), userId)
    } finally {
      await trx.rollback()
    }
  })

  test('三轮 db:seed：行数不变、稳定行不被改写、外键引用正确', async ({ assert }) => {
    await testUtils.db().seed()
    await testUtils.db().seed()

    const defaultOrg = await db.from('organizations').where('slug', 'default-org').first()
    const demoOrg = await db.from('organizations').where('slug', 'demo-org').first()
    assert.isOk(defaultOrg, '默认组织应存在')
    assert.isOk(demoOrg, '示范组织应存在')

    const defaultProject = await db
      .from('projects')
      .where('organization_id', defaultOrg.id)
      .where('code', 'DEMO')
      .first()
    const demoProject = await db
      .from('projects')
      .where('organization_id', demoOrg.id)
      .where('code', 'DEMO')
      .first()
    assert.isOk(defaultProject, '默认组织演示项目应存在')
    assert.isOk(demoProject, '示范项目应存在')

    // 这些行在 test 环境下的 seeder 里只在判据不一致时才 UPDATE，重跑必须零写入
    const stableRows = {
      users: () => db.from('users').whereIn('email', DEV_USER_EMAILS),
      organizations: () => db.from('organizations').whereIn('id', [defaultOrg.id, demoOrg.id]),
      organization_members: () =>
        db.from('organization_members').where('organization_id', defaultOrg.id),
      project_roles: () =>
        db.from('project_roles').whereIn('project_id', [defaultProject.id, demoProject.id]),
      project_members: () => db.from('project_members').where('project_id', defaultProject.id),
      ai_connections: () => db.from('ai_connections').where('organization_id', defaultOrg.id),
    }

    for (const [table, query] of Object.entries(stableRows)) {
      const rows = await query()
      assert.isAbove(rows.length, 0, `${table} 应有种子行`)
      await query().update({ updated_at: SENTINEL_UPDATED_AT })
    }

    const before = await countRows()
    await testUtils.db().seed()
    const after = await countRows()

    assert.deepEqual(after, before, '第三轮 db:seed 不应新增或删除任何行')

    for (const [table, query] of Object.entries(stableRows)) {
      const rewritten = await query().whereNot('updated_at', SENTINEL_UPDATED_AT)
      assert.lengthOf(
        rewritten,
        0,
        `${table} 的稳定行被重跑改写了 updated_at（判据可能因方言回传形态失真而恒真）`,
      )
    }

    // 外键必须指向真实主键，而不是被当作 id 写入的驱动结果对象
    const admin = await db.from('users').where('email', 'admin@aiproj.local').first()
    assert.strictEqual(normalizeId(defaultOrg.owner_id), normalizeId(admin.id))

    const members = await db
      .from('project_members as pm')
      .leftJoin('project_roles as pr', 'pr.id', 'pm.project_role_id')
      .where('pm.project_id', defaultProject.id)
      .select('pm.id', 'pr.project_id as role_project_id')
    assert.lengthOf(members, 4, '默认演示项目应有 4 名成员')
    for (const member of members) {
      assert.strictEqual(
        normalizeId(member.role_project_id),
        normalizeId(defaultProject.id),
        '项目成员的角色必须属于同一项目',
      )
    }
  }).timeout(120000)
})
