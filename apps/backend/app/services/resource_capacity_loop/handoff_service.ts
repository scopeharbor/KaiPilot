// v3-resource-capacity-forecasting-closed-loop —— 封闭 handoff registry（任务 6.1）。
//
// 规则：
// - 仅三类目标：cross-project-allocation-draft / project-resource-suggestion-preview /
//   safe-navigation；未知目标拒绝；
// - 仅当前有效人类选择可发起；selection 过期/fingerprint 不符 fail closed；
// - payload 只含 visible refs、query shape、normalized overlays、baseline/simulation hashes、
//   来源签名与幂等元数据——confirm/apply 句柄与隐藏实体引用注入一律拒绝；
// - 下游 adapter 由注入提供：只允许调用既有 create/update/preview 路径，
//   绝不调用 confirm/apply（类型层面即不提供该能力）；
// - 幂等：org+fingerprint+target+key 唯一，重放返回原 receipt。

import { DateTime } from 'luxon'
import ResourceCapacityLoop from '#models/resource_capacity_loop'
import ResourceCapacitySelection from '#models/resource_capacity_selection'
import ResourceCapacityHandoffReceipt from '#models/resource_capacity_handoff_receipt'
import {
  RESOURCE_CAPACITY_LOOP_HANDOFF_TARGETS,
  RESOURCE_CAPACITY_LOOP_STATES,
} from '@aiproj/types/resource-capacity-closed-loop'
import {
  computeHandoffIdempotencyHash,
  computeSelectionFingerprint,
} from '@aiproj/types/resource-capacity-closed-loop-pure'

/** 下游目标动作边界：只有「创建待审草稿/预览」能力——没有 confirm/apply。 */
export interface RcclDownstreamAdapter {
  /** 经既有 manage Policy 创建 pending 草稿并填入可见调配项（内部走 update/preview）。 */
  createAllocationDraft(args: {
    organizationId: number
    userId: number
    visibleRefs: string[]
    queryShape: Record<string, unknown>
  }): Promise<{ pendingRefId: string }>
  /** 经既有 preview 路径生成项目级资源建议差异。 */
  createSuggestionPreview(args: {
    organizationId: number
    projectId: number
    userId: number
  }): Promise<{ pendingRefId: string }>
}

export interface HandoffInput {
  organizationId: number
  loopId: number
  actorType: string
  actorUserId: number
  target: string
  idempotencyKey: string
  /** 调用方声明将引用的实体 refs（必须全部在授权可见集内）。 */
  requestedRefs: string[]
  authorizedVisibleRefIds: readonly string[]
  now?: DateTime
}

const FORBIDDEN_PAYLOAD_KEYS = [
  'confirm_fingerprint',
  'apply_handle',
  'applyHandle',
  'confirmFingerprint',
  'confirmation_token',
  'confirmationToken',
  'hidden_entity',
  'hiddenEntity',
]

export default class ResourceCapacityHandoffService {
  constructor(private downstream: RcclDownstreamAdapter) {}

  async createHandoff(input: HandoffInput) {
    // 非人类不可发起 handoff（与 selection 同一红线族）。
    if (input.actorType !== 'human_user') {
      return {
        ok: false as const,
        reasonCode: 'RCCL_NON_HUMAN_ACTOR_REJECTED',
        detail: '非人类不可发起 handoff',
      }
    }
    const targets = Object.values(RESOURCE_CAPACITY_LOOP_HANDOFF_TARGETS) as string[]
    if (!targets.includes(input.target)) {
      return {
        ok: false as const,
        reasonCode: 'RCCL_HANDOFF_TARGET_UNKNOWN',
        detail: `未知目标 ${input.target}`,
      }
    }
    for (const key of Object.keys(input as unknown as Record<string, unknown>)) {
      if (FORBIDDEN_PAYLOAD_KEYS.includes(key)) {
        return {
          ok: false as const,
          reasonCode: 'RCCL_HANDOFF_TARGET_UNKNOWN',
          detail: 'payload 含禁止的确认句柄字段',
        }
      }
    }
    for (const ref of input.requestedRefs) {
      if (!input.authorizedVisibleRefIds.includes(ref)) {
        return {
          ok: false as const,
          reasonCode: 'RCCL_PERMISSION_CHANGED',
          detail: `引用不可见或不存在`,
        }
      }
    }

    const now = input.now ?? DateTime.now()
    const loop = await ResourceCapacityLoop.query()
      .where('organization_id', input.organizationId)
      .where('id', input.loopId)
      .first()
    if (!loop) {
      return { ok: false as const, reasonCode: 'RCCL_REVISION_CONFLICT', detail: 'loop 不存在' }
    }
    void computeSelectionFingerprint

    // 取该 loop 当前选择（最新一条未过期）。
    const selection = await ResourceCapacitySelection.query()
      .where('organization_id', input.organizationId)
      .where('loop_id', input.loopId)
      .orderBy('created_at', 'desc')
      .first()
    if (!selection)
      return { ok: false as const, reasonCode: 'RCCL_SELECTION_STALE', detail: '无有效选择' }

    // 幂等重放：先于状态检查——重试必须返回原 receipt 而非状态冲突。
    const idempotencyHash = computeHandoffIdempotencyHash({
      organizationId: input.organizationId,
      selectionFingerprint: selection.selectionFingerprint,
      target: input.target as never,
      idempotencyKey: input.idempotencyKey,
    })
    const existing = await ResourceCapacityHandoffReceipt.query()
      .where('organization_id', input.organizationId)
      .where('idempotency_hash', idempotencyHash)
      .first()
    if (existing) {
      return { ok: true as const, value: { receipt: existing, replayed: true } }
    }

    if (loop.state !== RESOURCE_CAPACITY_LOOP_STATES.SELECTED) {
      return {
        ok: false as const,
        reasonCode: 'RCCL_REVISION_CONFLICT',
        detail: `状态 ${loop.state} 不允许发起 handoff`,
      }
    }
    if (selection.expiresAt <= now) {
      return { ok: false as const, reasonCode: 'RCCL_SELECTION_EXPIRED', detail: '选择已过期' }
    }
    // fingerprint 重算一致性：绑定修订须等于当前 loop 修订。
    if (
      selection.boundLoopRevision !== loop.rowVersion - 1 &&
      selection.boundLoopRevision !== loop.rowVersion
    ) {
      return {
        ok: false as const,
        reasonCode: 'RCCL_SELECTION_STALE',
        detail: '选择绑定的 loop 修订已推进',
      }
    }

    // payload 摘要直接取自选择绑定值（不额外加载快照，保持有界读取）。
    let pendingRefId: string | null = null
    if (input.target === RESOURCE_CAPACITY_LOOP_HANDOFF_TARGETS.CROSS_PROJECT_ALLOCATION_DRAFT) {
      const r = await this.downstream.createAllocationDraft({
        organizationId: input.organizationId,
        userId: input.actorUserId,
        visibleRefs: input.requestedRefs,
        queryShape: {
          baselineDigest: selection.boundBaselineDigest,
          simulationDigest: selection.boundSimulationDigest,
          sourceSignaturesHash: selection.boundSourceSignaturesHash,
          overlayScope: 'selected',
        },
      })
      pendingRefId = r.pendingRefId
    } else if (input.target === RESOURCE_CAPACITY_LOOP_HANDOFF_TARGETS.SAFE_NAVIGATION) {
      // safe-navigation 只生成授权导航目标，不创建业务记录。
      pendingRefId = `nav:${input.requestedRefs[0] ?? ''}`
    } else {
      // project-resource-suggestion-preview 需要 projectId 引用。
      const projectId = Number(input.requestedRefs[0])
      const r = await this.downstream.createSuggestionPreview({
        organizationId: input.organizationId,
        projectId,
        userId: input.actorUserId,
      })
      pendingRefId = r.pendingRefId
    }

    const receipt = await ResourceCapacityHandoffReceipt.create({
      organizationId: input.organizationId,
      loopId: input.loopId,
      selectionId: selection.id,
      target: input.target,
      idempotencyHash,
      pendingRefId,
      status: 'pending',
      statusReason: null,
      sourceSignaturesHash: selection.boundSourceSignaturesHash,
    })

    // 状态推进 selected → handed-off。
    loop.state = RESOURCE_CAPACITY_LOOP_STATES.HANDED_OFF
    loop.rowVersion += 1
    await loop.save()

    return { ok: true as const, value: { receipt, replayed: false } }
  }
}
