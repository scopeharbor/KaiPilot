/**
 * 资源需求预测性能测试（v3-resource-demand-forecasting §7.1-7.2）。
 *
 * 使用大组织 mock fixture（1000 项目 / 100 资源 / 2000 需求 / 2000 分配）
 * 验证 forecast 聚合在合理时间预算内完成。
 *
 * 红线：
 *   - 全部使用 mock reader，不碰数据库
 *   - 时间预算：summary < 2s, demand-curves < 3s, gap-analysis < 3s,
 *     project-drivers < 2s, skill-drivers < 2s, trend-baseline < 2s
 */
import { test } from '@japa/runner'
import ResourceDemandForecastingService, {
  type ForecastReaders,
} from '#services/resource_demand_forecasting_service'
import type { ForecastGranularity } from '@aiproj/types'

// ─── Large-org fixture factory ────────────────────────────────────────────────

const PROJECT_COUNT = 1000
const RESOURCE_COUNT = 100
const REQUIREMENT_COUNT = 2000
const ALLOCATION_COUNT = 2000

const ROLES = ['developer', 'designer', 'pm', 'qa', 'devops', 'architect', 'data-engineer']
const SKILLS = [
  'typescript',
  'react',
  'python',
  'rust',
  'golang',
  'java',
  'figma',
  'kubernetes',
  'terraform',
  'postgresql',
]
const SKILL_KEYS = [
  'typescript',
  'react',
  'python',
  'rust',
  'golang',
  'java',
  'figma',
  'kubernetes',
  'terraform',
  'postgresql',
]

function generateLargeFixture() {
  let idSeq = 0
  const nextId = () => {
    idSeq += 1
    return idSeq
  }

  const projects = Array.from({ length: PROJECT_COUNT }, (_, i) => ({
    id: nextId(),
    organizationId: 1,
    name: `测试项目 ${i + 1}`,
    status: i % 4 === 0 ? 'completed' : 'active',
    updatedAt: new Date(Date.now() - Math.random() * 30 * 86400 * 1000).toISOString(),
  }))

  const resources = Array.from({ length: RESOURCE_COUNT }, (_, i) => ({
    id: nextId(),
    projectId: projects[i % PROJECT_COUNT].id,
    userId: null,
    name: `资源 ${i + 1}`,
    role: ROLES[i % ROLES.length],
    dailyCapacityHours: 4 + Math.floor(Math.random() * 5),
    skillTags: SKILLS.slice(0, 2 + Math.floor(Math.random() * 3)).join(','),
    updatedAt: new Date(Date.now() - Math.random() * 14 * 86400 * 1000).toISOString(),
  }))

  const requirements = Array.from({ length: REQUIREMENT_COUNT }, (_, i) => {
    const startOffset = Math.floor(Math.random() * 90)
    const duration = 7 + Math.floor(Math.random() * 28)
    const start = new Date(Date.now() + startOffset * 86400 * 1000)
    const end = new Date(start.getTime() + duration * 86400 * 1000)
    return {
      id: nextId(),
      projectId: projects[i % PROJECT_COUNT].id,
      taskId: 10000 + i,
      role: ROLES[i % ROLES.length],
      skillTags: SKILLS[i % SKILLS.length],
      allocationPercent: 100,
      hours: 4 + Math.floor(Math.random() * 80),
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      updatedAt: new Date(Date.now() - Math.random() * 7 * 86400 * 1000).toISOString(),
    }
  })

  const allocations = Array.from({ length: ALLOCATION_COUNT }, (_, i) => {
    const startOffset = Math.floor(Math.random() * 60)
    const duration = 5 + Math.floor(Math.random() * 14)
    const start = new Date(Date.now() + startOffset * 86400 * 1000)
    const end = new Date(start.getTime() + duration * 86400 * 1000)
    return {
      id: nextId(),
      resourceId: resources[i % RESOURCE_COUNT].id,
      projectId: projects[i % PROJECT_COUNT].id,
      taskId: 20000 + i,
      allocationPercent: 50 + Math.floor(Math.random() * 50),
      hours: 4 + Math.floor(Math.random() * 40),
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      updatedAt: new Date(Date.now() - Math.random() * 7 * 86400 * 1000).toISOString(),
    }
  })

  const skills = Array.from({ length: SKILL_KEYS.length }, (_, i) => ({
    id: nextId(),
    resourceId: resources[i].id,
    skillKey: SKILL_KEYS[i],
    originalLabel: SKILL_KEYS[i],
    proficiencyLevel: 'known',
    updatedAt: new Date().toISOString(),
  }))

  return { projects, resources, requirements, allocations, skills }
}

// ─── Mock readers ─────────────────────────────────────────────────────────────

function largeFixtureReaders(): ForecastReaders {
  const fixture = generateLargeFixture()
  return {
    readVisibleProjects: async () => fixture.projects,
    readResources: async () => fixture.resources,
    readRequirements: async () => fixture.requirements,
    readAllocations: async () => fixture.allocations,
    readSkills: async () => fixture.skills,
  }
}

// ─── Default context & query ──────────────────────────────────────────────────

const defaultAccess: Parameters<ResourceDemandForecastingService['getSummary']>[2] = {
  actor: { id: 1, organizationId: 1 },
  organizationId: 1,
  visibleProjectIds: null,
  canViewAllResources: true,
  canViewAllSkills: true,
  visibleResourceIds: null,
  visibleSkillKeys: null,
}

const query4Week: Parameters<ResourceDemandForecastingService['getSummary']>[1] = {
  startDate: new Date().toISOString().slice(0, 10),
  endDate: new Date(Date.now() + 28 * 86400 * 1000).toISOString().slice(0, 10),
  granularity: 'week' as ForecastGranularity,
}

const query12Week: Parameters<ResourceDemandForecastingService['getSummary']>[1] = {
  startDate: new Date().toISOString().slice(0, 10),
  endDate: new Date(Date.now() + 84 * 86400 * 1000).toISOString().slice(0, 10),
  granularity: 'week' as ForecastGranularity,
}

// ═══════════════════════════════════════════════════════════════════════════════
// Performance Tests
// ═══════════════════════════════════════════════════════════════════════════════

test.group('ResourceDemandForecastingService — Performance', () => {
  const service = new ResourceDemandForecastingService(largeFixtureReaders())

  // ─── 1. Summary < 2s ───────────────────────────────────────────────────

  test('getSummary completes within 2s for large org', async ({ assert }) => {
    const start = Date.now()
    const result = await service.getSummary(1, query4Week, defaultAccess)
    const elapsed = Date.now() - start

    assert.isBelow(elapsed, 2000, `getSummary took ${elapsed}ms (budget: 2000ms)`)
    assert.isDefined(result.metrics)
    assert.isAbove(
      result.metrics.forecast_total_demand_hours,
      0,
      'large fixture should produce non-zero demand',
    )
  })

  // ─── 2. Demand Curves < 3s ────────────────────────────────────────────

  test('getDemandCurves completes within 3s for large org', async ({ assert }) => {
    const start = Date.now()
    const result = await service.getDemandCurves(1, query4Week, defaultAccess)
    const elapsed = Date.now() - start

    assert.isBelow(elapsed, 3000, `getDemandCurves took ${elapsed}ms (budget: 3000ms)`)
    assert.isArray(result.roleBuckets)
    assert.isArray(result.skillBuckets)
    assert.isArray(result.projectBuckets)
  })

  // ─── 3. Gap Analysis < 3s ─────────────────────────────────────────────

  test('getGapAnalysis completes within 3s for large org', async ({ assert }) => {
    const start = Date.now()
    const result = await service.getGapAnalysis(1, query4Week, defaultAccess)
    const elapsed = Date.now() - start

    assert.isBelow(elapsed, 3000, `getGapAnalysis took ${elapsed}ms (budget: 3000ms)`)
    assert.isDefined(result.netGap)
    assert.isDefined(result.totalShortage)
    assert.isDefined(result.totalSurplus)
  })

  // ─── 4. Project Drivers < 2s ──────────────────────────────────────────

  test('getProjectDrivers completes within 2s for large org', async ({ assert }) => {
    const start = Date.now()
    const result = await service.getProjectDrivers(1, query4Week, defaultAccess)
    const elapsed = Date.now() - start

    assert.isBelow(elapsed, 2000, `getProjectDrivers took ${elapsed}ms (budget: 2000ms)`)
    assert.isArray(result)
    assert.isAbove(result.length, 0, 'should return drivers for large fixture')
  })

  // ─── 5. Skill Drivers < 2s ────────────────────────────────────────────

  test('getSkillDrivers completes within 2s for large org', async ({ assert }) => {
    const start = Date.now()
    const result = await service.getSkillDrivers(1, query4Week, defaultAccess)
    const elapsed = Date.now() - start

    assert.isBelow(elapsed, 2000, `getSkillDrivers took ${elapsed}ms (budget: 2000ms)`)
    assert.isArray(result)
    assert.isAbove(result.length, 0, 'should return skill drivers for large fixture')
  })

  // ─── 6. Trend Baseline < 2s ───────────────────────────────────────────

  test('getTrendBaseline completes within 2s for large org', async ({ assert }) => {
    const start = Date.now()
    const result = await service.getTrendBaseline(1, query12Week, defaultAccess)
    const elapsed = Date.now() - start

    assert.isBelow(elapsed, 2000, `getTrendBaseline took ${elapsed}ms (budget: 2000ms)`)
    assert.isDefined(result.method)
    assert.isDefined(result.historicalDataPoints)
  })

  // ─── 7. 12-week window summary still within budget ────────────────────

  test('getSummary with 12-week window completes within 3s', async ({ assert }) => {
    const start = Date.now()
    const result = await service.getSummary(1, query12Week, defaultAccess)
    const elapsed = Date.now() - start

    assert.isBelow(elapsed, 3000, `12w getSummary took ${elapsed}ms (budget: 3000ms)`)
    assert.isAbove(result.window.bucketCount, 0)
  })
})
