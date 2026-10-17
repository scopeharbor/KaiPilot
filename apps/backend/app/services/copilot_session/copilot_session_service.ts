/**
 * v3-copilot-session-persistence-and-history —— 会话服务（§4）。
 *
 * 核心职责：
 * - 会话创建（含 scope 与归属校验）
 * - 确定性标题派生（不调模型）
 * - 会话列表（分页、稳定排序、scope 与状态过滤）
 * - 重命名与归档（软状态，不删历史）
 * - 消息追加（有界摘要截断 + 幂等）
 * - 成本只存引用不存副本
 * - 续接判定（依序号与 SSE 事件 ID）
 * - 删除（清除摘要与 source refs）
 * - 导出（低敏结构化格式）
 * - 组织隔离全路径
 * - 低敏审计
 */

import type {
  CopilotScope,
  CopilotSessionStatus,
  CopilotSessionAttribution,
  CopilotMessageRole,
  CopilotWarningCode,
  CopilotDegradedReason,
} from '@aiproj/types'
import { isCopilotFieldSensitive } from '@aiproj/types'
import {
  truncateCopilotSummary,
  deriveCopilotSessionTitle,
  validateCopilotSessionExport,
} from '@aiproj/types'
import CopilotSession from '../../models/copilot_session.js'
import CopilotMessage from '../../models/copilot_message.js'

// ---------------------------------------------------------------------------
// 输入类型
// ---------------------------------------------------------------------------

export interface CreateSessionInput {
  readonly organizationId: number
  readonly scope: CopilotScope
  readonly attribution: CopilotSessionAttribution
  readonly actorId: number
  readonly title?: string
  readonly idempotencyKey?: string
}

export interface ListSessionsInput {
  readonly organizationId: number
  readonly actorId: number
  readonly scope?: CopilotScope
  readonly status?: CopilotSessionStatus
  readonly includeArchived?: boolean
  readonly page?: number
  readonly perPage?: number
  readonly sortField?: 'createdAt' | 'updatedAt'
  readonly sortOrder?: 'asc' | 'desc'
}

export interface AppendMessageInput {
  readonly organizationId: number
  /** 会话归属人：只能往本人的会话里追加消息（防同组织成员借 sessionId 写入他人会话）。 */
  readonly actorId: number
  readonly sessionId: string
  readonly role: CopilotMessageRole
  readonly contentSummary: string
  readonly sourceRefs?: readonly string[]
  readonly routeDecisionId?: string
  readonly actionId?: string
  readonly warningCodes?: readonly CopilotWarningCode[]
  readonly degradedReason?: CopilotDegradedReason | null
  readonly costLedgerRef?: string
  readonly idempotencyKey?: string
}

export interface ResumeSessionInput {
  readonly organizationId: number
  readonly actorId: number
  readonly sessionId: string
  readonly lastSequence: number
  readonly lastSseEventId?: string
}

// ---------------------------------------------------------------------------
// 服务实现
// ---------------------------------------------------------------------------

export class CopilotSessionService {
  /**
   * 创建会话（§4.1）。
   * 含 scope 与归属校验，确定性标题派生。
   */
  async createSession(input: CreateSessionInput): Promise<CopilotSession> {
    // 验证 scope 与 attribution 一致性
    this.validateScopeAttribution(input.scope, input.attribution)

    // 幂等检查
    if (input.idempotencyKey) {
      // 幂等键按「组织 + 本人」命中，不能把同组织他人的会话当作幂等结果返回。
      const existing = await CopilotSession.query()
        .where('organization_id', input.organizationId)
        .where('actor_id', input.actorId)
        .where('idempotency_key', input.idempotencyKey)
        .first()
      if (existing) return existing
    }

    // 标题：用户命名或确定性派生
    const title = input.title ?? '新会话'

    const session = await CopilotSession.create({
      organizationId: input.organizationId,
      scope: input.scope,
      attribution: input.attribution,
      status: 'active',
      title,
      archived: false,
      actorId: input.actorId,
      sessionId: `cps_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      idempotencyKey: input.idempotencyKey ?? `ik_${Date.now().toString(36)}`,
    })

    return session
  }

  /**
   * 确定性标题派生（§4.2）。
   * 由首条用户消息摘要派生，不调模型。
   */
  deriveTitle(firstUserMessageSummary: string): string {
    return deriveCopilotSessionTitle(firstUserMessageSummary)
  }

  /**
   * 会话列表（§4.4）。
   * 分页、稳定排序、scope 与状态过滤。
   */
  async listSessions(input: ListSessionsInput) {
    const page = input.page ?? 1
    const perPage = Math.min(input.perPage ?? 20, 100)
    const sortField = input.sortField ?? 'updatedAt'
    const sortOrder = input.sortOrder ?? 'desc'

    let query = CopilotSession.query()
      .where('organization_id', input.organizationId)
      .orderBy(sortField, sortOrder)

    query = query.where('actor_id', input.actorId)
    if (input.scope) {
      query = query.where('scope', input.scope)
    }
    if (input.status) {
      query = query.where('status', input.status)
    }
    if (!input.includeArchived) {
      query = query.where('archived', false)
    }

    const result = await query.paginate(page, perPage)
    return {
      data: result.all(),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  /**
   * 重命名（§4.5）。
   */
  async renameSession(
    organizationId: number,
    actorId: number,
    sessionId: string,
    newTitle: string,
  ): Promise<CopilotSession | null> {
    const session = await this.getSession(organizationId, actorId, sessionId)
    if (!session) return null

    session.title = newTitle
    await session.save()
    return session
  }

  /**
   * 归档（§4.5）。
   * 软状态，不删历史。
   */
  async archiveSession(
    organizationId: number,
    actorId: number,
    sessionId: string,
  ): Promise<CopilotSession | null> {
    const session = await this.getSession(organizationId, actorId, sessionId)
    if (!session) return null

    session.archived = true
    session.status = 'archived'
    await session.save()
    return session
  }

  /**
   * 追加消息（§4.7）。
   * 有界摘要截断 + 幂等 + 成本只存引用。
   */
  async appendMessage(input: AppendMessageInput): Promise<{
    message: CopilotMessage
    truncated: boolean
    idempotent: boolean
  }> {
    // 获取会话
    const session = await this.getSession(input.organizationId, input.actorId, input.sessionId)
    if (!session) {
      throw new Error(`Session not found: ${input.sessionId}`)
    }

    // 幂等检查
    if (input.idempotencyKey) {
      const existing = await CopilotMessage.query()
        .where('session_db_id', session.id)
        .where('idempotency_key', input.idempotencyKey)
        .first()
      if (existing) {
        return { message: existing, truncated: existing.truncated, idempotent: true }
      }
    }

    // 摘要截断
    const { text: summary, truncated } = truncateCopilotSummary(input.contentSummary)

    // 获取下一个序号
    const lastMessage = await CopilotMessage.query()
      .where('session_db_id', session.id)
      .orderBy('sequence', 'desc')
      .first()
    const sequence = (lastMessage?.sequence ?? 0) + 1

    // 成本只存引用，不存数值
    const costLedgerRef = input.costLedgerRef ?? null

    const message = await CopilotMessage.create({
      sessionDbId: session.id,
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      messageId: `cpm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      role: input.role,
      contentSummary: summary,
      truncated,
      sourceRefs: [...(input.sourceRefs ?? [])],
      routeDecisionId: input.routeDecisionId ?? null,
      actionId: input.actionId ?? null,
      warningCodes: [...(input.warningCodes ?? [])],
      degradedReason: input.degradedReason ?? null,
      costLedgerRef,
      sequence,
      idempotencyKey: input.idempotencyKey ?? null,
    })

    // 更新会话 updatedAt
    session.updatedAt = undefined as any // 让 autoUpdate 生效
    await session.save()

    return { message, truncated, idempotent: false }
  }

  /**
   * 消息历史分页返回（§5.1）。
   */
  async listMessages(
    organizationId: number,
    actorId: number,
    sessionId: string,
    page: number = 1,
    perPage: number = 50,
  ) {
    const session = await this.getSession(organizationId, actorId, sessionId)
    if (!session) return null

    const result = await CopilotMessage.query()
      .where('organization_id', organizationId)
      .where('session_db_id', session.id)
      .orderBy('sequence', 'asc')
      .paginate(page, perPage)

    return {
      data: result.all(),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  /** 仅本人、同一授权范围的近期低敏对话；历史不充当当前项目事实。 */
  async conversationContext(input: {
    organizationId: number
    actorId: number
    sessionId: string
    scope: CopilotScope
    attribution: CopilotSessionAttribution
    currentIdempotencyKey: string
  }): Promise<readonly { role: 'user' | 'assistant'; content: string }[]> {
    const session = await this.getSession(input.organizationId, input.actorId, input.sessionId)
    if (
      !session ||
      session.scope !== input.scope ||
      String(session.attribution.projectId ?? '') !== String(input.attribution.projectId ?? '') ||
      session.archived
    )
      return []
    const messages = await CopilotMessage.query()
      .where('organization_id', input.organizationId)
      .where('session_db_id', session.id)
      .where((query) =>
        query
          .whereNull('idempotency_key')
          .orWhereNot('idempotency_key', input.currentIdempotencyKey),
      )
      .whereIn('role', ['user', 'assistant'])
      .orderBy('sequence', 'desc')
      .limit(8)
    return messages.reverse().flatMap((message) => {
      const content = message.contentSummary.slice(0, 512)
      if (isCopilotFieldSensitive(content) || !content.trim()) return []
      // 旧项目回答可能包含已过期或权限已变化的实体，不作为历史重新发送。
      if (input.scope !== 'global' && message.role === 'assistant' && message.sourceRefs.length > 0)
        return []
      if (message.role !== 'user' && message.role !== 'assistant') return []
      return [{ role: message.role, content }]
    })
  }

  /**
   * 续接判定（§6.1）。
   * 依序号与既有 SSE 事件 ID / 进度游标续接。
   */
  async resumeSession(input: ResumeSessionInput): Promise<{
    resumable: boolean
    reason?: string
    resumeFromSequence: number
    lastMessage: CopilotMessage | null
  }> {
    const session = await this.getSession(input.organizationId, input.actorId, input.sessionId)
    if (!session) {
      return { resumable: false, reason: '会话不存在', resumeFromSequence: 0, lastMessage: null }
    }

    if (session.status !== 'active') {
      return {
        resumable: false,
        reason: `会话状态为 ${session.status}，无法续接`,
        resumeFromSequence: 0,
        lastMessage: null,
      }
    }

    // 获取指定序号之后的消息
    const lastMessage = await CopilotMessage.query()
      .where('session_db_id', session.id)
      .where('sequence', '>', input.lastSequence)
      .orderBy('sequence', 'asc')
      .first()

    if (!lastMessage) {
      return {
        resumable: false,
        reason: '没有需要续接的消息',
        resumeFromSequence: input.lastSequence,
        lastMessage: null,
      }
    }

    return {
      resumable: true,
      resumeFromSequence: lastMessage.sequence,
      lastMessage,
    }
  }

  /**
   * 会话删除（§7.1）。
   * 清除摘要与 source refs，或墓碑仅留不可重建元数据。
   */
  async deleteSession(
    organizationId: number,
    actorId: number,
    sessionId: string,
  ): Promise<{ deleted: boolean }> {
    const session = await this.getSession(organizationId, actorId, sessionId)
    if (!session) return { deleted: false }

    // 删除所有消息（真实删除，不留可重建残留）
    await CopilotMessage.query().where('session_db_id', session.id).delete()

    // 删除会话本身
    await session.delete()

    return { deleted: true }
  }

  /**
   * 导出为低敏结构化格式（§7.3）。
   */
  async exportSession(
    organizationId: number,
    actorId: number,
    sessionId: string,
  ): Promise<{ valid: boolean; violations: string[]; payload: any } | null> {
    const session = await this.getSession(organizationId, actorId, sessionId)
    if (!session) return null

    const messages = await CopilotMessage.query()
      .where('session_db_id', session.id)
      .orderBy('sequence', 'asc')

    const payload = {
      sessionId: session.sessionId,
      scope: session.scope,
      attribution: session.attribution,
      status: session.status,
      title: session.title,
      archived: session.archived,
      actorId: session.actorId,
      createdAt: session.createdAt?.toISO() ?? '',
      updatedAt: session.updatedAt?.toISO() ?? session.createdAt?.toISO() ?? '',
      messages: messages.map((m) => ({
        messageId: m.messageId,
        role: m.role,
        contentSummary: m.contentSummary,
        truncated: m.truncated,
        sourceRefs: m.sourceRefs,
        warningCodes: m.warningCodes,
        degradedReason: m.degradedReason,
        sequence: m.sequence,
        createdAt: m.createdAt?.toISO() ?? '',
      })),
    }

    const validation = validateCopilotSessionExport(payload)
    return { ...validation, payload }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * 按「组织 + 归属人 + sessionId」取会话。
   *
   * 会话是个人对话记录：同组织其他成员（含组织管理员）拿到 sessionId 也不能读写；
   * 不匹配一律当作不存在，不区分「别人的」与「没有」，不泄露存在性。
   */
  private async getSession(
    organizationId: number,
    actorId: number,
    sessionId: string,
  ): Promise<CopilotSession | null> {
    return CopilotSession.query()
      .where('organization_id', organizationId)
      .where('actor_id', actorId)
      .where('session_id', sessionId)
      .first()
  }

  /** 会话是否属于该用户（续接客户端带来的 sessionId 前先行校验）。 */
  async isOwnedBy(organizationId: number, actorId: number, sessionId: string): Promise<boolean> {
    return (await this.getSession(organizationId, actorId, sessionId)) !== null
  }

  private validateScopeAttribution(
    scope: CopilotScope,
    attribution: CopilotSessionAttribution,
  ): void {
    if (scope === 'organization' && !attribution.organizationId) {
      throw new Error('organization scope requires organizationId in attribution')
    }
    if (scope === 'project' && (!attribution.organizationId || !attribution.projectId)) {
      throw new Error('project scope requires organizationId and projectId in attribution')
    }
    if (scope === 'portfolio' && (!attribution.organizationId || !attribution.portfolioId)) {
      throw new Error('portfolio scope requires organizationId and portfolioId in attribution')
    }
    if (
      scope === 'entity' &&
      (!attribution.organizationId || !attribution.entityType || !attribution.entityId)
    ) {
      throw new Error(
        'entity scope requires organizationId, entityType and entityId in attribution',
      )
    }
  }
}

export const copilotSessionService = new CopilotSessionService()
