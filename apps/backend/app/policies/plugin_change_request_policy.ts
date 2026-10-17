/**
 * v3-plugin-approval-change-flow —— PluginChangeRequestPolicy（统一变更请求 RBAC Policy）。
 *
 * RBAC 策略：view / manage / approve 三级。
 * - view：查看组织内变更请求与决策流水
 * - manage：发起/预览/撤回/签发句柄/最终确认
 * - approve：审批或拒绝（maker-checker 审批者；服务层另行强制审批者 ≠ 发起人）
 * 跨组织不可区分：查询经 Model.forOrganization，未命中按 404 处理。
 */
import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import {
  PLUGIN_CHANGE_REQUEST_VIEW,
  PLUGIN_CHANGE_REQUEST_MANAGE,
  PLUGIN_CHANGE_REQUEST_APPROVE,
  type Permission,
} from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class PluginChangeRequestPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number): Promise<boolean> {
    return this.allows(PLUGIN_CHANGE_REQUEST_VIEW, user, organizationId)
  }

  async manage(user: User, organizationId: number): Promise<boolean> {
    return this.allows(PLUGIN_CHANGE_REQUEST_MANAGE, user, organizationId)
  }

  async approve(user: User, organizationId: number): Promise<boolean> {
    return this.allows(PLUGIN_CHANGE_REQUEST_APPROVE, user, organizationId)
  }

  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.view(user, organizationId))) {
      throw new PermissionDeniedException('无权查看插件变更请求')
    }
  }

  async authorizeManage(user: User, organizationId: number): Promise<void> {
    if (!(await this.manage(user, organizationId))) {
      throw new PermissionDeniedException('无权管理插件变更请求')
    }
  }

  async authorizeApprove(user: User, organizationId: number): Promise<void> {
    if (!(await this.approve(user, organizationId))) {
      throw new PermissionDeniedException('无权审批插件变更请求')
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
