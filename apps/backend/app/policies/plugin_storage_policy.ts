/**
 * v3-plugin-scoped-storage —— PluginStoragePolicy（任务 4.1）。
 *
 * RBAC 策略：view / manage / export 三权分立（对齐 PLUGIN_STORAGE_* 权限常量）。
 * 所有检查经 RbacService 走组织级 scope；跨组织操作不可区分（统一 404 隐藏存在性）。
 */
import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import {
  PLUGIN_STORAGE_VIEW,
  PLUGIN_STORAGE_MANAGE,
  PLUGIN_STORAGE_EXPORT,
  type Permission,
} from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class PluginStoragePolicy {
  constructor(private rbac: RbacService) {}

  /** 查看组织插件存储 namespace/配额/用量 */
  async view(user: User, organizationId: number): Promise<boolean> {
    return this.allows(PLUGIN_STORAGE_VIEW, user, organizationId)
  }

  /** 管理插件存储（runtime 写入授权、清理 preview/confirm） */
  async manage(user: User, organizationId: number): Promise<boolean> {
    return this.allows(PLUGIN_STORAGE_MANAGE, user, organizationId)
  }

  /** 导出本组织插件存储数据 */
  async export(user: User, organizationId: number): Promise<boolean> {
    return this.allows(PLUGIN_STORAGE_EXPORT, user, organizationId)
  }

  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.view(user, organizationId))) {
      throw new PermissionDeniedException('无权查看插件存储')
    }
  }

  async authorizeManage(user: User, organizationId: number): Promise<void> {
    if (!(await this.manage(user, organizationId))) {
      throw new PermissionDeniedException('无权管理插件存储')
    }
  }

  async authorizeExport(user: User, organizationId: number): Promise<void> {
    if (!(await this.export(user, organizationId))) {
      throw new PermissionDeniedException('无权导出插件存储数据')
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
