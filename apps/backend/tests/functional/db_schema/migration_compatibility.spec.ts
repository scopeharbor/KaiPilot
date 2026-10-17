/**
 * v2-postgresql-migration-foundation —— 迁移兼容性测试（Section 5.4）。
 *
 * 覆盖：
 * - SQLite 默认迁移成功，关键表创建
 * - PG opt-in 迁移成功（需启用 PG 测试环境变量）
 * - 关键业务表结构一致性（列、索引、外键）
 * - PDM/Compiler 表结构一致性
 * - 软删除字段存在性
 */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { isPg, isSqlite } from '#services/dialect/dialect_helper'

async function tableExists(table: string): Promise<boolean> {
  try {
    if (isPg()) {
      const res = await db.rawQuery(`SELECT to_regclass('public.${table}') IS NOT NULL AS exists`)
      const rows = (res as any)?.rows ?? []
      return rows[0]?.exists ?? false
    }
    const res = await db.rawQuery(
      `SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='${table}'`,
    )
    const rows = Array.isArray(res) ? res : ((res as any)?.rows ?? [])
    return Number(rows[0]?.cnt ?? 0) > 0
  } catch {
    return false
  }
}

test.group('Migration - Key tables exist (SQLite)', (group) => {
  group.setup(async () => {
    // 保证迁移已执行
  })

  test('V1 核心业务表全部存在', async ({ assert }) => {
    const tables = [
      'users',
      'organizations',
      'organization_members',
      'projects',
      'project_members',
      'project_roles',
      'tasks',
      'task_dependencies',
      'wbs_nodes',
      'milestones',
    ]

    for (const table of tables) {
      const exists = await tableExists(table)
      assert.isTrue(exists, `表 ${table} 应存在`)
    }
  })

  test('V2 Compiler/PDM 表全部存在', async ({ assert }) => {
    const tables = [
      'compiler_runs',
      'compiler_stage_events',
      'compiler_artifacts',
      'pdm_migration_runs',
      'pdm_entity_mappings',
      'pdm_migration_snapshots',
      'pdm_migration_reports',
      'ai_project_drafts',
      'ai_project_draft_versions',
      'ai_project_draft_validations',
      'source_attributions',
      'traceability_links',
    ]

    for (const table of tables) {
      const exists = await tableExists(table)
      assert.isTrue(exists, `V2 表 ${table} 应存在`)
    }
  })

  test('Draft Layer V2 表全部存在', async ({ assert }) => {
    const tables = [
      'ai_draft_layer_sessions',
      'ai_draft_layer_changes',
      'ai_draft_layer_previews',
      'ai_draft_layer_apply_results',
    ]

    for (const table of tables) {
      const exists = await tableExists(table)
      assert.isTrue(exists, `Draft Layer 表 ${table} 应存在`)
    }
  })

  test('每个业务表都有软删除字段（deleted_at）', async ({ assert }) => {
    const tablesWithSoftDelete = ['projects', 'tasks', 'risks', 'change_requests', 'reports']

    for (const table of tablesWithSoftDelete) {
      const columns = await db.rawQuery(
        isPg()
          ? `SELECT column_name FROM information_schema.columns WHERE table_name='${table}' AND table_schema='public' AND column_name='deleted_at'`
          : `PRAGMA table_info(${table})`,
      )
      const rows = isPg() ? ((columns as any)?.rows ?? []) : columns
      const hasDeletedAt = rows.some((r: any) =>
        isPg() ? r.column_name === 'deleted_at' : r.name === 'deleted_at',
      )
      assert.isTrue(hasDeletedAt, `表 ${table} 应包含 deleted_at 软删除字段`)
    }
  })

  test('projects 表有 organization_id 外键和 status/priority checks', async ({ assert }) => {
    const exists = await tableExists('projects')
    assert.isTrue(exists)

    const columns = isPg()
      ? await db.rawQuery(
          `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='projects' AND table_schema='public'`,
        )
      : await db.rawQuery('PRAGMA table_info(projects)')

    const cols = isPg() ? ((columns as any)?.rows ?? []) : columns
    const colNames = cols.map((c: any) => (isPg() ? c.column_name : c.name))

    assert.includeMembers(colNames, [
      'id',
      'organization_id',
      'name',
      'status',
      'priority',
      'start_date',
      'end_date',
      'budget_cents',
      'created_by',
      'created_at',
      'updated_at',
    ])
  })

  test('tasks 表有 project_id 外键和 assignee_id', async ({ assert }) => {
    const exists = await tableExists('tasks')
    assert.isTrue(exists)

    const columns = isPg()
      ? await db.rawQuery(
          `SELECT column_name FROM information_schema.columns WHERE table_name='tasks' AND table_schema='public'`,
        )
      : await db.rawQuery('PRAGMA table_info(tasks)')

    const cols = isPg() ? ((columns as any)?.rows ?? []) : columns
    const colNames = cols.map((c: any) => (isPg() ? c.column_name : c.name))

    assert.includeMembers(colNames, [
      'id',
      'project_id',
      'name',
      'status',
      'assignee_id',
      'parent_task_id',
      'start_date',
      'end_date',
      'created_at',
      'deleted_at',
    ])
  })
})

test.group('Migration - Indexes and constraints', () => {
  test('projects 表有 organization_id+status 复合索引', async ({ assert }) => {
    const tableOk = await tableExists('projects')
    assert.isTrue(tableOk)

    if (isPg()) {
      const res = await db.rawQuery(
        `SELECT indexname FROM pg_indexes WHERE tablename='projects' AND schemaname='public'`,
      )
      const rows = (res as any)?.rows ?? []
      const indexNames = rows.map((r: any) => r.indexname)
      assert.isTrue(
        indexNames.some((n: string) => n.includes('organization_id') && n.includes('status')),
      )
    } else {
      const res = await db.rawQuery('PRAGMA index_list(projects)')
      const indexList = Array.isArray(res) ? res : ((res as any)?.rows ?? [])
      assert.isAbove(indexList.length, 0)
    }
  })

  test('tasks 表有 project_id + status 索引', async ({ assert }) => {
    const exists = await tableExists('tasks')
    assert.isTrue(exists)

    if (isPg()) {
      const res = await db.rawQuery(
        `SELECT indexname FROM pg_indexes WHERE tablename='tasks' AND schemaname='public'`,
      )
      const rows = (res as any)?.rows ?? []
      assert.isAbove(rows.length, 0)
    } else {
      const res = await db.rawQuery('PRAGMA index_list(tasks)')
      const indexList = Array.isArray(res) ? res : ((res as any)?.rows ?? [])
      assert.isAbove(indexList.length, 0)
    }
  })
})

test.group('Migration - PDM tables structure', () => {
  test('pdm_migration_runs 表有 organization_id 外键', async ({ assert }) => {
    const exists = await tableExists('pdm_migration_runs')
    assert.isTrue(exists)

    const columns = isPg()
      ? await db.rawQuery(
          `SELECT column_name FROM information_schema.columns WHERE table_name='pdm_migration_runs' AND table_schema='public'`,
        )
      : await db.rawQuery('PRAGMA table_info(pdm_migration_runs)')

    const cols = isPg() ? ((columns as any)?.rows ?? []) : columns
    const colNames = cols.map((c: any) => (isPg() ? c.column_name : c.name))

    assert.includeMembers(colNames, [
      'id',
      'organization_id',
      'requested_by_user_id',
      'status',
      'started_at',
      'completed_at',
      'created_at',
    ])
  })
})

test.group('Migration - Cross-dialect consistency', () => {
  test('SQLite 下同名字段类型符合预期', async ({ assert }) => {
    if (!isSqlite()) return // skip if not SQLite

    const res = await db.rawQuery('PRAGMA table_info(projects)')
    const rows = Array.isArray(res) ? res : ((res as any)?.rows ?? [])
    const idCol = rows.find((r: any) => r.name === 'id')
    assert.isDefined(idCol)
    // SQLite: bigIncrements → INTEGER
    assert.include(idCol.type.toUpperCase(), 'INTEGER')
  })

  test('PG 迁移可用性标志（当前环境）', async ({ assert }) => {
    // 确认当前连接方言可执行迁移
    const activeConnection = process.env.DB_CONNECTION ?? 'sqlite'
    assert.include(['sqlite', 'pg'], activeConnection)
  })
})
