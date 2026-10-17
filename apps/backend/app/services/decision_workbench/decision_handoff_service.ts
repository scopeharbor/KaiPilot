import { inject } from '@adonisjs/core'
import {
  ConflictException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import type User from '#models/user'
import PmoDecisionCase from '#models/pmo_decision_case'
import PmoDecisionOutcome from '#models/pmo_decision_outcome'
import PmoDecisionHandoffReceipt from '#models/pmo_decision_handoff_receipt'
import AuditService from '#services/audit_service'
import DecisionWorkbenchPolicy from '#policies/decision_workbench_policy'
import {
  decisionHandoffCreatedAudit,
  decisionHandoffFailedAudit,
  decisionHandoffReplayedAudit,
} from './decision_workbench_audit.js'
import {
  PMO_DECISION_HANDOFF_TARGETS,
  isPmoDecisionHandoffTarget,
  normalizePmoDecisionIdempotencyKey,
  pmoDecisionStableHash,
  type PmoDecisionHandoffReceiptDTO,
  type PmoDecisionHandoffStatus,
  type PmoDecisionHandoffTarget,
} from '@aiproj/types'

/**
 * v3-pmo-decision-intelligence-workbench —— 受控 handoff 与幂等 receipt
 * （tasks 7.1–7.5，design D5）。
 *
 * 红线：
 *   - 目标闭集（registry）：navigation / priority_review_intent / allocation_draft /
 *     risk_change_review_draft / plugin_action_proposal；未知 target fail closed。
 *   - 只有 decided case + selected option（如适用）+ 现有 outcome 可交接；
 *     权限变化 / 缺结论 fail closed。
 *   - 只产生 pending 下游 draft/preview 引用：不调用 confirm/apply、不写任何正式
 *     业务表、不自动接受推荐或保存排序。
 *   - 幂等键唯一：同键同 payload 返回既有 receipt；同键异 payload 冲突拒绝。
 */

export interface HandoffRequestInput {
  caseId: number
  target: string
  idempotencyKey: string
}

/** 闭集 registry：target → eligibility 描述。 */
const HANDOFF_REGISTRY: Readonly<
  Record<
    PmoDecisionHandoffTarget,
    { requiresSelectedOption: boolean; downstreamCapability: string }
  >
> = {
  [PMO_DECISION_HANDOFF_TARGETS.NAVIGATION]: {
    requiresSelectedOption: false,
    downstreamCapability: 'navigation',
  },
  [PMO_DECISION_HANDOFF_TARGETS.PRIORITY_REVIEW_INTENT]: {
    requiresSelectedOption: true,
    downstreamCapability: 'pmo-ai-priority-recommendations',
  },
  [PMO_DECISION_HANDOFF_TARGETS.ALLOCATION_DRAFT]: {
    requiresSelectedOption: true,
    downstreamCapability: 'cross-project-resource-allocation',
  },
  [PMO_DECISION_HANDOFF_TARGETS.RISK_CHANGE_REVIEW_DRAFT]: {
    requiresSelectedOption: false,
    downstreamCapability: 'change-management',
  },
  [PMO_DECISION_HANDOFF_TARGETS.PLUGIN_ACTION_PROPOSAL]: {
    requiresSelectedOption: false,
    downstreamCapability: 'plugin-action-preview-boundary',
  },
}

export function listRegisteredTargets(): PmoDecisionHandoffTarget[] {
  return Object.keys(HANDOFF_REGISTRY) as PmoDecisionHandoffTarget[]
}

@inject()
export default class DecisionHandoffService {
  constructor(
    private readonly policy: DecisionWorkbenchPolicy,
    private readonly audit: AuditService,
  ) {}

  async create(
    user: User,
    organizationId: number,
    input: HandoffRequestInput,
  ): Promise<PmoDecisionHandoffReceiptDTO> {
    await this.policy.authorizeHandoff(user, organizationId)

    if (!isPmoDecisionHandoffTarget(input.target)) {
      throw new ValidationException('未知 handoff 目标', { code: 'UNKNOWN_TARGET' })
    }
    const target = input.target
    const spec = HANDOFF_REGISTRY[target]
    const idempotencyKey = normalizePmoDecisionIdempotencyKey(input.idempotencyKey)
    if (!idempotencyKey) {
      throw new ValidationException('幂等键不能为空', { code: 'IDEMPOTENCY_KEY_REQUIRED' })
    }

    const parent = await PmoDecisionCase.query()
      .where('organizationId', organizationId)
      .where('id', input.caseId)
      .first()
    if (!parent) throw new ResourceNotFoundException('资源不存在')
    if (parent.status !== 'decided') {
      throw new ValidationException('仅 decided 议题可创建 handoff', { code: 'CASE_NOT_DECIDED' })
    }

    const outcome = await PmoDecisionOutcome.query()
      .where('organizationId', organizationId)
      .where('caseId', input.caseId)
      .orderBy('id', 'desc')
      .first()
    if (!outcome || outcome.action !== 'approve') {
      throw new ValidationException('缺少 approve 结论，无法交接', { code: 'OUTCOME_MISSING' })
    }
    if (spec.requiresSelectedOption && !outcome.selectedOptionId) {
      throw new ValidationException('该目标要求 approve 时选中方案', {
        code: 'SELECTED_OPTION_REQUIRED',
      })
    }

    const requestHash = pmoDecisionStableHash(
      JSON.stringify({
        org: organizationId,
        caseId: input.caseId,
        outcomeDigest: outcome.outcomeDigest,
        target,
        option: outcome.selectedOptionId,
        actor: user.id,
      }),
    )

    // 幂等查找：同键同 payload → replayed；同键异 payload → conflict。
    const existing = await PmoDecisionHandoffReceipt.query()
      .where('organizationId', organizationId)
      .where('caseId', input.caseId)
      .where('target', target)
      .where('idempotencyKey', idempotencyKey)
      .first()
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException('幂等键冲突：同键不同 payload', {
          code: 'IDEMPOTENCY_CONFLICT',
        })
      }
      existing.status = 'replayed' as PmoDecisionHandoffStatus
      await existing.save()
      await this.audit.log(
        decisionHandoffReplayedAudit({
          organizationId,
          actorId: user.id,
          caseId: input.caseId,
          handoffTarget: target,
          idempotencyKey,
        }),
      )
      return this.toDTO(existing)
    }

    const pendingRef = this.buildPendingTargetRef(
      target,
      organizationId,
      input.caseId,
      outcome.selectedOptionId,
    )
    try {
      const row = await PmoDecisionHandoffReceipt.create({
        organizationId,
        caseId: input.caseId,
        target,
        idempotencyKey,
        requestHash,
        resultHash: null,
        status: 'pending',
        pendingTargetRef: pendingRef,
        failReasonCode: null,
        actorId: user.id,
      } as never)
      await this.audit.log(
        decisionHandoffCreatedAudit({
          organizationId,
          actorId: user.id,
          caseId: input.caseId,
          handoffTarget: target,
          idempotencyKey,
        }),
      )
      return this.toDTO(row)
    } catch {
      await this.audit.log(
        decisionHandoffFailedAudit({
          organizationId,
          actorId: user.id,
          caseId: input.caseId,
          handoffTarget: target,
          reasonCode: 'TARGET_UNAVAILABLE',
        }),
      )
      throw new ValidationException('下游目标暂不可用', { code: 'TARGET_UNAVAILABLE' })
    }
  }

  async listReceipts(
    organizationId: number,
    caseId: number,
  ): Promise<PmoDecisionHandoffReceiptDTO[]> {
    const parent = await PmoDecisionCase.query()
      .where('organizationId', organizationId)
      .where('id', caseId)
      .first()
    if (!parent) throw new ResourceNotFoundException('资源不存在')
    const rows = await PmoDecisionHandoffReceipt.query()
      .where('organizationId', organizationId)
      .where('caseId', caseId)
      .orderBy('id', 'asc')
    return rows.map(this.toDTO)
  }

  /**
   * pending 引用只指向既有授权入口（前端路由），由用户显式打开；
   * 不包含任何 token/handle，也不预执行下游动作。
   */
  private buildPendingTargetRef(
    target: PmoDecisionHandoffTarget,
    organizationId: number,
    caseId: number,
    optionId: number | null,
  ): string {
    switch (target) {
      case PMO_DECISION_HANDOFF_TARGETS.NAVIGATION:
        return '/pmo/decisions'
      case PMO_DECISION_HANDOFF_TARGETS.PRIORITY_REVIEW_INTENT:
        return `/pmo/recommendations?org=${organizationId}&from=decision-${caseId}`
      case PMO_DECISION_HANDOFF_TARGETS.ALLOCATION_DRAFT:
        return `/pmo/allocation?org=${organizationId}&from=decision-${caseId}&option=${optionId ?? ''}`
      case PMO_DECISION_HANDOFF_TARGETS.RISK_CHANGE_REVIEW_DRAFT:
        return `/change-requests?org=${organizationId}&from=decision-${caseId}`
      case PMO_DECISION_HANDOFF_TARGETS.PLUGIN_ACTION_PROPOSAL:
        return `/plugin-actions?org=${organizationId}&from=decision-${caseId}`
    }
  }

  private toDTO(row: PmoDecisionHandoffReceipt): PmoDecisionHandoffReceiptDTO {
    return {
      id: Number(row.id),
      organizationId: row.organizationId,
      caseId: row.caseId,
      target: row.target,
      idempotencyKey: row.idempotencyKey,
      requestHash: row.requestHash,
      resultHash: row.resultHash,
      status: row.status,
      pendingTargetRef: row.pendingTargetRef,
      failReasonCode: row.failReasonCode,
      actorId: row.actorId,
      createdAt: row.createdAt.toISO() ?? '',
      updatedAt: row.updatedAt?.toISO() ?? row.createdAt.toISO() ?? '',
    }
  }
}
