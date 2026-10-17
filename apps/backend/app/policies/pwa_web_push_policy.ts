import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { NOTIFICATION_MANAGE_SELF, type Permission } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * PWA Web Push 订阅策略（v2-5-pwa-web-push-notifications）。
 *
 * 所有已认证用户在当前组织内均可管理自己的推送订阅。
 * 订阅是用户私有资源，不存在跨用户管理。
 */
@inject()
export default class PwaWebPushPolicy {
  constructor(private rbac: RbacService) {}

  /**
   * 检查用户是否可管理推送订阅。
   */
  async manage(user: User, organizationId: number): Promise<boolean> {
    return this.allows(NOTIFICATION_MANAGE_SELF, user, organizationId)
  }

  /**
   * 断言可管理推送订阅，否则抛 PERMISSION_DENIED。
   */
  async authorizeManage(user: User, organizationId: number): Promise<void> {
    const ok = await this.manage(user, organizationId)
    if (!ok) {
      throw new PermissionDeniedException('无权管理推送订阅')
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
