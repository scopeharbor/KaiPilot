/**
 * v3-plugin-action-preview-boundary —— PluginActionPolicy。
 *
 * RBAC 策略：view（查看提案与预览）/ confirm（决策与确认执行）两级。
 * 同时负责把 actor 的权限集解析给 boundary service（descriptor.requiredPermissions 比对）。
 * 跨组织操作统一 404 隐藏存在性（由 service 层组织隔离查询保证）。
 */
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { PLUGIN_ACTION_VIEW, PLUGIN_ACTION_CONFIRM, type Permission } from '#rbac'

export const PLUGIN_ACTION_ACTOR_PERMISSIONS_FULL = [
  'plugin_action:view',
  'plugin_action:confirm',
] as const

@inject()
export default class PluginActionPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number): Promise<boolean> {
    return this.allows(PLUGIN_ACTION_VIEW, user, organizationId)
  }

  async confirm(user: User, organizationId: number): Promise<boolean> {
    return this.allows(PLUGIN_ACTION_CONFIRM, user, organizationId)
  }

  /**
   * 解析 actor 权限集（低敏：只含 plugin_action 域内布尔结果），
   * 供 boundary service 与 adapter descriptor.requiredPermissions 做集合比对。
   */
  async resolveActorPermissions(user: User, organizationId: number): Promise<string[]> {
    const perms: string[] = []
    if (await this.view(user, organizationId)) perms.push('plugin_action:view')
    if (await this.confirm(user, organizationId)) perms.push('plugin_action:confirm')
    return perms
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
