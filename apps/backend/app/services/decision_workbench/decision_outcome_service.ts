import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import {
  ConflictException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import type User from '#models/user'
import PmoDecisionCase from '#models/pmo_decision_case'
import PmoDecisionOption from '#models/pmo_decision_option'
import PmoDecisionOutcome from '#models/pmo_decision_outcome'
import AuditService from '#services/audit_service'
import DecisionWorkbenchPolicy from '#policies/decision_workbench_policy'
import DecisionReviewService from './decision_review_service.js'
import {
  decisionOutcomeDeniedAudit,
  decisionOutcomeRecordedAudit,
} from './decision_workbench_audit.js'

import {
  PMO_DECISION_OUTCOME_ACTIONS,
  PMO_DECISION_RATIONALE_MAX_LENGTH,
  computePmoDecisionOutcomeDigest,
  isPmoDecisionOutcomeAction,
  pmoDecisionOutcomeRequiresSelectedOption,
  pmoDecisionOutcomeTargetStatus,
  type PmoDecisionOutcomeAction,
  type PmoDecisionOutcomeDTO,
} from '@aiproj/types'

/**
 * v3-pmo-decision-intelligence-workbench —— 人工结论服务（tasks 6.5–6.7，design D4/D5）。
 *
 * 红线：
 *   - 只有已认证的当前人类 actor 可提交终态结论（automation-origin fail-closed）；
 *     AI/插件/后台任务/未签名请求一律拒绝并写低敏 denial audit。
 *   - 结论绑定 selected option、snapshot hash、review fingerprint 与 warning ack；
 *     fingerprint 在同一事务内重核（TOCTOU 门），stale 即回滚。
 *   - 终态结论不可改；outcome 与审计原子提交。
 *   - 不提供/调用任何正式 apply|confirm；不修改 project/task/WBS/resource/risk/
 *     priority/investment/impact 事实。
 */

export interface OutcomeInput {
  action: string
  caseId: number
  selectedOptionId?: number | null
  reviewFingerprint: string
  rationale?: string | null
  acknowledgedWarnings?: string[]
  supersededByCaseId?: number | null
}

/** automation-origin fail-closed guard：请求必须携带已认证人类 user 上下文。 */
export function assertHumanActor(user: User | null | undefined): void {
  if (!user || typeof user.id !== 'number' || !Number.isFinite(user.id)) {
    throw new ValidationException('缺少已认证人类 actor', { code: 'AUTOMATION_ORIGIN_DENIED' })
  }
}

@inject()
export default class DecisionOutcomeService {
  constructor(
    private readonly policy: DecisionWorkbenchPolicy,
    private readonly review: DecisionReviewService,
    private readonly audit: AuditService,
  ) {}

  async record(
    user: User,
    organizationId: number,
    input: OutcomeInput,
  ): Promise<PmoDecisionOutcomeDTO> {
    // ── Guard 1：automation origin fail closed ──
    try {
      assertHumanActor(user)
      await this.policy.authorizeDecide(user, organizationId)
    } catch (error) {
      await this.audit.log(
        decisionOutcomeDeniedAudit({
          organizationId,
          actorId: user?.id ?? 0,
          caseId: input.caseId,
          reasonCode: 'AUTOMATION_ORIGIN_DENIED',
        }),
      )
      throw error
    }

    if (!isPmoDecisionOutcomeAction(input.action)) {
      throw new ValidationException('未知结论动作', { code: 'ACTION_INVALID' })
    }
    const action = input.action as PmoDecisionOutcomeAction
    const rationale = input.rationale ?? null
    if ((rationale?.length ?? 0) > PMO_DECISION_RATIONALE_MAX_LENGTH) {
      throw new ValidationException('结论文本超长', { code: 'RATIONALE_TOO_LONG' })
    }

    const parent = await this.requireOrgCase(organizationId, input.caseId)
    if (parent.status !== 'under-review') {
      throw new ValidationException('仅 under-review 议题可记录结论', {
        code: 'CASE_NOT_UNDER_REVIEW',
      })
    }

    const requiresOption = pmoDecisionOutcomeRequiresSelectedOption(action)
    if (requiresOption && !input.selectedOptionId) {
      throw new ValidationException('approve 必须选择一个方案', {
        code: 'SELECTED_OPTION_REQUIRED',
      })
    }

    // supersede：必须指向同组织内已存在的新议题（双向 refs 由本事务写入）。
    let supersedeTarget: { id: number; supersedesCaseId: number | null } | null = null
    if (action === PMO_DECISION_OUTCOME_ACTIONS.SUPERSEDE) {
      if (!input.supersededByCaseId) {
        throw new ValidationException('supersede 必须提供取代本议题的新议题 id', {
          code: 'SUPERSEDE_TARGET_REQUIRED',
        })
      }
      const target = await PmoDecisionCase.query()
        .where('organizationId', organizationId)
        .where('id', input.supersededByCaseId)
        .first()
      if (!target) {
        throw new ValidationException('取代目标不存在或不属于本组织', {
          code: 'SUPERSEDE_TARGET_INVALID',
        })
      }
      if (target.supersedesCaseId !== null && Number(target.supersedesCaseId) !== input.caseId) {
        throw new ConflictException('取代目标已指向其他议题')
      }
      supersedeTarget = { id: input.supersededByCaseId, supersedesCaseId: target.supersedesCaseId }
    }

    let selectedActive = false
    if (input.selectedOptionId) {
      const option = await PmoDecisionOption.query()
        .where('organizationId', organizationId)
        .where('caseId', input.caseId)
        .where('id', input.selectedOptionId)
        .where('active', true)
        .first()
      selectedActive = Boolean(option)
      if (!selectedActive) {
        throw new ValidationException('选中方案不存在或非 active', { code: 'OPTION_INVALID' })
      }
    }
    void selectedActive

    const snapshot = await this.review.latestSnapshotOrNull(organizationId, input.caseId)
    if (!snapshot) {
      throw new ValidationException('尚无证据快照', { code: 'EVIDENCE_MISSING' })
    }

    const targetStatus = pmoDecisionOutcomeTargetStatus(action)

    // TOCTOU 重核：在事务外读取全部 revision 并验证 fingerprint（SQLite 连接池
    // 为 1，事务内不得再从池取连接）；随后事务内的状态 CAS（revision 守卫）
    // 保证校验与写入之间无并发窗口。
    const revalidated = await this.review.revalidateFingerprint({
      organizationId,
      caseId: input.caseId,
      actorId: user.id,
      fingerprint: input.reviewFingerprint,
    })
    if (!revalidated.valid) {
      throw new ConflictException(
        `review 已过期（${revalidated.staleReason ?? 'STALE'}），请重新生成 readiness`,
        {
          code: 'REVIEW_STALE',
        },
      )
    }

    // ── 事务：写 outcome + 状态 CAS → 审计（同事务原子提交）──
    return db.transaction(async (trx: TransactionClientContract) => {
      const digest = computePmoDecisionOutcomeDigest({
        action,
        organizationId,
        caseId: input.caseId,
        selectedOptionId: input.selectedOptionId ?? null,
        snapshotHash: snapshot.snapshotHash,
        reviewFingerprint: input.reviewFingerprint,
      })

      // 幂等：同 digest 重复提交返回既有结论。
      const existing = await trx
        .from('pmo_decision_outcomes')
        .where('organization_id', organizationId)
        .where('case_id', input.caseId)
        .where('outcome_digest', digest)
        .first()
      if (existing) {
        return this.toDTO(existing as Record<string, unknown>)
      }

      await PmoDecisionOutcome.create(
        {
          organizationId,
          caseId: input.caseId,
          action,
          selectedOptionId: input.selectedOptionId ?? null,
          supersededByCaseId: input.supersededByCaseId ?? null,
          snapshotHash: snapshot.snapshotHash,
          reviewFingerprint: input.reviewFingerprint,
          outcomeDigest: digest,
          rationale,
          acknowledgedWarnings: input.acknowledgedWarnings ?? [],
          actorId: user.id,
        } as never,
        { client: trx },
      )

      // 状态机 CAS 推进（request-more-evidence 回退到 collecting-evidence）。
      const affected = (await trx
        .from('pmo_decision_cases')
        .where('organization_id', organizationId)
        .where('id', input.caseId)
        .where('revision', parent.revision)
        .whereIn('status', ['under-review'])
        .update({
          status: targetStatus,
          revision: parent.revision + 1,
          superseded_by_case_id:
            action === PMO_DECISION_OUTCOME_ACTIONS.SUPERSEDE
              ? (input.supersededByCaseId ?? null)
              : parent.supersededByCaseId,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })) as unknown as number
      if (affected === 0) {
        throw new ConflictException('议题已被并发修改，结论未落库')
      }

      // supersede 双向 refs：新 case 回指本议题（同事务原子写入）。
      if (action === PMO_DECISION_OUTCOME_ACTIONS.SUPERSEDE && supersedeTarget) {
        await trx
          .from('pmo_decision_cases')
          .where('organization_id', organizationId)
          .where('id', supersedeTarget.id)
          .whereNull('supersedes_case_id')
          .update({
            supersedes_case_id: input.caseId,
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          })
      }

      await this.audit.log({
        ...decisionOutcomeRecordedAudit({
          organizationId,
          actorId: user.id,
          caseId: input.caseId,
          action,
          selectedOptionId: input.selectedOptionId ?? null,
          snapshotHash: snapshot.snapshotHash,
          outcomeDigest: digest,
          warningCodes: [...new Set(input.acknowledgedWarnings ?? [])],
        }),
        client: trx,
      })

      const row = await trx
        .from('pmo_decision_outcomes')
        .where('organization_id', organizationId)
        .where('case_id', input.caseId)
        .where('outcome_digest', digest)
        .first()
      return this.toDTO(row as Record<string, unknown>)
    })
  }

  async listOutcomes(organizationId: number, caseId: number): Promise<PmoDecisionOutcomeDTO[]> {
    await this.requireOrgCase(organizationId, caseId)
    const rows = await PmoDecisionOutcome.query()
      .where('organizationId', organizationId)
      .where('caseId', caseId)
      .orderBy('id', 'asc')
    return rows.map((row) => ({
      id: Number(row.id),
      organizationId: row.organizationId,
      caseId: row.caseId,
      action: row.action,
      selectedOptionId: row.selectedOptionId,
      snapshotHash: row.snapshotHash,
      reviewFingerprint: row.reviewFingerprint,
      outcomeDigest: row.outcomeDigest,
      actorId: row.actorId,
      acknowledgedWarnings: row.acknowledgedWarnings ?? [],
      createdAt: row.createdAt.toISO() ?? '',
    }))
  }

  private toDTO(raw: Record<string, unknown>): PmoDecisionOutcomeDTO {
    return {
      id: Number(raw['id']),
      organizationId: Number(raw['organization_id']),
      caseId: Number(raw['case_id']),
      action: raw['action'] as PmoDecisionOutcomeAction,
      selectedOptionId: (raw['selected_option_id'] as number | null) ?? null,
      snapshotHash: String(raw['snapshot_hash'] ?? ''),
      reviewFingerprint: String(raw['review_fingerprint'] ?? ''),
      outcomeDigest: String(raw['outcome_digest'] ?? ''),
      actorId: Number(raw['actor_id']),
      acknowledgedWarnings: JSON.parse(String(raw['acknowledged_warnings'] ?? '[]')) as string[],
      createdAt: new Date(String(raw['created_at'])).toISOString(),
    }
  }

  private async requireOrgCase(organizationId: number, caseId: number): Promise<PmoDecisionCase> {
    const row = await PmoDecisionCase.query()
      .where('organizationId', organizationId)
      .where('id', caseId)
      .first()
    if (!row) throw new ResourceNotFoundException('资源不存在')
    return row
  }
}
