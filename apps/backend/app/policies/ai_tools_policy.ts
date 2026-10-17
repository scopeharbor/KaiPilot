// apps/backend — v3-ai-tools-orchestration-layer —— AI 工具统一安全策略守卫（W1）。
//
// 门禁（change design.md D4/§5、spec「统一工具执行入口与服务端强制 RBAC 及组织隔离」）：
// - `authorizeExecute`：先校验 `ai:trigger` 基础权限，再循环校验工具声明的领域业务权限；
// - `authorizeConfirm`：先校验 `ai:confirm` 基础权限，再校验提交所需的写权限；
// - 超级管理员直接放行（系统内既有 RBAC 语义）。
//
// RL-05 防探测：`RbacService.check` 在 projectId 不属于当前组织时返回
// `reason: 'cross_org_denied'`——此时**必须**抛 404 `RESOURCE_NOT_FOUND` 而非 403，
// 严禁泄露目标资源在其他组织中的存在性（spec：跨组织访问统一 404）。
// 目标资源不存在（非跨组织）同样由领域 Service 层抛 404。

import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { AI_CONFIRM, AI_TRIGGER, isPermission, type Permission } from '#rbac'

@inject()
export default class AiToolsPolicy {
  constructor(private rbac: RbacService) {}

  async authorizeExecute(
    user: User,
    organizationId: number,
    requiredPermissions: readonly string[],
    projectId?: number,
  ): Promise<void> {
    if (user.isSuperAdmin) return
    await this.requireBasePermission(
      user,
      organizationId,
      AI_TRIGGER,
      '缺少 AI 基础触发权限 (ai:trigger)',
    )
    await this.requireDomainPermissions(
      user,
      organizationId,
      requiredPermissions,
      projectId,
      '执行',
    )
  }

  async authorizeConfirm(
    user: User,
    organizationId: number,
    requiredPermissions: readonly string[],
    projectId?: number,
  ): Promise<void> {
    if (user.isSuperAdmin) return
    await this.requireBasePermission(
      user,
      organizationId,
      AI_CONFIRM,
      '缺少 AI 确认权限 (ai:confirm)',
    )
    await this.requireDomainPermissions(
      user,
      organizationId,
      requiredPermissions,
      projectId,
      '提交',
    )
  }

  private async requireBasePermission(
    user: User,
    organizationId: number,
    permission: Permission,
    message: string,
  ): Promise<void> {
    const result = await this.rbac.check(user, permission, organizationId)
    if (!result.allowed) {
      throw new PermissionDeniedException(message)
    }
  }

  private async requireDomainPermissions(
    user: User,
    organizationId: number,
    requiredPermissions: readonly string[],
    projectId: number | undefined,
    actionLabel: '执行' | '提交',
  ): Promise<void> {
    for (const perm of requiredPermissions) {
      if (!isPermission(perm)) {
        throw new PermissionDeniedException(`缺少${actionLabel}该工具所需权限 (${perm})`)
      }
      const result = await this.rbac.check(user, perm, organizationId, projectId)
      if (!result.allowed) {
        if (result.reason === 'cross_org_denied') {
          throw new ResourceNotFoundException('资源不存在或无权访问')
        }
        throw new PermissionDeniedException(`缺少${actionLabel}该工具所需权限 (${perm})`)
      }
    }
  }
}
