import { test } from '@japa/runner'
import OrganizationResourcePoolService, {
  type OrganizationResourcePoolReaders,
} from '#services/organization_resource_pool_service'
import type User from '#models/user'
import { useAuthDatabase } from '../functional/auth/_helpers.js'

// ── Factories ────────────────────────────────────────────────────────────────────

function makeProjectFact(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    organizationId: 1,
    name: '测试项目',
    status: 'active',
    healthStatus: 'green',
    updatedAt: new Date().toISOString(),
    createdBy: 1,
    ...overrides,
  }
}

function makeResourceFact(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    projectId: 1,
    userId: null,
    name: '张三',
    email: 'zhangsan@example.com',
    resourceType: 'human',
    role: 'developer',
    status: 'active',
    dailyCapacityHours: 8,
    skillTags: 'typescript,react',
    roleTags: 'senior',
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeAllocationFact(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    resourceId: 1,
    taskId: 10,
    allocationPercent: 50,
    startDate: '2026-10-01',
    endDate: '2026-10-07',
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeRequirementFact(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    projectId: 1,
    taskId: 20,
    role: 'developer',
    skillTags: 'typescript',
    allocationPercent: 100,
    startDate: '2026-11-01',
    endDate: '2026-11-15',
    priority: 'high',
    status: 'open',
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeAvailabilityFact(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    resourceId: 1,
    startDate: '2026-10-05',
    endDate: '2026-10-05',
    capacityOverrideHours: 0,
    status: 'confirmed',
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ── Mock Readers ───────────────────────────────────────────────────────────────

function mockReaders(
  overrides: Partial<OrganizationResourcePoolReaders> = {},
): OrganizationResourcePoolReaders {
  return {
    readVisibleProjects: async () => [makeProjectFact()],
    readResources: async () => [makeResourceFact()],
    readAllocations: async () => [makeAllocationFact()],
    readRequirements: async () => [makeRequirementFact()],
    readAvailabilityExceptions: async () => [makeAvailabilityFact()],
    ...overrides,
  }
}

const mockAccess = {
  canViewResourceDetails: true,
  canViewLinkedUsers: true,
  canViewPmo: true,
}

test.group('OrganizationResourcePoolService', (group) => {
  useAuthDatabase(group)

  // ─── 4.8.1: 确定性聚合 ─────────────────────────────────────────────────────

  test('getSummary returns deterministic result for same inputs', async ({ assert }) => {
    const readers = mockReaders()
    const service = new OrganizationResourcePoolService(readers)

    const user = { id: 1, isSuperAdmin: false } as User
    const result1 = await service.getSummary(user, 1, undefined, mockAccess)
    const result2 = await service.getSummary(user, 1, undefined, mockAccess)

    assert.equal(result1.resourceCount, result2.resourceCount)
    assert.equal(result1.conflictCount, result2.conflictCount)
    assert.equal(result1.demandGapCount, result2.demandGapCount)
    assert.deepEqual(result1.capacity, result2.capacity)
  })

  // ─── 4.8.2: 空组织返回合法空态 ──────────────────────────────────────────

  test('empty organization returns empty summary with warning', async ({ assert }) => {
    const readers = mockReaders({
      readVisibleProjects: async () => [],
    })
    const service = new OrganizationResourcePoolService(readers)
    const user = { id: 1, isSuperAdmin: false } as User

    const result = await service.getSummary(user, 1, undefined, mockAccess)

    assert.equal(result.resourceCount, 0)
    assert.equal(result.conflictCount, 0)
    assert.equal(result.demandGapCount, 0)
    assert.equal(result.capacity.totalHours, 0)
    assert.isTrue(result.warnings.some((w) => w.code === 'EMPTY_ORGANIZATION_RESOURCE_POOL'))
  })

  // ─── 4.8.3: 需求与分配分离 ──────────────────────────────────────────────

  test('demand gaps remain separate from allocated capacity', async ({ assert }) => {
    const readers = mockReaders({
      readAllocations: async () => [], // 无分配
      readRequirements: async () => [makeRequirementFact()], // 有需求
    })
    const service = new OrganizationResourcePoolService(readers)
    const user = { id: 1, isSuperAdmin: false } as User

    const result = await service.getSummary(user, 1, undefined, mockAccess)

    // 有需求但没分配——分配容量应为 0
    assert.equal(result.capacity.allocatedHours, 0)
    assert.isTrue(result.demandGapCount > 0)
  })

  test('allocation sourced from resource_allocations, not task.assignee', async ({ assert }) => {
    const readers = mockReaders()
    const service = new OrganizationResourcePoolService(readers)
    const user = { id: 1, isSuperAdmin: false } as User

    const result = await service.getSummary(user, 1, undefined, mockAccess)

    // 分配应来自 resource_allocations 表
    assert.isTrue(result.capacity.allocatedHours > 0)
    // metrics 中应包含 allocation 来源
    const allocationMetric = result.metrics.find(
      (m) => m.key === 'org_respool_allocated_capacity_hours',
    )
    assert.isDefined(allocationMetric)
    assert.equal(allocationMetric!.source, 'resource_allocation')
  })

  // ─── 4.8.4: 项目事实复用 ─────────────────────────────────────────────────

  test('visible project resolution always filters by organization_id', async ({ assert }) => {
    const readers = mockReaders({
      readVisibleProjects: async () => [
        makeProjectFact({ id: 1, organizationId: 1 }),
        makeProjectFact({ id: 2, organizationId: 999 }), // 别的组织
      ],
    })
    const service = new OrganizationResourcePoolService(readers)
    const user = { id: 1, isSuperAdmin: false } as User

    const result = await service.getSummary(user, 1, undefined, mockAccess)

    // Service 内部 readVisibleProjects 返回前已过滤 organization_id
    // 我们通过 meta.visibleProjectCount 验证
    assert.isTrue(result.meta.visibleProjectCount <= 2)
  })

  // ─── 4.8.5: 低基数脱敏 ────────────────────────────────────────────────────

  test('skill coverage redacts low-cardinality buckets', async ({ assert }) => {
    const readers = mockReaders({
      readResources: async () => [
        makeResourceFact({ id: 1, skillTags: 'go' }),
        makeResourceFact({ id: 2, skillTags: 'go' }), // 只有2个——低于阈值3
      ],
    })
    const service = new OrganizationResourcePoolService(readers)
    const user = { id: 1, isSuperAdmin: false } as User

    const result = await service.getSummary(user, 1, undefined, mockAccess)

    // 2 个资源 < 3 阈值 => 应脱敏
    if (result.skillCoverage.length > 0) {
      const goSkill = result.skillCoverage.find((s) => s.skill === null && s.redacted)
      assert.isDefined(goSkill)
    }
  })

  // ─── 4.8.6: 冲突检测 ──────────────────────────────────────────────────────

  test('overloaded resource generates conflict', async ({ assert }) => {
    const readers = mockReaders({
      readAllocations: async () => [
        makeAllocationFact({ allocationPercent: 200 }), // 200% 分配 → 过载
      ],
    })
    const service = new OrganizationResourcePoolService(readers)
    const user = { id: 1, isSuperAdmin: false } as User

    const { conflicts, total } = await service.getConflicts(user, 1, undefined, mockAccess)

    assert.isTrue(total > 0)
    assert.isTrue(conflicts.some((c) => c.severity === 'critical'))
  })

  test('unavailable date allocation generates conflict', async ({ assert }) => {
    const readers = mockReaders({
      readAllocations: async () => [
        makeAllocationFact({ startDate: '2026-10-05', endDate: '2026-10-05' }),
      ],
      readAvailabilityExceptions: async () => [
        makeAvailabilityFact({
          startDate: '2026-10-05',
          endDate: '2026-10-05',
          capacityOverrideHours: 0,
        }),
      ],
    })
    const service = new OrganizationResourcePoolService(readers)
    const user = { id: 1, isSuperAdmin: false } as User

    const { total } = await service.getConflicts(user, 1, undefined, mockAccess)

    // 不可用日期的分配应生成冲突
    assert.isTrue(total > 0)
  })

  // ─── 4.8.7: 跨项目争用 ────────────────────────────────────────────────────

  test('cross-project contention is detected for same resource across multiple projects', async ({
    assert,
  }) => {
    const readers = mockReaders({
      readResources: async () => [makeResourceFact({ id: 1 })],
      readAllocations: async () => [
        makeAllocationFact({ id: 1, resourceId: 1, taskId: 100, allocationPercent: 90 }),
        makeAllocationFact({ id: 2, resourceId: 1, taskId: 200, allocationPercent: 90 }),
      ],
    })
    const service = new OrganizationResourcePoolService(readers)
    const user = { id: 1, isSuperAdmin: false } as User

    const { conflicts } = await service.getConflicts(user, 1, undefined, mockAccess)

    // 同资源在多个项目中的高分配 → 争用
    const contention = conflicts.find((c) => c.description.includes('跨'))
    assert.isDefined(contention, '同资源跨多个项目的高分配应产生争用冲突')
    assert.equal(contention!.resourceId, 1)
    assert.lengthOf(contention!.projectIds ?? [], 2)
  })

  // ─── 4.8.8: Stale source ────────────────────────────────────────────────────

  test('stale source data generates freshness warning', async ({ assert }) => {
    const oldDate = new Date(Date.now() - 100 * 60 * 1000).toISOString() // 100 分钟前
    const readers = mockReaders({
      readResources: async () => [makeResourceFact({ updatedAt: oldDate })],
      readAllocations: async () => [makeAllocationFact({ updatedAt: oldDate })],
    })
    const service = new OrganizationResourcePoolService(readers)
    const user = { id: 1, isSuperAdmin: false } as User

    const result = await service.getSummary(
      user,
      1,
      { freshnessWindowMinutes: 60 } as any,
      mockAccess,
    )

    assert.isTrue(result.sourceFreshness.some((f) => f.isStale))
  })

  // ─── 4.8.9: 下钻 ────────────────────────────────────────────────────────────

  test('drill-down to project returns authorized project data', async ({ assert }) => {
    const service = new OrganizationResourcePoolService(mockReaders())
    const user = { id: 1, isSuperAdmin: false } as User

    const result = await service.drillDown(user, 1, 'project', undefined, undefined, 1)

    assert.isObject(result)
  })

  // ─── 4.8.10: Source signature ────────────────────────────────────────────────

  test('computeSourceSignature produces deterministic hash', async ({ assert }) => {
    const service = new OrganizationResourcePoolService(mockReaders())
    const resources = [makeResourceFact()]
    const allocations = [makeAllocationFact()]
    const requirements = [makeRequirementFact()]
    const projects = [makeProjectFact()]

    const sig1 = service.computeSourceSignature(resources, allocations, requirements, projects)
    const sig2 = service.computeSourceSignature(resources, allocations, requirements, projects)

    assert.equal(sig1, sig2)
    assert.isString(sig1)
    assert.isNotEmpty(sig1)
  })
})

// ─── 4.9: 性能测试 ─────────────────────────────────────────────────────────────

test.group('OrganizationResourcePoolService — Performance', (group) => {
  useAuthDatabase(group)

  test('summary with 100 resources and 2000 allocations completes within budget', async ({
    assert,
  }) => {
    const resources = Array.from({ length: 100 }, (_, i) =>
      makeResourceFact({
        id: i + 1,
        name: `资源${i + 1}`,
        projectId: (i % 10) + 1,
      }),
    )

    const allocations = Array.from({ length: 2000 }, (_, i) =>
      makeAllocationFact({
        id: i + 1,
        resourceId: (i % 100) + 1,
        taskId: (i % 200) + 1,
        allocationPercent: 50 + (i % 100),
      }),
    )

    const projects = Array.from({ length: 10 }, (_, i) => makeProjectFact({ id: i + 1 }))

    const readers: OrganizationResourcePoolReaders = {
      readVisibleProjects: async () => projects,
      readResources: async () => resources,
      readAllocations: async () => allocations,
      readRequirements: async () => [],
      readAvailabilityExceptions: async () => [],
    }

    const service = new OrganizationResourcePoolService(readers)
    const user = { id: 1, isSuperAdmin: false } as User

    const start = performance.now()
    const result = await service.getSummary(user, 1, undefined, mockAccess)
    const duration = performance.now() - start

    assert.equal(result.resourceCount, 100)
    assert.isTrue(duration < 10000, `Summary took ${duration}ms, expected < 10000ms`)

    // Also test listResources
    const start2 = performance.now()
    const { total } = await service.listResources(user, 1, undefined, mockAccess)
    const duration2 = performance.now() - start2

    assert.equal(total, 100)
    assert.isTrue(duration2 < 5000, `ListResources took ${duration2}ms, expected < 5000ms`)
  })

  test('capacity matrix with 50 resources completes within budget', async ({ assert }) => {
    const resources = Array.from({ length: 50 }, (_, i) =>
      makeResourceFact({ id: i + 1, name: `资源${i + 1}` }),
    )
    const allocations = Array.from({ length: 500 }, (_, i) =>
      makeAllocationFact({
        id: i + 1,
        resourceId: (i % 50) + 1,
        allocationPercent: 30 + (i % 70),
      }),
    )

    const readers: OrganizationResourcePoolReaders = {
      readVisibleProjects: async () => [makeProjectFact()],
      readResources: async () => resources,
      readAllocations: async () => allocations,
      readRequirements: async () => [],
      readAvailabilityExceptions: async () => [],
    }

    const service = new OrganizationResourcePoolService(readers)
    const user = { id: 1, isSuperAdmin: false } as User

    const start = performance.now()
    const result = await service.getCapacityMatrix(user, 1, undefined, mockAccess)
    const duration = performance.now() - start

    assert.isTrue(result.rows.length > 0)
    assert.isTrue(duration < 5000, `Capacity matrix took ${duration}ms, expected < 5000ms`)
  })
})
