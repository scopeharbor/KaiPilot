/**
 * CopilotSessionRetentionController — Copilot 会话保留治理 API 控制器（v3-copilot-session-retention）
 *
 * `/api/v1/copilot-sessions/retention` 端点：
 * - GET  /policy          — 读取保留策略
 * - PUT  /policy          — 更新保留策略（admin / retention manager）
 * - GET  /status          — 项目级保留状态汇总
 * - GET  /:sessionId/summary — 单会话保留摘要
 * - GET  /sessions        — 分页列出会话（含保留信息）
 * - POST /:sessionId/delete  — 两步删除请求
 * - POST /cleanup         — 批量清理过期会话（admin）
 * - GET  /:sessionId/deletion-status — 检查会话删除状态
 *
 * RBAC：
 *   - 策略读取：组织内任意已认证用户
 *   - 策略写入：admin 或 retention manager
 *   - 删除：会话所有者或 admin
 *   - 清理：admin
 */

import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import { PermissionDeniedException, ValidationException } from '#exceptions/api_exception'
import AuditService, { AuditEvent } from '#services/audit_service'

// ────────────────────────────────────────────────────────────────────────────
// Service 接口 —— 由 CopilotSessionRetentionService 实现
// 为避免循环依赖，此处只声明调用契约，不在 Controller 层引用具体实现。
// ────────────────────────────────────────────────────────────────────────────

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

/** 保留管理 Service 需要实现的方法签名 */
export interface CopilotSessionRetentionServiceContract {
  getPolicy(organizationId: number, projectId: number | null): Promise<RetentionPolicyDto>
  updatePolicy(
    organizationId: number,
    projectId: number | null,
    input: { retentionDays: number; enabled: boolean },
    userId: number,
  ): Promise<RetentionPolicyDto>
  getStatus(organizationId: number, projectId: number): Promise<RetentionStatusDto>
  getSessionSummary(
    organizationId: number,
    sessionId: string,
  ): Promise<SessionRetentionSummaryDto | null>
  listSessionsWithRetention(
    organizationId: number,
    projectId: number | null,
    page: number,
    perPage: number,
  ): Promise<{
    data: SessionWithRetentionDto[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }>
  previewDeletion(
    organizationId: number,
    sessionId: string,
    userId: number,
  ): Promise<SessionDeletionResult>
  executeDeletion(
    organizationId: number,
    sessionId: string,
    userId: number,
  ): Promise<SessionDeletionResult>
  getDeletionStatus(
    organizationId: number,
    sessionId: string,
  ): Promise<SessionDeletionStatusDto | null>
  executeCleanup(
    organizationId: number,
    projectId: number,
    batchSize: number,
    userId: number,
  ): Promise<CleanupResultDto>
}

/** 保留策略 Policy 需要实现的方法签名 */
export interface CopilotSessionRetentionPolicyContract {
  assertView(user: User, organizationId: number, projectId: number | null): Promise<void>
  assertManage(user: User, organizationId: number, projectId: number | null): Promise<void>
  assertDelete(user: User, organizationId: number, sessionId: string): Promise<void>
  assertCleanup(user: User, organizationId: number): Promise<void>
}

import { CopilotSessionRetentionService } from '#services/copilot_session/copilot_session_retention_service'

/** 注入 token —— 由 IoC 容器绑定 */
export const CopilotSessionRetentionServiceToken = 'services/copilot-session-retention'
export const CopilotSessionRetentionPolicyToken = 'policies/copilot-session-retention'

import OrganizationMember from '#models/organization_member'

class DefaultCopilotSessionRetentionPolicy implements CopilotSessionRetentionPolicyContract {
  async assertView(user: User, organizationId: number, _projectId: number | null): Promise<void> {
    const member = await OrganizationMember.query()
      .where('organization_id', organizationId)
      .where('user_id', user.id)
      .first()
    if (!member) {
      throw new PermissionDeniedException('无权访问该组织')
    }
  }

  async assertManage(user: User, organizationId: number, _projectId: number | null): Promise<void> {
    const member = await OrganizationMember.query()
      .where('organization_id', organizationId)
      .where('user_id', user.id)
      .first()
    if (!member) {
      throw new PermissionDeniedException('无权访问该组织')
    }
    if (member.role !== 'admin' && member.role !== 'owner' && member.role !== 'project_manager') {
      throw new PermissionDeniedException('只有管理员或项目经理可以管理保留策略')
    }
  }

  async assertDelete(user: User, organizationId: number, _sessionId: string): Promise<void> {
    const member = await OrganizationMember.query()
      .where('organization_id', organizationId)
      .where('user_id', user.id)
      .first()
    if (!member) {
      throw new PermissionDeniedException('无权访问该组织')
    }
  }

  async assertCleanup(user: User, organizationId: number): Promise<void> {
    const member = await OrganizationMember.query()
      .where('organization_id', organizationId)
      .where('user_id', user.id)
      .first()
    if (!member) {
      throw new PermissionDeniedException('无权访问该组织')
    }
    if (member.role !== 'admin' && member.role !== 'owner') {
      throw new PermissionDeniedException('只有管理员可以执行清理')
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Controller
// ────────────────────────────────────────────────────────────────────────────

@inject()
export default class CopilotSessionRetentionController {
  private service: CopilotSessionRetentionServiceContract
  private policy: CopilotSessionRetentionPolicyContract

  constructor(private audit: AuditService) {
    this.service = new CopilotSessionRetentionService()
    this.policy = new DefaultCopilotSessionRetentionPolicy()
  }

  // ── 私有工具方法 ──

  private orgIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  private userOf(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private userIdOf(ctx: HttpContext): number {
    return Number(this.userOf(ctx).id)
  }

  private sessionIdOf(ctx: HttpContext): string {
    const { sessionId } = ctx.params
    if (!sessionId || typeof sessionId !== 'string') {
      throw new ValidationException('sessionId 参数缺失')
    }
    return sessionId
  }

  private async auditEvent(
    userId: number,
    orgId: number,
    event: (typeof AuditEvent)[keyof typeof AuditEvent],
    metadata: Record<string, unknown>,
  ) {
    return this.audit.log({
      event,
      userId,
      organizationId: orgId,
      metadata,
    })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1. GET /policy — 读取保留策略
  // ──────────────────────────────────────────────────────────────────────────
  async readPolicy(ctx: HttpContext) {
    const { request, response } = ctx
    const orgId = this.orgIdOf(ctx)
    const user = this.userOf(ctx)
    const projectId = request.input('projectId')

    // RBAC：组织内任意已认证用户可读
    await this.policy.assertView(user, orgId, projectId ?? null)

    const result = await this.service.getPolicy(orgId, projectId ?? null)

    await this.auditEvent(
      this.userIdOf(ctx),
      orgId,
      AuditEvent.COPILOT_SESSION_RETENTION_POLICY_READ,
      {
        actorId: this.userIdOf(ctx),
        organizationId: orgId,
        projectId: projectId ?? null,
      },
    )

    return response.ok({ data: result })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. PUT /policy — 更新保留策略
  // ──────────────────────────────────────────────────────────────────────────
  async updatePolicy(ctx: HttpContext) {
    const { request, response } = ctx
    const orgId = this.orgIdOf(ctx)
    const user = this.userOf(ctx)
    const userId = this.userIdOf(ctx)

    const { projectId, retentionDays, enabled } = request.only([
      'projectId',
      'retentionDays',
      'enabled',
    ])

    if (retentionDays === undefined || retentionDays === null) {
      throw new ValidationException('retentionDays 为必填')
    }
    if (typeof retentionDays !== 'number' || retentionDays < 1) {
      throw new ValidationException('retentionDays 必须为正整数')
    }
    if (typeof enabled !== 'boolean') {
      throw new ValidationException('enabled 必须为布尔值')
    }

    // RBAC：admin 或 retention manager
    await this.policy.assertManage(user, orgId, projectId ?? null)

    const result = await this.service.updatePolicy(
      orgId,
      projectId ?? null,
      { retentionDays, enabled },
      userId,
    )

    await this.auditEvent(userId, orgId, AuditEvent.COPILOT_SESSION_RETENTION_POLICY_UPDATED, {
      actorId: userId,
      organizationId: orgId,
      projectId: projectId ?? null,
      retentionDays,
      enabled,
    })

    return response.ok({ data: result })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. GET /status — 项目级保留状态
  // ──────────────────────────────────────────────────────────────────────────
  async getStatus(ctx: HttpContext) {
    const { request, response } = ctx
    const orgId = this.orgIdOf(ctx)
    const user = this.userOf(ctx)
    const projectId = Number(request.input('projectId'))

    if (!projectId) {
      throw new ValidationException('projectId 为必填')
    }

    await this.policy.assertView(user, orgId, projectId)

    const result = await this.service.getStatus(orgId, projectId)

    await this.auditEvent(
      this.userIdOf(ctx),
      orgId,
      AuditEvent.COPILOT_SESSION_RETENTION_STATUS_READ,
      {
        actorId: this.userIdOf(ctx),
        organizationId: orgId,
        projectId,
      },
    )

    return response.ok({ data: result })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. GET /:sessionId/summary — 单会话保留摘要
  // ──────────────────────────────────────────────────────────────────────────
  async getSessionSummary(ctx: HttpContext) {
    const { response } = ctx
    const orgId = this.orgIdOf(ctx)
    const user = this.userOf(ctx)
    const sessionId = this.sessionIdOf(ctx)

    await this.policy.assertView(user, orgId, null)

    const result = await this.service.getSessionSummary(orgId, sessionId)

    if (!result) {
      return response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '会话不存在' },
      })
    }

    return response.ok({ data: result })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 5. GET /sessions — 分页列出会话（含保留信息）
  // ──────────────────────────────────────────────────────────────────────────
  async listSessions(ctx: HttpContext) {
    const { request, response } = ctx
    const orgId = this.orgIdOf(ctx)
    const user = this.userOf(ctx)
    const projectId = Number(request.input('projectId')) || null
    const page = Number(request.input('page', 1))
    const perPage = Math.min(Number(request.input('perPage', 20)), 100)

    if (projectId) {
      await this.policy.assertView(user, orgId, projectId)
    }

    const result = await this.service.listSessionsWithRetention(orgId, projectId, page, perPage)

    return response.ok({
      data: result.data,
      meta: result.meta,
    })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 6. POST /:sessionId/delete — 两步删除请求
  // ──────────────────────────────────────────────────────────────────────────
  async requestDeletion(ctx: HttpContext) {
    const { request, response } = ctx
    const orgId = this.orgIdOf(ctx)
    const user = this.userOf(ctx)
    const userId = this.userIdOf(ctx)
    const sessionId = this.sessionIdOf(ctx)

    const { confirm } = request.only(['confirm'])

    // RBAC：会话所有者或 admin
    await this.policy.assertDelete(user, orgId, sessionId)

    // 第一步：未确认时返回预览
    if (confirm !== true) {
      const preview = await this.service.previewDeletion(orgId, sessionId, userId)

      return response.ok({
        data: {
          ...preview,
          requiresConfirmation: true,
          message: '此操作不可逆，再次请求并传入 confirm: true 以执行删除',
        },
      })
    }

    // 第二步：确认后执行删除
    const result = await this.service.executeDeletion(orgId, sessionId, userId)

    await this.auditEvent(userId, orgId, AuditEvent.COPILOT_SESSION_RETENTION_DELETED, {
      actorId: userId,
      organizationId: orgId,
      sessionId,
    })

    return response.ok({ data: result })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 7. POST /cleanup — 批量清理过期会话
  // ──────────────────────────────────────────────────────────────────────────
  async executeCleanup(ctx: HttpContext) {
    const { request, response } = ctx
    const orgId = this.orgIdOf(ctx)
    const user = this.userOf(ctx)
    const userId = this.userIdOf(ctx)

    const { projectId, batchSize } = request.only(['projectId', 'batchSize'])

    if (!projectId) {
      throw new ValidationException('projectId 为必填')
    }

    const resolvedBatchSize = Math.min(Math.max(Number(batchSize ?? 50), 1), 200)

    // RBAC：admin only
    await this.policy.assertCleanup(user, orgId)

    const result = await this.service.executeCleanup(orgId, projectId, resolvedBatchSize, userId)

    await this.auditEvent(userId, orgId, AuditEvent.COPILOT_SESSION_RETENTION_CLEANUP_EXECUTED, {
      actorId: userId,
      organizationId: orgId,
      projectId,
      deletedCount: result.deletedCount,
      failedCount: result.failedCount,
    })

    return response.ok({ data: result })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 8. GET /:sessionId/deletion-status — 检查会话删除状态
  // ──────────────────────────────────────────────────────────────────────────
  async getDeletionStatus(ctx: HttpContext) {
    const { response } = ctx
    const orgId = this.orgIdOf(ctx)
    const user = this.userOf(ctx)
    const sessionId = this.sessionIdOf(ctx)

    await this.policy.assertView(user, orgId, null)

    const result = await this.service.getDeletionStatus(orgId, sessionId)

    if (!result) {
      return response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '会话不存在' },
      })
    }

    return response.ok({ data: result })
  }
}
