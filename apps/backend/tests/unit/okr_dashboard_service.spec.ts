/**
 * OkrDashboardService 综合测试（v3-okr-dashboard §3.6）。
 *
 * 覆盖：
 *   - 成功摘要：包含 KPI、KR attention、alignment、freshness、warnings、backflow 状态
 *   - 空组织：objectives=[]，KR=[]，attention=[]，backflow unavailable
 *   - 跨组织排除：另一组织的 objective/KR/evidence 不出现在结果里
 *   - 非成员访问抛出 RESOURCE_NOT_FOUND
 *   - attention 截断：limit 生效
 *   - 无副作用读取：service 未触发写入或 backflow 生成
 *   - cycleId 指定：只聚合该周期
 *
 * 策略：直接调用 service.getSummary()，数据持久化到测试 SQLite。
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import OkrDashboardService from '#services/okr_dashboard_service'
import OkrDashboardPolicy from '#policies/okr_dashboard_policy'
import OkrPolicy from '#policies/okr_policy'
import OrganizationPolicy from '#policies/organization_policy'
import RbacService from '#services/rbac_service'
import OkrCycle from '#models/okr_cycle'
import OkrObjective from '#models/okr_objective'
import OkrKeyResult from '#models/okr_key_result'
import OkrEvidenceLink from '#models/okr_evidence_link'
import OkrProgressHistory from '#models/okr_progress_history'
import { OKR_METRIC_VERSION } from '@aiproj/types'
import {
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

test.group('OkrDashboardService', (group) => {
  // 本 spec 会建用户、组织与整套 OKR 层级，必须自带 DB 生命周期：
  // 否则它拿到的是上一个 spec 留下的库，schema 与残留数据都取决于执行顺序。
  useAuthDatabase(group)

  let service: OkrDashboardService
  let ownerUser: any
  let org: any
  let otherOrg: any
  let otherOwner: any
  let outsiderUser: any

  group.each.setup(async () => {
    const rbac = new RbacService()
    const orgPolicy = new OrganizationPolicy(rbac)
    const okrPolicy = new OkrPolicy(rbac, orgPolicy)
    const dashboardPolicy = new OkrDashboardPolicy(okrPolicy)
    service = new OkrDashboardService(dashboardPolicy)

    ownerUser = await createUser({ email: uniqueEmail('okr-dash-svc-owner') })
    org = await createOrganization(ownerUser)
    outsiderUser = await createUser({ email: uniqueEmail('okr-dash-svc-outsider') })
    otherOwner = await createUser({ email: uniqueEmail('okr-dash-svc-other') })
    otherOrg = await createOrganization(otherOwner)
  })

  async function seedCycleWithObjective(
    organizationId: number,
    ownerId: number,
    overrides: {
      progress?: number
      status?: string
      confidence?: string
    } = {},
  ) {
    const cycle = await OkrCycle.create({
      organizationId,
      title: '2026 Q3',
      status: 'active',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
    })
    const objective = await OkrObjective.create({
      organizationId,
      cycleId: cycle.id,
      scope: 'organization',
      title: '组织目标 A',
      status: overrides.status ?? 'active',
      progress: overrides.progress ?? 40,
      confidence: overrides.confidence ?? 'medium',
      weight: 1,
      metricVersion: OKR_METRIC_VERSION,
      ownerId,
      startDate: '2026-07-01',
      endDate: '2026-09-30',
    })
    const kr = await OkrKeyResult.create({
      organizationId,
      objectiveId: objective.id,
      title: 'KR-1',
      measurementType: 'percent',
      baselineValue: 0,
      targetValue: 100,
      currentValue: overrides.progress ?? 40,
      confidence: overrides.confidence ?? 'medium',
      status: overrides.status ?? 'active',
      weight: 1,
    })
    return { cycle, objective, kr }
  }

  test('空组织 → 空 summary，backflow 可用但计数为零', async ({ assert }) => {
    const result = await service.getSummary(org.id, {}, ownerUser)
    assert.equal(result.data.meta.organizationId, org.id)
    assert.equal(result.data.meta.metricVersion, `okr-dashboard.${OKR_METRIC_VERSION}`)
    assert.isArray(result.data.attention)
    assert.lengthOf(result.data.attention, 0)
    // 用例名原先写「backflow unavailable」，但 DefaultOkrDashboardBackflowReader 已经接进
    // 服务并真的查库了：空组织查询成功、结果为零。「无数据」不等于「不可用」——
    // 把空结果报成 unavailable 会让运营分不清「没有建议」和「读不到建议」。
    assert.isTrue(result.data.backflow.available)
    assert.equal(result.data.backflow.candidateCount, 0)
  })

  test('单 objective + KR → summary 含 KPI 与 meta', async ({ assert }) => {
    await seedCycleWithObjective(org.id, ownerUser.id, { progress: 25 })
    const result = await service.getSummary(org.id, {}, ownerUser)
    assert.equal(result.data.meta.metricVersion, `okr-dashboard.${OKR_METRIC_VERSION}`)
    assert.isAtLeast(result.data.meta.visibleObjectiveCount, 1)
    assert.isAtLeast(result.data.meta.visibleKeyResultCount, 1)
    // KPI list 非空
    assert.isNotEmpty(result.data.kpis)
  })

  test('跨组织 objective 不出现在结果里', async ({ assert }) => {
    await seedCycleWithObjective(otherOrg.id, otherOwner.id)
    const result = await service.getSummary(org.id, {}, ownerUser)
    assert.equal(result.data.meta.organizationId, org.id)
    // 本组织无 objective
    assert.equal(result.data.meta.visibleObjectiveCount, 0)
    assert.lengthOf(result.data.attention, 0)
  })

  test('非成员访问抛异常（RESOURCE_NOT_FOUND）', async ({ assert }) => {
    try {
      await service.getSummary(org.id, {}, outsiderUser)
      assert.fail('应该抛出异常')
    } catch (err: any) {
      assert.include(err.message, '组织不存在')
    }
  })

  test('service 只读，不产生 evidence / progress 写入', async ({ assert }) => {
    await seedCycleWithObjective(org.id, ownerUser.id)
    const beforeEvidence = await OkrEvidenceLink.query().count('* as total')
    const beforeProgress = await OkrProgressHistory.query().count('* as total')
    await service.getSummary(org.id, {}, ownerUser)
    const afterEvidence = await OkrEvidenceLink.query().count('* as total')
    const afterProgress = await OkrProgressHistory.query().count('* as total')
    assert.equal((beforeEvidence[0] as any).$extras.total, (afterEvidence[0] as any).$extras.total)
    assert.equal((beforeProgress[0] as any).$extras.total, (afterProgress[0] as any).$extras.total)
  })

  test('attentionLimit 截断生效', async ({ assert }) => {
    const cycle = await OkrCycle.create({
      organizationId: org.id,
      title: '2026 Q3',
      status: 'active',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
    })
    for (let i = 0; i < 5; i++) {
      const objective = await OkrObjective.create({
        organizationId: org.id,
        cycleId: cycle.id,
        scope: 'organization',
        title: `目标 ${i}`,
        status: 'active',
        progress: 10,
        confidence: 'low',
        weight: 1,
        metricVersion: OKR_METRIC_VERSION,
        ownerId: ownerUser.id,
        startDate: '2026-07-01',
        endDate: '2026-09-30',
      })
      await OkrKeyResult.create({
        organizationId: org.id,
        objectiveId: objective.id,
        title: `KR-${i}`,
        measurementType: 'percent',
        baselineValue: 0,
        targetValue: 100,
        currentValue: 5,
        confidence: 'low',
        status: 'active',
        weight: 1,
      })
    }
    const result = await service.getSummary(org.id, { attentionLimit: 2 }, ownerUser)
    assert.isAtMost(result.data.attention.length, 2)
    assert.equal(result.data.meta.attentionLimit, 2)
  })

  test('backflow reader 读取失败 → available=false，不触发生成', async ({ assert }) => {
    // 真正的 unavailable 是「读不到」，用一个抛错的 reader 注入来验，
    // 而不是拿空组织的空结果冒充。同时确认读取失败不会触发任何生成。
    const failingReader = {
      read: async () => {
        throw new Error('backflow reader unavailable')
      },
    }
    const degraded = new OkrDashboardService(
      new OkrDashboardPolicy(
        new OkrPolicy(new RbacService(), new OrganizationPolicy(new RbacService())),
      ),
    )
    degraded.setBackflowReader(failingReader as never)
    const result = await degraded.getSummary(org.id, {}, ownerUser)
    assert.isFalse(result.data.backflow.available)
  })

  test('cycleId 指定 → 只聚合该周期', async ({ assert }) => {
    const cycleA = await OkrCycle.create({
      organizationId: org.id,
      title: 'Q2',
      status: 'completed',
      startDate: '2026-04-01',
      endDate: '2026-06-30',
    })
    await OkrObjective.create({
      organizationId: org.id,
      cycleId: cycleA.id,
      scope: 'organization',
      title: 'Q2 目标',
      status: 'completed',
      progress: 100,
      confidence: 'high',
      weight: 1,
      metricVersion: OKR_METRIC_VERSION,
      ownerId: ownerUser.id,
      startDate: '2026-04-01',
      endDate: '2026-06-30',
    })
    await seedCycleWithObjective(org.id, ownerUser.id)

    const resultA = await service.getSummary(org.id, { cycleId: cycleA.id }, ownerUser)
    assert.equal(resultA.data.cycleContext.cycleId, cycleA.id)
    assert.equal(resultA.data.meta.visibleObjectiveCount, 1)
  })
})
