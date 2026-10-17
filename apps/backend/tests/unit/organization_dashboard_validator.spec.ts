import { test } from '@japa/runner'
import {
  organizationDashboardParamsValidator,
  organizationDashboardQueryValidator,
  parseSectionsParam,
} from '#validators/organization_dashboard'
import {
  ORGANIZATION_DASHBOARD_MAX_ACTIVITY_LIMIT,
  ORGANIZATION_DASHBOARD_MAX_ATTENTION_LIMIT,
  organizationDashboardValidationDetail,
} from '@aiproj/types'

async function expectRejected(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    return null
  } catch (error) {
    return error
  }
}

test.group('组织 Dashboard 验证器 —— 路由参数', () => {
  test('接受正整数 organizationId', async ({ assert }) => {
    const payload = await organizationDashboardParamsValidator.validate({ organizationId: '12' })
    assert.equal(payload.organizationId, 12)
  })

  test('拒绝非数字与非正数 organizationId', async ({ assert }) => {
    assert.isNotNull(
      await expectRejected(
        organizationDashboardParamsValidator.validate({ organizationId: 'abc' }),
      ),
    )
    assert.isNotNull(
      await expectRejected(organizationDashboardParamsValidator.validate({ organizationId: 0 })),
    )
  })
})

test.group('组织 Dashboard 验证器 —— 查询白名单', () => {
  test('空查询合法（走共享默认值）', async ({ assert }) => {
    const payload = await organizationDashboardQueryValidator.validate({})
    assert.isUndefined(payload.sections)
    assert.isUndefined(payload.attentionLimit)
  })

  test('接受白名单内 section / sort / filter', async ({ assert }) => {
    const payload = await organizationDashboardQueryValidator.validate({
      sections: ['kpi', 'activity'],
      attentionSort: 'attention_score',
      attentionOrder: 'desc',
      filterStatus: 'active',
      filterHealth: 'at_risk',
      attentionLimit: 5,
      activityLimit: 10,
      freshnessWindowMinutes: 60,
      dueSoonDays: 7,
      search: '平台',
    })
    assert.deepEqual(payload.sections, ['kpi', 'activity'])
    assert.equal(payload.filterStatus, 'active')
    assert.equal(payload.search, '平台')
  })

  test('拒绝未知 section', async ({ assert }) => {
    assert.isNotNull(
      await expectRejected(
        organizationDashboardQueryValidator.validate({ sections: ['kpi', 'secret_section'] }),
      ),
    )
  })

  test('拒绝未知 sort / filter 值', async ({ assert }) => {
    assert.isNotNull(
      await expectRejected(
        organizationDashboardQueryValidator.validate({ attentionSort: 'budget_desc' }),
      ),
    )
    assert.isNotNull(
      await expectRejected(
        organizationDashboardQueryValidator.validate({ filterStatus: 'top_secret' }),
      ),
    )
    assert.isNotNull(
      await expectRejected(
        organizationDashboardQueryValidator.validate({ filterHealth: 'exploding' }),
      ),
    )
  })

  test('拒绝超上限的 limit / freshness / dueSoonDays', async ({ assert }) => {
    assert.isNotNull(
      await expectRejected(
        organizationDashboardQueryValidator.validate({
          attentionLimit: ORGANIZATION_DASHBOARD_MAX_ATTENTION_LIMIT + 1,
        }),
      ),
    )
    assert.isNotNull(
      await expectRejected(
        organizationDashboardQueryValidator.validate({
          activityLimit: ORGANIZATION_DASHBOARD_MAX_ACTIVITY_LIMIT + 1,
        }),
      ),
    )
    assert.isNotNull(
      await expectRejected(
        organizationDashboardQueryValidator.validate({ freshnessWindowMinutes: 100000 }),
      ),
    )
    assert.isNotNull(
      await expectRejected(organizationDashboardQueryValidator.validate({ dueSoonDays: 365 })),
    )
  })

  test('拒绝超长 search，避免无界扫描', async ({ assert }) => {
    assert.isNotNull(
      await expectRejected(
        organizationDashboardQueryValidator.validate({ search: 'x'.repeat(500) }),
      ),
    )
  })
})

test.group('组织 Dashboard 验证器 —— sections 参数解析', () => {
  test('支持逗号分隔与数组两种写法', ({ assert }) => {
    assert.deepEqual(parseSectionsParam('kpi,activity'), ['kpi', 'activity'])
    assert.deepEqual(parseSectionsParam(['kpi', 'activity']), ['kpi', 'activity'])
    assert.deepEqual(parseSectionsParam(' kpi , activity '), ['kpi', 'activity'])
  })

  test('空值按未指定处理', ({ assert }) => {
    assert.isUndefined(parseSectionsParam(undefined))
    assert.isUndefined(parseSectionsParam(null))
    assert.isUndefined(parseSectionsParam(''))
    assert.isUndefined(parseSectionsParam([]))
  })

  test('未知值不被静默丢弃（交给验证器报 VALIDATION_ERROR）', ({ assert }) => {
    assert.deepEqual(parseSectionsParam('kpi,secret_section'), ['kpi', 'secret_section'])
  })
})

test.group('组织 Dashboard 验证器 —— 错误细节低敏', () => {
  test('允许值清单只暴露白名单与上限', ({ assert }) => {
    const detail = organizationDashboardValidationDetail()
    assert.include(detail.allowedSections, 'kpi')
    assert.include(detail.allowedStatusFilters, 'active')
    assert.equal(detail.maxAttentionLimit, ORGANIZATION_DASHBOARD_MAX_ATTENTION_LIMIT)
    assert.notMatch(JSON.stringify(detail), /projectName|organizationId|evidence/)
  })
})
