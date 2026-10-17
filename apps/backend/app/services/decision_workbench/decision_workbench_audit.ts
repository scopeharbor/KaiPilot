import { AuditEvent, type AuditEntry, type AuditEventType } from '#services/audit_service'
import {
  PMO_DECISION_CONTRACT_VERSION,
  redactPmoDecisionAuditMetadata,
  type PmoDecisionCaseStatus,
  type PmoDecisionOutcomeAction,
} from '@aiproj/types'

/**
 * v3-pmo-decision-intelligence-workbench —— 决策工作台低敏审计构造器（tasks 2.8/9.6）。
 *
 * 红线：只记录组织、actor、稳定 refs、hash、状态、reason code、计数与耗时；
 * **禁止**写入完整问题/rationale/dissent 正文、prompt、模型输出、secret/token/
 * Authorization/URL/文件路径/隐藏实体 id。metadata 一律先过
 * `redactPmoDecisionAuditMetadata`（allowlist + 二次扫描）fail closed。
 */

export interface PmoDecisionAuditInput {
  organizationId: number
  actorId: number
  caseId: number | null
  metadata?: Record<string, unknown>
}

function baseEntry(
  event: AuditEventType,
  input: PmoDecisionAuditInput,
  extra?: Partial<AuditEntry>,
): AuditEntry {
  return {
    event,
    userId: input.actorId,
    organizationId: input.organizationId,
    entityType: 'pmo_decision_case',
    entityId: input.caseId,
    metadata: {
      contractVersion: PMO_DECISION_CONTRACT_VERSION,
      ...redactPmoDecisionAuditMetadata(input.metadata ?? {}),
    },
    ...extra,
  }
}

export function decisionCaseCreatedAudit(
  input: PmoDecisionAuditInput & { statusFrom: null; statusTo: PmoDecisionCaseStatus },
): AuditEntry {
  return baseEntry(AuditEvent.PMO_DECISION_CASE_CREATED, input)
}

export function decisionCaseUpdatedAudit(input: PmoDecisionAuditInput): AuditEntry {
  return baseEntry(AuditEvent.PMO_DECISION_CASE_UPDATED, input)
}

export function decisionCaseTransitionedAudit(
  input: PmoDecisionAuditInput & {
    statusFrom: PmoDecisionCaseStatus
    statusTo: PmoDecisionCaseStatus
  },
): AuditEntry {
  return baseEntry(AuditEvent.PMO_DECISION_CASE_TRANSITIONED, input, {
    changes: { before: { status: input.statusFrom }, after: { status: input.statusTo } },
  })
}

export function decisionCaseSupersededAudit(input: PmoDecisionAuditInput): AuditEntry {
  return baseEntry(AuditEvent.PMO_DECISION_CASE_SUPERSEDED, input)
}

export function decisionEvidenceRefreshedAudit(
  input: PmoDecisionAuditInput & {
    sourceStates: Array<{ source: string; state: string }>
    truncated: boolean
  },
): AuditEntry {
  return baseEntry(AuditEvent.PMO_DECISION_EVIDENCE_REFRESHED, input)
}

export function decisionReadinessCheckedAudit(
  input: PmoDecisionAuditInput & {
    ready: boolean
    blockingCount: number
    staleReason?: string | null
  },
): AuditEntry {
  return baseEntry(AuditEvent.PMO_DECISION_READINESS_CHECKED, input)
}

export function decisionPositionRecordedAudit(input: PmoDecisionAuditInput): AuditEntry {
  return baseEntry(AuditEvent.PMO_DECISION_POSITION_RECORDED, input)
}

export function decisionOutcomeRecordedAudit(
  input: PmoDecisionAuditInput & {
    action: PmoDecisionOutcomeAction
    selectedOptionId: number | null
    snapshotHash: string
    outcomeDigest: string
    warningCodes: string[]
  },
): AuditEntry {
  return baseEntry(AuditEvent.PMO_DECISION_OUTCOME_RECORDED, input)
}

/** 自动化 origin 提交终态结论的低敏拒绝审计（不含任何请求正文）。 */
export function decisionOutcomeDeniedAudit(
  input: PmoDecisionAuditInput & { reasonCode: string },
): AuditEntry {
  return baseEntry(AuditEvent.PMO_DECISION_OUTCOME_DENIED, input, { severity: 'warning' as const })
}

export function decisionAiLensRequestedAudit(
  input: PmoDecisionAuditInput & { lensId?: string },
): AuditEntry {
  return baseEntry(AuditEvent.PMO_DECISION_AI_LENS_REQUESTED, input)
}

export function decisionAiLensIsolatedAudit(
  input: PmoDecisionAuditInput & { reasonCode: string; provider?: string },
): AuditEntry {
  return baseEntry(AuditEvent.PMO_DECISION_AI_LENS_ISOLATED, input, {
    severity: 'warning' as const,
  })
}

export function decisionHandoffCreatedAudit(
  input: PmoDecisionAuditInput & { handoffTarget: string; idempotencyKey: string },
): AuditEntry {
  return baseEntry(AuditEvent.PMO_DECISION_HANDOFF_CREATED, input)
}

export function decisionHandoffReplayedAudit(
  input: PmoDecisionAuditInput & { handoffTarget: string; idempotencyKey: string },
): AuditEntry {
  return baseEntry(AuditEvent.PMO_DECISION_HANDOFF_REPLAYED, input)
}

export function decisionHandoffFailedAudit(
  input: PmoDecisionAuditInput & { handoffTarget: string; reasonCode: string },
): AuditEntry {
  return baseEntry(AuditEvent.PMO_DECISION_HANDOFF_FAILED, input, {
    severity: 'warning' as const,
  })
}
