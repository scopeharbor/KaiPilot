// v3-resource-capacity-forecasting-closed-loop §3.8 —— 保留/清理服务测试。
// 覆盖：retention cutoff、引用保护（selection/review）、组织隔离、幂等、feature flag 关闭。
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import ResourceCapacityRetentionService from '#services/resource_capacity_retention_service'
import ResourceCapacityLoop from '#models/resource_capacity_loop'
import ResourceCapacityBaselineSnapshot from '#models/resource_capacity_baseline_snapshot'
import ResourceCapacityObservationSnapshot from '#models/resource_capacity_observation_snapshot'
import ResourceCapacityScenario from '#models/resource_capacity_scenario'
import ResourceCapacitySimulationSnapshot from '#models/resource_capacity_simulation_snapshot'
import ResourceCapacitySelection from '#models/resource_capacity_selection'
import ResourceCapacityReview from '#models/resource_capacity_review'
import db from '@adonisjs/lucid/services/db'
import { createOrganization, createUser, useAuthDatabase } from './auth/_helpers.js'

test.group('RCCL 保留清理服务（§3.8）', (group) => {
  useAuthDatabase(group)

  let orgA: Awaited<ReturnType<typeof createOrganization>>
  let owner: Awaited<ReturnType<typeof createUser>>
  const svc = new ResourceCapacityRetentionService()
  // 固定时钟：确定性 cutoff 测试。
  const now = DateTime.fromISO('2026-12-15T00:00:00Z', { zone: 'utc' })
  const old = now.minus({ days: 120 }) // 早于 90 天截止期
  const fresh = now.minus({ days: 10 })

  group.each.setup(async () => {
    owner = await createUser({
      email: `rccl-ret-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    })
    orgA = await createOrganization(owner)
    // 确保默认 flag 开启（env 未设置时 isResourceCapacityLoopEnabled=false，见 feature flag 语义）。
    // 保存并恢复原值，避免污染其他套件的 flag 状态。
    process.env.RESOURCE_CAPACITY_LOOP_ENABLED = 'true'
  })
  group.each.teardown(() => {
    process.env.RESOURCE_CAPACITY_LOOP_ENABLED = 'true'
  })

  async function makeLoop(): Promise<ResourceCapacityLoop> {
    return ResourceCapacityLoop.create({
      organizationId: Number(orgA.id),
      ownerUserId: Number(owner.id),
      title: '保留测试闭环',
      state: 'observing',
      granularity: 'week',
      windowStart: '2026-09-01',
      windowEnd: '2026-11-30',
      rowVersion: 1,
      featureVersion: 'resource-capacity-loop@1',
    })
  }

  async function makeBaseline(
    loop: ResourceCapacityLoop,
    digest: string,
    createdAt: DateTime,
    supersededById: number | null = null,
  ) {
    const b = await ResourceCapacityBaselineSnapshot.create({
      organizationId: loop.organizationId,
      loopId: loop.id,
      schemaVersion: 'v1',
      packetJson: {},
      baselineDigest: digest,
      permissionFingerprint: 'p',
      sourceSignaturesHash: 's',
      readyForSimulation: true,
    })
    if (supersededById !== null) {
      await db.from('resource_capacity_baseline_snapshots').where('id', b.id).update({
        superseded_by_id: supersededById,
        created_at: createdAt.toSQL(),
      })
    } else {
      await db
        .from('resource_capacity_baseline_snapshots')
        .where('id', b.id)
        .update({ created_at: createdAt.toSQL() })
    }
    return b
  }

  test('retention cutoff：仅删除 superseded 且早于截止期的 baseline；active 与新鲜版本保留', async ({
    assert,
  }) => {
    const loop = await makeLoop()
    const current = await makeBaseline(loop, 'fnv1a:cur000001', fresh, null) // active：永不删
    const newerSuperseded = await makeBaseline(loop, 'fnv1a:new000001', fresh, current.id) // superseded 但新鲜：保留
    const oldSuperseded = await makeBaseline(loop, 'fnv1a:old000001', old, current.id) // superseded 且过期：删
    void newerSuperseded

    const result = await svc.cleanup(Number(orgA.id), { now })
    assert.isTrue(result.enabled)
    assert.deepEqual(result.deletedBaselineIds, [oldSuperseded.id])
    assert.equal(result.protectedBySelection, 0)

    assert.isNotNull(
      await db.from('resource_capacity_baseline_snapshots').where('id', current.id).first(),
    )
    assert.isNotNull(
      await db.from('resource_capacity_baseline_snapshots').where('id', newerSuperseded.id).first(),
    )
    assert.isNull(
      await db.from('resource_capacity_baseline_snapshots').where('id', oldSuperseded.id).first(),
    )
  })

  test('引用保护：digest 被 selection 绑定的 superseded 版本不删除', async ({ assert }) => {
    const loop = await makeLoop()
    const current = await makeBaseline(loop, 'fnv1a:sel-cur01', fresh, null)
    const boundOld = await makeBaseline(loop, 'fnv1a:sel-old01', old, current.id)
    const unboundOld = await makeBaseline(loop, 'fnv1a:sel-old02', old, current.id)

    const baseline = boundOld // selection 绑定旧版本 baseline（模拟 stale 后仍可追溯）
    const baselineSnapshot = await ResourceCapacityBaselineSnapshot.findOrFail(current.id)
    const scenario = await ResourceCapacityScenario.create({
      organizationId: loop.organizationId,
      loopId: loop.id,
      baselineSnapshotId: baselineSnapshot.id,
      name: 'S 情景',
      overlaysJson: [],
      rowVersion: 1,
      active: true,
    })
    const sim = await ResourceCapacitySimulationSnapshot.create({
      organizationId: loop.organizationId,
      scenarioId: scenario.id,
      loopId: loop.id,
      engineVersion: 'rccl-engine@1',
      scenarioRevision: 1,
      rowsJson: [],
      gapDeltaHours: '0',
      contentionDeltaCount: 0,
      confidenceBand: 'low',
      warningsJson: [],
      simulationDigest: 'fnv1a:simS0001',
      staleState: 'current',
    })
    await ResourceCapacitySelection.create({
      organizationId: loop.organizationId,
      loopId: loop.id,
      scenarioId: scenario.id,
      simulationSnapshotId: sim.id,
      selectionFingerprint: `fp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      boundBaselineDigest: baseline.baselineDigest,
      boundSimulationDigest: sim.simulationDigest,
      boundSourceSignaturesHash: 's',
      boundPermissionFingerprint: 'p',
      boundLoopRevision: 1,
      actorUserId: Number(owner.id),
      acknowledgedWarningsJson: [],
      expiresAt: now.plus({ hours: 72 }),
    })

    const result = await svc.cleanup(Number(orgA.id), { now })
    assert.equal(result.protectedBySelection, 1)
    // 未被绑定的过期 superseded 版本被删除；被绑定版本保留。
    assert.isNull(
      await db.from('resource_capacity_baseline_snapshots').where('id', unboundOld.id).first(),
    )
    assert.isNotNull(
      await db.from('resource_capacity_baseline_snapshots').where('id', boundOld.id).first(),
    )
    assert.isTrue(result.deletedBaselineIds.includes(unboundOld.id))
  })

  test('observation 被 review 引用保护；未引用的超期 observation 清理', async ({ assert }) => {
    const loop = await makeLoop()
    const reviewedObs = await ResourceCapacityObservationSnapshot.create({
      organizationId: loop.organizationId,
      loopId: loop.id,
      downstreamStatus: 'applied_downstream',
      comparable: true,
      comparabilityReasonsJson: [],
      comparisonsJson: [],
      appliedItemRefsJson: [],
      failedItemRefsJson: [],
      unrelatedChangeNotesJson: [],
      observationDigest: 'fnv1a:obsR0001',
    })
    const orphanObs = await ResourceCapacityObservationSnapshot.create({
      organizationId: loop.organizationId,
      loopId: loop.id,
      downstreamStatus: 'failed',
      comparable: false,
      comparabilityReasonsJson: ['RCCL_NOT_COMPARABLE_WINDOW'],
      comparisonsJson: [],
      appliedItemRefsJson: [],
      failedItemRefsJson: [],
      unrelatedChangeNotesJson: [],
      observationDigest: 'fnv1a:obsX0001',
    })
    await db
      .from('resource_capacity_observation_snapshots')
      .where('id', reviewedObs.id)
      .update({ created_at: old.toSQL() })
    await db
      .from('resource_capacity_observation_snapshots')
      .where('id', orphanObs.id)
      .update({ created_at: old.toSQL() })

    await ResourceCapacityReview.create({
      organizationId: loop.organizationId,
      loopId: loop.id,
      observationSnapshotId: reviewedObs.id,
      outcome: 'not_met',
      boundedRationale: '缺口未收窄。',
      actorUserId: Number(owner.id),
    })

    const result = await svc.cleanup(Number(orgA.id), { now })
    assert.equal(result.protectedByReview, 1)
    assert.deepEqual(result.deletedObservationIds, [orphanObs.id])
    assert.isNotNull(
      await db.from('resource_capacity_observation_snapshots').where('id', reviewedObs.id).first(),
    )
  })

  test('组织隔离：cleanup 只作用于指定组织', async ({ assert }) => {
    const otherOwner = await createUser({ email: `rccl-o-${Date.now()}@test.local` })
    const otherOrg = await createOrganization(otherOwner)
    const otherLoop = await ResourceCapacityLoop.create({
      organizationId: Number(otherOrg.id),
      ownerUserId: Number(otherOwner.id),
      title: '他组织闭环',
      state: 'draft',
      granularity: 'week',
      windowStart: '2026-09-01',
      windowEnd: '2026-11-30',
      rowVersion: 1,
      featureVersion: 'v1',
    })
    const b = await ResourceCapacityBaselineSnapshot.create({
      organizationId: Number(otherOrg.id),
      loopId: otherLoop.id,
      schemaVersion: 'v1',
      packetJson: {},
      baselineDigest: 'fnv1a:oth00001',
      permissionFingerprint: 'p',
      sourceSignaturesHash: 's',
      readyForSimulation: false,
    })
    await db.from('resource_capacity_baseline_snapshots').where('id', b.id).update({
      superseded_by_id: b.id,
      created_at: old.toSQL(),
    })

    const result = await svc.cleanup(Number(orgA.id), { now })
    assert.notDeepEqual(result.deletedBaselineIds, [b.id])
    assert.isNotNull(
      await db.from('resource_capacity_baseline_snapshots').where('id', b.id).first(),
    )
  })

  test('幂等：重复执行第二次零删除', async ({ assert }) => {
    const loop = await makeLoop()
    const current = await makeBaseline(loop, 'fnv1a:idem-cur1', fresh, null)
    const oldSup = await makeBaseline(loop, 'fnv1a:idem-old1', old, current.id)
    void current

    const first = await svc.cleanup(Number(orgA.id), { now })
    assert.deepEqual(first.deletedBaselineIds, [oldSup.id])

    const second = await svc.cleanup(Number(orgA.id), { now })
    assert.deepEqual(second.deletedBaselineIds, [])
  })

  test('feature flag 关闭时整体跳过且零删除', async ({ assert }) => {
    process.env.RESOURCE_CAPACITY_LOOP_ENABLED = 'false'
    const loop = await makeLoop()
    const current = await makeBaseline(loop, 'fnv1a:off-cur01', fresh, null)
    const oldSup = await makeBaseline(loop, 'fnv1a:off-old01', old, current.id)
    void current

    const result = await svc.cleanup(Number(orgA.id), { now })
    assert.isFalse(result.enabled)
    assert.deepEqual(result.deletedBaselineIds, [])
    assert.isNotNull(
      await db.from('resource_capacity_baseline_snapshots').where('id', oldSup.id).first(),
    )
  })
})
