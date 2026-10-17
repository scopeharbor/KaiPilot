import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import { columnNames, foreignKeys, assertForeignKey, columnDefault } from './_helpers.js'

/**
 * 任务 2.4 — 用户与组织域三表结构校验。
 * 覆盖：字段、索引、外键策略（owner RESTRICT、org CASCADE、invited_by SET NULL）。
 */
test.group('用户与组织域结构', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('users 表含扩展字段与默认值', async ({ assert }) => {
    const cols = await columnNames('users')
    for (const c of [
      'auth_provider',
      'provider_id',
      'preferences',
      'is_active',
      'email_verified_at',
      'deleted_at',
    ]) {
      assert.include(cols, c, `users 应含字段 ${c}`)
    }

    assert.equal(await columnDefault('users', 'auth_provider'), "'local'")
    // SQLite 布尔默认 '1'（Knex 以字符串字面量存储）
    assert.equal(await columnDefault('users', 'is_active'), "'1'")
  })

  test('users 含 (auth_provider, provider_id) 联合唯一索引', async ({ assert }) => {
    const res = await db.rawQuery(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='users' AND sql LIKE '%auth_provider%provider_id%'",
    )
    const rows = (res as { rows?: any[] }).rows ?? (res as any[])
    assert.isAtLeast(rows.length, 1, '应存在 (auth_provider, provider_id) 联合唯一索引')
  })

  test('organizations 表字段与 owner_id RESTRICT', async ({ assert }) => {
    const cols = await columnNames('organizations')
    for (const c of [
      'owner_id',
      'name',
      'slug',
      'plan_tier',
      'max_projects',
      'max_members',
      'settings',
      'deleted_at',
    ]) {
      assert.include(cols, c)
    }
    const fks = await foreignKeys('organizations')
    assertForeignKey(fks, 'owner_id', 'users', 'RESTRICT')
  })

  test('organization_members 联合唯一与三种外键策略', async ({ assert }) => {
    const fks = await foreignKeys('organization_members')
    assertForeignKey(fks, 'organization_id', 'organizations', 'CASCADE')
    assertForeignKey(fks, 'user_id', 'users', 'CASCADE')
    assertForeignKey(fks, 'invited_by', 'users', 'SET NULL')

    // 联合唯一索引存在
    const res = await db.rawQuery(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='organization_members' AND sql LIKE '%organization_id%user_id%' AND sql LIKE '%UNIQUE%'",
    )
    const rows = (res as { rows?: any[] }).rows ?? (res as any[])
    assert.isAtLeast(rows.length, 1, '应存在 (organization_id, user_id) 联合唯一索引')
  })
})
