/**
 * OKR Backflow 性能 fixture 与基准测试（v3-okr-progress-backflow 6.1 / 6.2）。
 *
 * 覆盖：
 *   - 单 KR 回流重算性能阈值
 *   - 批量重算性能阈值
 *   - suggestion listing 性能阈值
 *   - 1000+ KR 大规模 fixture 的稳定性
 *
 * @aiproj/backend
 */

import { test } from '@japa/runner'
import OkrProgressBackflowService from '#services/okr_progress_backflow_service'
import OkrPolicy from '#policies/okr_policy'
import RbacService from '#services/rbac_service'
import OrganizationPolicy from '#policies/organization_policy'
import OkrCycle from '#models/okr_cycle'
import OkrObjective from '#models/okr_objective'
import OkrKeyResult from '#models/okr_key_result'
import OkrProgressBackflowSuggestion from '#models/okr_progress_backflow_suggestion'
import { createOrganization, createUser, uniqueEmail } from '../functional/auth/_helpers.js'
import testUtils from '@adonisjs/core/services/test_utils'

test.group('OKR Backflow Performance', (group) => {
  group.setup(() => testUtils.db().truncate())
  group.each.setup(() => testUtils.db().truncate())

  let service: OkrProgressBackflowService
  let ownerUser: any
  let org: any

  group.each.setup(async () => {
    const rbac = new RbacService()
    const orgPolicy = new OrganizationPolicy(rbac)
    const policy = new OkrPolicy(rbac, orgPolicy)
    service = new OkrProgressBackflowService(policy)

    const owner = await createUser({ email: uniqueEmail('perf-bf') })
    org = await createOrganization(owner)
    ownerUser = owner
  })

  /**
   * 批量创建 KR（不含 evidence link）。
   */
  async function createKrs(objectiveId: number, orgId: number, count: number) {
    const krs: any[] = []
    for (let i = 0; i < count; i++) {
      const kr = await OkrKeyResult.create({
        organizationId: orgId,
        objectiveId,
        title: `KR ${i}`,
        measurementType: 'percent',
        baselineValue: 0,
        targetValue: 100,
        currentValue: 20 + (i % 80),
        weight: 100,
        status: 'active',
        confidence: 'medium',
      })
      krs.push(kr)
    }
    return krs
  }

  async function seedPerformanceFixture(krCount: number = 1000) {
    const cycle = await OkrCycle.create({
      organizationId: org.id,
      title: '2026 Q3 Perf',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
      status: 'active',
    })

    const obj = await OkrObjective.create({
      organizationId: org.id,
      cycleId: cycle.id,
      title: 'Perf Objective',
      scope: 'organization',
      status: 'active',
      weight: 1,
      progress: 0,
      confidence: 'medium',
      metricVersion: '1.0.0',
    })

    const krs = await createKrs(obj.id, org.id, krCount)
    return { cycle, objective: obj, krs }
  }

  // ── Performance Tests ─────────────────────────────────────────────────

  test('单 KR 回流重算 < 500ms', async ({ assert }) => {
    const { krs } = await seedPerformanceFixture(10)
    const kr = krs[0]

    const start = performance.now()
    const suggestion = await service.recalculateKeyResult(org.id, kr.id, ownerUser)
    const elapsed = performance.now() - start

    assert.isTrue(suggestion.id > 0)
    assert.isBelow(elapsed, 500, `单 KR 重算耗时 ${elapsed.toFixed(1)}ms 超过 500ms 阈值`)
  })

  test('批量重算 10 KR < 3000ms', async ({ assert }) => {
    const { objective } = await seedPerformanceFixture(10)

    const start = performance.now()
    const result = await service.batchRecalculate(org.id, 'objective', objective.id, 10, ownerUser)
    const elapsed = performance.now() - start

    assert.isAtLeast(result.data.length, 1)
    assert.isBelow(elapsed, 3000, `批量重算 10 KR 耗时 ${elapsed.toFixed(1)}ms 超过 3000ms 阈值`)
  })

  test('suggestion listing < 300ms', async ({ assert }) => {
    const { krs } = await seedPerformanceFixture(10)

    // 先生成一些 suggestion
    for (const kr of krs.slice(0, 5)) {
      await service.recalculateKeyResult(org.id, kr.id, ownerUser)
    }

    const start = performance.now()
    const result = await service.listSuggestions(org.id, { perPage: 10 }, ownerUser)
    const elapsed = performance.now() - start

    assert.isAtLeast(result.data.length, 1)
    assert.isBelow(elapsed, 300, `suggestion listing 耗时 ${elapsed.toFixed(1)}ms 超过 300ms 阈值`)
  })

  test('大规模 fixture 500 KR 批量重算稳定性', async ({ assert }) => {
    const { objective } = await seedPerformanceFixture(500)

    const start = performance.now()
    const result = await service.batchRecalculate(org.id, 'objective', objective.id, 50, ownerUser)
    const elapsed = performance.now() - start

    assert.isAtLeast(result.data.length, 1)
    // 大批量重算应在合理时间内完成
    assert.isBelow(elapsed, 10000, `500 KR fixture 批量重算耗时 ${elapsed.toFixed(1)}ms`)
  })

  test('空 KR 重算性能边界', async ({ assert }) => {
    const cycle = await OkrCycle.create({
      organizationId: org.id,
      title: 'Empty Cycle',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
      status: 'active',
    })
    const obj = await OkrObjective.create({
      organizationId: org.id,
      cycleId: cycle.id,
      title: 'Empty Objective',
      scope: 'organization',
      status: 'active',
      weight: 1,
      progress: 0,
      confidence: 'medium',
      metricVersion: '1.0.0',
    })
    const kr = await OkrKeyResult.create({
      organizationId: org.id,
      objectiveId: obj.id,
      title: 'No-evidence KR',
      measurementType: 'percent',
      baselineValue: 0,
      targetValue: 100,
      currentValue: 0,
      weight: 100,
      status: 'active',
      confidence: 'medium',
    })

    const start = performance.now()
    const suggestion = await service.recalculateKeyResult(org.id, kr.id, ownerUser)
    const elapsed = performance.now() - start

    // 无 evidence 的 KR 应快速返回空建议
    assert.isTrue(suggestion.id > 0)
    assert.isBelow(elapsed, 500, `空 KR 重算耗时 ${elapsed.toFixed(1)}ms`)
  })

  test('suggestion 持久化不泄漏（cleanup 验证）', async ({ assert }) => {
    const { krs } = await seedPerformanceFixture(20)

    // 记录重算前的 suggestion 数量
    const beforeRows = await OkrProgressBackflowSuggestion.query()
      .where('organization_id', org.id)
      .count('* as total')
    const countBefore = Number(beforeRows[0].$extras.total)

    // 批量重算
    for (const kr of krs.slice(0, 10)) {
      await service.recalculateKeyResult(org.id, kr.id, ownerUser)
    }

    const afterRows = await OkrProgressBackflowSuggestion.query()
      .where('organization_id', org.id)
      .count('* as total')
    const countAfter = Number(afterRows[0].$extras.total)

    // 应该新增了 10 条 suggestion
    assert.equal(countAfter, countBefore + 10)
  })
})
