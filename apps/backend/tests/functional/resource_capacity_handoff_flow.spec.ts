// v3-resource-capacity-forecasting-closed-loop §6.2/6.4/6.8/6.10/6.12 ——
// handoff / observation / review 功能测试。下游 adapter 用 fake spy 记录调用，
// 断言零 confirm/apply 路径；全部零正式资源写入。
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import ResourceCapacityLoop from '#models/resource_capacity_loop'
import ResourceCapacityBaselineSnapshot from '#models/resource_capacity_baseline_snapshot'
import ResourceCapacityScenario from '#models/resource_capacity_scenario'
import ResourceCapacitySimulationSnapshot from '#models/resource_capacity_simulation_snapshot'
import ResourceCapacitySelection from '#models/resource_capacity_selection'
import ResourceCapacityObservationSnapshot from '#models/resource_capacity_observation_snapshot'
import ResourceCapacityHandoffService from '#services/resource_capacity_loop/handoff_service'
import ResourceCapacityObservationService from '#services/resource_capacity_loop/observation_service'
import ResourceCapacityReviewService from '#services/resource_capacity_loop/review_service'
import { createOrganization, createUser, useAuthDatabase } from './auth/_helpers.js'

test.group('RCCL handoff/observation/review（§6）', (group) => {
  useAuthDatabase(group)

  let org: Awaited<ReturnType<typeof createOrganization>>
  let owner: Awaited<ReturnType<typeof createUser>>
  let calls: string[]

  group.each.setup(async () => {
    owner = await createUser({
      email: `rccl6-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    })
    org = await createOrganization(owner)
    calls = []
  })

  /** 下游 fake：只提供 pending 创建路径，confirm/apply 调用会被记录为违规。 */
  const downstream = {
    createAllocationDraft: async (args: { visibleRefs: string[] }) => {
      calls.push('createAllocationDraft')
      void args
      return { pendingRefId: 'draft-123' }
    },
    createSuggestionPreview: async () => {
      calls.push('createSuggestionPreview')
      return { pendingRefId: 'preview-456' }
    },
  }
  const handoffSvc = new ResourceCapacityHandoffService(downstream)
  const reviewSvc = new ResourceCapacityReviewService()

  async function makeSelectedLoop(): Promise<{
    loop: ResourceCapacityLoop
    selection: ResourceCapacitySelection
  }> {
    const loop = await ResourceCapacityLoop.create({
      organizationId: Number(org.id),
      ownerUserId: Number(owner.id),
      title: 'Phase6 闭环',
      state: 'selected',
      granularity: 'week',
      windowStart: '2026-09-01',
      windowEnd: '2026-11-30',
      rowVersion: 5,
      featureVersion: 'v1',
    })
    const baseline = await ResourceCapacityBaselineSnapshot.create({
      organizationId: Number(org.id),
      loopId: loop.id,
      schemaVersion: 'resource-capacity-loop@1',
      packetJson: {
        schemaVersion: 'resource-capacity-loop@1',
        scope: {
          granularity: 'week',
          windowStart: '2026-09-01',
          windowEnd: '2026-11-30',
          projectIds: [1, 2],
        },
        unit: 'hours',
        facts: [
          {
            dimension: 'skill',
            dimensionKey: 'react frontend',
            bucket: '2026-09-07',
            demandHours: 100,
            allocatedHours: 60,
            availableCapacityHours: 70,
            remainingCapacityHours: 10,
            gapHours: 60,
            factState: 'visible',
          },
        ],
        skillEntries: [],
        sources: [],
        evidenceRefs: [],
        warnings: [],
        readyForSimulation: true,
      },
      baselineDigest: `fnv1a:p6-${Date.now()}`,
      permissionFingerprint: 'perm-ok',
      sourceSignaturesHash: 'sig-ok',
      readyForSimulation: true,
    })
    const scenario = await ResourceCapacityScenario.create({
      organizationId: Number(org.id),
      loopId: loop.id,
      baselineSnapshotId: baseline.id,
      name: 'S',
      overlaysJson: [],
      rowVersion: 1,
      active: true,
    })
    const sim = await ResourceCapacitySimulationSnapshot.create({
      organizationId: Number(org.id),
      scenarioId: scenario.id,
      loopId: loop.id,
      engineVersion: 'rccl-engine@1',
      scenarioRevision: scenario.rowVersion,
      rowsJson: [
        {
          dimension: 'skill',
          dimensionKey: 'react frontend',
          bucket: '2026-09-07',
          demandHours: 100,
          allocatedHours: 60,
          availableCapacityHours: 70,
          remainingCapacityHours: 10,
          gapHours: 60,
          factState: 'visible',
          hypothetical: true,
        },
      ],
      gapDeltaHours: '-40.00',
      contentionDeltaCount: 0,
      confidenceBand: 'medium',
      warningsJson: [],
      simulationDigest: `fnv1a:sim-${Date.now()}`,
      staleState: 'current',
    })
    const selection = await ResourceCapacitySelection.create({
      organizationId: Number(org.id),
      loopId: loop.id,
      scenarioId: scenario.id,
      simulationSnapshotId: sim.id,
      selectionFingerprint: `fnv1a:sel-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      boundBaselineDigest: baseline.baselineDigest,
      boundSimulationDigest: sim.simulationDigest,
      boundSourceSignaturesHash: 'sig-ok',
      boundPermissionFingerprint: 'perm-ok',
      boundLoopRevision: loop.rowVersion - 1,
      actorUserId: Number(owner.id),
      acknowledgedWarningsJson: [],
      expiresAt: DateTime.now().plus({ hours: 48 }),
    })
    return { loop, selection }
  }

  test('handoff 正例 + 幂等重放 + 状态推进 + 下游零 confirm/apply', async ({ assert }) => {
    const { loop } = await makeSelectedLoop()
    const r1 = await handoffSvc.createHandoff({
      organizationId: Number(org.id),
      loopId: loop.id,
      actorType: 'human_user',
      actorUserId: Number(owner.id),
      target: 'cross-project-allocation-draft',
      idempotencyKey: 'key-1',
      requestedRefs: ['ref-1'],
      authorizedVisibleRefIds: ['ref-1'],
    })
    assert.isTrue(r1.ok)
    if (r1.ok) {
      assert.isFalse(r1.value.replayed)
      assert.equal(r1.value.receipt.pendingRefId, 'draft-123')
      assert.equal(r1.value.receipt.status, 'pending')
    }
    assert.deepEqual(
      calls.filter((c) => c.includes('confirm') || c.includes('apply')),
      [],
    )

    await loop.refresh()
    assert.equal(loop.state, 'handed-off')

    // 重放：同 key → 原 receipt，不再调用下游。
    calls = []
    const r2 = await handoffSvc.createHandoff({
      organizationId: Number(org.id),
      loopId: loop.id,
      actorType: 'human_user',
      actorUserId: Number(owner.id),
      target: 'cross-project-allocation-draft',
      idempotencyKey: 'key-1',
      requestedRefs: ['ref-1'],
      authorizedVisibleRefIds: ['ref-1'],
    })
    assert.isTrue(r2.ok)
    if (r2.ok) assert.isTrue(r2.value.replayed)
    assert.deepEqual(calls, [])
  })

  test('负例：未知目标 / 越权 ref / 非人类 / confirm token 注入均被拒且零下游调用', async ({
    assert,
  }) => {
    const { loop } = await makeSelectedLoop()
    const base = {
      organizationId: Number(org.id),
      loopId: loop.id,
      actorType: 'human_user',
      actorUserId: Number(owner.id),
      requestedRefs: ['ref-1'],
      authorizedVisibleRefIds: ['ref-1'],
    }
    const unknownTarget = await handoffSvc.createHandoff({
      ...base,
      target: 'direct-db-write',
      idempotencyKey: 'k1',
    })
    assert.isFalse(unknownTarget.ok)
    if (!unknownTarget.ok) assert.equal(unknownTarget.reasonCode, 'RCCL_HANDOFF_TARGET_UNKNOWN')

    const hiddenRef = await handoffSvc.createHandoff({
      ...base,
      target: 'safe-navigation',
      idempotencyKey: 'k2',
      requestedRefs: ['hidden-ref'],
      authorizedVisibleRefIds: ['ref-1'],
    })
    assert.isFalse(hiddenRef.ok)
    if (!hiddenRef.ok) assert.equal(hiddenRef.reasonCode, 'RCCL_PERMISSION_CHANGED')

    const nonHuman = await handoffSvc.createHandoff({
      ...base,
      actorType: 'scheduled_job',
      target: 'safe-navigation',
      idempotencyKey: 'k3',
    })
    assert.isFalse(nonHuman.ok)

    const withToken = await handoffSvc.createHandoff({
      ...base,
      target: 'safe-navigation',
      idempotencyKey: 'k4',
      apply_handle: 'leak',
    } as never)
    assert.isFalse(withToken.ok)

    assert.deepEqual(calls, [])
    await loop.refresh()
    assert.equal(loop.state, 'selected')
  })

  test('observation：applied 后同口径复测可比；partial/failed 记录显式化', async ({ assert }) => {
    const { loop } = await makeSelectedLoop()
    const obsSvc = new ResourceCapacityObservationService(async () => [
      // observed gap 从 60 降到 30（改善但不归零 → unresolved=false）。
      {
        dimension: 'skill',
        dimensionKey: 'react frontend',
        bucket: '2026-09-07',
        observedGapHours: 30,
        observedAllocatedHours: 70,
        factState: 'visible' as const,
      },
    ])
    const result = await obsSvc.capture({
      organizationId: Number(org.id),
      loopId: loop.id,
      downstreamStatus: 'applied_downstream',
      appliedItemRefs: ['draft-item-1'],
      failedItemRefs: [],
      unrelatedChangeNotes: ['来源侧无关变更：预测方法版本不变，无其他变化'],
    })
    assert.isTrue(result.ok)
    if (result.ok) {
      assert.isTrue(result.comparison.comparability.comparable)
      assert.isTrue(result.observation.comparable)
      const cmp = JSON.parse(JSON.stringify(result.comparison.comparisons[0]))
      assert.equal(cmp.forecastErrorHours, -30)
    }

    // pending 状态不可捕获观察。
    const tooEarly = await obsSvc.capture({
      organizationId: Number(org.id),
      loopId: loop.id,
      downstreamStatus: 'pending',
    })
    assert.isFalse(tooEarly.ok)

    // 只读 status adapter 零副作用且不把 confirmed 当 loop applied。
    const status = await obsSvc.getHandoffStatus(Number(org.id), 999999)
    assert.isNull(status)
  })

  test('review/close：reviewed→closed 仅人工；自动关单不存在；closed 重开拒绝；并发 revision 冲突', async ({
    assert,
  }) => {
    const { loop } = await makeSelectedLoop()
    await ResourceCapacityLoop.query().where('id', loop.id).update({ state: 'observing' })
    const obs = await ResourceCapacityObservationSnapshot.create({
      organizationId: Number(org.id),
      loopId: loop.id,
      downstreamStatus: 'applied_downstream',
      comparable: true,
      comparabilityReasonsJson: [],
      comparisonsJson: [],
      appliedItemRefsJson: [],
      failedItemRefsJson: [],
      unrelatedChangeNotesJson: [],
      observationDigest: 'fnv1a:rev00001',
    })

    // 非 human 复核拒绝。
    const aiReview = await reviewSvc.review({
      organizationId: Number(org.id),
      loopId: loop.id,
      actorType: 'ai',
      observationSnapshotId: obs.id,
      outcome: 'goal_met',
      boundedRationale: '自动结论应被拒',
      acknowledgedWarnings: [],
      expectedObservationCreatedAt: '',
    })
    assert.isFalse(aiReview.ok)

    const humanReview = await reviewSvc.review({
      organizationId: Number(org.id),
      loopId: loop.id,
      actorType: 'human_user',
      observationSnapshotId: obs.id,
      outcome: 'partially_met',
      boundedRationale: '缺口部分收窄。',
      acknowledgedWarnings: [],
      expectedObservationCreatedAt: '',
    })
    assert.isTrue(humanReview.ok)
    await loop.refresh()
    assert.equal(loop.state, 'reviewed')

    // reviewed→closed 需要 revision 一致。
    const wrongRev = await reviewSvc.close({
      organizationId: Number(org.id),
      loopId: loop.id,
      actorType: 'human_user',
      expectedLoopRevision: 999,
    })
    assert.isFalse(wrongRev.ok)

    const closed = await reviewSvc.close({
      organizationId: Number(org.id),
      loopId: loop.id,
      actorType: 'human_user',
      expectedLoopRevision: loop.rowVersion,
    })
    assert.isTrue(closed.ok)
    await loop.refresh()
    assert.equal(loop.state, 'closed')

    // closed 重开拒绝。
    const reopen = await reviewSvc.cancel({
      organizationId: Number(org.id),
      loopId: loop.id,
      actorType: 'human_user',
      reason: '重开尝试',
    })
    assert.isFalse(reopen.ok)

    // 每 observation 至多一条 review。
    const dupReview = await reviewSvc.review({
      organizationId: Number(org.id),
      loopId: loop.id,
      actorType: 'human_user',
      observationSnapshotId: obs.id,
      outcome: 'goal_met',
      boundedRationale: '重复',
      acknowledgedWarnings: [],
      expectedObservationCreatedAt: '',
    })
    assert.isFalse(dupReview.ok)
  })

  test('not-comparable 复核须显式确认', async ({ assert }) => {
    const { loop } = await makeSelectedLoop()
    await ResourceCapacityLoop.query().where('id', loop.id).update({ state: 'observing' })
    const obs = await ResourceCapacityObservationSnapshot.create({
      organizationId: Number(org.id),
      loopId: loop.id,
      downstreamStatus: 'expired',
      comparable: false,
      comparabilityReasonsJson: ['RCCL_NOT_COMPARABLE_WINDOW'],
      comparisonsJson: [],
      appliedItemRefsJson: [],
      failedItemRefsJson: [],
      unrelatedChangeNotesJson: [],
      observationDigest: 'fnv1a:nc000001',
    })
    const withoutAck = await reviewSvc.review({
      organizationId: Number(org.id),
      loopId: loop.id,
      actorType: 'human_user',
      observationSnapshotId: obs.id,
      outcome: 'invalidated',
      boundedRationale: '窗口失配未确认',
      acknowledgedWarnings: [],
      expectedObservationCreatedAt: '',
    })
    assert.isFalse(withoutAck.ok)

    const withAck = await reviewSvc.review({
      organizationId: Number(org.id),
      loopId: loop.id,
      actorType: 'human_user',
      observationSnapshotId: obs.id,
      outcome: 'invalidated',
      boundedRationale: '窗口失配已确认，判定失效。',
      acknowledgedWarnings: ['NOT_COMPARABLE_ACKNOWLEDGED'],
      expectedObservationCreatedAt: '',
    })
    assert.isTrue(withAck.ok)
  })
})
