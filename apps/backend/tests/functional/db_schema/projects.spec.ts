import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import {
  columnNames,
  foreignKeys,
  assertForeignKey,
  tableSql,
  hasUniqueIndex,
  checkEnum,
} from './_helpers.js'

/**
 * 任务 3.4 — 项目域三表结构校验。
 * 覆盖：字段、索引、外键策略（projects→org CASCADE、created_by RESTRICT、updated_by SET NULL、
 * wbs_root_id→wbs_nodes SET NULL、project_roles 删除级联）。
 */
test.group('项目域结构', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('projects 表核心字段与外键策略', async ({ assert }) => {
    const cols = await columnNames('projects')
    for (const c of [
      'organization_id',
      'name',
      'code',
      'status',
      'priority',
      'budget_cents',
      'actual_cost_cents',
      'currency',
      'progress_percent',
      'health_status',
      'wbs_root_id',
      'diagram_spec',
      'ai_metadata',
      'created_by',
      'updated_by',
      'deleted_at',
    ]) {
      assert.include(cols, c, `projects 应含字段 ${c}`)
    }

    const fks = await foreignKeys('projects')
    assertForeignKey(fks, 'organization_id', 'organizations', 'CASCADE')
    assertForeignKey(fks, 'created_by', 'users', 'RESTRICT')
    assertForeignKey(fks, 'updated_by', 'users', 'SET NULL')
    // 循环外键：wbs_root_id → wbs_nodes SET NULL（由 wbs_nodes 迁移补加）
    assertForeignKey(fks, 'wbs_root_id', 'wbs_nodes', 'SET NULL')
  })

  test('projects 金额分整数字段（DEBT-01）+ 状态/优先级枚举 CHECK', async ({ assert }) => {
    const cols = await columnNames('projects')
    assert.include(cols, 'budget_cents', '金额以分整数存储')
    assert.include(cols, 'actual_cost_cents')

    const sql = await tableSql('projects')
    assert.isTrue(checkEnum(sql, 'status', ['draft', 'planning', 'active']), 'status 枚举 CHECK')
    assert.isTrue(
      checkEnum(sql, 'priority', ['low', 'medium', 'high', 'critical']),
      'priority 枚举 CHECK',
    )
    assert.isTrue(checkEnum(sql, 'health_status', ['green', 'yellow']), 'health_status 枚举 CHECK')
  })

  test('projects 含 (organization_id,status) 与 (start_date,end_date) 索引', async ({ assert }) => {
    const res = await import('@adonisjs/lucid/services/db')
    const db = res.default
    const idxRes = await db.rawQuery(
      "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='projects'",
    )
    const sqlText = (((idxRes as any).rows ?? idxRes) as any[]).map((r) => r.sql ?? '').join('\n')
    assert.match(
      sqlText,
      /organization_id.*status|status.*organization_id/s,
      '应有 (org,status) 索引',
    )
    assert.match(sqlText, /start_date.*end_date|end_date.*start_date/s, '应有日期索引')
  })

  test('project_roles：project_id CASCADE + (project_id,name) 联合唯一', async ({ assert }) => {
    const fks = await foreignKeys('project_roles')
    assertForeignKey(fks, 'project_id', 'projects', 'CASCADE')
    assert.isTrue(await hasUniqueIndex('project_roles', ['project_id', 'name']))
  })

  test('project_members：联合唯一 + project_role_id SET NULL', async ({ assert }) => {
    const fks = await foreignKeys('project_members')
    assertForeignKey(fks, 'project_id', 'projects', 'CASCADE')
    assertForeignKey(fks, 'project_role_id', 'project_roles', 'SET NULL')
    assert.isTrue(await hasUniqueIndex('project_members', ['project_id', 'user_id']))
  })
})
