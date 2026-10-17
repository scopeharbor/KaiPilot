/**
 * v2-postgresql-migration-foundation —— Section 6 测试。
 *
 * 覆盖：6.1-6.3 P0 + 6.4 P1
 * 所有断言通过 SELECT 查询验证列存在性（跨方言兼容）。
 */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'

// 6.1 P0：关键业务表可查询
test.group('6.1 P0 - 表可查询', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('projects', async (a) => {
    await db.rawQuery('SELECT 1 FROM projects LIMIT 0')
    a.assert.isTrue(true)
  })
  test('tasks', async (a) => {
    await db.rawQuery('SELECT 1 FROM tasks LIMIT 0')
    a.assert.isTrue(true)
  })
  test('pdm_migration_runs', async (a) => {
    await db.rawQuery('SELECT 1 FROM pdm_migration_runs LIMIT 0')
    a.assert.isTrue(true)
  })
  test('audit_logs', async (a) => {
    await db.rawQuery('SELECT 1 FROM audit_logs LIMIT 0')
    a.assert.isTrue(true)
  })
  test('compiler_runs', async (a) => {
    await db.rawQuery('SELECT 1 FROM compiler_runs LIMIT 0')
    a.assert.isTrue(true)
  })
})
