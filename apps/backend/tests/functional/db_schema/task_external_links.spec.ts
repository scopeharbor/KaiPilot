import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { columnNames, indexNames } from './_helpers.js'

test.group('task_external_links schema', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('migration creates all expected columns', async ({ assert }) => {
    const cols = await columnNames('task_external_links')
    const required = [
      'id',
      'organization_id',
      'project_id',
      'task_id',
      'provider',
      'link_type',
      'repository_owner',
      'repository_name',
      'external_number',
      'external_id',
      'external_title',
      'external_status',
      'status_source',
      'external_url',
      'note',
      'metadata',
      'last_observed_at',
      'created_by',
      'updated_by',
      'created_at',
      'updated_at',
    ]
    for (const c of required) {
      assert.include(cols, c, `task_external_links 应含字段 ${c}`)
    }
  })

  test('table has expected indexes', async ({ assert }) => {
    const names = await indexNames('task_external_links')
    const expected = [
      'idx_ext_links_org_proj_task',
      'idx_ext_links_task_provider_repo_num',
      'idx_ext_links_provider_status',
      'idx_ext_links_repo_owner_name',
      'idx_ext_links_external_number',
      'idx_ext_links_external_id',
      'idx_ext_links_updated_by',
      'idx_ext_links_org_updated',
    ]
    for (const idx of expected) {
      assert.include(names, idx, `预期索引 ${idx} 存在`)
    }
  })

  test('migration is idempotent (re-migrate succeeds)', async ({ assert }) => {
    // Re-running migrate should not throw
    await testUtils.db().migrate()
    const colsAfter = await columnNames('task_external_links')
    assert.include(colsAfter, 'id', '重新迁移后表应存在')
  })
})
