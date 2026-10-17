// v3-resource-capacity-forecasting-closed-loop —— 模拟服务（任务 5.3）。
//
// 规则：
// - 对同一 canonical baseline 复用内存 packet 计算全部 2–5 情景（不为每个情景重复查库）；
// - 输出不可变 simulation snapshots（同 scenario 同 digest 幂等复用，不重复落库）；
// - 零正式资源表写入；预算失败/基线未就绪 fail closed。

import ResourceCapacityLoop from '#models/resource_capacity_loop'
import ResourceCapacityBaselineSnapshot from '#models/resource_capacity_baseline_snapshot'
import ResourceCapacityScenario from '#models/resource_capacity_scenario'
import ResourceCapacitySimulationSnapshot from '#models/resource_capacity_simulation_snapshot'
import {
  RESOURCE_CAPACITY_LOOP_BUDGETS,
  RESOURCE_CAPACITY_LOOP_ENGINE_VERSION,
  RESOURCE_CAPACITY_LOOP_STATES,
} from '@aiproj/types/resource-capacity-closed-loop'
import {
  computeOverlayDigest,
  computePacketDigest,
  computeSimulationDigest,
  simulateScenario,
} from '@aiproj/types/resource-capacity-closed-loop-pure'
import type {
  ResourceCapacityLoopCanonicalPacket,
  ResourceCapacityLoopOverlay,
} from '@aiproj/types/resource-capacity-closed-loop'

export interface SimulationRunResult {
  ok: boolean
  reasonCode?: string
  detail?: string
  loopState: string
  loopRowVersion: number
  results: Array<{
    scenarioId: number
    scenarioName: string
    simulationSnapshotId: number | null
    simulationDigest: string | null
    gapDeltaHours: number | null
    /** true = 本次运行新建；false = 命中幂等已有快照。 */
    created: boolean
  }>
}

export default class ResourceCapacitySimulationService {
  async simulateAll(input: {
    organizationId: number
    loopId: number
    expectedLoopRevision: number
  }): Promise<SimulationRunResult> {
    const loop = await ResourceCapacityLoop.query()
      .where('organization_id', input.organizationId)
      .where('id', input.loopId)
      .first()
    if (!loop) {
      return {
        ok: false,
        reasonCode: 'RCCL_REVISION_CONFLICT',
        detail: 'loop 不存在',
        loopState: '',
        loopRowVersion: 0,
        results: [],
      }
    }
    if (
      ![RESOURCE_CAPACITY_LOOP_STATES.DRAFT, RESOURCE_CAPACITY_LOOP_STATES.SIMULATED].includes(
        loop.state as never,
      )
    ) {
      return {
        ok: false,
        reasonCode: 'RCCL_REVISION_CONFLICT',
        detail: `状态 ${loop.state} 不允许重新模拟`,
        loopState: loop.state,
        loopRowVersion: loop.rowVersion,
        results: [],
      }
    }
    const revOk = input.expectedLoopRevision === loop.rowVersion
    if (!revOk) {
      return {
        ok: false,
        reasonCode: 'RCCL_REVISION_CONFLICT',
        detail: `revision 已推进到 ${loop.rowVersion}`,
        loopState: loop.state,
        loopRowVersion: loop.rowVersion,
        results: [],
      }
    }

    const baseline = await ResourceCapacityBaselineSnapshot.query()
      .where('organization_id', input.organizationId)
      .where('loop_id', input.loopId)
      .whereNull('superseded_by_id')
      .orderBy('created_at', 'desc')
      .first()
    if (!baseline || !baseline.readyForSimulation) {
      return {
        ok: false,
        reasonCode: 'RCCL_SOURCE_REQUIRED_FAILED',
        detail: '缺少可模拟的当前基线',
        loopState: loop.state,
        loopRowVersion: loop.rowVersion,
        results: [],
      }
    }
    const packet = baseline.packetJson as unknown as ResourceCapacityLoopCanonicalPacket

    const scenarios = await ResourceCapacityScenario.query()
      .where('organization_id', input.organizationId)
      .where('loop_id', input.loopId)
      .where('active', true)
      .orderBy('id', 'asc')
    if (
      scenarios.length < RESOURCE_CAPACITY_LOOP_BUDGETS.MIN_SCENARIOS ||
      scenarios.length > RESOURCE_CAPACITY_LOOP_BUDGETS.MAX_SCENARIOS
    ) {
      return {
        ok: false,
        reasonCode: 'RCCL_PAYLOAD_TOO_LARGE',
        detail: `情景数 ${scenarios.length} 不在 2–5 范围`,
        loopState: loop.state,
        loopRowVersion: loop.rowVersion,
        results: [],
      }
    }
    // 全部情景必须绑定同一当前基线。
    if (scenarios.some((s) => s.baselineSnapshotId !== baseline.id)) {
      return {
        ok: false,
        reasonCode: 'RCCL_SOURCE_STALE',
        detail: '存在绑定已取代基线的情景，请先刷新',
        loopState: loop.state,
        loopRowVersion: loop.rowVersion,
        results: [],
      }
    }

    const baselineDigest = computePacketDigest(packet)

    const results: SimulationRunResult['results'] = []
    for (const scenario of scenarios) {
      const overlays = scenario.overlaysJson as ResourceCapacityLoopOverlay[]
      const sim = simulateScenario(packet, overlays)
      if (!sim.ok) {
        results.push({
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          simulationSnapshotId: null,
          simulationDigest: null,
          gapDeltaHours: null,
          created: false,
        })
        continue
      }
      const overlayDigest = computeOverlayDigest(overlays)
      const digest = computeSimulationDigest({
        baselineDigest,
        scenarioRevision: scenario.rowVersion,
        overlayDigest,
        engineVersion: RESOURCE_CAPACITY_LOOP_ENGINE_VERSION,
      })

      // 幂等：同 scenario + digest 已存在则直接复用。
      let snapshot = await ResourceCapacitySimulationSnapshot.query()
        .where('organization_id', input.organizationId)
        .where('scenario_id', scenario.id)
        .where('simulation_digest', digest)
        .first()
      let created = false
      if (!snapshot) {
        snapshot = await ResourceCapacitySimulationSnapshot.create({
          organizationId: input.organizationId,
          scenarioId: scenario.id,
          loopId: input.loopId,
          engineVersion: RESOURCE_CAPACITY_LOOP_ENGINE_VERSION,
          scenarioRevision: scenario.rowVersion,
          rowsJson: sim.value.rows,
          gapDeltaHours: sim.value.gapDeltaHours.toFixed(2),
          contentionDeltaCount: sim.value.contentionDeltaCount,
          confidenceBand: 'medium',
          warningsJson: sim.value.warnings,
          simulationDigest: digest,
          staleState: 'current',
        })
        created = true
      }
      results.push({
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        simulationSnapshotId: snapshot.id,
        simulationDigest: digest,
        gapDeltaHours: sim.value.gapDeltaHours,
        created,
      })
    }

    // 状态推进 draft → simulated（乐观锁递增）。
    if (
      loop.state === RESOURCE_CAPACITY_LOOP_STATES.DRAFT &&
      results.every((r) => r.simulationSnapshotId)
    ) {
      loop.state = RESOURCE_CAPACITY_LOOP_STATES.SIMULATED
      loop.rowVersion += 1
      await loop.save()
    } else if (loop.state === RESOURCE_CAPACITY_LOOP_STATES.SIMULATED) {
      loop.rowVersion += 1
      await loop.save()
    }

    return {
      ok: true,
      loopState: loop.state,
      loopRowVersion: loop.rowVersion,
      results,
    }
  }
}
