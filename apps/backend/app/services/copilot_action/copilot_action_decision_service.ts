/**
 * v3-copilot-action-and-preview-boundary —— CopilotActionDecisionService（任务 4.1/5.4/5.7/7.x 组装）。
 *
 * 薄组装层：确认请求到达后**服务端复核**（组织/权限/stale/diff 一致/dry-run，任务 4.1 服务端复核），
 * 幂等重放与有界重试，然后把 Copilot 单条/批量决策翻译为既有 draft_layer 决策服务调用
 * （复用既有端点语义；modify 携带 userModifiedValue/userNote，落五态 modified 而非 accepted），
 * 全程低敏审计（含越权尝试与 stale 阻断，不泄露隐藏实体）。
 * **只组合既有 draft_layer service + 草案层模型 + 审计**，不引入任何领域写入 API。
 */
import { inject } from '@adonisjs/core'
import {
  DraftLayerDecisionService,
  DecisionValidationError,
} from '#services/draft_layer/decision_service'
import AuditService, { AuditEvent } from '#services/audit_service'
import type {
  CopilotActionConfirmationResult,
  CopilotActionDecisionKind,
  CopilotActionSourceSignature,
} from '@aiproj/types'
import {
  assembleCopilotBulkResult,
  evaluateCopilotBoundedRetry,
  evaluateCopilotBulkItemOutcome,
  mapCopilotDecisionToReviewStatus,
  type CopilotBulkItemEvaluationInput,
} from './decision_translation_core.js'
import {
  evaluateCopilotConfirmationPreflight,
  evaluateCopilotIdempotencyReplay,
} from './confirmation_validator_core.js'

export class CopilotDecisionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CopilotDecisionError'
  }
}

export interface CopilotDecisionParams {
  readonly sessionId: number
  readonly organizationId: number
  readonly userId: number
  readonly actionCardId: string
  readonly changeId: number
  readonly decision: CopilotActionDecisionKind
  readonly userModifiedValue?: unknown
  readonly userNote?: string
  readonly requiredPermissions: readonly string[]
  readonly actorPermissions: readonly string[]
  readonly requestSources: readonly CopilotActionSourceSignature[]
  readonly recordedSources: readonly CopilotActionSourceSignature[]
  readonly confirmedTargetRefs: readonly string[]
  readonly writeTargetRefs: readonly string[]
  readonly dryRunCanApply: boolean
  readonly idempotencyKey: string
  readonly existingResultIdempotencyKey: string | null
  readonly attempt?: number
  readonly maxRetries?: number
}

@inject()
export class CopilotActionDecisionService {
  constructor(
    private readonly draftDecision: DraftLayerDecisionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * 单条决策：确认前服务端复核（组织/权限/stale/diff/dry-run）→ 幂等重放 →
   * 有界重试 → 翻译为既有 draft_layer 决策调用 → 低敏审计（拒绝/修改/确认/stale/越权全覆盖）。
   */
  async decide(params: CopilotDecisionParams): Promise<CopilotActionConfirmationResult> {
    const preflight = evaluateCopilotConfirmationPreflight({
      actorOrganizationId: params.organizationId,
      actionOrganizationId: params.organizationId,
      requiredPermissions: params.requiredPermissions,
      actorPermissions: params.actorPermissions,
      requestSources: params.requestSources,
      recordedSources: params.recordedSources,
      confirmedTargetRefs: params.confirmedTargetRefs,
      writeTargetRefs: params.writeTargetRefs,
      dryRunCanApply: params.dryRunCanApply,
    })

    // 越权尝试（权限不足/跨组织）落审计，且不泄露隐藏实体标题与 ID
    if (preflight.status === 'permission_denied' || preflight.status === 'organization_denied') {
      await this.audit.log({
        event: AuditEvent.COPILOT_ACTION_DENIED,
        organizationId: params.organizationId,
        userId: params.userId,
        metadata: {
          actionCardId: params.actionCardId,
          reason: preflight.status,
          idempotencyKey: params.idempotencyKey,
        },
      })
      return {
        status: 'permission_denied',
        idempotencyKey: params.idempotencyKey,
        message: preflight.message,
      }
    }

    // stale 阻断落审计（只记失配计数，不泄露来源内容）
    if (preflight.status === 'stale_blocked') {
      await this.audit.log({
        event: AuditEvent.COPILOT_ACTION_STALE_BLOCKED,
        organizationId: params.organizationId,
        userId: params.userId,
        metadata: {
          actionCardId: params.actionCardId,
          mismatchedCount: preflight.revalidation?.mismatchedIndexes.length ?? 0,
          idempotencyKey: params.idempotencyKey,
        },
      })
      return {
        status: 'stale_blocked',
        idempotencyKey: params.idempotencyKey,
        message: preflight.message,
      }
    }

    if (preflight.status === 'diff_mismatch' || preflight.status === 'dry_run_failed') {
      return {
        status: preflight.status === 'dry_run_failed' ? 'dry_run_failed' : 'partial_failure',
        idempotencyKey: params.idempotencyKey,
        message: preflight.message,
      }
    }

    // 幂等重放：同派生键 + 来源未变 → 返回既有结果，不重复写入
    const replay = evaluateCopilotIdempotencyReplay({
      requestIdempotencyKey: params.idempotencyKey,
      existingResultIdempotencyKey: params.existingResultIdempotencyKey,
      requestSources: params.requestSources,
      existingSources: params.recordedSources,
    })
    if (replay.replay) {
      return {
        status: 'idempotent_replay',
        idempotencyKey: params.idempotencyKey,
        message: replay.reason ?? '已处理过',
      }
    }

    // 有界重试：attempt ≤ maxRetries+1 且来源 fresh（重试仍受幂等与 hash 重校验约束）
    const retry = evaluateCopilotBoundedRetry({
      attempt: params.attempt ?? 1,
      maxAttempts: (params.maxRetries ?? 1) + 1,
      sourceFresh: true,
    })
    if (!retry.allowed) {
      return {
        status: 'partial_failure',
        idempotencyKey: params.idempotencyKey,
        message: retry.reason ?? '重试受限',
      }
    }

    try {
      // 翻译为既有草案层决策：modify 必须携带用户修改值与备注（decision_service 强制）
      const result = await this.draftDecision.decide(
        params.sessionId,
        params.changeId,
        params.organizationId,
        mapCopilotDecisionToReviewStatus(params.decision),
        params.decision === 'modify' ? params.userModifiedValue : undefined,
        params.decision === 'modify' ? params.userNote : undefined,
      )
      void result.selectionHash

      const status = mapCopilotDecisionToReviewStatus(params.decision)
      const event =
        status === 'rejected'
          ? AuditEvent.COPILOT_ACTION_REJECTED
          : status === 'modified'
            ? AuditEvent.COPILOT_ACTION_MODIFIED
            : AuditEvent.COPILOT_ACTION_DECIDED

      await this.audit.log({
        event,
        organizationId: params.organizationId,
        userId: params.userId,
        metadata: {
          actionCardId: params.actionCardId,
          changeId: params.changeId,
          decision: params.decision,
          status,
          idempotencyKey: params.idempotencyKey,
          sourceHashPrefixes: params.requestSources.map((s) => s.contentHash.slice(0, 8)),
        },
      })

      return {
        status,
        idempotencyKey: params.idempotencyKey,
        message:
          status === 'accepted'
            ? '已按原样接受'
            : status === 'modified'
              ? '已按修改后的值记录（修改后应用）'
              : status === 'rejected'
                ? '已放弃该建议'
                : '已跳过该建议',
      }
    } catch (error) {
      if (error instanceof DecisionValidationError) {
        await this.audit.log({
          event: AuditEvent.COPILOT_ACTION_APPLY_PARTIAL_FAILED,
          organizationId: params.organizationId,
          userId: params.userId,
          metadata: {
            actionCardId: params.actionCardId,
            changeId: params.changeId,
            idempotencyKey: params.idempotencyKey,
          },
        })
        return {
          status: 'partial_failure',
          idempotencyKey: params.idempotencyKey,
          failedChangeIds: [params.changeId],
          message: error.message,
        }
      }
      throw error
    }
  }

  /**
   * 批量决策：逐条 preflight（权限/stale/dry-run）→ 对通过项逐条翻译为既有决策服务调用
   * （复用既有 decide 语义；批量由既有 bulk-decisions 端点承载，仅接受/拒绝/跳过），
   * 失败项逐条报告结局，不整批静默通过。返回含 fullyApplied 的逐条结果。
   */
  async bulkDecide(params: {
    readonly organizationId: number
    readonly userId: number
    readonly sessionId: number
    readonly items: readonly CopilotBulkItemEvaluationInput[]
    readonly perItemChangeIds: ReadonlyMap<string, number>
  }): Promise<ReturnType<typeof assembleCopilotBulkResult>> {
    // 批量仅接受/拒绝/跳过（spec Requirement 6）；modify 必须逐条处理
    const results = params.items.map((item) => {
      if (item.decision === 'modify') {
        return {
          actionCardId: item.actionCardId,
          permission: item.permissionGranted ? ('granted' as const) : ('denied' as const),
          stale: item.stale ? ('stale' as const) : ('fresh' as const),
          outcome: 'failed' as const,
          message: '修改决策不支持批量，请逐条处理',
        }
      }
      return evaluateCopilotBulkItemOutcome(item)
    })

    // 仅对通过校验的项逐条落既有决策服务（不重复实现既有批量更新逻辑）
    let passed = 0
    let failed = 0
    for (const item of params.items) {
      const outcome = evaluateCopilotBulkItemOutcome(item)
      if (outcome.outcome === 'applied') {
        const changeId = params.perItemChangeIds.get(item.actionCardId)
        if (changeId !== undefined) {
          await this.draftDecision.decide(
            params.sessionId,
            changeId,
            params.organizationId,
            mapCopilotDecisionToReviewStatus(item.decision),
            undefined,
            undefined,
          )
          passed++
        }
      } else {
        failed++
      }
    }

    await this.audit.log({
      event: AuditEvent.COPILOT_ACTION_BULK_DECIDED,
      organizationId: params.organizationId,
      userId: params.userId,
      metadata: {
        sessionId: params.sessionId,
        itemCount: params.items.length,
        passedCount: passed,
        failedCount: failed,
      },
    })

    return assembleCopilotBulkResult(results)
  }
}
