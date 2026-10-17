import { test } from '@japa/runner'
import {
  createResourceAnalysisValidator,
  listResourceAnalysesValidator,
  listResourceSnapshotsValidator,
  listResourceOpportunitiesValidator,
  reviewResourceOpportunityValidator,
} from '#validators/triz_resource_analyzer'

// ===========================================================================
// TRIZ 资源分析器 Vine 验证器测试（v3-triz-resource-analyzer §5.2）
//
// 覆盖分页边界、枚举白名单、手工资源草稿体积上限与非法枚举拒绝。
// ===========================================================================

async function fails(validator: { validate: (d: unknown) => Promise<unknown> }, data: unknown) {
  try {
    await validator.validate(data)
    return false
  } catch {
    return true
  }
}

test.group('createResourceAnalysisValidator', () => {
  test('空请求体合法（全部字段可选）', async ({ assert }) => {
    const out = await createResourceAnalysisValidator.validate({})
    assert.isObject(out)
  })

  test('接受合法的用户补充资源草稿', async ({ assert }) => {
    const out = await createResourceAnalysisValidator.validate({
      manualResourceDrafts: [
        {
          label: '合作方闲置测试机',
          resourceKind: 'technical',
          systemScope: 'external_environment',
          origin: 'user_supplied',
          availability: 'high',
          utilizationState: 'idle',
          capacity: '2 台',
          costRating: 'low',
          description: '合作方提供的闲置测试设备',
        },
      ],
      userContext: '希望降低测试环境成本',
    })
    assert.lengthOf(out.manualResourceDrafts!, 1)
  })

  test('草稿数量超过 50 条被拒绝', async ({ assert }) => {
    const one = {
      label: '资源',
      resourceKind: 'technical',
      systemScope: 'internal_system',
      origin: 'user_supplied',
      availability: 'high',
      utilizationState: 'idle',
      costRating: 'low',
      description: '描述',
    }
    assert.isTrue(
      await fails(createResourceAnalysisValidator, {
        manualResourceDrafts: Array.from({ length: 51 }, () => one),
      }),
    )
  })

  test('草稿 origin 只允许 user_supplied', async ({ assert }) => {
    assert.isTrue(
      await fails(createResourceAnalysisValidator, {
        manualResourceDrafts: [
          {
            label: '资源',
            resourceKind: 'technical',
            systemScope: 'internal_system',
            origin: 'project_registry',
            availability: 'high',
            utilizationState: 'idle',
            costRating: 'low',
            description: '描述',
          },
        ],
      }),
    )
  })

  test('非法 resourceKind 被拒绝', async ({ assert }) => {
    assert.isTrue(
      await fails(createResourceAnalysisValidator, {
        manualResourceDrafts: [
          {
            label: '资源',
            resourceKind: 'quantum',
            systemScope: 'internal_system',
            origin: 'user_supplied',
            availability: 'high',
            utilizationState: 'idle',
            costRating: 'low',
            description: '描述',
          },
        ],
      }),
    )
  })

  test('userContext 超过 2000 字被拒绝', async ({ assert }) => {
    assert.isTrue(await fails(createResourceAnalysisValidator, { userContext: 'x'.repeat(2001) }))
  })
})

test.group('list validators — 分页与枚举白名单', () => {
  test('runs：perPage 上限 100', async ({ assert }) => {
    const ok = await listResourceAnalysesValidator.validate({ page: 2, perPage: 100 })
    assert.equal(ok.perPage, 100)
    assert.isTrue(await fails(listResourceAnalysesValidator, { perPage: 101 }))
    assert.isTrue(await fails(listResourceAnalysesValidator, { page: 0 }))
  })

  test('runs：非法 status 被拒绝', async ({ assert }) => {
    assert.isTrue(await fails(listResourceAnalysesValidator, { status: 'running' }))
    const ok = await listResourceAnalysesValidator.validate({ status: 'completed_with_warnings' })
    assert.equal(ok.status, 'completed_with_warnings')
  })

  test('resources：resourceKind / systemScope / origin 白名单', async ({ assert }) => {
    const ok = await listResourceSnapshotsValidator.validate({
      resourceKind: 'human',
      systemScope: 'supersystem',
      origin: 'user_supplied',
    })
    assert.equal(ok.origin, 'user_supplied')
    assert.isTrue(await fails(listResourceSnapshotsValidator, { resourceKind: 'people' }))
    assert.isTrue(await fails(listResourceSnapshotsValidator, { systemScope: 'galaxy' }))
    assert.isTrue(await fails(listResourceSnapshotsValidator, { origin: 'github' }))
  })

  test('opportunities：opportunityType / severity / status 白名单', async ({ assert }) => {
    const ok = await listResourceOpportunitiesValidator.validate({
      opportunityType: 'overload_relief',
      severity: 'critical',
      status: 'blocked_stale',
      stale: true,
    })
    assert.equal(ok.opportunityType, 'overload_relief')
    assert.isTrue(ok.stale)
    assert.isTrue(await fails(listResourceOpportunitiesValidator, { opportunityType: 'magic' }))
    assert.isTrue(await fails(listResourceOpportunitiesValidator, { severity: 'blocker' }))
    assert.isTrue(await fails(listResourceOpportunitiesValidator, { status: 'approved' }))
  })
})

test.group('reviewResourceOpportunityValidator', () => {
  test('三种审查动作被接受', async ({ assert }) => {
    for (const action of ['mark_reviewed', 'mark_unreviewed', 'dismiss']) {
      const out = await reviewResourceOpportunityValidator.validate({ action })
      assert.equal(out.action, action)
    }
  })

  test('非法动作被拒绝（不得出现自动执行类动作）', async ({ assert }) => {
    assert.isTrue(await fails(reviewResourceOpportunityValidator, { action: 'auto_apply' }))
    assert.isTrue(await fails(reviewResourceOpportunityValidator, {}))
  })

  test('reason 超长被拒绝', async ({ assert }) => {
    assert.isTrue(
      await fails(reviewResourceOpportunityValidator, {
        action: 'dismiss',
        reason: 'x'.repeat(2001),
      }),
    )
  })
})
