import { test } from '@japa/runner'
import {
  portfolioGroupingViewListValidator,
  portfolioGroupingViewPreviewValidator,
  portfolioGroupingViewCreateValidator,
  portfolioGroupingViewUpdateValidator,
  portfolioGroupingViewDuplicateValidator,
  portfolioGroupingViewSetDefaultValidator,
} from '#validators/portfolio_grouping_view'
import {
  PMO_GROUPING_VIEW_PRIMARY_KEYS,
  PMO_GROUPING_VIEW_SCOPES,
  PMO_GROUPING_VIEW_SORT_KEYS,
} from '@aiproj/types'

test.group('PortfolioGroupingView Validators — §3.4', () => {
  // ─── 列表查询 ──────────────────────────────────────────────────────────

  test('list: 空查询通过验证', async ({ assert }) => {
    const result = await portfolioGroupingViewListValidator.validate({})
    assert.isObject(result)
  })

  test('list: 合法分页参数通过', async ({ assert }) => {
    const result = await portfolioGroupingViewListValidator.validate({
      page: 2,
      perPage: 50,
      scope: 'personal',
      search: '按状态',
    })
    assert.equal(result.page, 2)
    assert.equal(result.perPage, 50)
    assert.equal(result.scope, 'personal')
  })

  test('list: 非法 scope 被拒绝', async ({ assert }) => {
    await assert.rejects(async () => {
      await portfolioGroupingViewListValidator.validate({ scope: 'invalid_scope' })
    })
  })

  test('list: perPage 超过上限被拒绝', async ({ assert }) => {
    await assert.rejects(async () => {
      await portfolioGroupingViewListValidator.validate({ perPage: 200 })
    })
  })

  test('list: 合法 scope 值通过', async ({ assert }) => {
    for (const scope of Object.values(PMO_GROUPING_VIEW_SCOPES)) {
      const result = await portfolioGroupingViewListValidator.validate({ scope })
      assert.equal(result.scope, scope)
    }
  })

  // ─── 预览 ──────────────────────────────────────────────────────────────

  test('preview: 仅 viewId 通过', async ({ assert }) => {
    const result = await portfolioGroupingViewPreviewValidator.validate({
      viewId: 'system-by-status',
    })
    assert.equal(result.viewId, 'system-by-status')
  })

  test('preview: 仅临时 query 通过', async ({ assert }) => {
    const result = await portfolioGroupingViewPreviewValidator.validate({
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
    })
    assert.isObject(result.query)
    assert.equal(result.query!.primaryGrouping, 'status')
  })

  test('preview: viewId 和 query 同时提供通过', async ({ assert }) => {
    const result = await portfolioGroupingViewPreviewValidator.validate({
      viewId: 'system-by-health',
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
    })
    assert.equal(result.viewId, 'system-by-health')
    assert.isObject(result.query)
  })

  test('preview: 空 body 通过（无 viewId 和 query）', async ({ assert }) => {
    const result = await portfolioGroupingViewPreviewValidator.validate({})
    assert.isObject(result)
  })

  // ─── 创建 ──────────────────────────────────────────────────────────────

  test('create: 最小合法 payload 通过', async ({ assert }) => {
    const result = await portfolioGroupingViewCreateValidator.validate({
      name: '我的视图',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
    })
    assert.equal(result.name, '我的视图')
    assert.equal(result.scope, 'personal')
  })

  test('create: 带可选字段通过', async ({ assert }) => {
    const result = await portfolioGroupingViewCreateValidator.validate({
      name: '完整视图',
      description: '详细描述',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: {
        primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.HEALTH,
        secondaryGrouping: 'status',
        sort: PMO_GROUPING_VIEW_SORT_KEYS.PROJECT_COUNT,
        order: 'desc',
      },
      isDefault: true,
    })
    assert.equal(result.name, '完整视图')
    assert.equal(result.description, '详细描述')
    assert.isTrue(result.isDefault)
  })

  test('create: 缺少 name 被拒绝', async ({ assert }) => {
    await assert.rejects(async () => {
      await portfolioGroupingViewCreateValidator.validate({
        scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
        query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
      })
    })
  })

  test('create: 缺少 query 被拒绝', async ({ assert }) => {
    await assert.rejects(async () => {
      await portfolioGroupingViewCreateValidator.validate({
        name: '测试',
        scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      })
    })
  })

  test('create: 名称超长被拒绝', async ({ assert }) => {
    await assert.rejects(async () => {
      await portfolioGroupingViewCreateValidator.validate({
        name: 'x'.repeat(200),
        scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
        query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
      })
    })
  })

  test('create: 非法 primaryGrouping 被拒绝', async ({ assert }) => {
    await assert.rejects(async () => {
      await portfolioGroupingViewCreateValidator.validate({
        name: '无效',
        scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
        query: { primaryGrouping: 'invalid_key' },
      })
    })
  })

  test('create: 非法 scope 被拒绝', async ({ assert }) => {
    await assert.rejects(async () => {
      await portfolioGroupingViewCreateValidator.validate({
        name: '测试',
        scope: 'global',
        query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
      })
    })
  })

  test('create: 组织共享视图合法', async ({ assert }) => {
    const result = await portfolioGroupingViewCreateValidator.validate({
      name: '组织视图',
      scope: PMO_GROUPING_VIEW_SCOPES.ORGANIZATION,
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.DEPARTMENT },
    })
    assert.equal(result.scope, 'organization')
  })

  // ─── 更新 ──────────────────────────────────────────────────────────────

  test('update: 仅更新 name 通过', async ({ assert }) => {
    const result = await portfolioGroupingViewUpdateValidator.validate({
      name: '新名称',
    })
    assert.equal(result.name, '新名称')
  })

  test('update: 空 payload 通过（无变更）', async ({ assert }) => {
    const result = await portfolioGroupingViewUpdateValidator.validate({})
    assert.isObject(result)
  })

  test('update: 更新 isDefault 通过', async ({ assert }) => {
    const result = await portfolioGroupingViewUpdateValidator.validate({
      isDefault: false,
    })
    assert.isFalse(result.isDefault)
  })

  test('update: 更新 query 通过', async ({ assert }) => {
    const result = await portfolioGroupingViewUpdateValidator.validate({
      query: {
        primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
        sort: PMO_GROUPING_VIEW_SORT_KEYS.GROUP_NAME,
      },
    })
    assert.isObject(result.query)
  })

  // ─── 复制 ──────────────────────────────────────────────────────────────

  test('duplicate: 带 name 通过', async ({ assert }) => {
    const result = await portfolioGroupingViewDuplicateValidator.validate({
      name: '副本名称',
    })
    assert.equal(result.name, '副本名称')
  })

  test('duplicate: 不带 name 通过', async ({ assert }) => {
    const result = await portfolioGroupingViewDuplicateValidator.validate({})
    assert.isObject(result)
  })

  // ─── 设默认 ────────────────────────────────────────────────────────────

  test('setDefault: personal scope 通过', async ({ assert }) => {
    const result = await portfolioGroupingViewSetDefaultValidator.validate({
      scope: 'personal',
    })
    assert.equal(result.scope, 'personal')
  })

  test('setDefault: organization scope 通过', async ({ assert }) => {
    const result = await portfolioGroupingViewSetDefaultValidator.validate({
      scope: 'organization',
    })
    assert.equal(result.scope, 'organization')
  })

  test('setDefault: 非法 scope 被拒绝', async ({ assert }) => {
    await assert.rejects(async () => {
      await portfolioGroupingViewSetDefaultValidator.validate({
        scope: 'system',
      })
    })
  })

  test('setDefault: 缺少 scope 被拒绝', async ({ assert }) => {
    await assert.rejects(async () => {
      await portfolioGroupingViewSetDefaultValidator.validate({})
    })
  })

  // ─── 分组查询边界 ─────────────────────────────────────────────────────

  test('query: 合法 secondaryGrouping 通过', async ({ assert }) => {
    const result = await portfolioGroupingViewCreateValidator.validate({
      name: '二级分组',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: {
        primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
        secondaryGrouping: 'health',
      },
    })
    assert.equal(result.query.secondaryGrouping, 'health')
  })

  test('query: topN 合法值通过', async ({ assert }) => {
    const result = await portfolioGroupingViewCreateValidator.validate({
      name: 'TopN',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: {
        primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
        topN: 10,
      },
    })
    assert.equal(result.query.topN, 10)
  })

  test('query: 合法 compareMode 通过', async ({ assert }) => {
    const result = await portfolioGroupingViewCreateValidator.validate({
      name: 'Compare',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: {
        primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
        compareMode: 'side_by_side',
      },
    })
    assert.equal(result.query.compareMode, 'side_by_side')
  })

  test('query: displayMetricKeys 合法数量通过', async ({ assert }) => {
    const result = await portfolioGroupingViewCreateValidator.validate({
      name: 'Metrics',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: {
        primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
        displayMetricKeys: ['total_projects', 'active_projects', 'at_risk_projects'],
      },
    })
    assert.lengthOf(result.query.displayMetricKeys!, 3)
  })

  test('query: 合法 filters 通过', async ({ assert }) => {
    const result = await portfolioGroupingViewCreateValidator.validate({
      name: 'Filters',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: {
        primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
        filters: {
          status: ['active', 'archived'],
          search: '关键词',
        },
      },
    })
    assert.deepEqual(result.query.filters!.status, ['active', 'archived'])
  })
})
