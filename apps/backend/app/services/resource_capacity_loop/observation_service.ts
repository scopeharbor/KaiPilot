// v3-resource-capacity-forecasting-closed-loop —— handoff status 只读 adapter（任务 6.7）。
// 与 observation capture/comparison 服务（任务 6.9）。
//
// 红线：
// - status adapter 只读：不写任何表、不调用下游 confirm/apply；
// - 下游 confirmed_downstream ≠ loop applied；
// - 观察必须同 scope/window/granularity/metricVersion 才可比，失配 → not-comparable 显式化。

import { DateTime } from 'luxon'
import ResourceCapacityHandoffReceipt from '#models/resource_capacity_handoff_receipt'
import ResourceCapacityLoop from '#models/resource_capacity_loop'
import ResourceCapacityBaselineSnapshot from '#models/resource_capacity_baseline_snapshot'
import ResourceCapacityScenario from '#models/resource_capacity_scenario'
import ResourceCapacitySimulationSnapshot from '#models/resource_capacity_simulation_snapshot'
import ResourceCapacityObservationSnapshot from '#models/resource_capacity_observation_snapshot'
import {
  compareObservation,
  type ObservationCompareOutput,
} from '@aiproj/types/resource-capacity-closed-loop-pure'
import type { ResourceCapacityLoopCanonicalPacket } from '@aiproj/types/resource-capacity-closed-loop'

export default class ResourceCapacityObservationService {
  constructor(
    /**
     * 同口径复测 reader：以与 baseline 相同 scope/window/granularity 重读五类来源，
     * 返回观测行。生产由 Phase 4 collector 的只读路径提供；测试注入 fake。
     */
    private reobserve: (args: {
      organizationId: number
      windowStart: string
      windowEnd: string
      granularity: 'day' | 'week' | 'month'
      metricVersion: string
    }) => Promise<
      Array<{
        dimension: 'role' | 'skill' | 'project'
        dimensionKey: string
        bucket: string
        observedGapHours: number
        observedAllocatedHours: number
        factState: 'visible' | 'redacted' | 'missing' | 'stale'
      }>
    >,
  ) {}

  /** 只读 handoff status 投影：规范化状态但不把下游 confirmed 当 loop applied。 */
  async getHandoffStatus(organizationId: number, receiptId: number) {
    const receipt = await ResourceCapacityHandoffReceipt.query()
      .where('organization_id', organizationId)
      .where('id', receiptId)
      .first()
    if (!receipt) return null
    return {
      receiptId: receipt.id,
      target: receipt.target,
      status: receipt.status, // confirmed_downstream / applied_downstream 均为下游口径
      pendingRefId: receipt.pendingRefId,
      statusReason: receipt.statusReason,
      updatedAt: receipt.updatedAt?.toISO() ?? null,
      // 明确姿态：下游确认不代表闭环已应用，更不代表正式写入已发生之外的授权。
      loopApplied: false as const,
      confirmationRequired: true as const,
    }
  }

  /** 捕获观察快照并同口径比较。 */
  async capture(input: {
    organizationId: number
    loopId: number
    downstreamStatus: string
    appliedItemRefs?: string[]
    failedItemRefs?: string[]
    unrelatedChangeNotes?: string[]
  }): Promise<
    | {
        ok: true
        observation: ResourceCapacityObservationSnapshot
        comparison: ObservationCompareOutput
      }
    | { ok: false; reasonCode: string; detail?: string }
  > {
    const loop = await ResourceCapacityLoop.query()
      .where('organization_id', input.organizationId)
      .where('id', input.loopId)
      .first()
    if (!loop) return { ok: false, reasonCode: 'RCCL_REVISION_CONFLICT', detail: 'loop 不存在' }
    if (input.downstreamStatus === 'pending' || input.downstreamStatus === 'previewed') {
      return {
        ok: false,
        reasonCode: 'RCCL_SOURCE_REQUIRED_FAILED',
        detail: '下游尚未到达可观察终态',
      }
    }

    const baseline = await ResourceCapacityBaselineSnapshot.query()
      .where('organization_id', input.organizationId)
      .where('loop_id', input.loopId)
      .orderBy('created_at', 'desc')
      .first()
    if (!baseline) return { ok: false, reasonCode: 'RCCL_SOURCE_STALE', detail: '缺少基线' }

    const packet = baseline.packetJson as unknown as ResourceCapacityLoopCanonicalPacket

    // selected 情景的 expected rows（若有选择）。
    const selectionRows = await this.loadExpectedRows(input.organizationId, input.loopId)

    const observed = await this.reobserve({
      organizationId: input.organizationId,
      windowStart: packet.scope.windowStart,
      windowEnd: packet.scope.windowEnd,
      granularity: packet.scope.granularity,
      metricVersion: baseline.schemaVersion,
    })

    const comparison = compareObservation({
      baselineScope: packet.scope,
      observationScope: {
        granularity: packet.scope.granularity,
        windowStart: packet.scope.windowStart,
        windowEnd: packet.scope.windowEnd,
        projectIds: packet.scope.projectIds,
      },
      baselineMetricVersion: baseline.schemaVersion,
      observationMetricVersion: baseline.schemaVersion,
      expectedRows:
        selectionRows.length > 0
          ? selectionRows
          : packet.facts.map((f) => ({
              dimension: f.dimension,
              dimensionKey: f.dimensionKey,
              bucket: f.bucket,
              gapHours: f.gapHours,
            })),
      observedRows: observed,
    })

    const digestInput = JSON.stringify({
      c: comparison.comparisons,
      s: input.downstreamStatus,
      t: DateTime.now().toFormat('yyyy-MM-dd'),
    })
    let hash = 0x811c9dc5
    for (let i = 0; i < digestInput.length; i++) {
      hash ^= digestInput.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }

    const observation = await ResourceCapacityObservationSnapshot.create({
      organizationId: input.organizationId,
      loopId: input.loopId,
      downstreamStatus: input.downstreamStatus,
      comparable: comparison.comparability.comparable,
      comparabilityReasonsJson: comparison.comparability.reasonCodes,
      comparisonsJson: comparison.comparisons,
      appliedItemRefsJson: input.appliedItemRefs ?? [],
      failedItemRefsJson: input.failedItemRefs ?? [],
      unrelatedChangeNotesJson: input.unrelatedChangeNotes ?? [],
      observationDigest: `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`,
    })

    return { ok: true, observation, comparison }
  }

  /** 读取当前选择的模拟行作为 expected（无选择时退化为基线缺口）。 */
  private async loadExpectedRows(organizationId: number, loopId: number) {
    const sim = await ResourceCapacitySimulationSnapshot.query()
      .where('organization_id', organizationId)
      .where('loop_id', loopId)
      .orderBy('created_at', 'desc')
      .first()
    void sim
    const scenario = sim ? await ResourceCapacityScenario.find(sim.scenarioId) : null
    void scenario
    // expected 以模拟快照行为准（rows 与 packet facts 同形）。
    return (
      (sim?.rowsJson ?? []) as Array<{
        dimension: 'role' | 'skill' | 'project'
        dimensionKey: string
        bucket: string
        gapHours: number
      }>
    ).map((r) => ({
      dimension: r.dimension,
      dimensionKey: r.dimensionKey,
      bucket: r.bucket,
      gapHours: r.gapHours,
    }))
  }
}
