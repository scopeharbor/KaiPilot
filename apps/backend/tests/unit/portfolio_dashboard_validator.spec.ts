// Portfolio Dashboard 验证器测试（v3-pmo-portfolio-dashboard §3.2）。
import { test } from '@japa/runner'
import {
  portfolioDashboardSummaryValidator,
  portfolioProjectListValidator,
  portfolioGroupSliceValidator,
  portfolioTrendValidator,
  portfolioMetricDetailValidator,
} from '#validators/portfolio_dashboard'

test.group('Portfolio Dashboard Validators', () => {
  test('summary validator 接受有效查询', async ({ assert }) => {
    const result = await portfolioDashboardSummaryValidator.validate({
      includeTrafficLight: true,
      includeFreshness: false,
    })
    assert.equal(result.includeTrafficLight, true)
    assert.equal(result.includeFreshness, false)
  })

  test('summary validator 接受空查询（全默认）', async ({ assert }) => {
    const result = await portfolioDashboardSummaryValidator.validate({})
    assert.deepEqual(result, {})
  })

  test('project list validator 接受有效分页查询', async ({ assert }) => {
    const result = await portfolioProjectListValidator.validate({
      page: 1,
      perPage: 20,
      sort: 'name',
      order: 'asc',
    })
    assert.equal(result.page, 1)
    assert.equal(result.perPage, 20)
    assert.equal(result.sort, 'name')
    assert.equal(result.order, 'asc')
  })

  test('project list validator 拒绝 unbounded perPage', async ({ assert }) => {
    let threw = false
    try {
      await portfolioProjectListValidator.validate({ perPage: 999 })
    } catch {
      threw = true
    }
    assert.isTrue(threw, '应拒绝 >100 的 perPage')
  })

  test('project list validator 拒绝非法 order', async ({ assert }) => {
    let threw = false
    try {
      await portfolioProjectListValidator.validate({ order: 'invalid' })
    } catch {
      threw = true
    }
    assert.isTrue(threw, '应拒绝非法 order 值')
  })

  test('group slice validator 接受有效 groupBy', async ({ assert }) => {
    const result = await portfolioGroupSliceValidator.validate({
      groupBy: 'status',
      page: 1,
      perPage: 20,
    })
    assert.equal(result.groupBy, 'status')
    assert.equal(result.page, 1)
  })

  test('group slice validator 拒绝空 groupBy', async ({ assert }) => {
    let threw = false
    try {
      await portfolioGroupSliceValidator.validate({})
    } catch {
      threw = true
    }
    assert.isTrue(threw, '应拒绝空 groupBy')
  })

  test('trend validator 接受有效 window', async ({ assert }) => {
    const result = await portfolioTrendValidator.validate({
      window: 'last_30_days',
      page: 1,
      perPage: 10,
    })
    assert.equal(result.window, 'last_30_days')
  })

  test('trend validator 拒绝空 window', async ({ assert }) => {
    let threw = false
    try {
      await portfolioTrendValidator.validate({})
    } catch {
      threw = true
    }
    assert.isTrue(threw, '应拒绝空 window')
  })

  test('metric detail validator 接受有效 metricKey', async ({ assert }) => {
    const result = await portfolioMetricDetailValidator.validate({
      metricKey: 'total_projects',
      page: 1,
      perPage: 10,
    })
    assert.equal(result.metricKey, 'total_projects')
  })

  test('metric detail validator 拒绝空 metricKey', async ({ assert }) => {
    let threw = false
    try {
      await portfolioMetricDetailValidator.validate({})
    } catch {
      threw = true
    }
    assert.isTrue(threw, '应拒绝空 metricKey')
  })

  test('project list validator 忽略未知字段（Vine 默认行为）', async ({ assert }) => {
    const result = await portfolioProjectListValidator.validate({ unknownField: 'test' })
    // Vine 默认忽略未知字段，验证结果不包含该字段
    assert.isUndefined((result as any).unknownField)
  })
})
