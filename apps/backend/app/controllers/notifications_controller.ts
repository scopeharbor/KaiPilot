import NotificationPolicy from '#policies/notification_policy'
import NotificationService from '#services/notification_service'
import {
  listNotificationsValidator,
  MAX_PER_PAGE,
  batchOperationValidator,
} from '#validators/notification'
import { inject } from '@adonisjs/core'
import { PermissionDeniedException } from '#exceptions/api_exception'
import type { HttpContext } from '@adonisjs/core/http'
import type { NotificationType, NotificationSeverity, NotificationTypeGroup } from '#types/dto'
import type User from '#models/user'
import AuditService from '#services/audit_service'
import { AuditEvent } from '#services/audit_service'
import RealtimeBroadcaster from '#services/realtime/realtime_broadcaster'
import { RealtimeEvents } from '#types/realtime_events'

/**
 * 通知 API 控制器（v2-notification-center）：
 * - GET  /api/v1/notifications               通知列表（支持通知中心扩展筛选）
 * - GET  /api/v1/notifications/unread-count   未读数
 * - PATCH /api/v1/notifications/:id/read      单条已读
 * - PATCH /api/v1/notifications/read-all      全部已读
 * - POST /api/v1/notifications/batch          批量操作（V2 新增）
 */
@inject()
export default class NotificationsController {
  constructor(
    private notifications: NotificationService,
    private policy: NotificationPolicy,
    private audit: AuditService,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  /**
   * 解析当前组织上下文。通知是组织级资源；已认证但无组织（如未加入任何组织的
   * 个人账号）统一返回 403「需要组织上下文」，而不是让 `ctx.tenant!` 崩成 500。
   */
  private tenantOrganizationId(ctx: HttpContext): number {
    const organizationId = ctx.tenant?.organizationId ?? null
    if (organizationId === null || organizationId === undefined) {
      throw new PermissionDeniedException('需要组织上下文')
    }
    return Number(organizationId)
  }

  /**
   * GET /api/v1/notifications
   * 通知列表：支持通知中心扩展筛选参数。
   */
  async index(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.tenantOrganizationId(ctx)
    const raw = ctx.request.qs()
    const filters = await ctx.request.validateUsing(listNotificationsValidator, { data: raw })

    await this.policy.authorizeView(user, organizationId)

    // 强制分页上限
    const page = filters.page ?? 1
    const perPage = Math.min(filters.perPage ?? 20, MAX_PER_PAGE)

    const result = await this.notifications.listForUser(
      organizationId,
      user.id,
      {
        status: filters.status,
        typeGroup: filters.typeGroup as NotificationTypeGroup | undefined,
        type: filters.type as NotificationType | undefined,
        severity: filters.severity as NotificationSeverity | undefined,
        projectId: filters.projectId,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        hidden: filters.hidden as 'include' | 'exclude' | 'only' | undefined,
      },
      page,
      perPage,
    )

    return ctx.response.ok(result)
  }

  /**
   * GET /api/v1/notifications/unread-count
   * 未读通知数量。
   */
  async unreadCount(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.tenantOrganizationId(ctx)

    await this.policy.authorizeView(user, organizationId)

    const result = await this.notifications.getUnreadCount(organizationId, user.id)
    return ctx.response.ok(result)
  }

  /**
   * PATCH /api/v1/notifications/:id/read
   * 标记单条通知已读（幂等）。
   */
  async markRead(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.tenantOrganizationId(ctx)
    const id = Number(ctx.params.id)

    const notification = await this.notifications.markRead(organizationId, user.id, id)

    if (!notification.success) {
      await this.policy.authorizeMarkRead(user, organizationId, {
        organizationId: BigInt(0),
        recipientId: BigInt(0),
      } as any)
    }

    // 广播已读事件
    this.broadcastReadChange(user, organizationId)

    return ctx.response.ok({
      success: true,
      readAt: notification.readAt,
    })
  }

  /**
   * PATCH /api/v1/notifications/read-all
   * 全部标记已读。
   */
  async markAllRead(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.tenantOrganizationId(ctx)

    await this.policy.authorizeView(user, organizationId)

    const result = await this.notifications.markAllRead(organizationId, user.id)

    // 广播已读事件
    this.broadcastReadChange(user, organizationId)

    return ctx.response.ok(result)
  }

  /**
   * POST /api/v1/notifications/batch
   * 批量操作（V2 通知中心）。
   */
  async batch(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = this.tenantOrganizationId(ctx)

    await this.policy.authorizeView(user, organizationId)

    const body = await ctx.request.validateUsing(batchOperationValidator)
    const notificationIds = body.notificationIds ?? []

    const result = await this.notifications.batchOperation(
      organizationId,
      user.id,
      notificationIds,
      body.action,
    )

    // 记录低敏审计事件（禁止写入完整正文或 metadata）
    this.audit.log({
      event: AuditEvent.NOTIFICATION_BATCH,
      severity: 'info',
      userId: user.id,
      organizationId,
      entityType: 'notification',
      metadata: {
        action: body.action,
        affectedCount: result.affectedCount,
        notificationIdsCount: notificationIds.length,
      },
    })

    // 广播状态变更事件
    this.broadcastBatchChange(user, organizationId, body.action, result.affectedCount)

    return ctx.response.ok(result)
  }

  /**
   * 广播单条已读/全部已读事件到用户频道。
   */
  private broadcastReadChange(user: User, organizationId: number): void {
    try {
      const broadcaster = new RealtimeBroadcaster()
      broadcaster.broadcastToUser(user.id, {
        type: RealtimeEvents.NOTIFICATION_READ_STATUS_CHANGED,
        projectId: 0,
        entityId: 0,
        actorId: user.id,
        occurredAt: new Date().toISOString(),
        metadata: { organizationId },
      })
    } catch {
      // 广播失败不影响业务
    }
  }

  /**
   * 广播批量操作事件到用户频道。
   */
  private broadcastBatchChange(
    user: User,
    organizationId: number,
    action: string,
    affectedCount: number,
  ): void {
    try {
      const broadcaster = new RealtimeBroadcaster()
      broadcaster.broadcastToUser(user.id, {
        type: RealtimeEvents.NOTIFICATION_BATCH_PROCESSED,
        projectId: 0,
        entityId: 0,
        actorId: user.id,
        occurredAt: new Date().toISOString(),
        metadata: { organizationId, action, affectedCount },
      })
    } catch {
      // 广播失败不影响业务
    }
  }
}
