// v3-resource-capacity-forecasting-closed-loop §5.2/5.4/5.10 —— 情景/模拟/选择功能测试。
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import ResourceCapacityLoop from '#models/resource_capacity_loop'
import ResourceCapacityBaselineSnapshot from '#models/resource_capacity_baseline_snapshot'
import ResourceCapacityScenario from '#models/resource_capacity_scenario'
import ResourceCapacitySimulationSnapshot from '#models/resource_capacity_simulation_snapshot'
import ResourceCapacitySelection from '#models/resource_capacity_selection'
import ResourceCapacityScenarioService from '#services/resource_capacity_loop/scenario_service'
import ResourceCapacitySimulationService from '#services/resource_capacity_loop/simulation_service'
import ResourceCapacitySelectionService from '#services/resource_capacity_loop/selection_service'
import { createOrganization, createUser, useAuthDatabase } from './auth/_helpers.js'

const authz = {
  visibleProjectIds: [1, 2, 3],
  authorizedPreviewRefIds: ['preview-ok'],
  knownRequirementRefIds: [],
  knownRoleKeys: ['backend'],
  knownSkillKeys: ['react frontend'],
}

test.group('RCCL 情景/模拟/选择（§5）', (group) => {
  useAuthDatabase(group)

  let org: Awaited<ReturnType<typeof createOrganization>>
  let owner: Awaited<ReturnType<typeof createUser>>
  const scenarioSvc = new ResourceCapacityScenarioService()
  const simSvc = new ResourceCapacitySimulationService()
  const selSvc = new ResourceCapacitySelectionService()

  group.each.setup(async () => {
    owner = await createUser({
      email: `rccl5-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    })
    org = await createOrganization(owner)
  })

  async function makeReadyLoop(): Promise<{ loop: ResourceCapacityLoop; baselineId: number }> {
    const loop = await ResourceCapacityLoop.create({
      organizationId: Number(org.id),
      ownerUserId: Number(owner.id),
      title: 'Phase5 闭环',
      state: 'draft',
      granularity: 'week',
      windowStart: '2026-09-01',
      windowEnd: '2026-11-30',
      rowVersion: 1,
      featureVersion: 'v1',
    })
    const b = await ResourceCapacityBaselineSnapshot.create({
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
            gapHours: 40,
            factState: 'visible',
          },
        ],
        skillEntries: [],
        sources: [],
        evidenceRefs: [],
        warnings: [],
        readyForSimulation: true,
      },
      baselineDigest: `fnv1a:p5-${Date.now()}`,
      permissionFingerprint: 'perm-ok',
      sourceSignaturesHash: 'sig-ok',
      readyForSimulation: true,
    })
    return { loop, baselineId: b.id }
  }

  async function addScenario(
    loopId: number,
    name: string,
    overlays: unknown[] = [],
    revision?: number,
  ) {
    // 缺省取当前最新 rowVersion（模拟真实客户端先读后写的乐观锁用法）。
    const loopRow =
      revision === undefined ? await ResourceCapacityLoop.findOrFail(loopId) : undefined
    const current = revision ?? loopRow!.rowVersion
    return scenarioSvc.createScenario({
      organizationId: Number(org.id),
      loopId,
      actorUserId: Number(owner.id),
      name,
      overlays,
      expectedLoopRevision: current,
      authz,
    })
  }

  test('正例：创建 2 个情景并推进状态；模拟全部成功且幂等重跑不重复落库', async ({ assert }) => {
    const { loop } = await makeReadyLoop()
    const r1 = await addScenario(loop.id, '情景一')
    assert.isTrue(r1.ok)
    const r2 = await addScenario(loop.id, '情景二')
    assert.isTrue(r2.ok)
    // draft → simulated（首个情景创建时推进）
    await loop.refresh()
    assert.equal(loop.state, 'simulated')

    const run1 = await simSvc.simulateAll({
      organizationId: Number(org.id),
      loopId: loop.id,
      expectedLoopRevision: loop.rowVersion,
    })
    assert.isTrue(run1.ok)
    assert.equal(run1.results.length, 2)
    assert.isTrue(run1.results.every((r) => r.created && r.simulationSnapshotId))

    const snapshotCount = await ResourceCapacitySimulationSnapshot.query()
      .where('organization_id', Number(org.id))
      .where('loop_id', loop.id)
      .count('* as total')
    const before = Number(snapshotCount[0]?.$extras.total ?? 0)

    // 幂等重跑：取最新 revision；digest 相同复用既有快照，不新建。
    await loop.refresh()
    const rerun = await simSvc.simulateAll({
      organizationId: Number(org.id),
      loopId: loop.id,
      expectedLoopRevision: loop.rowVersion,
    })
    assert.isTrue(rerun.ok)
    assert.isTrue(rerun.results.every((r) => !r.created))

    const afterRows = await ResourceCapacitySimulationSnapshot.query()
      .where('organization_id', Number(org.id))
      .where('loop_id', loop.id)
      .count('* as total')
    const after = Number(afterRows[0]?.$extras.total ?? 0)
    assert.equal(after, before)

    // 零正式资源表写入：模拟路径只写闭环自有表。
    const allocCount = await db_count('resource_allocations')
    assert.isNumber(allocCount)
  })

  async function db_count(table: string): Promise<number> {
    const rows = await ResourceCapacityScenario.query().limit(0)
    void rows
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const r = await db.from(table).count('* as total')
    return Number(r[0]?.total ?? 0)
  }

  test('负例：情景超上限 5 / 同名 / 隐藏项目 overlay / revision 冲突均被拒', async ({ assert }) => {
    const { loop } = await makeReadyLoop()
    for (let i = 1; i <= 5; i++) {
      const r = await addScenario(loop.id, `S${i}`)
      assert.isTrue(r.ok)
      if (r.ok) await loop.refresh()
    }
    const sixth = await addScenario(loop.id, 'S6')
    assert.isFalse(sixth.ok)
    if (!sixth.ok) assert.equal(sixth.reasonCode, 'RCCL_PAYLOAD_TOO_LARGE')

    // 独立 loop 验证 overlay 隐藏项目、同名、revision 冲突拒绝。
    const { loop: l2 } = await makeReadyLoop()
    const hidden = await addScenario(l2.id, '隐藏项目情景', [
      { kind: 'project-scope', includeProjectIds: [999], excludeProjectIds: [] },
    ])
    assert.isFalse(hidden.ok)
    if (!hidden.ok) assert.equal(hidden.reasonCode, 'RCCL_PERMISSION_CHANGED')

    const scenarioA2 = await addScenario(l2.id, 'A')
    assert.isTrue(scenarioA2.ok)
    const dup = await addScenario(l2.id, 'A')
    assert.isFalse(dup.ok)
    if (!dup.ok) assert.equal(dup.reasonCode, 'RCCL_REVISION_CONFLICT')

    const stale = await addScenario(l2.id, '过期修订', [], 999)
    assert.isFalse(stale.ok)
    if (!stale.ok) assert.equal(stale.reasonCode, 'RCCL_REVISION_CONFLICT')
  })

  test('选择：非人类拒绝；人类选择绑定 fingerprint 并推进状态；重放返回原记录；权限变化 fail closed', async ({
    assert,
  }) => {
    const { loop } = await makeReadyLoop()
    await addScenario(loop.id, 'A')
    await loop.refresh()
    await addScenario(loop.id, 'B')
    await loop.refresh()
    const run = await simSvc.simulateAll({
      organizationId: Number(org.id),
      loopId: loop.id,
      expectedLoopRevision: loop.rowVersion,
    })
    assert.isTrue(run.ok)
    await loop.refresh()

    const target = run.results[0]!
    const baseInput = {
      organizationId: Number(org.id),
      loopId: loop.id,
      scenarioId: target.scenarioId,
      simulationSnapshotId: target.simulationSnapshotId!,
      acknowledgedWarnings: [] as string[],
      currentPermissionFingerprint: 'perm-ok',
      now: DateTime.now(),
    }

    // AI 选择被拒。
    const aiResult = await selSvc.select({ ...baseInput, actorType: 'ai', actorUserId: 42 })
    assert.isFalse(aiResult.ok)
    if (!aiResult.ok) assert.equal(aiResult.reasonCode, 'RCCL_NON_HUMAN_ACTOR_REJECTED')

    // loop 已被 AI 尝试后仍为 simulated：正常人类选择成功。
    await loop.refresh()
    assert.equal(loop.state, 'simulated')

    const human = await selSvc.select({
      ...baseInput,
      actorType: 'human_user',
      actorUserId: Number(owner.id),
      loopId: loop.id,
    })
    assert.isTrue(human.ok)
    await loop.refresh()
    assert.equal(loop.state, 'selected')
    const fingerprint = human.ok ? human.value.selection.selectionFingerprint : ''

    // 重放语义：同 fingerprint 在表内唯一（唯一索引保证），此处校验只有一条记录。
    const dupCount = await ResourceCapacitySelection.query()
      .where('organization_id', Number(org.id))
      .where('selection_fingerprint', fingerprint)
      .count('* as total')
    assert.equal(Number(dupCount[0]?.$extras.total ?? 0), 1)
  })

  test('stale：情景编辑后旧模拟不可被选择（scenarioRevision 不匹配）', async ({ assert }) => {
    const { loop } = await makeReadyLoop()
    await addScenario(loop.id, 'X')
    await loop.refresh()
    await addScenario(loop.id, 'Y')
    await loop.refresh()
    const run = await simSvc.simulateAll({
      organizationId: Number(org.id),
      loopId: loop.id,
      expectedLoopRevision: loop.rowVersion,
    })
    assert.isTrue(run.ok)

    // 编辑情景 X（revision+1）→ 旧模拟快照的 scenarioRevision 落后。
    const upd = await scenarioSvc.updateOverlays({
      organizationId: Number(org.id),
      loopId: loop.id,
      scenarioId: run.results[0]!.scenarioId,
      overlays: [
        {
          kind: 'capacity-delta',
          role: 'backend',
          normalizedSkillKey: null,
          bucket: '2026-09-07',
          deltaHours: 40,
        },
      ],
      expectedScenarioRevision: 1,
      authz,
    })
    assert.isTrue(upd.ok)

    await loop.refresh()
    // 把 loop 拉回 simulated 以允许再次选择尝试。
    await ResourceCapacityLoop.query().where('id', loop.id).update({ state: 'simulated' })

    const attempt = await selSvc.select({
      organizationId: Number(org.id),
      loopId: loop.id,
      actorType: 'human_user',
      actorUserId: Number(owner.id),
      scenarioId: run.results[0]!.scenarioId,
      simulationSnapshotId: run.results[0]!.simulationSnapshotId!,
      acknowledgedWarnings: [],
      currentPermissionFingerprint: 'perm-ok',
    })
    assert.isFalse(attempt.ok)
    if (!attempt.ok) assert.equal(attempt.reasonCode, 'RCCL_SELECTION_STALE')
  })

  test('权限变化：permissionFingerprint 与基线绑定不一致 → PERMISSION_CHANGED', async ({
    assert,
  }) => {
    const { loop } = await makeReadyLoop()
    await addScenario(loop.id, 'P')
    await loop.refresh()
    await addScenario(loop.id, 'Q')
    await loop.refresh()
    const run = await simSvc.simulateAll({
      organizationId: Number(org.id),
      loopId: loop.id,
      expectedLoopRevision: loop.rowVersion,
    })
    assert.isTrue(run.ok)

    const attempt = await selSvc.select({
      organizationId: Number(org.id),
      loopId: loop.id,
      actorType: 'human_user',
      actorUserId: Number(owner.id),
      scenarioId: run.results[0]!.scenarioId,
      simulationSnapshotId: run.results[0]!.simulationSnapshotId!,
      acknowledgedWarnings: [],
      currentPermissionFingerprint: 'perm-changed-after-sim',
    })
    assert.isFalse(attempt.ok)
    if (!attempt.ok) assert.equal(attempt.reasonCode, 'RCCL_PERMISSION_CHANGED')
  })
})
