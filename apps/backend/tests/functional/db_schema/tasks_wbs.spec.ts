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
 * 任务 4.5 — 任务与 WBS 域结构校验。
 * 覆盖：tasks 字段/索引/CPM 字段、parent_task_id 自引用 CASCADE、
 * task_dependencies 联合唯一防重复、wbs_nodes 字段。
 */
test.group('任务与 WBS 域结构', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('tasks 核心字段、CPM 字段与金额分整数', async ({ assert }) => {
    const cols = await columnNames('tasks')
    for (const c of [
      'project_id',
      'name',
      'status',
      'priority',
      'task_type',
      'start_date',
      'end_date',
      'assignee_id',
      'reviewer_id',
      'parent_task_id',
      'wbs_node_id',
      'milestone_id',
      'is_critical_path',
      'earliest_start',
      'earliest_finish',
      'latest_start',
      'latest_finish',
      'total_float',
      'free_float',
      'cpm_calculated_at',
      'cost_estimate_cents',
      'cost_actual_cents',
      'ai_metadata',
      'custom_fields',
      'deleted_at',
      'progress_percent',
      'kanban_rank',
    ]) {
      assert.include(cols, c, `tasks 应含字段 ${c}`)
    }
  })

  test('tasks 外键策略：parent_task_id 自引用 CASCADE、人员 SET NULL', async () => {
    const fks = await foreignKeys('tasks')
    assertForeignKey(fks, 'project_id', 'projects', 'CASCADE')
    assertForeignKey(fks, 'parent_task_id', 'tasks', 'CASCADE')
    assertForeignKey(fks, 'assignee_id', 'users', 'SET NULL')
    assertForeignKey(fks, 'reviewer_id', 'users', 'SET NULL')
    assertForeignKey(fks, 'milestone_id', 'milestones', 'SET NULL')
    // 循环外键：wbs_node_id → wbs_nodes SET NULL（由 wbs_nodes 迁移补加）
    assertForeignKey(fks, 'wbs_node_id', 'wbs_nodes', 'SET NULL')
  })

  test('tasks 状态/优先级/类型枚举 CHECK + 核心索引', async ({ assert }) => {
    const sql = await tableSql('tasks')
    assert.isTrue(
      checkEnum(sql, 'status', ['not_started', 'in_progress', 'completed']),
      'status 枚举 CHECK',
    )
    assert.isTrue(
      checkEnum(sql, 'priority', ['lowest', 'low', 'medium', 'high', 'highest']),
      'priority 枚举 CHECK',
    )
    assert.isTrue(
      checkEnum(sql, 'task_type', ['task', 'milestone', 'summary', 'deliverable']),
      'task_type 枚举 CHECK',
    )
  })

  test('task_dependencies：联合唯一防重复 + 双向 CASCADE', async ({ assert }) => {
    const fks = await foreignKeys('task_dependencies')
    assertForeignKey(fks, 'predecessor_id', 'tasks', 'CASCADE')
    assertForeignKey(fks, 'successor_id', 'tasks', 'CASCADE')
    assert.isTrue(await hasUniqueIndex('task_dependencies', ['predecessor_id', 'successor_id']))
    const sql = await tableSql('task_dependencies')
    assert.isTrue(checkEnum(sql, 'type', ['fs', 'ss', 'ff', 'sf']), 'type 枚举 CHECK')
  })

  test('wbs_nodes 字段与 project_id CASCADE', async ({ assert }) => {
    const cols = await columnNames('wbs_nodes')
    for (const c of [
      'project_id',
      'parent_id',
      'path',
      'code',
      'depth',
      'is_leaf',
      'collapsed',
      'task_id',
      'display_order',
      'deleted_at',
    ]) {
      assert.include(cols, c, `wbs_nodes 应含字段 ${c}`)
    }
    const fks = await foreignKeys('wbs_nodes')
    assertForeignKey(fks, 'project_id', 'projects', 'CASCADE')
    assertForeignKey(fks, 'parent_id', 'wbs_nodes', 'SET NULL')
    assertForeignKey(fks, 'task_id', 'tasks', 'SET NULL')
  })
})
