import { test } from '@japa/runner'
import PmoInvestmentDistributionService, {
  type InvestmentProjectFact,
} from '#services/pmo_investment_distribution_service'
import {
  PMO_INVESTMENT_DISTRIBUTION_METRIC_VERSION,
  PMO_INVESTMENT_WARNING_CODES,
} from '@aiproj/types'

const user = { id: 7, isSuperAdmin: false } as any

const projects: InvestmentProjectFact[] = [
  {
    id: 1,
    organizationId: 1,
    name: 'Alpha',
    category: 'delivery',
    priority: 'high',
    status: 'active',
    createdBy: 7,
    updatedAt: '2026-07-28T00:00:00.000Z',
    settings: { lifecyclePhase: 'build', department: 'platform' },
  },
  {
    id: 2,
    organizationId: 1,
    name: 'Beta',
    category: 'research',
    priority: 'medium',
    status: 'planning',
    createdBy: 8,
    updatedAt: '2026-07-27T00:00:00.000Z',
    settings: { lifecyclePhase: 'discover', department: 'ai' },
  },
  {
    id: 3,
    organizationId: 1,
    name: 'Gamma',
    category: 'delivery',
    priority: 'medium',
    status: 'active',
    createdBy: 9,
    updatedAt: '2026-07-26T00:00:00.000Z',
    settings: { lifecyclePhase: 'build', department: 'platform' },
  },
]

const largerProjects: InvestmentProjectFact[] = [
  ...projects,
  {
    id: 4,
    organizationId: 1,
    name: 'Delta',
    category: 'research',
    priority: 'low',
    status: 'active',
    createdBy: 7,
    updatedAt: '2026-07-25T00:00:00.000Z',
    settings: { lifecyclePhase: 'discover', department: 'ai' },
  },
  {
    id: 5,
    organizationId: 1,
    name: 'Epsilon',
    category: 'ops',
    priority: 'high',
    status: 'planning',
    createdBy: 7,
    updatedAt: '2026-07-24T00:00:00.000Z',
    settings: { lifecyclePhase: 'run', department: 'ops' },
  },
  {
    id: 6,
    organizationId: 1,
    name: 'Zeta',
    category: 'ops',
    priority: 'medium',
    status: 'planning',
    createdBy: 7,
    updatedAt: '2026-07-23T00:00:00.000Z',
    settings: { lifecyclePhase: 'run', department: 'ops' },
  },
]

test.group('PmoInvestmentDistributionService', () => {
  test('catalogue 暴露非财务 basis、unsupported 财务 basis 和展示模式', ({ assert }) => {
    const catalogue = new PmoInvestmentDistributionService().getSupportedCatalogue()
    assert.include(catalogue.nonFinancialBasis, 'project_count')
    assert.include(catalogue.unsupportedFinancialBasis, 'roi')
    assert.include(catalogue.displayModes, 'matrix')
    assert.equal(catalogue.metricVersion, PMO_INVESTMENT_DISTRIBUTION_METRIC_VERSION)
  })

  test('project_count 按可见项目聚合并归一化百分比', async ({ assert }) => {
    const service = new PmoInvestmentDistributionService({
      async readProjects() {
        return projects
      },
    })
    const summary = await service.getSummary(user, 1, {
      basis: 'project_count',
      dimension: 'project_type',
    })
    assert.equal(summary.meta.visibleProjectCount, 3)
    assert.equal(summary.meta.totalBasisValue, 3)
    assert.equal(
      summary.buckets.reduce((sum, bucket) => sum + bucket.percent, 0),
      100,
    )
    assert.equal(summary.buckets[0].key, 'delivery')
  })

  test('reader 返回跨组织项目时服务再次过滤', async ({ assert }) => {
    const service = new PmoInvestmentDistributionService({
      async readProjects() {
        return [
          ...projects,
          {
            id: 99,
            organizationId: 2,
            name: 'Other Org Secret',
            category: 'secret',
            priority: 'critical',
            status: 'active',
          },
        ]
      },
    })
    const summary = await service.getSummary(user, 1, {
      basis: 'project_count',
      dimension: 'project_type',
    })
    assert.equal(summary.meta.visibleProjectCount, 3)
    assert.isUndefined(summary.buckets.find((bucket) => bucket.key === 'secret'))
  })

  test('estimated_effort_hours 使用授权工时 facts', async ({ assert }) => {
    const service = new PmoInvestmentDistributionService({
      async readProjects() {
        return projects
      },
      async readEstimatedEffortHours() {
        return [
          { projectId: 1, value: 80, updatedAt: '2026-07-28T00:00:00.000Z' },
          { projectId: 2, value: 20, updatedAt: '2026-07-28T00:00:00.000Z' },
          { projectId: 3, value: 100, updatedAt: '2026-07-28T00:00:00.000Z' },
        ]
      },
    })
    const summary = await service.getSummary(user, 1, {
      basis: 'estimated_effort_hours',
      dimension: 'lifecycle_phase',
    })
    assert.equal(summary.meta.totalBasisValue, 200)
    assert.equal(summary.buckets.find((bucket) => bucket.key === 'build')?.total, 180)
  })

  test('resource allocation 权限不足时返回 redacted', async ({ assert }) => {
    const service = new PmoInvestmentDistributionService({
      async readProjects() {
        return projects
      },
    })
    const summary = await service.getSummary(
      user,
      1,
      { basis: 'resource_allocation_percent', dimension: 'department' },
      { canViewResourceFacts: false, canViewDepartmentDimension: false },
    )
    assert.isNull(summary.meta.totalBasisValue)
    assert.equal(summary.buckets[0].total, null)
    assert.equal(summary.warnings[0].code, PMO_INVESTMENT_WARNING_CODES.PERMISSION_REDACTED)
  })

  test('resource allocation 授权时聚合百分比分布', async ({ assert }) => {
    const service = new PmoInvestmentDistributionService({
      async readProjects() {
        return largerProjects
      },
      async readResourceAllocationPercent() {
        return [
          { projectId: 1, value: 100, updatedAt: '2026-07-28T00:00:00.000Z' },
          { projectId: 3, value: 120, updatedAt: '2026-07-28T00:00:00.000Z' },
          { projectId: 5, value: 80, updatedAt: '2026-07-28T00:00:00.000Z' },
          { projectId: 6, value: 40, updatedAt: '2026-07-28T00:00:00.000Z' },
        ]
      },
    })
    const summary = await service.getSummary(
      user,
      1,
      { basis: 'resource_allocation_percent', dimension: 'project_type' },
      { canViewResourceFacts: true },
    )
    assert.equal(summary.meta.totalBasisValue, 340)
    assert.equal(summary.buckets.find((bucket) => bucket.key === 'delivery')?.total, 220)
  })

  test('missing effort facts 返回 SOURCE_UNAVAILABLE warning', async ({ assert }) => {
    const service = new PmoInvestmentDistributionService({
      async readProjects() {
        return projects
      },
      async readEstimatedEffortHours() {
        return []
      },
    })
    const summary = await service.getSummary(user, 1, { basis: 'estimated_effort_hours' })
    assert.lengthOf(summary.buckets, 0)
    assert.equal(summary.warnings[0].code, PMO_INVESTMENT_WARNING_CODES.SOURCE_UNAVAILABLE)
  })

  test('财务 basis 不伪造数值', async ({ assert }) => {
    const service = new PmoInvestmentDistributionService({
      async readProjects() {
        throw new Error('financial requests should not read projects')
      },
    })
    const summary = await service.getSummary(user, 1, { basis: 'roi' })
    assert.isNull(summary.meta.totalBasisValue)
    assert.lengthOf(summary.buckets, 0)
    assert.equal(summary.warnings[0].code, PMO_INVESTMENT_WARNING_CODES.FINANCIAL_BASIS_UNSUPPORTED)
  })

  test('空组合返回 empty warning', async ({ assert }) => {
    const service = new PmoInvestmentDistributionService({
      async readProjects() {
        return []
      },
    })
    const summary = await service.getSummary(user, 1)
    assert.equal(summary.meta.visibleProjectCount, 0)
    assert.equal(summary.warnings[0].code, PMO_INVESTMENT_WARNING_CODES.EMPTY_PORTFOLIO)
  })

  test('drill-down 复用 summary 授权和 bucket', async ({ assert }) => {
    const service = new PmoInvestmentDistributionService({
      async readProjects() {
        return projects
      },
    })
    const result = await service.getDrillDown(user, 1, {
      bucketKey: 'delivery',
      basis: 'project_count',
      dimension: 'project_type',
    })
    assert.lengthOf(result.data, 2)
    assert.equal(result.data[0].bucketKey, 'delivery')
  })

  test('topN 溢出并入 other，低基数桶不暴露项目数', async ({ assert }) => {
    const service = new PmoInvestmentDistributionService({
      async readProjects() {
        return largerProjects
      },
    })
    const summary = await service.getSummary(user, 1, {
      basis: 'project_count',
      dimension: 'project_type',
      topN: 1,
    })
    assert.exists(summary.buckets.find((bucket) => bucket.key === 'other'))
    assert.isUndefined(summary.buckets.find((bucket) => bucket.key === 'research'))
    assert.equal(summary.meta.totalBasisValue, 6)
  })

  test('输入签名对相同输入稳定', async ({ assert }) => {
    const service = new PmoInvestmentDistributionService({
      async readProjects() {
        return projects
      },
    })
    const first = await service.getSummary(user, 1, {
      basis: 'project_count',
      dimension: 'status',
    })
    const second = await service.getSummary(user, 1, {
      basis: 'project_count',
      dimension: 'status',
    })
    assert.equal(first.meta.inputSignatureHash, second.meta.inputSignatureHash)
  })

  test('1000 项目分布聚合保持有界且不含外部调用敏感字段', async ({ assert }) => {
    const bigProjects = Array.from({ length: 1000 }, (_, index) => ({
      id: index + 1,
      organizationId: 1,
      name: `项目 ${index + 1}`,
      category: `type-${index % 8}`,
      priority: index % 3 === 0 ? 'high' : 'medium',
      status: index % 2 === 0 ? 'active' : 'planning',
      createdBy: 7,
      updatedAt: '2026-07-28T00:00:00.000Z',
    }))
    let readCount = 0
    const service = new PmoInvestmentDistributionService({
      async readProjects() {
        readCount += 1
        return bigProjects
      },
    })

    const startedAt = Date.now()
    const summary = await service.getSummary(user, 1, {
      basis: 'project_count',
      dimension: 'project_type',
      topN: 10,
    })
    const elapsedMs = Date.now() - startedAt

    assert.equal(readCount, 1)
    assert.equal(summary.meta.visibleProjectCount, 1000)
    assert.equal(summary.meta.totalBasisValue, 1000)
    assert.isAtMost(elapsedMs, 500)
    const serialized = JSON.stringify(summary).toLowerCase()
    assert.notInclude(serialized, 'prompt')
    assert.notInclude(serialized, 'model_output')
    assert.notInclude(serialized, 'authorization')
    assert.notInclude(serialized, 'token')
  })
})
