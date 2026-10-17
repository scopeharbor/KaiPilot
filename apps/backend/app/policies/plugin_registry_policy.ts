/**
 * v3-plugin-private-registry-lifecycle — PluginRegistryPolicy（task 5.1/5.2 partial）。
 *
 * RBAC 策略：view/submit/review/manage/rollback 权限检查。
 * 所有检查经 RbacService 走组织级 scope。
 *
 * 红线：Policy 只判定权限，不操作数据。
 */
import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import {
  PLUGIN_REGISTRY_VIEW,
  PLUGIN_REGISTRY_SUBMIT,
  PLUGIN_REGISTRY_REVIEW,
  PLUGIN_REGISTRY_MANAGE,
  PLUGIN_REGISTRY_ROLLBACK,
  type Permission,
} from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class PluginRegistryPolicy {
  constructor(private rbac: RbacService) {}

  /**
   * 查看组织私有插件目录
   */
  async view(user: User, organizationId: number): Promise<boolean> {
    return this.allows(PLUGIN_REGISTRY_VIEW, user, organizationId)
  }

  /**
   * 提交 release 送审
   */
  async submit(user: User, organizationId: number): Promise<boolean> {
    return this.allows(PLUGIN_REGISTRY_SUBMIT, user, organizationId)
  }

  /**
   * 审批/拒绝 release
   */
  async review(user: User, organizationId: number): Promise<boolean> {
    return this.allows(PLUGIN_REGISTRY_REVIEW, user, organizationId)
  }

  /**
   * 弃用/撤回/恢复管理操作
   */
  async manage(user: User, organizationId: number): Promise<boolean> {
    return this.allows(PLUGIN_REGISTRY_MANAGE, user, organizationId)
  }

  /**
   * 确认回滚操作
   */
  async rollback(user: User, organizationId: number): Promise<boolean> {
    return this.allows(PLUGIN_REGISTRY_ROLLBACK, user, organizationId)
  }

  /**
   * Authorize view — throws if denied
   */
  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.view(user, organizationId))) {
      throw new PermissionDeniedException('无权查看私有插件目录')
    }
  }

  /**
   * Authorize submit — throws if denied
   */
  async authorizeSubmit(user: User, organizationId: number): Promise<void> {
    if (!(await this.submit(user, organizationId))) {
      throw new PermissionDeniedException('无权提交插件 release')
    }
  }

  /**
   * Authorize review — throws if denied
   */
  async authorizeReview(user: User, organizationId: number): Promise<void> {
    if (!(await this.review(user, organizationId))) {
      throw new PermissionDeniedException('无权审批插件 release')
    }
  }

  /**
   * Authorize manage — throws if denied
   */
  async authorizeManage(user: User, organizationId: number): Promise<void> {
    if (!(await this.manage(user, organizationId))) {
      throw new PermissionDeniedException('无权管理插件 release')
    }
  }

  /**
   * Authorize rollback — throws if denied
   */
  async authorizeRollback(user: User, organizationId: number): Promise<void> {
    if (!(await this.rollback(user, organizationId))) {
      throw new PermissionDeniedException('无权确认回滚操作')
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
