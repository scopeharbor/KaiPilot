// v3-resource-capacity-forecasting-closed-loop —— 情景 CRUD 服务（任务 5.1）。
//
// 规则：
// - 每 loop 情景数 2–5（创建上限 5，模拟时校验下限 2）；
// - 封闭 overlay union 校验（复用 @aiproj/types 纯函数，隐藏 ref 一律拒绝）；
// - 所有 mutation 走 expectedRevision 乐观锁；
// - 必须绑定当前未取代的 baseline 快照；终态/取消后禁止修改；
// - 全部查询强制组织过滤。

import ResourceCapacityLoop from '#models/resource_capacity_loop'
import ResourceCapacityBaselineSnapshot from '#models/resource_capacity_baseline_snapshot'
import ResourceCapacityScenario from '#models/resource_capacity_scenario'
import {
  RESOURCE_CAPACITY_LOOP_BUDGETS,
  RESOURCE_CAPACITY_LOOP_STATES,
} from '@aiproj/types/resource-capacity-closed-loop'
import {
  checkExpectedRevision,
  evaluateLoopTransition,
  isTerminalLoopState,
  type LoopResult,
} from '@aiproj/types/resource-capacity-closed-loop-pure'
import {
  validateOverlays,
  type OverlayValidationContext,
} from '@aiproj/types/resource-capacity-closed-loop-pure'

export interface ScenarioAuthzContext extends OverlayValidationContext {}

/** 组织内取 loop，跨租返回 null（无存在泄露）。 */
async function findOrgLoop(
  organizationId: number,
  loopId: number,
): Promise<ResourceCapacityLoop | null> {
  return ResourceCapacityLoop.query()
    .where('organization_id', organizationId)
    .where('id', loopId)
    .first()
}

async function currentBaseline(organizationId: number, loopId: number) {
  return ResourceCapacityBaselineSnapshot.query()
    .where('organization_id', organizationId)
    .where('loop_id', loopId)
    .whereNull('superseded_by_id')
    .orderBy('created_at', 'desc')
    .first()
}

function scenarioMutationAllowed(state: string): boolean {
  return (
    state === RESOURCE_CAPACITY_LOOP_STATES.DRAFT ||
    state === RESOURCE_CAPACITY_LOOP_STATES.SIMULATED
  )
}

export default class ResourceCapacityScenarioService {
  async createScenario(input: {
    organizationId: number
    loopId: number
    actorUserId: number
    name: string
    overlays: unknown[]
    expectedLoopRevision: number
    authz: ScenarioAuthzContext
  }): Promise<LoopResult<ResourceCapacityScenario>> {
    const loop = await findOrgLoop(input.organizationId, input.loopId)
    if (!loop) return { ok: false, reasonCode: 'RCCL_REVISION_CONFLICT', detail: 'loop 不存在' }

    if (!scenarioMutationAllowed(loop.state)) {
      const t = evaluateLoopTransition({
        from: loop.state as never,
        to: RESOURCE_CAPACITY_LOOP_STATES.SIMULATED,
      })
      void t
      return {
        ok: false,
        reasonCode: 'RCCL_REVISION_CONFLICT',
        detail: `状态 ${loop.state} 不允许修改情景`,
      }
    }
    const rev = checkExpectedRevision(input.expectedLoopRevision, loop.rowVersion)
    if (!rev.ok) return rev

    const baseline = await currentBaseline(input.organizationId, input.loopId)
    if (!baseline || !baseline.readyForSimulation) {
      return { ok: false, reasonCode: 'RCCL_SOURCE_STALE', detail: '缺少可用的当前基线' }
    }

    const countRows = await ResourceCapacityScenario.query()
      .where('organization_id', input.organizationId)
      .where('loop_id', input.loopId)
      .where('active', true)
      .count('* as total')
    const activeCount = Number(countRows[0]?.$extras?.total ?? 0)
    if (activeCount >= RESOURCE_CAPACITY_LOOP_BUDGETS.MAX_SCENARIOS) {
      return { ok: false, reasonCode: 'RCCL_PAYLOAD_TOO_LARGE', detail: '情景数已达上限 5' }
    }

    const overlays = validateOverlays(input.overlays, input.authz)
    if (!overlays.ok) return overlays

    const exists = await ResourceCapacityScenario.query()
      .where('organization_id', input.organizationId)
      .where('loop_id', input.loopId)
      .where('name', input.name)
      .first()
    if (exists) return { ok: false, reasonCode: 'RCCL_REVISION_CONFLICT', detail: '同名情景已存在' }

    const scenario = await ResourceCapacityScenario.create({
      organizationId: input.organizationId,
      loopId: input.loopId,
      baselineSnapshotId: baseline.id,
      name: input.name,
      overlaysJson: overlays.value,
      rowVersion: 1,
      active: true,
    })

    // loop 保持状态机推进：draft → simulated（有可用基线且已有情景即视为可模拟准备态）。
    if (loop.state === RESOURCE_CAPACITY_LOOP_STATES.DRAFT) {
      loop.state = RESOURCE_CAPACITY_LOOP_STATES.SIMULATED
      loop.rowVersion += 1
      await loop.save()
    }
    return { ok: true, value: scenario }
  }

  async updateOverlays(input: {
    organizationId: number
    loopId: number
    scenarioId: number
    overlays: unknown[]
    expectedScenarioRevision: number
    authz: ScenarioAuthzContext
  }): Promise<LoopResult<ResourceCapacityScenario>> {
    const loop = await findOrgLoop(input.organizationId, input.loopId)
    if (!loop) return { ok: false, reasonCode: 'RCCL_REVISION_CONFLICT', detail: 'loop 不存在' }
    if (!scenarioMutationAllowed(loop.state)) {
      return {
        ok: false,
        reasonCode: 'RCCL_REVISION_CONFLICT',
        detail: `状态 ${loop.state} 不允许修改情景`,
      }
    }
    if (isTerminalLoopState(loop.state as never)) {
      return { ok: false, reasonCode: 'RCCL_REVISION_CONFLICT', detail: '终态不可修改' }
    }

    const scenario = await ResourceCapacityScenario.query()
      .where('organization_id', input.organizationId)
      .where('loop_id', input.loopId)
      .where('id', input.scenarioId)
      .first()
    if (!scenario) return { ok: false, reasonCode: 'RCCL_REVISION_CONFLICT', detail: '情景不存在' }

    const rev = checkExpectedRevision(input.expectedScenarioRevision, scenario.rowVersion)
    if (!rev.ok) return rev

    // 编辑后重绑当前 baseline：若 baseline 已换代则要求先 refresh。
    const baseline = await currentBaseline(input.organizationId, input.loopId)
    if (!baseline || baseline.id !== scenario.baselineSnapshotId) {
      return { ok: false, reasonCode: 'RCCL_SOURCE_STALE', detail: '情景绑定的基线已被取代' }
    }

    const overlays = validateOverlays(input.overlays, input.authz)
    if (!overlays.ok) return overlays

    scenario.overlaysJson = overlays.value
    scenario.rowVersion += 1
    await scenario.save()
    return { ok: true, value: scenario }
  }

  /** 删除为软删（active=false），保留审计追溯。 */
  async deactivateScenario(input: {
    organizationId: number
    loopId: number
    scenarioId: number
    expectedScenarioRevision: number
  }): Promise<LoopResult<boolean>> {
    const loop = await findOrgLoop(input.organizationId, input.loopId)
    if (!loop) return { ok: false, reasonCode: 'RCCL_REVISION_CONFLICT', detail: 'loop 不存在' }
    if (!scenarioMutationAllowed(loop.state)) {
      return {
        ok: false,
        reasonCode: 'RCCL_REVISION_CONFLICT',
        detail: `状态 ${loop.state} 不允许删除情景`,
      }
    }
    const scenario = await ResourceCapacityScenario.query()
      .where('organization_id', input.organizationId)
      .where('loop_id', input.loopId)
      .where('id', input.scenarioId)
      .first()
    if (!scenario) return { ok: false, reasonCode: 'RCCL_REVISION_CONFLICT', detail: '情景不存在' }
    const rev = checkExpectedRevision(input.expectedScenarioRevision, scenario.rowVersion)
    if (!rev.ok) return rev

    scenario.active = false
    scenario.rowVersion += 1
    await scenario.save()
    return { ok: true, value: true }
  }
}
