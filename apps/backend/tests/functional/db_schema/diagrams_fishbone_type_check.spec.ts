/**
 * v3-ui-next-chart-gallery —— diagrams.type CHECK 扩容（fishbone）集成测试。
 *
 * 覆盖（tasks 3.x 迁移前置，japa 真实连接内省）：
 * - 1996080000000 迁移已在测试库全部执行并登记（adonis_schema）；
 * - `diagrams` 表 CHECK 白名单已含 fishbone（sqlite_master 建表 SQL）；
 * - type='fishbone' 记录可真实插入/回读（迁移前会被旧 CHECK 拒绝）；
 * - 既有四类旧类型不受影响、未知类型仍被 CHECK 拒绝；
 * - 外键与两枚显式索引在重建后完整保留（索引按**覆盖列组合**断言，不绑定重建后的索引名）。
 */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import { indexes } from '#services/database_schema_introspection'
import { assertForeignKey, columnNames, foreignKeys, tableSql } from './_helpers.js'

/** 单值插入返回 id（兼容 number | number[]）。 */
async function insertId(table: string, row: Record<string, unknown>): Promise<number> {
  const r = await db.table(table).insert(row)
  return Array.isArray(r) ? r[0] : r
}

const MIGRATION_NAME = '1996080000000_widen_diagrams_type_check_for_fishbone'

test.group('Diagrams fishbone type CHECK migration', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('fishbone 扩容迁移已登记并执行', async ({ assert }) => {
    const rows = await db.from('adonis_schema').select('id', 'name', 'batch')
    const mine = rows.filter(
      (r: { name: string }) =>
        r.name.endsWith(`/${MIGRATION_NAME}`) || r.name.endsWith(MIGRATION_NAME),
    )
    assert.equal(mine.length, 1, '迁移应登记在 adonis_schema')
    assert.isAbove(mine[0]!.batch, 0, '迁移 batch 应有效（已执行）')
  })

  test('diagrams 建表 CHECK 已包含 fishbone 且保留旧类型', async ({ assert }) => {
    const sql = await tableSql('diagrams')
    assert.isTrue(
      sql.includes("'wbs_tree','gantt','dependency_graph','critical_path','fishbone'"),
      `CHECK 白名单应含 fishbone，实际 SQL: ${sql.slice(0, 400)}`,
    )
  })

  test('type=fishbone 记录可插入并回读（迁移前会被旧 CHECK 拒绝）', async ({ assert }) => {
    const now = new Date().toISOString()
    const suffix = `fb-${Date.now()}`
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
    const projectId = await insertId('projects', {
      organization_id: orgId,
      name: 'p',
      created_by: userId,
      created_at: now,
      updated_at: now,
    })

    const fishboneId = await insertId('diagrams', {
      organization_id: orgId,
      project_id: projectId,
      type: 'fishbone',
      title: '鱼骨图：测试',
      spec: JSON.stringify({
        version: '1.0',
        type: 'fishbone',
        title: '鱼骨图：测试',
        data: { effect: '质量缺陷高发', categories: [] },
        metadata: { generatedBy: 'user', generatedAt: now, sourceProjectId: projectId },
        exports: { mermaid: { supported: false, limitations: [] } },
      }),
      source_hash: null,
      created_by: userId,
      updated_by: null,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    })
    const legacyId = await insertId('diagrams', {
      organization_id: orgId,
      project_id: projectId,
      type: 'wbs_tree',
      title: '既有 WBS',
      spec: '{}',
      source_hash: null,
      created_by: userId,
      updated_by: null,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    })

    const fishboneRow = await db.from('diagrams').where('id', fishboneId).first()
    assert.equal(fishboneRow.type, 'fishbone')
    const parsed = JSON.parse(fishboneRow.spec)
    assert.equal(parsed.data.effect, '质量缺陷高发')
    const legacyRow = await db.from('diagrams').where('id', legacyId).first()
    assert.equal(legacyRow.type, 'wbs_tree', '旧类型写入不受影响')
  })

  test('未知类型仍被 CHECK 拒绝', async ({ assert }) => {
    const now = new Date().toISOString()
    const suffix = `bad-${Date.now()}`
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
    const projectId = await insertId('projects', {
      organization_id: orgId,
      name: 'p',
      created_by: userId,
      created_at: now,
      updated_at: now,
    })

    await assert.rejects(
      () =>
        db.table('diagrams').insert({
          organization_id: orgId,
          project_id: projectId,
          type: 'mindmap',
          title: '非法类型',
          spec: '{}',
          created_by: userId,
          deleted_at: null,
          created_at: now,
          updated_at: now,
        }),
      /CHECK constraint failed/,
    )
  })

  test('表重建后外键与显式索引完整保留', async ({ assert }) => {
    const fks = await foreignKeys('diagrams')
    assertForeignKey(fks, 'organization_id', 'organizations', 'CASCADE')
    assertForeignKey(fks, 'project_id', 'projects', 'CASCADE')
    assertForeignKey(fks, 'created_by', 'users', 'RESTRICT')
    assertForeignKey(fks, 'updated_by', 'users', 'SET NULL')

    // 表重建（1996080000000）用新名字重建索引（`*_idx_v2`），因此按**覆盖列组合**断言而非
    // 索引字面名：守卫的是「索引覆盖面没丢」，下次再重建也不会假红。
    const tableIndexes = await indexes('diagrams')
    const hasCovering = (columns: string[]) =>
      tableIndexes.some(
        (i) => i.columns.length === columns.length && i.columns.every((c, n) => c === columns[n]),
      )
    const actualIndexes = tableIndexes.map((i) => `${i.name}(${i.columns.join(', ')})`).join('; ')
    assert.isTrue(
      hasCovering(['project_id', 'type']),
      `应存在覆盖 (project_id, type) 的索引，实际索引: ${actualIndexes}`,
    )
    assert.isTrue(
      hasCovering(['organization_id', 'project_id', 'deleted_at']),
      `应存在覆盖 (organization_id, project_id, deleted_at) 的索引，实际索引: ${actualIndexes}`,
    )

    const columns = await columnNames('diagrams')
    for (const column of [
      'id',
      'organization_id',
      'project_id',
      'type',
      'title',
      'spec',
      'source_hash',
      'created_by',
      'updated_by',
      'deleted_at',
      'created_at',
      'updated_at',
    ]) {
      assert.isTrue(columns.includes(column), `列 ${column} 应存在`)
    }
  })
})
