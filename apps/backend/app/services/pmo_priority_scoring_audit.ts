/**
 * PMO 优先级评分审计事件（v3-pmo-priority-scoring-model §4.15）
 *
 * 低敏只读审计：只记录元数据，不含完整证据文本、prompt、模型输出、
 * token、API key、跨组织数据或受限维度详情。
 */
import type User from '#models/user'
import type AuditService from '#services/audit_service'

// ─── 审计事件类型 ─────────────────────────────────────────────

export const PMO_PRIORITY_SCORING_AUDIT_EVENTS = {
  SUMMARY_READ: 'PMO_PRIORITY_SCORING_SUMMARY_READ',
  LIST_READ: 'PMO_PRIORITY_SCORING_LIST_READ',
  GROUPS_READ: 'PMO_PRIORITY_SCORING_GROUPS_READ',
  WEIGHTS_READ: 'PMO_PRIORITY_SCORING_WEIGHTS_READ',
  DETAIL_READ: 'PMO_PRIORITY_SCORING_DETAIL_READ',
  PERMISSION_DENIED: 'PMO_PRIORITY_SCORING_PERMISSION_DENIED',
} as const

/** 本域可用的审计事件（均已在 AuditService 的 AuditEvent/EVENT_TO_ACTION 双表注册）。 */
export type PriorityScoringAuditEvent =
  (typeof PMO_PRIORITY_SCORING_AUDIT_EVENTS)[keyof typeof PMO_PRIORITY_SCORING_AUDIT_EVENTS]

// ─── 低敏元数据 ───────────────────────────────────────────────

interface PriorityScoringAuditMetadata {
  organizationId: number
  actorId: number
  scoreVersion?: string
  queryShape?: string
  projectId?: number
  page?: number
  perPage?: number
  groupBy?: string
  priorityLevels?: string
  deniedCode?: string
}

function buildBaseMetadata(
  user: User,
  organizationId: number,
  overrides: Partial<PriorityScoringAuditMetadata> = {},
): PriorityScoringAuditMetadata {
  return {
    organizationId,
    actorId: user.id,
    ...overrides,
  }
}

// ─── 审计事件构建器 ───────────────────────────────────────────

export function buildPriorityScoringSummaryReadAudit(
  user: User,
  organizationId: number,
  scoreVersion?: string,
): { event: PriorityScoringAuditEvent; metadata: PriorityScoringAuditMetadata } {
  return {
    event: PMO_PRIORITY_SCORING_AUDIT_EVENTS.SUMMARY_READ,
    metadata: buildBaseMetadata(user, organizationId, { scoreVersion, queryShape: 'summary' }),
  }
}

export function buildPriorityScoringListReadAudit(
  user: User,
  organizationId: number,
  params: {
    scoreVersion?: string
    page?: number
    perPage?: number
    priorityLevels?: string
    sort?: string
  } = {},
): { event: PriorityScoringAuditEvent; metadata: PriorityScoringAuditMetadata } {
  return {
    event: PMO_PRIORITY_SCORING_AUDIT_EVENTS.LIST_READ,
    metadata: buildBaseMetadata(user, organizationId, {
      scoreVersion: params.scoreVersion,
      page: params.page,
      perPage: params.perPage,
      priorityLevels: params.priorityLevels,
      queryShape: `list|sort:${params.sort ?? 'default'}`,
    }),
  }
}

export function buildPriorityScoringGroupsReadAudit(
  user: User,
  organizationId: number,
  groupBy: string,
  scoreVersion?: string,
): { event: PriorityScoringAuditEvent; metadata: PriorityScoringAuditMetadata } {
  return {
    event: PMO_PRIORITY_SCORING_AUDIT_EVENTS.GROUPS_READ,
    metadata: buildBaseMetadata(user, organizationId, {
      scoreVersion,
      groupBy,
      queryShape: 'groups',
    }),
  }
}

export function buildPriorityScoringWeightsReadAudit(
  user: User,
  organizationId: number,
  scoreVersion?: string,
): { event: PriorityScoringAuditEvent; metadata: PriorityScoringAuditMetadata } {
  return {
    event: PMO_PRIORITY_SCORING_AUDIT_EVENTS.WEIGHTS_READ,
    metadata: buildBaseMetadata(user, organizationId, {
      scoreVersion,
      queryShape: 'weights',
    }),
  }
}

export function buildPriorityScoringDetailReadAudit(
  user: User,
  organizationId: number,
  projectId: number,
  scoreVersion?: string,
): { event: PriorityScoringAuditEvent; metadata: PriorityScoringAuditMetadata } {
  return {
    event: PMO_PRIORITY_SCORING_AUDIT_EVENTS.DETAIL_READ,
    metadata: buildBaseMetadata(user, organizationId, {
      scoreVersion,
      projectId,
      queryShape: 'detail',
    }),
  }
}

export function buildPriorityScoringDeniedAudit(
  user: User | null,
  organizationId: number | null,
  deniedCode: string,
): { event: PriorityScoringAuditEvent; metadata: PriorityScoringAuditMetadata } {
  return {
    event: PMO_PRIORITY_SCORING_AUDIT_EVENTS.PERMISSION_DENIED,
    metadata: buildBaseMetadata((user ?? { id: 0 }) as User, organizationId ?? 0, {
      deniedCode,
      queryShape: 'denied',
    }),
  }
}

// ─── 审计事件发射辅助 ─────────────────────────────────────────

/**
 * 可选审计：低敏 read audit 写入。
 * 如果审计服务不可用（例如测试环境），静默降级。
 */
export async function emitPriorityScoringAudit(
  auditService: AuditService | null,
  entry: { event: PriorityScoringAuditEvent; metadata: PriorityScoringAuditMetadata },
): Promise<void> {
  if (!auditService) return
  try {
    await auditService.log({
      event: entry.event,
      severity:
        entry.event === PMO_PRIORITY_SCORING_AUDIT_EVENTS.PERMISSION_DENIED ? 'warning' : 'info',
      userId: entry.metadata.actorId,
      organizationId: entry.metadata.organizationId,
      projectId: entry.metadata.projectId,
      metadata: { ...entry.metadata },
    })
  } catch {
    // 审计写入失败不阻塞业务
  }
}
