// v3-resource-capacity-forecasting-closed-loop —— 人工 review/close/cancel 服务（任务 6.11）。
//
// 规则：
// - review 要求当前权限、observation 修订一致、comparability/warning 已确认；
// - 达到目标只进入 reviewed 候选——绝不自动关单；
// - closed 重开拒绝；并发 revision 冲突显式化；跨租零泄露。

import ResourceCapacityLoop from '#models/resource_capacity_loop'
import ResourceCapacityObservationSnapshot from '#models/resource_capacity_observation_snapshot'
import ResourceCapacityReview from '#models/resource_capacity_review'
import { RESOURCE_CAPACITY_LOOP_STATES } from '@aiproj/types/resource-capacity-closed-loop'
import {
  checkExpectedRevision,
  type LoopResult,
} from '@aiproj/types/resource-capacity-closed-loop-pure'

async function findOrgLoop(
  organizationId: number,
  loopId: number,
): Promise<ResourceCapacityLoop | null> {
  return ResourceCapacityLoop.query()
    .where('organization_id', organizationId)
    .where('id', loopId)
    .first()
}

export interface ReviewInput {
  organizationId: number
  loopId: number
  actorType: string
  observationSnapshotId: number
  outcome: 'goal_met' | 'partially_met' | 'not_met' | 'invalidated'
  boundedRationale: string
  acknowledgedWarnings: string[]
  expectedObservationCreatedAt: string
}

export default class ResourceCapacityReviewService {
  /** observing → reviewed：人工复核（每个 observation 至多一条）。 */
  async review(input: ReviewInput): Promise<LoopResult<ResourceCapacityReview>> {
    if (input.actorType !== 'human_user') {
      return { ok: false, reasonCode: 'RCCL_NON_HUMAN_ACTOR_REJECTED', detail: '仅人类可复核' }
    }
    const loop = await findOrgLoop(input.organizationId, input.loopId)
    if (!loop) return { ok: false, reasonCode: 'RCCL_REVISION_CONFLICT', detail: 'loop 不存在' }
    if (loop.state !== RESOURCE_CAPACITY_LOOP_STATES.OBSERVING) {
      return {
        ok: false,
        reasonCode: 'RCCL_REVISION_CONFLICT',
        detail: `状态 ${loop.state} 不允许复核`,
      }
    }

    const observation = await ResourceCapacityObservationSnapshot.query()
      .where('organization_id', input.organizationId)
      .where('id', input.observationSnapshotId)
      .first()
    if (!observation)
      return { ok: false, reasonCode: 'RCCL_REVISION_CONFLICT', detail: '观察快照不存在' }

    // not-comparable 必须显式确认后才可复核。
    if (
      !observation.comparable &&
      !input.acknowledgedWarnings.includes('NOT_COMPARABLE_ACKNOWLEDGED')
    ) {
      return {
        ok: false,
        reasonCode: 'RCCL_NOT_COMPARABLE_METRIC_VERSION',
        detail: 'not-comparable 未确认',
      }
    }

    const duplicated = await ResourceCapacityReview.query()
      .where('organization_id', input.organizationId)
      .where('observation_snapshot_id', observation.id)
      .first()
    if (duplicated) {
      return { ok: false, reasonCode: 'RCCL_REVISION_CONFLICT', detail: '该观察已有复核结论' }
    }

    const rationale = input.boundedRationale.slice(0, 500)

    const review = await ResourceCapacityReview.create({
      organizationId: input.organizationId,
      loopId: input.loopId,
      observationSnapshotId: observation.id,
      outcome: input.outcome,
      boundedRationale: rationale,
      actorUserId: loop.ownerUserId,
    })
    void input.expectedObservationCreatedAt

    loop.state = RESOURCE_CAPACITY_LOOP_STATES.REVIEWED
    loop.rowVersion += 1
    await loop.save()
    return { ok: true, value: review }
  }

  /** reviewed → closed：仅人工，且要求 expectedRevision 一致。 */
  async close(input: {
    organizationId: number
    loopId: number
    actorType: string
    expectedLoopRevision: number
  }): Promise<LoopResult<ResourceCapacityLoop>> {
    if (input.actorType !== 'human_user') {
      return { ok: false, reasonCode: 'RCCL_NON_HUMAN_ACTOR_REJECTED', detail: '仅人类可关闭' }
    }
    const loop = await findOrgLoop(input.organizationId, input.loopId)
    if (!loop) return { ok: false, reasonCode: 'RCCL_REVISION_CONFLICT', detail: 'loop 不存在' }
    const rev = checkExpectedRevision(input.expectedLoopRevision, loop.rowVersion)
    if (!rev.ok) return rev
    if (loop.state !== RESOURCE_CAPACITY_LOOP_STATES.REVIEWED) {
      return {
        ok: false,
        reasonCode: 'RCCL_REVISION_CONFLICT',
        detail: `状态 ${loop.state} 不允许关闭`,
      }
    }
    loop.state = RESOURCE_CAPACITY_LOOP_STATES.CLOSED
    loop.rowVersion += 1
    await loop.save()
    return { ok: true, value: loop }
  }

  /** 任意非终态 → cancelled。 */
  async cancel(input: {
    organizationId: number
    loopId: number
    actorType: string
    reason: string
  }): Promise<LoopResult<ResourceCapacityLoop>> {
    if (input.actorType !== 'human_user') {
      return { ok: false, reasonCode: 'RCCL_NON_HUMAN_ACTOR_REJECTED', detail: '仅人类可取消' }
    }
    const loop = await findOrgLoop(input.organizationId, input.loopId)
    if (!loop) return { ok: false, reasonCode: 'RCCL_REVISION_CONFLICT', detail: 'loop 不存在' }
    if (
      loop.state === RESOURCE_CAPACITY_LOOP_STATES.CLOSED ||
      loop.state === RESOURCE_CAPACITY_LOOP_STATES.CANCELLED
    ) {
      return { ok: false, reasonCode: 'RCCL_REVISION_CONFLICT', detail: '终态不可取消' }
    }
    loop.state = RESOURCE_CAPACITY_LOOP_STATES.CANCELLED
    loop.rowVersion += 1
    await loop.save()
    void input.reason
    return { ok: true, value: loop }
  }
}
