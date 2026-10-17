import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import Notification from '#models/notification'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { NOTIFICATION_MANAGE_SELF, NOTIFICATION_VIEW, type Permission } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * 通知策略（v2-notification-center）：
 * 确保通知读取、已读、批量操作只能作用于当前组织内当前用户。
 *
 * 设计原则（D1）：
 * - 通知是接收人私有资源，不存在跨用户共享或组织级别通知
 * - 所有操作同时验证 organization_id 与 recipient_id
 * - 未认证用户由 auth 中间件拦截，本策略不处理
 */
@inject()
export default class NotificationPolicy {
  constructor(private rbac: RbacService) {}

  /**
   * 检查用户是否可查看通知列表。
   * 所有已认证用户在其当前组织内均可查看自己的通知。
   */
  async view(user: User, organizationId: number): Promise<boolean> {
    return this.allows(NOTIFICATION_VIEW, user, organizationId)
  }

  /**
   * 检查用户是否可操作通知（单条 / 批量）。
   * 只能操作当前组织内属于自己的通知。
   */
  async manageSelf(user: User, organizationId: number): Promise<boolean> {
    return this.allows(NOTIFICATION_MANAGE_SELF, user, organizationId)
  }

  /**
   * 检查用户是否可标记某条通知为已读（单条 / 全部）。
   */
  async markRead(
    user: User,
    organizationId: number,
    notification?: Notification,
  ): Promise<boolean> {
    if (!this.allows(NOTIFICATION_MANAGE_SELF, user, organizationId)) return false
    if (notification) {
      return (
        Number(notification.organizationId) === organizationId &&
        Number(notification.recipientId) === user.id
      )
    }
    return true
  }

  /**
   * 断言可读取通知列表，否则抛 PERMISSION_DENIED。
   */
  async authorizeView(user: User, organizationId: number): Promise<void> {
    const ok = await this.view(user, organizationId)
    if (!ok) {
      throw new PermissionDeniedException('无权查看通知')
    }
  }

  /**
   * 断言可进行批量操作（view 权限已足够，manage_self 确认可操作）。
   */
  async authorizeBatch(user: User, organizationId: number): Promise<void> {
    const ok = await this.manageSelf(user, organizationId)
    if (!ok) {
      throw new PermissionDeniedException('无权操作通知')
    }
  }

  /**
   * 断言可标记单条通知已读。
   */
  async authorizeMarkRead(
    user: User,
    organizationId: number,
    notification: Notification,
  ): Promise<void> {
    if (Number(notification.organizationId) !== organizationId) {
      throw new ResourceNotFoundException('通知不存在')
    }
    if (Number(notification.recipientId) !== user.id) {
      throw new PermissionDeniedException('无法操作他人的通知')
    }
  }

  private async allows(
    permission: Permission,
    user: User,
    organizationId: number,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, permission, organizationId)
    return result.allowed
  }
}
