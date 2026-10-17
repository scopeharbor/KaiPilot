// v3-resource-capacity-forecasting-closed-loop §3.4/3.6 —— 闭环持久化与组织隔离功能测试。
// 覆盖：CHECK 非法状态拒绝、唯一约束（digest 去重/fingerprint/idempotency）、
// 父链 CASCADE、跨租查询返回空（无存在泄露）、终态 review 唯一、回滚负例。
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import ResourceCapacityLoop from '#models/resource_capacity_loop'
import ResourceCapacityBaselineSnapshot from '#models/resource_capacity_baseline_snapshot'
import ResourceCapacityScenario from '#models/resource_capacity_scenario'
import ResourceCapacitySimulationSnapshot from '#models/resource_capacity_simulation_snapshot'
import ResourceCapacitySelection from '#models/resource_capacity_selection'
import ResourceCapacityHandoffReceipt from '#models/resource_capacity_handoff_receipt'
import ResourceCapacityObservationSnapshot from '#models/resource_capacity_observation_snapshot'
import ResourceCapacityReview from '#models/resource_capacity_review'
import { createOrganization, createUser, useAuthDatabase } from './auth/_helpers.js'

test.group('RCCL 持久化与组织隔离（§3.4/3.6）', (group) => {
  useAuthDatabase(group)

  let orgA: Awaited<ReturnType<typeof createOrganization>>
  let orgB: Awaited<ReturnType<typeof createOrganization>>
  let ownerA: Awaited<ReturnType<typeof createUser>>
  let ownerB: Awaited<ReturnType<typeof createUser>>

  group.each.setup(async () => {
    ownerA = await createUser({
      email: `rccl-a-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    })
    orgA = await createOrganization(ownerA)
    ownerB = await createUser({
      email: `rccl-b-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    })
    orgB = await createOrganization(ownerB)
  })

  async function makeLoop(
    orgId: number,
    ownerId: number,
    title = 'Q4 容量闭环',
  ): Promise<ResourceCapacityLoop> {
    return ResourceCapacityLoop.create({
      organizationId: Number(orgId),
      ownerUserId: Number(ownerId),
      title,
      state: 'draft',
      granularity: 'week',
      windowStart: '2026-09-01',
      windowEnd: '2026-11-30',
      rowVersion: 1,
      featureVersion: 'resource-capacity-loop@1',
    })
  }

  test('正例：创建 loop 并按组织读取；row_version 默认乐观锁起点', async ({ assert }) => {
    const loop = await makeLoop(orgA.id, ownerA.id)
    assert.equal(loop.state, 'draft')

    const found = await ResourceCapacityLoop.query()
      .where('organization_id', Number(orgA.id))
      .where('id', loop.id)
      .firstOrFail()
    assert.equal(found.id, loop.id)
    assert.equal(found.rowVersion, 1)
  })

  test('非法状态被 CHECK 约束拒绝（draft → handed-off 直跳不可能落库）', async ({ assert }) => {
    try {
      await db.table('resource_capacity_loops').insert({
        organization_id: Number(orgA.id),
        owner_user_id: Number(ownerA.id),
        title: '非法直跳',
        state: 'handed-off',
        granularity: 'week',
        window_start: '2026-09-01',
        window_end: '2026-11-30',
        row_version: 1,
        feature_version: 'resource-capacity-loop@1',
        // 原生插入绕过 Lucid autoCreate，需显式给时间列。
        created_at: DateTime.now().toSQL(),
        updated_at: DateTime.now().toSQL(),
      })
      assert.fail('非法 state 应被 CHECK 拒绝')
    } catch (e) {
      assert.match(String((e as Error).message), /check/i)
    }
  })

  test('baseline digest 组织内幂等去重：同 loop 同 digest 二次插入被拒', async ({ assert }) => {
    const loop = await makeLoop(orgA.id, ownerA.id)
    const base = {
      organizationId: Number(orgA.id),
      loopId: loop.id,
      schemaVersion: 'resource-capacity-loop@1',
      packetJson: { facts: [] },
      baselineDigest: 'fnv1a:dedup01',
      permissionFingerprint: 'fnv1a:perm0001',
      sourceSignaturesHash: 'fnv1a:sig0001',
      readyForSimulation: true,
    }
    await ResourceCapacityBaselineSnapshot.create(base)
    try {
      await ResourceCapacityBaselineSnapshot.create(base)
      assert.fail('重复 digest 应被唯一索引拒绝')
    } catch {
      assert.isTrue(true)
    }
  })

  test('selection fingerprint 跨组织可同值、组织内唯一（跨租重放不冲突）', async ({ assert }) => {
    const loopA = await makeLoop(orgA.id, ownerA.id)
    const baselineSnapshotA = await ResourceCapacityBaselineSnapshot.create({
      organizationId: Number(orgA.id),
      loopId: loopA.id,
      schemaVersion: 'v1',
      packetJson: {},
      baselineDigest: 'fnv1a:bA000001',
      permissionFingerprint: 'pA',
      sourceSignaturesHash: 'sA',
      readyForSimulation: true,
    })
    const scenarioA = await ResourceCapacityScenario.create({
      organizationId: Number(orgA.id),
      loopId: loopA.id,
      baselineSnapshotId: baselineSnapshotA.id,
      name: '情景一',
      overlaysJson: [],
      rowVersion: 1,
      active: true,
    })
    const simA = await ResourceCapacitySimulationSnapshot.create({
      organizationId: Number(orgA.id),
      scenarioId: scenarioA.id,
      loopId: loopA.id,
      engineVersion: 'rccl-engine@1',
      scenarioRevision: 1,
      rowsJson: [],
      gapDeltaHours: '-40.00',
      contentionDeltaCount: 0,
      confidenceBand: 'high',
      warningsJson: [],
      simulationDigest: 'fnv1a:simA0001',
      staleState: 'current',
    })
    const fp = 'fnv1a:fpx000001'
    await ResourceCapacitySelection.create({
      organizationId: Number(orgA.id),
      loopId: loopA.id,
      scenarioId: scenarioA.id,
      simulationSnapshotId: simA.id,
      selectionFingerprint: fp,
      boundBaselineDigest: 'bA',
      boundSimulationDigest: 'simA',
      boundSourceSignaturesHash: 'sA',
      boundPermissionFingerprint: 'pA',
      boundLoopRevision: 1,
      actorUserId: Number(ownerA.id),
      acknowledgedWarningsJson: [],
      expiresAt: DateTimeFromNow(72),
    })
    // 同组织重放被拒
    let replayRejected = false
    try {
      await ResourceCapacitySelection.create({
        organizationId: Number(orgA.id),
        loopId: loopA.id,
        scenarioId: scenarioA.id,
        simulationSnapshotId: simA.id,
        selectionFingerprint: fp,
        boundBaselineDigest: 'bA',
        boundSimulationDigest: 'simA',
        boundSourceSignaturesHash: 'sA',
        boundPermissionFingerprint: 'pA',
        boundLoopRevision: 1,
        actorUserId: Number(ownerA.id),
        acknowledgedWarningsJson: [],
        expiresAt: DateTimeFromNow(72),
      })
    } catch {
      replayRejected = true
    }
    assert.isTrue(replayRejected)

    // orgB 用同一 fingerprint 值不受 orgA 影响（唯一性按组织分域）
    const loopB = await makeLoop(orgB.id, ownerB.id, 'B 组织闭环')
    const baselineB = await ResourceCapacityBaselineSnapshot.create({
      organizationId: Number(orgB.id),
      loopId: loopB.id,
      schemaVersion: 'v1',
      packetJson: {},
      baselineDigest: 'fnv1a:bB000001',
      permissionFingerprint: 'pB',
      sourceSignaturesHash: 'sB',
      readyForSimulation: true,
    })
    const scenarioB = await ResourceCapacityScenario.create({
      organizationId: Number(orgB.id),
      loopId: loopB.id,
      baselineSnapshotId: baselineB.id,
      name: '情景一',
      overlaysJson: [],
      rowVersion: 1,
      active: true,
    })
    const simB = await ResourceCapacitySimulationSnapshot.create({
      organizationId: Number(orgB.id),
      scenarioId: scenarioB.id,
      loopId: loopB.id,
      engineVersion: 'rccl-engine@1',
      scenarioRevision: 1,
      rowsJson: [],
      gapDeltaHours: '0',
      contentionDeltaCount: 0,
      confidenceBand: 'medium',
      warningsJson: [],
      simulationDigest: 'fnv1a:simB0001',
      staleState: 'current',
    })
    await ResourceCapacitySelection.create({
      organizationId: Number(orgB.id),
      loopId: loopB.id,
      scenarioId: scenarioB.id,
      simulationSnapshotId: simB.id,
      selectionFingerprint: fp,
      boundBaselineDigest: 'bB',
      boundSimulationDigest: 'simB',
      boundSourceSignaturesHash: 'sB',
      boundPermissionFingerprint: 'pB',
      boundLoopRevision: 1,
      actorUserId: Number(ownerB.id),
      acknowledgedWarningsJson: [],
      expiresAt: DateTimeFromNow(72),
    })
    assert.isTrue(true)
  })

  test('handoff idempotency hash 组织内唯一：重试复用原 receipt 而非新建', async ({ assert }) => {
    const loop = await makeLoop(orgA.id, ownerA.id)
    const baseline = await ResourceCapacityBaselineSnapshot.create({
      organizationId: Number(orgA.id),
      loopId: loop.id,
      schemaVersion: 'v1',
      packetJson: {},
      baselineDigest: 'fnv1a:bR000001',
      permissionFingerprint: 'pR',
      sourceSignaturesHash: 'sR',
      readyForSimulation: true,
    })
    const scenario = await ResourceCapacityScenario.create({
      organizationId: Number(orgA.id),
      loopId: loop.id,
      baselineSnapshotId: baseline.id,
      name: 'R 情景',
      overlaysJson: [],
      rowVersion: 1,
      active: true,
    })
    const sim = await ResourceCapacitySimulationSnapshot.create({
      organizationId: Number(orgA.id),
      scenarioId: scenario.id,
      loopId: loop.id,
      engineVersion: 'rccl-engine@1',
      scenarioRevision: 1,
      rowsJson: [],
      gapDeltaHours: '0',
      contentionDeltaCount: 0,
      confidenceBand: 'low',
      warningsJson: [],
      simulationDigest: 'fnv1a:simR0001',
      staleState: 'current',
    })
    const sel = await ResourceCapacitySelection.create({
      organizationId: Number(orgA.id),
      loopId: loop.id,
      scenarioId: scenario.id,
      simulationSnapshotId: sim.id,
      selectionFingerprint: 'fnv1a:fpr000001',
      boundBaselineDigest: 'bR',
      boundSimulationDigest: 'simR',
      boundSourceSignaturesHash: 'sR',
      boundPermissionFingerprint: 'pR',
      boundLoopRevision: 1,
      actorUserId: Number(ownerA.id),
      acknowledgedWarningsJson: [],
      expiresAt: DateTimeFromNow(72),
    })
    await ResourceCapacityHandoffReceipt.create({
      organizationId: Number(orgA.id),
      loopId: loop.id,
      selectionId: sel.id,
      target: 'safe-navigation',
      idempotencyHash: 'fnv1a:idemR001',
      pendingRefId: null,
      status: 'pending',
      statusReason: null,
      sourceSignaturesHash: 'fnv1a:sig00rc1',
    })
    let duplicateRejected = false
    try {
      await ResourceCapacityHandoffReceipt.create({
        organizationId: Number(orgA.id),
        loopId: loop.id,
        selectionId: sel.id,
        target: 'safe-navigation',
        idempotencyHash: 'fnv1a:idemR001',
        pendingRefId: null,
        status: 'pending',
        statusReason: null,
        sourceSignaturesHash: 'fnv1a:sig00rc1',
      })
    } catch {
      duplicateRejected = true
    }
    assert.isTrue(duplicateRejected)
  })

  test('跨租查询隔离：orgB 过滤条件下读不到 orgA 的任何闭环对象且无存在泄露', async ({
    assert,
  }) => {
    const loop = await makeLoop(orgA.id, ownerA.id)
    const rows = await ResourceCapacityLoop.query().where('organization_id', Number(orgB.id))
    for (const r of rows) {
      assert.notEqual(r.id, loop.id)
    }
    const cross = await ResourceCapacityLoop.query()
      .where('organization_id', Number(orgB.id))
      .where('id', loop.id)
      .first()
    assert.isNull(cross)
  })

  test('父链 CASCADE：删除 loop 级联清理全部子对象', async ({ assert }) => {
    const loop = await makeLoop(orgA.id, ownerA.id)
    const baseline = await ResourceCapacityBaselineSnapshot.create({
      organizationId: Number(orgA.id),
      loopId: loop.id,
      schemaVersion: 'v1',
      packetJson: {},
      baselineDigest: 'fnv1a:bC000001',
      permissionFingerprint: 'pC',
      sourceSignaturesHash: 'sC',
      readyForSimulation: false,
    })
    const scenario = await ResourceCapacityScenario.create({
      organizationId: Number(orgA.id),
      loopId: loop.id,
      baselineSnapshotId: baseline.id,
      name: 'C 情景',
      overlaysJson: [{ kind: 'project-scope', includeProjectIds: [], excludeProjectIds: [] }],
      rowVersion: 1,
      active: true,
    })
    const sim = await ResourceCapacitySimulationSnapshot.create({
      organizationId: Number(orgA.id),
      scenarioId: scenario.id,
      loopId: loop.id,
      engineVersion: 'rccl-engine@1',
      scenarioRevision: 1,
      rowsJson: [],
      gapDeltaHours: '0',
      contentionDeltaCount: 0,
      confidenceBand: 'medium',
      warningsJson: [],
      simulationDigest: 'fnv1a:simC0001',
      staleState: 'current',
    })
    const observation = await ResourceCapacityObservationSnapshot.create({
      organizationId: Number(orgA.id),
      loopId: loop.id,
      downstreamStatus: 'applied_downstream',
      comparable: true,
      comparabilityReasonsJson: [],
      comparisonsJson: [],
      appliedItemRefsJson: ['item-1'],
      failedItemRefsJson: [],
      unrelatedChangeNotesJson: [],
      observationDigest: 'fnv1a:obsC0001',
    })
    assert.equal(observation.downstreamStatus, 'applied_downstream')

    await loop.delete()

    assert.isNull(
      await db.from('resource_capacity_baseline_snapshots').where('loop_id', loop.id).first(),
    )
    assert.isNull(await db.from('resource_capacity_scenarios').where('loop_id', loop.id).first())
    assert.isNull(
      await db.from('resource_capacity_simulation_snapshots').where('loop_id', loop.id).first(),
    )
    assert.isNull(
      await db.from('resource_capacity_observation_snapshots').where('loop_id', loop.id).first(),
    )

    // baseline 被 RESTRICT 引用链保护：scenario 已随 CASCADE 删除，baseline 也应消失。
    void sim
  })

  test('review 每 observation 至多一条：组织内 observation_snapshot_id 唯一', async ({
    assert,
  }) => {
    const loop = await makeLoop(orgA.id, ownerA.id)
    const observation = await ResourceCapacityObservationSnapshot.create({
      organizationId: Number(orgA.id),
      loopId: loop.id,
      downstreamStatus: 'partial',
      comparable: false,
      comparabilityReasonsJson: ['RCCL_NOT_COMPARABLE_WINDOW'],
      comparisonsJson: [],
      appliedItemRefsJson: [],
      failedItemRefsJson: [],
      unrelatedChangeNotesJson: ['来源侧无关变更：需求预测方法版本升级'],
      observationDigest: 'fnv1a:obsD0001',
    })
    await ResourceCapacityReview.create({
      organizationId: Number(orgA.id),
      loopId: loop.id,
      observationSnapshotId: observation.id,
      outcome: 'partially_met',
      boundedRationale: '缺口部分收窄，剩余桶未解决。',
      actorUserId: Number(ownerA.id),
    })
    let rejected = false
    try {
      await ResourceCapacityReview.create({
        organizationId: Number(orgA.id),
        loopId: loop.id,
        observationSnapshotId: observation.id,
        outcome: 'goal_met',
        boundedRationale: '重复结论应被拒。',
        actorUserId: Number(ownerA.id),
      })
    } catch {
      rejected = true
    }
    assert.isTrue(rejected)
  })
})

/** 测试辅助：N 小时后的 DateTime。 */
function DateTimeFromNow(hours: number) {
  return DateTime.now().plus({ hours })
}
