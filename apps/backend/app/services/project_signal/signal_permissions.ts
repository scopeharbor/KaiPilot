import { MILESTONE_VIEW, RESOURCE_VIEW, RISK_VIEW, TASK_VIEW, type Permission } from '#rbac'
import type { ProjectSignalEvidence, ProjectSignalType } from './signal_contracts.js'

/**
 * v3-triz-contradiction-copilot W3 任务 3.4 —— 信号类型 → 证据所需领域权限映射。
 *
 * spec「信号读取的权限隔离与审计」第 1 条：读取信号要求 `project:view`；涉及风险/缺陷类
 * 证据时 MUST 额外要求对应领域权限；无领域权限时该信号的证据字段 MUST 被裁剪。
 *
 * 本映射是**唯一一份**（D10：两处承载共用同一权限裁剪逻辑，禁止各写一套），
 * 由 `ProjectSignalPolicy` 解析出用户实际持有情况、由 `ProjectSignalService` 执行裁剪。
 */
export const PROJECT_SIGNAL_DOMAIN_PERMISSIONS: Record<ProjectSignalType, Permission> = {
  // 进度读数来自任务与关键路径（EVM 是任务层的绩效视图）
  progress_deviation: TASK_VIEW,
  // 风险登记册与缺陷议题
  risk_surge: RISK_VIEW,
  // 资源分配与负载
  resource_overload: RESOURCE_VIEW,
  // 里程碑与甘特基线
  milestone_slip: MILESTONE_VIEW,
}

/** 用户对各领域权限的持有情况（键为权限码字符串）。 */
export type SignalDomainAccess = Record<string, boolean>

export function requiredPermissionFor(signalType: ProjectSignalType): Permission {
  return PROJECT_SIGNAL_DOMAIN_PERMISSIONS[signalType]
}

/** 是否允许读取该类型信号的证据字段（缺省视为无权限，fail-closed）。 */
export function canReadSignalEvidence(
  signalType: ProjectSignalType,
  domainAccess: SignalDomainAccess,
): boolean {
  return domainAccess[requiredPermissionFor(signalType)] === true
}

export interface RedactedEvidenceResult {
  evidence: ProjectSignalEvidence | null
  evidenceRedacted: boolean
  redactedReason: string | null
}

/**
 * 领域权限证据裁剪纯函数（v3-triz-copilot-followups 任务 4.1）：
 * 项目级与组织级共用同一裁剪口径。无权限域证据置 null，并标注 evidenceRedacted: true 与 redactedReason。
 */
export function redactSignalEvidence(
  signalType: ProjectSignalType,
  evidence: unknown,
  domainAccess: SignalDomainAccess = {},
): RedactedEvidenceResult {
  const requiredPermission = requiredPermissionFor(signalType)
  const allowed = canReadSignalEvidence(signalType, domainAccess)
  return {
    evidence: allowed ? (evidence as ProjectSignalEvidence) : null,
    evidenceRedacted: !allowed,
    redactedReason: allowed ? null : `missing_permission:${requiredPermission}`,
  }
}
