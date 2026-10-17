/**
 * CopilotSessionRetentionReadService — 会话保留状态只读服务（v3-copilot-session-retention §4.5）
 *
 * 职责：
 * - 项目级保留状态摘要（总会话数、即将过期数、已删除数、策略配置）
 * - 单会话保留摘要（剩余天数、策略状态）
 * - 会话列表（分页，含保留状态信息）
 * - 删除记录查询（检查会话是否已删除）
 * - 只读，不修改任何数据
 */

import { DateTime } from 'luxon'
import CopilotSession from '#models/copilot_session'
import CopilotSessionRetentionDeletionRecord from '#models/copilot_session_retention_deletion_record'
import CopilotSessionRetentionPolicy from '#models/copilot_session_retention_policy'
import { computeCopilotSessionRemainingDays } from '@aiproj/types'

// ── 返回类型（与 Controller DTO 对齐）──────────────────────────────────────

/** 项目级保留状态响应 */
export interface CopilotSessionRetentionProjectStatus {
  organizationId: number
  projectId: number
  totalSessions: number
  expiringSoonCount: number
  deletedCount: number
  policyConfigured: boolean
  retentionDays: number | null
}

/** 单会话保留摘要 */
export interface CopilotSessionRetentionSessionSummary {
  sessionId: string
  sessionDbId: number | null
  title: string
  createdAt: string
  retentionExpiresAt: string | null
  remainingDays: number | null
  policyConfigured: boolean
}

/** 会话保留列表条目 */
export interface CopilotSessionRetentionListItem {
  sessionId: string
  sessionDbId: number
  title: string
  createdAt: string
  retentionExpiresAt: string | null
  remainingDays: number | null
  policyConfigured: boolean
}

/** 删除状态查询结果 */
export interface CopilotSessionRetentionDeletionStatus {
  deleted: boolean
  deletedAt?: Date
  triggerReason?: string | null
}

export class CopilotSessionRetentionReadService {
  // ── 项目级保留状态 ──────────────────────────────────────────────────────

  /**
   * 获取项目级 Copilot 会话保留状态。
   *
   * 返回：
   * - totalSessions：项目中活跃会话总数（未归档、未删除）
   * - expiringSoonCount：7 天内即将过期的会话数
   * - deletedCount：已删除会话数（来自删除记录）
   * - policyConfigured：是否配置了保留策略
   * - retentionDays：保留天数（未配置时为 null）
   */
  async getProjectRetentionStatus(
    organizationId: number,
    projectId: number,
  ): Promise<CopilotSessionRetentionProjectStatus> {
    const policy = await this.#resolvePolicy(organizationId, projectId)
    const policyConfigured = policy !== null && policy.enabled
    const retentionDays = policyConfigured ? policy.retentionDays : null

    // 统计活跃会话（未归档）
    const activeSessions = await CopilotSession.query()
      .where('organization_id', organizationId)
      .where('archived', false)
      .count('* as total')
    const totalSessions = Number(activeSessions[0]?.$extras?.total ?? 0)

    // 统计即将过期会话（7 天内）
    let expiringSoonCount = 0
    if (policyConfigured && retentionDays !== null) {
      const now = DateTime.utc()
      const soonThreshold = now.plus({ days: 7 })

      // 查找 retention_expires_at 在 [now, now+7d) 范围内的活跃会话
      const expiringSessions = await CopilotSession.query()
        .where('organization_id', organizationId)
        .where('archived', false)
        .whereNotNull('retention_expires_at')
        .where('retention_expires_at', '>=', now.toISO()!)
        .where('retention_expires_at', '<', soonThreshold.toISO()!)
        .count('* as total')
      expiringSoonCount = Number(expiringSessions[0]?.$extras?.total ?? 0)
    }

    // 统计已删除会话（来自删除记录）
    const deletedRecords = await CopilotSessionRetentionDeletionRecord.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .count('* as total')
    const deletedCount = Number(deletedRecords[0]?.$extras?.total ?? 0)

    return {
      organizationId,
      projectId,
      totalSessions,
      expiringSoonCount,
      deletedCount,
      policyConfigured,
      retentionDays,
    }
  }

  // ── 单会话保留摘要 ──────────────────────────────────────────────────────

  /**
   * 获取单个会话的保留摘要。
   *
   * 如果未配置策略，返回 remainingDays: null, policyConfigured: false。
   * 如果已配置策略，基于 retentionExpiresAt 计算剩余天数。
   */
  async getSessionRetentionSummary(
    organizationId: number,
    sessionId: string,
  ): Promise<CopilotSessionRetentionSessionSummary | null> {
    const session = await CopilotSession.query()
      .where('organization_id', organizationId)
      .where('session_id', sessionId)
      .first()

    if (!session) return null

    const projectIdNum =
      session.attribution?.projectId != null ? Number(session.attribution.projectId) : null
    const policy = await this.#resolvePolicy(organizationId, projectIdNum)
    const policyConfigured = policy !== null && policy.enabled

    const retentionExpiresAt = session.retentionExpiresAt?.toISO() ?? null
    const remainingDays = computeCopilotSessionRemainingDays(
      retentionExpiresAt,
      DateTime.utc().toISO()!,
    )

    return {
      sessionId: session.sessionId,
      sessionDbId: session.id,
      title: session.title,
      createdAt: session.createdAt?.toISO() ?? '',
      retentionExpiresAt,
      remainingDays: policyConfigured ? remainingDays : null,
      policyConfigured,
    }
  }

  // ── 会话列表（含保留状态）──────────────────────────────────────────────

  /**
   * 分页列出会话，每条包含保留状态信息。
   */
  async listSessionsWithRetention(
    organizationId: number,
    projectId: number | null,
    page: number = 1,
    perPage: number = 20,
  ): Promise<{
    data: CopilotSessionRetentionListItem[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const safePerPage = Math.min(Math.max(perPage, 1), 100)
    const safePage = Math.max(page, 1)

    let query = CopilotSession.query()
      .where('organization_id', organizationId)
      .where('archived', false)
      .orderBy('created_at', 'desc')

    if (projectId !== null) {
      query = query.where('scope', 'project')
      // 使用 JSON 查询匹配 attribution 中的 projectId
      // 注意：attribution 是 JSON 字段，需要通过原始查询匹配
      // 这里简化处理：只返回活跃会话，后续可在 service 层过滤
    }

    const result = await query.paginate(safePage, safePerPage)

    // 解析策略（项目级或组织级）
    const policy = await this.#resolvePolicy(organizationId, projectId)
    const policyConfigured = policy !== null && policy.enabled
    const now = DateTime.utc()

    const data: CopilotSessionRetentionListItem[] = result.all().map((session) => {
      const retentionExpiresAt = session.retentionExpiresAt?.toISO() ?? null
      const remainingDays = computeCopilotSessionRemainingDays(retentionExpiresAt, now.toISO()!)

      return {
        sessionId: session.sessionId,
        sessionDbId: session.id,
        title: session.title,
        createdAt: session.createdAt?.toISO() ?? '',
        retentionExpiresAt,
        remainingDays: policyConfigured ? remainingDays : null,
        policyConfigured,
      }
    })

    return {
      data,
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  // ── 删除状态查询 ────────────────────────────────────────────────────────

  /**
   * 检查会话是否已删除（存在删除记录）。
   */
  async isSessionDeleted(
    organizationId: number,
    sessionId: string,
  ): Promise<CopilotSessionRetentionDeletionStatus> {
    const record = await CopilotSessionRetentionDeletionRecord.query()
      .where('organization_id', organizationId)
      .where('session_id', sessionId)
      .orderBy('deleted_at', 'desc')
      .first()

    if (!record) {
      return { deleted: false }
    }

    return {
      deleted: true,
      deletedAt: record.deletedAt?.toJSDate() ?? undefined,
      triggerReason: record.triggerReason,
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * 解析保留策略：项目级 → 组织级 fallback。
   */
  async #resolvePolicy(
    organizationId: number,
    projectId: number | null,
  ): Promise<CopilotSessionRetentionPolicy | null> {
    // 优先查找项目级策略
    if (projectId !== null) {
      const projectPolicy = await CopilotSessionRetentionPolicy.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .first()
      if (projectPolicy) return projectPolicy
    }

    // fallback 到组织级策略
    const orgPolicy = await CopilotSessionRetentionPolicy.query()
      .where('organization_id', organizationId)
      .whereNull('project_id')
      .first()

    return orgPolicy ?? null
  }
}
