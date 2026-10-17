/**
 * v3-skill-as-plugin-adapter —— PluginInstallPolicy（W2b 安装生命周期 RBAC Policy）。
 *
 * RBAC 策略：view/manage 权限检查。
 * 所有检查经 RbacService 走组织级 scope。
 * 跨组织操作不可区分：返回 ResourceNotFoundError 或统一 404 隐藏存在性。
 */
import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { PLUGIN_INSTALL_VIEW, PLUGIN_INSTALL_MANAGE, type Permission } from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class PluginInstallPolicy {
  constructor(private rbac: RbacService) {}

  /**
   * 查看组织插件安装态
   */
  async view(user: User, organizationId: number): Promise<boolean> {
    return this.allows(PLUGIN_INSTALL_VIEW, user, organizationId)
  }

  /**
   * 管理组织插件安装态（安装/启用/停用/升级/卸载）
   */
  async manage(user: User, organizationId: number): Promise<boolean> {
    return this.allows(PLUGIN_INSTALL_MANAGE, user, organizationId)
  }

  /**
   * 授权查看 — 无权则抛出异常
   */
  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.view(user, organizationId))) {
      throw new PermissionDeniedException('无权查看插件安装信息')
    }
  }

  /**
   * 授权管理 — 无权则抛出异常
   */
  async authorizeManage(user: User, organizationId: number): Promise<void> {
    if (!(await this.manage(user, organizationId))) {
      throw new PermissionDeniedException('无权管理插件安装状态')
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
