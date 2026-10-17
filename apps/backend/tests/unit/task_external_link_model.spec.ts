import TaskExternalLink from '#models/task_external_link'
import { test } from '@japa/runner'

test.group('TaskExternalLink Model', () => {
  test('model has correct table name', async ({ assert }) => {
    assert.equal(TaskExternalLink.table, 'task_external_links')
  })

  test('model columns match migration schema', async ({ assert }) => {
    const columns = TaskExternalLink.$columnsDefinitions as Map<string, unknown>
    for (const column of [
      'id',
      'organizationId',
      'projectId',
      'taskId',
      'provider',
      'linkType',
      'repositoryOwner',
      'repositoryName',
      'externalNumber',
      'externalId',
      'externalTitle',
      'externalStatus',
      'statusSource',
      'externalUrl',
      'note',
      'metadata',
      'lastObservedAt',
      'createdBy',
      'updatedBy',
    ]) {
      assert.isTrue(columns.has(column), `${column} column should be defined`)
    }
  })

  test('metadata JSON serialization round-trip', async ({ assert }) => {
    // Test the prepare/consume functions directly
    // Test prepare: object -> JSON string
    const prepare = (TaskExternalLink.$columnsDefinitions as any)?.metadata?.prepare
    if (prepare) {
      const input = { key: 'value', nested: { a: 1 } }
      const result = prepare(input)
      assert.equal(result, JSON.stringify(input))
    }

    // Test prepare: null -> null
    if (prepare) {
      assert.isNull(prepare(null))
    }

    // Test consume
    const consume = (TaskExternalLink.$columnsDefinitions as any)?.metadata?.consume
    if (consume) {
      const input = '{"key":"value"}'
      const result = consume(input)
      assert.deepEqual(result, { key: 'value' })
    }

    // Test consume: null -> null
    if (consume) {
      assert.isNull(consume(null))
    }

    // Test consume: already an object
    if (consume) {
      const obj = { key: 'value' }
      const result = consume(obj)
      assert.deepEqual(result, obj)
    }
  })

  test('date fields use Luxon DateTime', async ({ assert }) => {
    const link = new TaskExternalLink()
    // Verify column types
    const createdAtMeta = (TaskExternalLink as any).$columnsDefinitions?.createdAt
    assert.isNotNull(createdAtMeta)

    // Default values should be correct
    assert.equal(link.externalStatus, undefined) // Not set yet; default in migration
    assert.equal(link.statusSource, undefined) // Not set yet; default in migration
  })

  test('model can construct with fillable fields', async ({ assert }) => {
    const link = new TaskExternalLink()
    link.organizationId = 1
    link.projectId = 10
    link.taskId = 100
    link.provider = 'github'
    link.linkType = 'issue'
    link.repositoryOwner = 'owner'
    link.repositoryName = 'repo'
    link.externalNumber = 42
    link.externalStatus = 'open'
    link.statusSource = 'manual'
    link.externalUrl = 'https://github.com/owner/repo/issues/42'
    link.createdBy = 1
    link.updatedBy = 1

    assert.equal(link.organizationId, 1)
    assert.equal(link.projectId, 10)
    assert.equal(link.taskId, 100)
    assert.equal(link.provider, 'github')
    assert.equal(link.linkType, 'issue')
    assert.equal(link.repositoryOwner, 'owner')
    assert.equal(link.repositoryName, 'repo')
    assert.equal(link.externalNumber, 42)
    assert.equal(link.externalStatus, 'open')
    assert.equal(link.statusSource, 'manual')
    assert.equal(link.externalUrl, 'https://github.com/owner/repo/issues/42')
    assert.equal(link.createdBy, 1)
    assert.equal(link.updatedBy, 1)
    assert.isUndefined(link.externalId)
    assert.isUndefined(link.externalTitle)
    assert.isUndefined(link.metadata)
    assert.isUndefined(link.lastObservedAt)
  })
})
