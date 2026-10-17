import { test } from '@japa/runner'
import {
  okrDashboardParamsValidator,
  okrDashboardQueryValidator,
  parseOkrDashboardListParam,
  validateOkrDashboardDateWindow,
} from '#validators/okr_dashboard'
import {
  OKR_DASHBOARD_MAX_ATTENTION_LIMIT,
  OKR_DASHBOARD_MAX_DATE_WINDOW_DAYS,
  OKR_DASHBOARD_MAX_SEARCH_LENGTH,
  OKR_DASHBOARD_MAX_STALE_MINUTES,
} from '@aiproj/types'

async function expectRejected(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    return null
  } catch (error) {
    return error
  }
}

test.group('OKR Dashboard 验证器 —— 路由参数', () => {
  test('接受正整数 organizationId（字符串数字自动转换）', async ({ assert }) => {
    const payload = await okrDashboardParamsValidator.validate({ organizationId: '12' })
    assert.equal(payload.organizationId, 12)
  })

  test('拒绝非数字与非正数 organizationId', async ({ assert }) => {
    assert.isNotNull(
      await expectRejected(okrDashboardParamsValidator.validate({ organizationId: 'abc' })),
    )
    assert.isNotNull(
      await expectRejected(okrDashboardParamsValidator.validate({ organizationId: 0 })),
    )
    assert.isNotNull(
      await expectRejected(okrDashboardParamsValidator.validate({ organizationId: -3 })),
    )
  })
})

test.group('OKR Dashboard 验证器 —— 查询白名单', () => {
  test('空查询合法（走共享默认值）', async ({ assert }) => {
    const payload = await okrDashboardQueryValidator.validate({})
    assert.isUndefined(payload.sections)
    assert.isUndefined(payload.attentionLimit)
    assert.isUndefined(payload.staleThresholdMinutes)
  })

  test('接受白名单内 section / include / scope / status / sort', async ({ assert }) => {
    const payload = await okrDashboardQueryValidator.validate({
      cycleId: 42,
      ownerId: 7,
      scope: ['organization', 'team'],
      status: ['active', 'paused'],
      sections: ['kpi', 'attention'],
      // include 白名单是 evidence_freshness / alignment_health / backflow；
      // 原先写的 attention/alignment 不在其中，验证器拒绝是对的（红线：非法值必须 VALIDATION_ERROR）
      include: ['evidence_freshness', 'alignment_health'],
      attentionLimit: 8,
      // attentionSort 白名单是 risk_score/progress/confidence/updated_at/title，没有 progress_asc；
      // 升降序由 attentionOrder 单独表达
      attentionSort: 'progress',
      attentionOrder: 'desc',
      staleThresholdMinutes: 4320,
      search: '组织目标',
    })
    assert.deepEqual(payload.scope, ['organization', 'team'])
    assert.deepEqual(payload.status, ['active', 'paused'])
    assert.deepEqual(payload.sections, ['kpi', 'attention'])
    assert.equal(payload.attentionSort, 'progress')
    assert.equal(payload.search, '组织目标')
  })

  test('拒绝未知 scope / status / section / include / sort', async ({ assert }) => {
    assert.isNotNull(
      await expectRejected(okrDashboardQueryValidator.validate({ scope: ['company'] })),
    )
    assert.isNotNull(
      await expectRejected(okrDashboardQueryValidator.validate({ status: ['pending'] })),
    )
    assert.isNotNull(
      await expectRejected(okrDashboardQueryValidator.validate({ sections: ['budget'] })),
    )
    assert.isNotNull(
      await expectRejected(okrDashboardQueryValidator.validate({ include: ['secret'] })),
    )
    assert.isNotNull(
      await expectRejected(okrDashboardQueryValidator.validate({ attentionSort: 'budget_desc' })),
    )
    assert.isNotNull(
      await expectRejected(okrDashboardQueryValidator.validate({ attentionOrder: 'sideways' })),
    )
  })

  test('拒绝超上限的 attentionLimit / staleThresholdMinutes / search', async ({ assert }) => {
    assert.isNotNull(
      await expectRejected(
        okrDashboardQueryValidator.validate({
          attentionLimit: OKR_DASHBOARD_MAX_ATTENTION_LIMIT + 1,
        }),
      ),
    )
    assert.isNotNull(
      await expectRejected(
        okrDashboardQueryValidator.validate({
          staleThresholdMinutes: OKR_DASHBOARD_MAX_STALE_MINUTES + 1,
        }),
      ),
    )
    assert.isNotNull(
      await expectRejected(
        okrDashboardQueryValidator.validate({
          search: 'x'.repeat(OKR_DASHBOARD_MAX_SEARCH_LENGTH + 1),
        }),
      ),
    )
  })

  test('拒绝非正数 cycleId / ownerId', async ({ assert }) => {
    assert.isNotNull(await expectRejected(okrDashboardQueryValidator.validate({ cycleId: 0 })))
    assert.isNotNull(await expectRejected(okrDashboardQueryValidator.validate({ ownerId: -5 })))
  })
})

test.group('OKR Dashboard 验证器 —— parseOkrDashboardListParam', () => {
  test('支持逗号分隔与数组两种写法', ({ assert }) => {
    assert.deepEqual(parseOkrDashboardListParam('kpi,attention'), ['kpi', 'attention'])
    assert.deepEqual(parseOkrDashboardListParam(['kpi', 'attention']), ['kpi', 'attention'])
    assert.deepEqual(parseOkrDashboardListParam(' kpi , attention '), ['kpi', 'attention'])
  })

  test('空值按未指定处理', ({ assert }) => {
    assert.isUndefined(parseOkrDashboardListParam(undefined))
    assert.isUndefined(parseOkrDashboardListParam(null))
    assert.isUndefined(parseOkrDashboardListParam(''))
    assert.isUndefined(parseOkrDashboardListParam([]))
  })

  test('未知值不被静默丢弃（交给验证器报 VALIDATION_ERROR）', ({ assert }) => {
    assert.deepEqual(parseOkrDashboardListParam('kpi,secret'), ['kpi', 'secret'])
  })
})

test.group('OKR Dashboard 验证器 —— validateOkrDashboardDateWindow', () => {
  test('两端都缺失或只有一端时通过', ({ assert }) => {
    assert.isNull(validateOkrDashboardDateWindow(undefined, undefined))
    assert.isNull(validateOkrDashboardDateWindow('2026-01-01', undefined))
    assert.isNull(validateOkrDashboardDateWindow(undefined, '2026-06-30'))
  })

  test('合法窗口通过', ({ assert }) => {
    assert.isNull(validateOkrDashboardDateWindow('2026-01-01', '2026-03-31'))
  })

  test('dateTo 早于 dateFrom 报错', ({ assert }) => {
    const result = validateOkrDashboardDateWindow('2026-06-30', '2026-01-01')
    assert.isNotNull(result)
  })

  test('窗口超过上限报错', ({ assert }) => {
    const from = '2026-01-01'
    const beyond = new Date(
      new Date(from).getTime() + (OKR_DASHBOARD_MAX_DATE_WINDOW_DAYS + 5) * 86_400_000,
    )
      .toISOString()
      .slice(0, 10)
    const result = validateOkrDashboardDateWindow(from, beyond)
    assert.isNotNull(result)
  })

  test('日期格式非法报错', ({ assert }) => {
    assert.isNotNull(validateOkrDashboardDateWindow('not-a-date', 'also-bad'))
  })
})
