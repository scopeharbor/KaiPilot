import { test } from '@japa/runner'
import PmoInvestmentDistributionService from '#services/pmo_investment_distribution_service'
import PmoInvestmentDistributionCache from '#services/pmo_investment_distribution_cache'
import {
  LARGE_PORTFOLIO_PROJECT_COUNT,
  buildLargePortfolioFixture,
} from '#tests/fixtures/pmo_investment_large_portfolio'
import { PMO_INVESTMENT_WARNING_CODES } from '@aiproj/types'

/**
 * 大组织性能门禁（§6.1/§6.2）。阈值来自本地 SQLite 优先的开发约束：
 * 1000 项目的组织级聚合必须在 1.5s 内完成，否则输出实测证据并判失败。
 */
const PERF_BUDGET_MS = 1500

const user = { id: 5, isSuperAdmin: false } as any
const fixture = buildLargePortfolioFixture(1, LARGE_PORTFOLIO_PROJECT_COUNT)

function makeService() {
  return new PmoInvestmentDistributionService(
    {
      readProjects: async () => fixture.projects,
      readEstimatedEffortHours: async () => fixture.effortFacts,
      readPlannedEffortHours: async () => fixture.effortFacts,
      readResourceAllocationPercent: async () => fixture.allocationFacts,
      readSourceSignature: async () => 'large-portfolio-sig',
    },
    new PmoInvestmentDistributionCache({ enabled: false }),
  )
}

async function measure<T>(label: string, run: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const start = performance.now()
  const value = await run()
  const ms = performance.now() - start
  // 显式证据输出：无论通过与否都留下实测耗时
  console.log(`[perf] ${label}: ${ms.toFixed(1)}ms (budget ${PERF_BUDGET_MS}ms)`)
  return { ms, value }
}

test.group('PMO 投入分布大组织性能门禁（§6.1/§6.2）', () => {
  test('夹具覆盖 1000 项目、多维度、缺失来源与低基数桶', async ({ assert }) => {
    assert.lengthOf(fixture.projects, LARGE_PORTFOLIO_PROJECT_COUNT)
    assert.isBelow(
      fixture.effortFacts.length,
      fixture.projects.length,
      '必须存在缺失工时来源的项目，才能验证不造数据',
    )
    assert.isBelow(fixture.allocationFacts.length, fixture.effortFacts.length)
    assert.equal(
      fixture.projects.filter((project) => project.category === 'singleton-type').length,
      1,
      '必须存在低基数桶以覆盖受限合并路径',
    )
    assert.isAbove(new Set(fixture.projects.map((p) => p.settings?.department)).size, 3)
  })

  test('项目数 summary 在阈值内完成', async ({ assert }) => {
    const service = makeService()
    const { ms, value } = await measure('summary/project_count/project_type', () =>
      service.getSummary(user, 1, { basis: 'project_count', dimension: 'project_type' }),
    )

    assert.equal(value.meta.visibleProjectCount, LARGE_PORTFOLIO_PROJECT_COUNT)
    assert.isAbove(value.buckets.length, 0)
    assert.isBelow(ms, PERF_BUDGET_MS, `summary 超出性能预算：实测 ${ms.toFixed(1)}ms`)
  })

  test('top bucket（bounded topN + 高基数维度）在阈值内完成', async ({ assert }) => {
    const service = makeService()
    const { ms, value } = await measure('summary/top-bucket/manager', () =>
      service.getSummary(user, 1, {
        basis: 'estimated_effort_hours',
        dimension: 'manager',
        topN: 5,
      }),
    )

    assert.isAtMost(value.buckets.length, 6, 'topN=5 之外必须并入 other 桶')
    assert.isBelow(ms, PERF_BUDGET_MS, `top bucket 查询超出性能预算：实测 ${ms.toFixed(1)}ms`)
  })

  test('缺失来源与受限维度路径同样在阈值内完成', async ({ assert }) => {
    const service = makeService()

    const missing = await measure('summary/missing-source', () =>
      new PmoInvestmentDistributionService(
        {
          readProjects: async () => fixture.projects,
          readEstimatedEffortHours: async () => [],
          readSourceSignature: async () => 'large-portfolio-sig',
        },
        new PmoInvestmentDistributionCache({ enabled: false }),
      ).getSummary(user, 1, { basis: 'estimated_effort_hours', dimension: 'lifecycle_phase' }),
    )
    assert.lengthOf(missing.value.buckets, 0)
    assert.equal(missing.value.warnings[0]!.code, PMO_INVESTMENT_WARNING_CODES.SOURCE_UNAVAILABLE)
    assert.isBelow(missing.ms, PERF_BUDGET_MS)

    const redacted = await measure('summary/redacted-department', () =>
      service.getSummary(
        user,
        1,
        { basis: 'project_count', dimension: 'department' },
        { canViewDepartmentDimension: false },
      ),
    )
    assert.equal(redacted.value.buckets[0]!.status, 'redacted')
    assert.isNull(redacted.value.buckets[0]!.projectCount, '受限桶不得泄露隐藏数量')
    assert.isBelow(redacted.ms, PERF_BUDGET_MS)
  })

  test('drill-down 在阈值内完成且分页有界', async ({ assert }) => {
    const service = makeService()
    const { ms, value } = await measure('drill-down/project_type/delivery', () =>
      service.getDrillDown(user, 1, {
        basis: 'project_count',
        dimension: 'project_type',
        bucketKey: 'delivery',
        perPage: 20,
      }),
    )

    assert.isAtMost(value.data.length, 20)
    assert.isBelow(ms, PERF_BUDGET_MS, `drill-down 超出性能预算：实测 ${ms.toFixed(1)}ms`)
  })
})
