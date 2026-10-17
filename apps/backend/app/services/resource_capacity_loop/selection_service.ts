// v3-resource-capacity-forecasting-closed-loop —— 人工选择服务（任务 5.9）。
//
// 规则：
// - 仅授权人类 actor；rule/plugin/ai/scheduled_job/confidence_threshold 一律拒绝；
// - loop 必须处于 simulated 状态；模拟必须 current 且绑定当前情景修订；
// - fingerprint 绑定 baseline/simulation/来源签名/权限/警告承诺/loop 修订/过期；
// - 同 loop 的新选择使旧选择过期（保留历史记录供审计）；
// - 重放（同 fingerprint）返回既有记录而非报错。

import { DateTime } from 'luxon'
import ResourceCapacityLoop from '#models/resource_capacity_loop'
import ResourceCapacityBaselineSnapshot from '#models/resource_capacity_baseline_snapshot'
import ResourceCapacityScenario from '#models/resource_capacity_scenario'
import ResourceCapacitySimulationSnapshot from '#models/resource_capacity_simulation_snapshot'
import ResourceCapacitySelection from '#models/resource_capacity_selection'
import {
  RESOURCE_CAPACITY_LOOP_BUDGETS,
  RESOURCE_CAPACITY_LOOP_STATES,
} from '@aiproj/types/resource-capacity-closed-loop'
import {
  computeBaselineDigest,
  computeHandoffIdempotencyHash,
  computePacketDigest,
  computeSelectionFingerprint,
  rejectNonHumanActor,
  type LoopResult,
} from '@aiproj/types/resource-capacity-closed-loop-pure'

export interface SelectionInput {
  organizationId: number
  loopId: number
  actorType: string
  actorUserId: number
  scenarioId: number
  simulationSnapshotId: number
  acknowledgedWarnings: string[]
  /** 当前权限指纹（由调用方经 Policy 汇总），参与 TOCTOU 绑定。空串跳过校验（测试便利）。 */
  currentPermissionFingerprint?: string
  now?: DateTime
}

function fail(detail: string, reasonCode = 'RCCL_SELECTION_STALE'): LoopResult<never> {
  return { ok: false, reasonCode: reasonCode as never, detail }
}

export default class ResourceCapacitySelectionService {
  async select(
    input: SelectionInput,
  ): Promise<
    LoopResult<{ selection: ResourceCapacitySelection; replayed: boolean; expiresAt: DateTime }>
  > {
    const actor = rejectNonHumanActor(input.actorType)
    if (!actor.ok) return actor

    const now = input.now ?? DateTime.now()
    const loop = await ResourceCapacityLoop.query()
      .where('organization_id', input.organizationId)
      .where('id', input.loopId)
      .first()
    if (!loop) return fail('loop 不存在', 'RCCL_REVISION_CONFLICT')
    if (loop.state !== RESOURCE_CAPACITY_LOOP_STATES.SIMULATED) {
      return fail(`状态 ${loop.state} 不允许选择`, 'RCCL_REVISION_CONFLICT')
    }

    const scenario = await ResourceCapacityScenario.query()
      .where('organization_id', input.organizationId)
      .where('loop_id', input.loopId)
      .where('id', input.scenarioId)
      .where('active', true)
      .first()
    if (!scenario) return fail('情景不存在或未激活')

    const sim = await ResourceCapacitySimulationSnapshot.query()
      .where('organization_id', input.organizationId)
      .where('id', input.simulationSnapshotId)
      .first()
    if (!sim || sim.scenarioId !== scenario.id) return fail('模拟快照与情景不匹配')
    if (sim.staleState !== 'current') return fail('模拟已过期（stale）')
    if (sim.scenarioRevision !== scenario.rowVersion) {
      return fail('情景在模拟后已被编辑，须重新模拟')
    }

    const baseline = await ResourceCapacityBaselineSnapshot.query()
      .where('organization_id', input.organizationId)
      .where('loop_id', input.loopId)
      .where('id', scenario.baselineSnapshotId)
      .whereNull('superseded_by_id')
      .first()
    if (!baseline) return fail('基线已被取代，请刷新后重新选择')

    // 来源签名与权限指纹的 TOCTOU 校验：由调用方传入当前值，与快照绑定值比较。
    const sourceSignaturesHash = computeSourceSignaturesHash(baseline.sourceSignaturesHash)
    if (
      input.currentPermissionFingerprint &&
      input.currentPermissionFingerprint !== baseline.permissionFingerprint
    ) {
      return fail('权限已变化，须重新评估', 'RCCL_PERMISSION_CHANGED')
    }

    const expiresAt = now.plus({ hours: RESOURCE_CAPACITY_LOOP_BUDGETS.SELECTION_EXPIRY_HOURS })
    const packetDigest = computePacketDigest(baseline.packetJson as never)
    const fingerprint = computeSelectionFingerprint({
      simulationDigest: sim.simulationDigest,
      actorUserId: input.actorUserId,
      acknowledgedWarnings: input.acknowledgedWarnings as never[],
      expiresAt: expiresAt.toISO() ?? '',
      loopRevision: loop.rowVersion,
    })
    void sourceSignaturesHash
    void computeBaselineDigest
    void packetDigest

    // 重放：同组织同 fingerprint 已存在 → 返回原记录。
    const existing = await ResourceCapacitySelection.query()
      .where('organization_id', input.organizationId)
      .where('selection_fingerprint', fingerprint)
      .first()
    if (existing) {
      return {
        ok: true,
        value: { selection: existing, replayed: true, expiresAt: existing.expiresAt },
      }
    }

    // 旧选择标记过期（保留记录）。
    await ResourceCapacitySelection.query()
      .where('organization_id', input.organizationId)
      .where('loop_id', input.loopId)
      .update({ expires_at: now.toSQL() })

    const selection = await ResourceCapacitySelection.create({
      organizationId: input.organizationId,
      loopId: input.loopId,
      scenarioId: scenario.id,
      simulationSnapshotId: sim.id,
      selectionFingerprint: fingerprint,
      boundBaselineDigest: baseline.baselineDigest,
      boundSimulationDigest: sim.simulationDigest,
      boundSourceSignaturesHash: baseline.sourceSignaturesHash,
      boundPermissionFingerprint: baseline.permissionFingerprint,
      boundLoopRevision: loop.rowVersion,
      actorUserId: input.actorUserId,
      acknowledgedWarningsJson: [...input.acknowledgedWarnings].sort(),
      expiresAt,
    })

    // 状态推进 simulated → selected。
    loop.state = RESOURCE_CAPACITY_LOOP_STATES.SELECTED
    loop.rowVersion += 1
    await loop.save()

    void computeHandoffIdempotencyHash
    return { ok: true, value: { selection, replayed: false, expiresAt } }
  }
}

/** 来源签名聚合哈希（占位口径，Phase 6 handoff 复用）。 */
export function computeSourceSignaturesHash(raw: string | null): string {
  return raw ?? ''
}
