/**
 * v3-copilot-session-persistence-and-history — CopilotSessionRetentionService。
 *
 * 实现 ICopilotSessionRetentionService 接口（由 controller 定义）。
 *
 * 核心职责：
 * - Hard delete（D1）：删除会话及其全部消息，不留可重建残留
 * - Tombstone cascade（D2）：删除前更新路由决策/反馈事件中的会话引用为墓碑引用
 * - Audit（D3）：删除事件写入审计日志，记录 session ID、时间、触发原因，不含内容
 * - Idempotent（D5）：已删除的会话返回成功
 * - 批量清理与用户请求共享执行路径（D6）
 *
 * 设计约束（D1–D6）：
 * - D1: Hard delete, not soft hide
 * - D2: Tombstone references in ledgers, not dangling or cascaded
 * - D3: Audit records event without content
 * - D5: Batched and idempotent
 * - D6: User-requested and expiry share same execution path
 *
 * 组织隔离约定：所有查询必须附加 organization_id 过滤。
 */

import { DateTime } from 'luxon'

import CopilotSession from '#models/copilot_session'
import CopilotMessage from '#models/copilot_message'
import CopilotRoutingDecisionModel from '#models/copilot_routing_decision'
import UnifiedAiFeedbackEvent from '#models/unified_ai_feedback_event'
import CopilotSessionRetentionTombstone from '#models/copilot_session_retention_tombstone'
import CopilotSessionRetentionDeletionRecord from '#models/copilot_session_retention_deletion_record'
import CopilotSessionRetentionPolicyModel from '#models/copilot_session_retention_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  type CopilotSessionRetentionTriggerReason,
  computeCopilotSessionTombstoneHash,
  computeCopilotSessionRetentionPolicyHash,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// Service interface（与 controller 一致）
// ---------------------------------------------------------------------------

/** 保留策略 DTO */
export interface RetentionPolicyDto {
  organizationId: number
  projectId: number | null
  retentionDays: number
  enabled: boolean
  configured: boolean
  updatedAt: string | null
}

/** 保留状态汇总 DTO */
export interface RetentionStatusDto {
  projectId: number
  totalSessions: number
  activeSessions: number
  expiredSessions: number
  deletedSessions: number
  policy: RetentionPolicyDto
}

/** 单会话保留摘要 DTO */
export interface SessionRetentionSummaryDto {
  sessionId: string
  title: string | null
  createdAt: string
  lastActivityAt: string | null
  remainingDays: number | null
  isExpired: boolean
  isDeleted: boolean
  policy: RetentionPolicyDto
}

/** 带保留信息的分页会话列表条目 */
export interface SessionWithRetentionDto {
  id: number
  sessionId: string
  title: string | null
  actorId: number
  status: string
  createdAt: string
  updatedAt: string | null
  remainingDays: number | null
  isExpired: boolean
}

/** 删除预览 / 执行结果 */
export interface SessionDeletionResult {
  sessionId: string
  deleted: boolean
  deletedAt: string | null
  message: string
}

/** 删除状态 */
export interface SessionDeletionStatusDto {
  sessionId: string
  isDeleted: boolean
  deletedAt: string | null
  markedForDeletion: boolean
}

/** 批量清理结果 */
export interface CleanupResultDto {
  projectId: number
  totalExpired: number
  deletedCount: number
  failedCount: number
  errors: Array<{ sessionId: string; reason: string }>
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CopilotSessionRetentionService {
  readonly #audit = new AuditService()

  // ── 1. getPolicy ────────────────────────────────────────────────────────

  async getPolicy(organizationId: number, projectId: number | null): Promise<RetentionPolicyDto> {
    const model = await this.#resolvePolicy(organizationId, projectId)
    if (!model) {
      return {
        organizationId,
        projectId,
        retentionDays: 90,
        enabled: false,
        configured: false,
        updatedAt: null,
      }
    }
    return {
      organizationId: model.organizationId,
      projectId: model.projectId,
      retentionDays: model.retentionDays,
      enabled: model.enabled,
      configured: true,
      updatedAt: model.updatedAt?.toISO?.() ?? null,
    }
  }

  // ── 2. updatePolicy ─────────────────────────────────────────────────────

  async updatePolicy(
    organizationId: number,
    projectId: number | null,
    input: { retentionDays: number; enabled: boolean },
    userId: number,
  ): Promise<RetentionPolicyDto> {
    const source = projectId !== null ? 'project' : 'organization'
    const policyHash = computeCopilotSessionRetentionPolicyHash({
      scope: source,
      organizationId,
      projectId,
      retentionDays: input.retentionDays,
      enabled: input.enabled,
    })

    let model = await this.#resolvePolicy(organizationId, projectId)
    if (model) {
      model.retentionDays = input.retentionDays
      model.enabled = input.enabled
      model.policyHash = policyHash
      model.updatedBy = userId
      await model.save()
    } else {
      model = await CopilotSessionRetentionPolicyModel.create({
        organizationId,
        projectId,
        retentionDays: input.retentionDays,
        enabled: input.enabled,
        policyHash,
        source,
        updatedBy: userId,
      })
    }

    // 审计
    await this.#audit.log({
      event: AuditEvent.CONFIG_CHANGED,
      userId,
      organizationId,
      metadata: {
        event: 'COPILOT_SESSION_RETENTION_POLICY_UPDATED',
        projectId,
        retentionDays: input.retentionDays,
        enabled: input.enabled,
        policyHash,
      },
    })

    return {
      organizationId: model.organizationId,
      projectId: model.projectId,
      retentionDays: model.retentionDays,
      enabled: model.enabled,
      configured: true,
      updatedAt: model.updatedAt?.toISO?.() ?? null,
    }
  }

  // ── 3. getStatus ────────────────────────────────────────────────────────

  async getStatus(organizationId: number, projectId: number): Promise<RetentionStatusDto> {
    const now = DateTime.now()

    const sessions = await CopilotSession.query()
      .where('organization_id', organizationId)
      .whereRaw("json_extract(attribution, '$.projectId') = ?", [projectId])

    const totalSessions = sessions.length
    let activeSessions = 0
    let expiredSessions = 0
    let deletedSessions = 0

    for (const s of sessions) {
      if (s.retentionExpiresAt && s.retentionExpiresAt < now) {
        expiredSessions++
      } else {
        activeSessions++
      }
    }

    // 已删除会话计数
    const deletionCount = await CopilotSessionRetentionDeletionRecord.query()
      .where('organization_id', organizationId)
      .whereRaw("json_extract(project_id, '$') = ?", [projectId])
      .count('* as total')
      .then((rows) => Number(rows[0]?.$extras?.total ?? 0))

    deletedSessions = deletionCount

    const policy = await this.getPolicy(organizationId, projectId)

    return {
      projectId,
      totalSessions,
      activeSessions,
      expiredSessions,
      deletedSessions,
      policy,
    }
  }

  // ── 4. getSessionSummary ────────────────────────────────────────────────

  async getSessionSummary(
    organizationId: number,
    sessionId: string,
  ): Promise<SessionRetentionSummaryDto | null> {
    const session = await CopilotSession.query()
      .where('organization_id', organizationId)
      .where('session_id', sessionId)
      .first()

    if (!session) {
      // 检查是否已删除
      const deletion = await CopilotSessionRetentionDeletionRecord.query()
        .where('organization_id', organizationId)
        .where('session_id', sessionId)
        .first()

      if (!deletion) return null

      const policy = await this.getPolicy(organizationId, null)

      return {
        sessionId,
        title: null,
        createdAt: deletion.createdAt?.toISO?.() ?? '',
        lastActivityAt: null,
        remainingDays: null,
        isExpired: true,
        isDeleted: true,
        policy,
      }
    }

    const projectId =
      session.attribution?.projectId != null ? Number(session.attribution.projectId) : null
    const policy = await this.getPolicy(organizationId, projectId)

    const now = DateTime.now()
    const isExpired = session.retentionExpiresAt ? session.retentionExpiresAt < now : false
    const remainingDays = session.retentionExpiresAt
      ? Math.max(0, Math.ceil(session.retentionExpiresAt.diff(now, 'days').days))
      : null

    return {
      sessionId: session.sessionId,
      title: session.title,
      createdAt: session.createdAt?.toISO?.() ?? '',
      lastActivityAt: session.updatedAt?.toISO?.() ?? null,
      remainingDays,
      isExpired,
      isDeleted: false,
      policy,
    }
  }

  // ── 5. listSessionsWithRetention ────────────────────────────────────────

  async listSessionsWithRetention(
    organizationId: number,
    projectId: number | null,
    page: number = 1,
    perPage: number = 50,
  ): Promise<{
    data: SessionWithRetentionDto[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    let query = CopilotSession.query().where('organization_id', organizationId)

    if (projectId !== null) {
      query = query.whereRaw("json_extract(attribution, '$.projectId') = ?", [projectId])
    }

    const now = DateTime.now()
    const sessions = await query.orderBy('created_at', 'desc')

    const data: SessionWithRetentionDto[] = sessions.map((s) => {
      const isExpired = s.retentionExpiresAt ? s.retentionExpiresAt < now : false
      const remainingDays = s.retentionExpiresAt
        ? Math.max(0, Math.ceil(s.retentionExpiresAt.diff(now, 'days').days))
        : null

      return {
        id: s.id,
        sessionId: s.sessionId,
        title: s.title,
        actorId: s.actorId,
        status: s.status,
        createdAt: s.createdAt?.toISO?.() ?? '',
        updatedAt: s.updatedAt?.toISO?.() ?? null,
        remainingDays,
        isExpired,
      }
    })

    const total = data.length
    const totalPages = Math.ceil(total / perPage)
    const start = (page - 1) * perPage
    const paged = data.slice(start, start + perPage)

    return {
      data: paged,
      meta: { total, page, perPage, totalPages },
    }
  }

  // ── 6. previewDeletion ──────────────────────────────────────────────────

  /**
   * 删除预览（两步删除的第一步）。
   * 校验会话归属，返回确认信息。
   */
  async previewDeletion(
    organizationId: number,
    sessionId: string,
    userId: number,
  ): Promise<SessionDeletionResult> {
    const session = await CopilotSession.query()
      .where('organization_id', organizationId)
      .where('session_id', sessionId)
      .first()

    if (!session) {
      // 幂等：已删除
      return {
        sessionId,
        deleted: true,
        deletedAt: null,
        message: '会话已被删除或不存在',
      }
    }

    // 审计：记录预览事件
    await this.#audit.log({
      event: AuditEvent.COPILOT_ACTION_PREVIEW_CREATED,
      userId,
      organizationId,
      metadata: {
        event: 'COPILOT_SESSION_DELETION_PREVIEW',
        sessionId,
      },
    })

    return {
      sessionId,
      deleted: false,
      deletedAt: null,
      message: '确认后将永久删除此会话及其所有消息，此操作不可逆。',
    }
  }

  // ── 7. executeDeletion ──────────────────────────────────────────────────

  /**
   * 执行删除（两步删除的第二步，D6 共享路径）。
   * Hard delete 会话及其所有消息（D1），级联 tombstone（D2），审计（D3）。
   */
  async executeDeletion(
    organizationId: number,
    sessionId: string,
    userId: number,
  ): Promise<SessionDeletionResult> {
    // 查找会话（组织隔离）
    const session = await CopilotSession.query()
      .where('organization_id', organizationId)
      .where('session_id', sessionId)
      .first()

    // 幂等：已删除返回 success（D5）
    if (!session) {
      return {
        sessionId,
        deleted: true,
        deletedAt: null,
        message: '会话已被删除或不存在',
      }
    }

    const sessionDbId = session.id
    const projectId =
      session.attribution?.projectId != null ? Number(session.attribution.projectId) : null
    const deletedAt = new Date().toISOString()

    // 统计消息数量（用于 tombstone 低敏记录）
    const messages = await CopilotMessage.query().where('session_db_id', sessionDbId).select('id')
    const messageCount = messages.length

    // 计算策略哈希
    const policyHash = computeCopilotSessionTombstoneHash({
      originalSessionId: sessionId,
      deletionReason: 'user_requested',
      policyHash: 'session-retention',
      deletedAtIso: deletedAt,
    })

    // ── Tombstone cascade（D2）──

    // 1. 更新路由决策中的会话引用为墓碑引用
    const routingTombstoned = await this.#cascadeToRoutingDecisions(
      organizationId,
      sessionId,
      policyHash,
    )

    // 2. 更新反馈事件中的会话引用为墓碑引用
    const feedbackTombstoned = await this.#cascadeToFeedbackEvents(
      organizationId,
      sessionId,
      policyHash,
    )

    // 3. 创建 tombstone 记录
    const tombstone = await this.#createTombstone(
      organizationId,
      projectId,
      sessionDbId,
      sessionId,
      messageCount,
      policyHash,
    )

    // 4. 创建删除记录
    await CopilotSessionRetentionDeletionRecord.create({
      organizationId,
      projectId,
      sessionId,
      sessionDbId,
      triggerReason: 'user_requested' as CopilotSessionRetentionTriggerReason,
      deletedAt: DateTime.fromISO(deletedAt),
      messageCount,
      tombstoneId: tombstone.id,
      policyHash,
    })

    // ── Hard delete（D1）──

    // 删除所有消息
    await CopilotMessage.query().where('session_db_id', sessionDbId).delete()

    // 删除会话本身
    await session.delete()

    // ── Audit（D3）──

    await this.#audit.log({
      event: AuditEvent.COPILOT_ACTION_DECIDED,
      userId,
      organizationId,
      metadata: {
        event: 'COPILOT_SESSION_HARD_DELETED',
        sessionId,
        triggerReason: 'user_requested',
        messageCount,
        tombstoneCount: routingTombstoned + feedbackTombstoned + 1,
        deletedAt,
        // D3: 不含会话内容，只记录元数据
      },
    })

    return {
      sessionId,
      deleted: true,
      deletedAt,
      message: '会话已永久删除',
    }
  }

  // ── 8. getDeletionStatus ────────────────────────────────────────────────

  async getDeletionStatus(
    organizationId: number,
    sessionId: string,
  ): Promise<SessionDeletionStatusDto | null> {
    // 先查会话是否存在
    const session = await CopilotSession.query()
      .where('organization_id', organizationId)
      .where('session_id', sessionId)
      .first()

    if (session) {
      return {
        sessionId,
        isDeleted: false,
        deletedAt: null,
        markedForDeletion: false,
      }
    }

    // 会话不存在，查删除记录
    const deletion = await CopilotSessionRetentionDeletionRecord.query()
      .where('organization_id', organizationId)
      .where('session_id', sessionId)
      .first()

    if (!deletion) return null

    return {
      sessionId,
      isDeleted: true,
      deletedAt: deletion.deletedAt?.toISO?.() ?? null,
      markedForDeletion: false,
    }
  }

  // ── 9. executeCleanup ───────────────────────────────────────────────────

  /**
   * 批量清理过期会话（D5/D6）。
   * 每个过期会话走与 executeDeletion 相同的执行路径。
   */
  async executeCleanup(
    organizationId: number,
    projectId: number,
    batchSize: number,
    userId: number,
  ): Promise<CleanupResultDto> {
    const now = DateTime.now()

    // 查询过期会话
    const expiredSessions = await CopilotSession.query()
      .where('organization_id', organizationId)
      .whereNotNull('retention_expires_at')
      .where('retention_expires_at', '<', now.toSQL()!)
      .whereRaw("json_extract(attribution, '$.projectId') = ?", [projectId])
      .limit(batchSize)

    const totalExpired = expiredSessions.length
    let deletedCount = 0
    let failedCount = 0
    const errors: Array<{ sessionId: string; reason: string }> = []

    for (const session of expiredSessions) {
      try {
        const result = await this.executeDeletion(organizationId, session.sessionId, userId)
        if (result.deleted) {
          deletedCount++
        } else {
          failedCount++
          errors.push({ sessionId: session.sessionId, reason: result.message })
        }
      } catch (error: any) {
        failedCount++
        errors.push({
          sessionId: session.sessionId,
          reason: error?.message ?? '未知错误',
        })
      }
    }

    // 审计
    await this.#audit.log({
      event: AuditEvent.CONFIG_CHANGED,
      userId,
      organizationId,
      metadata: {
        event: 'COPILOT_SESSION_RETENTION_CLEANUP_EXECUTED',
        projectId,
        totalExpired,
        deletedCount,
        failedCount,
      },
    })

    return { projectId, totalExpired, deletedCount, failedCount, errors }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * 解析组织/项目级保留策略。
   * 优先项目级，回退组织级。
   */
  async #resolvePolicy(
    organizationId: number,
    projectId: number | null,
  ): Promise<CopilotSessionRetentionPolicyModel | null> {
    if (projectId !== null) {
      const projectPolicy = await CopilotSessionRetentionPolicyModel.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .first()
      if (projectPolicy) return projectPolicy
    }

    // 回退组织级
    return CopilotSessionRetentionPolicyModel.query()
      .where('organization_id', organizationId)
      .whereNull('project_id')
      .first()
  }

  /**
   * 级联更新路由决策（D2）：查找引用此会话的路由决策，替换会话引用为墓碑引用。
   *
   * 路由决策通过 scope 字段引用会话（无直接 FK 列），
   * 会话引用形式为 session:{session_id} 或包含 session_id 的 scope 值。
   */
  async #cascadeToRoutingDecisions(
    organizationId: number,
    sessionId: string,
    tombstoneHash: string,
  ): Promise<number> {
    // 路由决策通过 scope 字段引用会话（scope 包含 session_id）
    const decisions = await CopilotRoutingDecisionModel.query()
      .where('organization_id', organizationId)
      .where('scope', 'like', `%${sessionId}%`)

    if (decisions.length === 0) return 0

    const tombstoneRef = `tombstone:${tombstoneHash}`
    let updated = 0

    for (const decision of decisions) {
      // 替换 scope 中的会话引用为墓碑引用
      if (decision.scope && decision.scope.includes(sessionId)) {
        decision.scope = decision.scope.replace(sessionId, tombstoneRef)
        await decision.save()
        updated++
      }
    }

    return updated
  }

  /**
   * 级联更新反馈事件（D2）：查找引用此会话的反馈事件，替换会话引用为墓碑引用。
   *
   * 反馈事件通过 source_ref 字段引用会话。
   */
  async #cascadeToFeedbackEvents(
    organizationId: number,
    sessionId: string,
    tombstoneHash: string,
  ): Promise<number> {
    const events = await UnifiedAiFeedbackEvent.query()
      .where('organization_id', organizationId)
      .where('source_ref', 'like', `%${sessionId}%`)

    if (events.length === 0) return 0

    const tombstoneRef = `tombstone:${tombstoneHash}`
    let updated = 0

    for (const event of events) {
      if (event.sourceRef && event.sourceRef.includes(sessionId)) {
        event.sourceRef = event.sourceRef.replace(sessionId, tombstoneRef)
        await event.save()
        updated++
      }
    }

    return updated
  }

  /**
   * 创建 tombstone 记录（D2）。
   */
  async #createTombstone(
    organizationId: number,
    projectId: number | null,
    _sessionDbId: number,
    originalSessionId: string,
    messageCount: number,
    policyHash: string,
  ): Promise<CopilotSessionRetentionTombstone> {
    const now = new Date().toISOString()

    const tombstoneHash = computeCopilotSessionTombstoneHash({
      originalSessionId,
      deletionReason: 'session_deleted',
      policyHash,
      deletedAtIso: now,
    })

    return CopilotSessionRetentionTombstone.create({
      organizationId,
      projectId,
      originalSessionId,
      tombstoneHash,
      messageCount,
      policyHash,
    })
  }
}
