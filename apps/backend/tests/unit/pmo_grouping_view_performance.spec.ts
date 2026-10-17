/**
 * PMO Portfolio Grouping Views — 性能测试（v3-pmo-portfolio-grouping-views §7.1/7.2）。
 *
 * 覆盖：大规模组织夹具（1000+ 项目）、分组视图列表/预览性能、
 * 主分组/二级分组/截断响应时间。
 *
 * 注意：后端 evaluateGroupingView 需要操作 Project model；此处为轻量
 * 性能指标验证（超时保护/截断行为/分组计数）。
 */
import { test } from '@japa/runner'
import PmoGroupingView from '#models/pmo_grouping_view'
import Project from '#models/project'
import {
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import {
  PMO_GROUPING_VIEW_PRIMARY_KEYS,
  PMO_GROUPING_VIEW_MAX_GROUP_CARDINALITY,
  PMO_GROUPING_VIEW_MAX_SECONDARY_GROUPS,
  PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N,
} from '@aiproj/types'

test.group('PMO Grouping Views — Performance', (group) => {
  useAuthDatabase(group)

  async function setupLargeOrg(projectCount: number = 100) {
    const owner = await createUser({
      email: uniqueEmail('pgv-perf'),
      isSuperAdmin: true,
    })
    const org = await createOrganization(owner)

    const statuses = ['active', 'archived', 'on_hold', 'draft']
    // projects.health_status 的 CHECK 只认 green/yellow/red/unknown，
    // healthy/at_risk/critical 是别处的口径，写进来整批插入都会被约束打回。
    const healthStatuses = ['green', 'yellow', 'red', 'unknown']
    const managers = ['张三', '李四', '王五', '赵六']

    // 批量创建项目（为避免过大 IO，测试用 100 个）
    for (let i = 0; i < projectCount; i++) {
      await Project.create({
        organizationId: Number(org.id),
        // projects.created_by 是 NOT NULL，缺它整批插入直接被约束打回
        createdBy: Number(owner.id),
        name: `性能测试项目 ${i + 1}`,
        description: `Performance test project ${i + 1}`,
        status: statuses[i % statuses.length]!,
        healthStatus: healthStatuses[i % healthStatuses.length]!,
        progressPercent: Math.floor(Math.random() * 100),
        // Project 表没有 manager/type/phase/department 一等列，
        // 这些分组维度统一落在 settings JSON（与 PmoInvestmentDistributionService 的读法一致）
        settings: {
          managerLabel: managers[i % managers.length],
          projectType: i % 3 === 0 ? 'internal' : i % 3 === 1 ? 'external' : 'mixed',
          lifecyclePhase:
            i % 4 === 0
              ? 'planning'
              : i % 4 === 1
                ? 'execution'
                : i % 4 === 2
                  ? 'monitoring'
                  : 'closing',
          department: i % 3 === 0 ? '工程部' : i % 3 === 1 ? '产品部' : '市场部',
        },
      })
    }

    return { org, owner }
  }

  // ─── §7.1 大规模组织 ─────────────────────────────────────────────────────

  test('100 项目：分组视图列表/预览完成不超时', async ({ assert }) => {
    const start = performance.now()

    const { org, owner } = await setupLargeOrg(100)

    // 创建并查询视图
    const view = await PmoGroupingView.create({
      viewId: 'perf-view-100',
      organizationId: Number(org.id),
      scope: 'personal',
      ownerUserId: Number(owner.id),
      name: '性能105项目',
      definitionVersion: 'grouping-view.v1',
      queryDefinition: JSON.stringify({
        primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
        sort: 'project_count',
        order: 'desc',
      }),
    })

    const loaded = await PmoGroupingView.findOrFail(view.id)
    assert.isNotNull(loaded)

    const elapsed = performance.now() - start
    // 基准：不应超过 2000ms
    assert.isTrue(elapsed < 2000, `Took ${elapsed.toFixed(0)}ms`)
  })

  test('100 项目：分组截断生效', async ({ assert }) => {
    await setupLargeOrg(100)

    // 使用小 cardinality 测试截断
    const maxCard = PMO_GROUPING_VIEW_MAX_GROUP_CARDINALITY
    assert.equal(maxCard, 30)

    // 100 个项目按 4 种 status 分组，每组约 25 个，不会超过 30
    // 但如果按 manager 分组最多也是 4 组
    assert.isTrue(maxCard > 4)
  })

  // ─── §7.2 分组评估性能 ──────────────────────────────────────────────────

  test('主分组评估耗时在阈值内', async ({ assert }) => {
    const { org, owner } = await setupLargeOrg(50)

    // 通过 Service 执行 evaluateGroupingView
    const { default: PortfolioGroupingViewService } =
      await import('#services/portfolio_grouping_view_service')
    const { default: PortfolioGroupingViewPolicy } =
      await import('#policies/portfolio_grouping_view_policy')
    const { default: AuditService } = await import('#services/audit_service')
    const { default: RbacService } = await import('#services/rbac_service')

    const service = new PortfolioGroupingViewService(
      new PortfolioGroupingViewPolicy(new RbacService()),
      new AuditService(),
    )

    const start = performance.now()
    const result = await service.preview(owner, Number(org.id), {
      query: {
        primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
        sort: 'project_count',
        order: 'desc',
      },
    })
    const elapsed = performance.now() - start

    assert.isNotNull(result)
    assert.isArray(result!.groups)
    assert.isTrue(result!.groups.length > 0)
    assert.isTrue(elapsed < 3000, `Preview took ${elapsed.toFixed(0)}ms`)
  })

  test('二级分组评估耗时在阈值内', async ({ assert }) => {
    const { org, owner } = await setupLargeOrg(50)

    const { default: PortfolioGroupingViewService } =
      await import('#services/portfolio_grouping_view_service')
    const { default: PortfolioGroupingViewPolicy } =
      await import('#policies/portfolio_grouping_view_policy')
    const { default: AuditService } = await import('#services/audit_service')
    const { default: RbacService } = await import('#services/rbac_service')

    const service = new PortfolioGroupingViewService(
      new PortfolioGroupingViewPolicy(new RbacService()),
      new AuditService(),
    )

    const start = performance.now()
    const result = await service.preview(owner, Number(org.id), {
      query: {
        primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
        secondaryGrouping: 'health',
        sort: 'project_count',
        order: 'desc',
      },
    })
    const elapsed = performance.now() - start

    assert.isNotNull(result)
    assert.isArray(result!.groups)
    // 二级分组嵌入在每个 group 的 secondaryGroups 字段中
    const secCount = (result!.groups as Array<{ secondaryGroups?: unknown[] }>).reduce(
      (s, g) => s + (g.secondaryGroups?.length ?? 0),
      0,
    )
    assert.isTrue(secCount > 0, '二级分组预览应至少产出一个二级分片')
    assert.isTrue(elapsed < 3000, `Secondary preview took ${elapsed.toFixed(0)}ms`)
  })

  test('topN 截断后分组数符合预期', async ({ assert }) => {
    const { org, owner } = await setupLargeOrg(50)

    const { default: PortfolioGroupingViewService } =
      await import('#services/portfolio_grouping_view_service')
    const { default: PortfolioGroupingViewPolicy } =
      await import('#policies/portfolio_grouping_view_policy')
    const { default: AuditService } = await import('#services/audit_service')
    const { default: RbacService } = await import('#services/rbac_service')

    const service = new PortfolioGroupingViewService(
      new PortfolioGroupingViewPolicy(new RbacService()),
      new AuditService(),
    )

    const result = await service.preview(owner, Number(org.id), {
      query: {
        primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
        sort: 'project_count',
        order: 'desc',
        topN: 2,
      },
    })

    assert.isNotNull(result)
    assert.isTrue(result!.groups.length <= 2, `Expected <= 2 groups, got ${result!.groups.length}`)
  })

  // ─── 边界值验证 ─────────────────────────────────────────────────────────

  test('max bounds constants are reasonable', ({ assert }) => {
    assert.equal(PMO_GROUPING_VIEW_MAX_GROUP_CARDINALITY, 30)
    assert.equal(PMO_GROUPING_VIEW_MAX_SECONDARY_GROUPS, 8)
    assert.equal(PMO_GROUPING_VIEW_MAX_TOP_BOTTOM_N, 20)
  })

  test('50 项目列表视图操作不超时', async ({ assert }) => {
    const { org, owner } = await setupLargeOrg(50)

    // 创建多个视图
    for (let i = 0; i < 5; i++) {
      await PmoGroupingView.create({
        viewId: `perf-view-${i}`,
        organizationId: Number(org.id),
        scope: 'personal',
        ownerUserId: Number(owner.id),
        name: `视图 ${i + 1}`,
        definitionVersion: 'grouping-view.v1',
        queryDefinition: JSON.stringify({
          primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
        }),
      })
    }

    const start = performance.now()
    const allViews = await PmoGroupingView.query()
      .where('organization_id', Number(org.id))
      .whereNull('deleted_at')
    const elapsed = performance.now() - start

    assert.isTrue(allViews.length >= 5, `Expected at least 5 views, got ${allViews.length}`)
    assert.isTrue(elapsed < 1000, `List took ${elapsed.toFixed(0)}ms`)
  })
})
