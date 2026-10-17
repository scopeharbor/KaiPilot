import { test } from '@japa/runner'
import {
  organizationResourcePoolParamsValidator,
  organizationResourcePoolSummaryValidator,
  organizationResourcePoolResourcesValidator,
  organizationResourcePoolCapacityValidator,
  organizationResourcePoolSkillsValidator,
  organizationResourcePoolConflictsValidator,
  organizationResourcePoolDemandGapsValidator,
  organizationResourcePoolDrillDownValidator,
} from '#validators/organization_resource_pool'

test.group('OrganizationResourcePoolValidator — params', () => {
  test('valid organizationId is accepted', async ({ assert }) => {
    const result = await organizationResourcePoolParamsValidator.validate({
      organizationId: 1,
    })
    assert.equal(result.organizationId, 1)
  })

  test('negative organizationId is rejected', async ({ assert }) => {
    await assert.rejects(() =>
      organizationResourcePoolParamsValidator.validate({ organizationId: -1 }),
    )
  })

  test('zero organizationId is rejected', async ({ assert }) => {
    await assert.rejects(() =>
      organizationResourcePoolParamsValidator.validate({ organizationId: 0 }),
    )
  })

  test('non-numeric organizationId is rejected', async ({ assert }) => {
    await assert.rejects(() =>
      organizationResourcePoolParamsValidator.validate({ organizationId: 'abc' }),
    )
  })
})

test.group('OrganizationResourcePoolValidator — summary', () => {
  test('empty query is valid', async ({ assert }) => {
    const result = await organizationResourcePoolSummaryValidator.validate({})
    assert.isDefined(result)
  })

  test('valid date range is accepted', async ({ assert }) => {
    const result = await organizationResourcePoolSummaryValidator.validate({
      from: '2026-01-01',
      to: '2026-12-31',
    })
    assert.equal(result.from, '2026-01-01')
    assert.equal(result.to, '2026-12-31')
  })

  test('valid freshnessWindowMinutes is accepted', async ({ assert }) => {
    const result = await organizationResourcePoolSummaryValidator.validate({
      freshnessWindowMinutes: 30,
    })
    assert.equal(result.freshnessWindowMinutes, 30)
  })

  test('excessive freshnessWindowMinutes is rejected', async ({ assert }) => {
    await assert.rejects(() =>
      organizationResourcePoolSummaryValidator.validate({
        freshnessWindowMinutes: 99999,
      }),
    )
  })

  test('negative freshnessWindowMinutes is rejected', async ({ assert }) => {
    await assert.rejects(() =>
      organizationResourcePoolSummaryValidator.validate({
        freshnessWindowMinutes: -5,
      }),
    )
  })
})

test.group('OrganizationResourcePoolValidator — resources', () => {
  test('empty query is valid', async ({ assert }) => {
    const result = await organizationResourcePoolResourcesValidator.validate({})
    assert.isDefined(result)
  })

  test('valid filters are accepted', async ({ assert }) => {
    const result = await organizationResourcePoolResourcesValidator.validate({
      view: 'list',
      resourceType: 'human',
      role: 'developer',
      skill: 'typescript',
      loadStatus: 'normal',
      conflictSeverity: 'error',
      search: '张三',
      sort: 'utilization',
      order: 'desc',
      page: 2,
      perPage: 50,
      topN: 20,
    })
    assert.equal(result.view, 'list')
    assert.equal(result.resourceType, 'human')
    assert.equal(result.page, 2)
    assert.equal(result.perPage, 50)
    assert.equal(result.topN, 20)
  })

  test('unsupported sort key is rejected', async ({ assert }) => {
    await assert.rejects(() =>
      organizationResourcePoolResourcesValidator.validate({ sort: 'invalid_sort' }),
    )
  })

  test('unsupported view mode is rejected', async ({ assert }) => {
    await assert.rejects(() =>
      organizationResourcePoolResourcesValidator.validate({ view: 'unsupported_view' }),
    )
  })

  test('unsupported loadStatus is rejected', async ({ assert }) => {
    await assert.rejects(() =>
      organizationResourcePoolResourcesValidator.validate({ loadStatus: 'unknown' }),
    )
  })

  test('excessive page size is rejected', async ({ assert }) => {
    await assert.rejects(() =>
      organizationResourcePoolResourcesValidator.validate({ perPage: 9999 }),
    )
  })

  test('excessive topN is rejected', async ({ assert }) => {
    await assert.rejects(() => organizationResourcePoolResourcesValidator.validate({ topN: 9999 }))
  })

  test('excessive search length is rejected', async ({ assert }) => {
    await assert.rejects(() =>
      organizationResourcePoolResourcesValidator.validate({ search: 'x'.repeat(500) }),
    )
  })
})

test.group('OrganizationResourcePoolValidator — capacity', () => {
  test('empty query is valid', async ({ assert }) => {
    const result = await organizationResourcePoolCapacityValidator.validate({})
    assert.isDefined(result)
  })

  test('valid date range and filters are accepted', async ({ assert }) => {
    const result = await organizationResourcePoolCapacityValidator.validate({
      from: '2026-01-01',
      to: '2026-06-30',
      resourceType: 'human',
      role: 'designer',
      skill: 'figma',
      loadStatus: 'high',
      topN: 30,
    })
    assert.equal(result.from, '2026-01-01')
    assert.equal(result.to, '2026-06-30')
    assert.equal(result.topN, 30)
  })
})

test.group('OrganizationResourcePoolValidator — skills', () => {
  test('empty query is valid', async ({ assert }) => {
    const result = await organizationResourcePoolSkillsValidator.validate({})
    assert.isDefined(result)
  })

  test('role and skill filter is accepted', async ({ assert }) => {
    const result = await organizationResourcePoolSkillsValidator.validate({
      role: 'backend',
      skill: 'java',
    })
    assert.equal(result.role, 'backend')
    assert.equal(result.skill, 'java')
  })
})

test.group('OrganizationResourcePoolValidator — conflicts', () => {
  test('empty query is valid', async ({ assert }) => {
    const result = await organizationResourcePoolConflictsValidator.validate({})
    assert.isDefined(result)
  })

  test('valid severity and pagination accepted', async ({ assert }) => {
    const result = await organizationResourcePoolConflictsValidator.validate({
      conflictSeverity: 'critical',
      resourceType: 'human',
      page: 1,
      perPage: 25,
    })
    assert.equal(result.conflictSeverity, 'critical')
    assert.equal(result.perPage, 25)
  })

  test('unsupported severity is rejected', async ({ assert }) => {
    await assert.rejects(() =>
      organizationResourcePoolConflictsValidator.validate({
        conflictSeverity: 'extreme',
      }),
    )
  })
})

test.group('OrganizationResourcePoolValidator — demand-gaps', () => {
  test('empty query is valid', async ({ assert }) => {
    const result = await organizationResourcePoolDemandGapsValidator.validate({})
    assert.isDefined(result)
  })

  test('role and skill filter accepted', async ({ assert }) => {
    const result = await organizationResourcePoolDemandGapsValidator.validate({
      role: 'frontend',
      skill: 'react',
      page: 2,
      perPage: 30,
    })
    assert.equal(result.role, 'frontend')
    assert.equal(result.perPage, 30)
  })
})

test.group('OrganizationResourcePoolValidator — drill-down', () => {
  test('valid project drill-down is accepted', async ({ assert }) => {
    const result = await organizationResourcePoolDrillDownValidator.validate({
      kind: 'project',
      targetId: 42,
      projectId: 42,
    })
    assert.equal(result.kind, 'project')
    assert.equal(result.targetId, 42)
  })

  test('valid resource drill-down is accepted', async ({ assert }) => {
    const result = await organizationResourcePoolDrillDownValidator.validate({
      kind: 'resource',
      resourceId: 100,
      targetId: 100,
    })
    assert.equal(result.kind, 'resource')
    assert.equal(result.resourceId, 100)
  })

  test('unsupported drill-down kind is rejected', async ({ assert }) => {
    await assert.rejects(() =>
      organizationResourcePoolDrillDownValidator.validate({ kind: 'financial' }),
    )
  })

  test('malformed targetId is rejected', async ({ assert }) => {
    await assert.rejects(() =>
      organizationResourcePoolDrillDownValidator.validate({
        kind: 'project',
        targetId: 'not-a-number',
      }),
    )
  })
})
