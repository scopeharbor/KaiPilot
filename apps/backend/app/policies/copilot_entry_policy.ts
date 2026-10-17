/**
 * v3-copilot-productized-operating-entry —— 入口授权适配（任务 3.1）。
 *
 * 本 Policy **不做新的权限判定**，只把既有权威适配成 readiness 聚合服务需要的形状：
 * - Copilot 可用性 → `RbacService.check(user, 'ai:trigger', organizationId)`
 * - 项目 scope 可见性 → `RbacService.check(user, 'project:view', organizationId, projectId)`
 *   （该判定内部已复核项目归属组织，跨组织/伪造 projectId 返回 `cross_org_denied`）
 * - quick start 权限过滤 → 同一 `RbacService.check`
 *
 * 红线：判定失败**只返回布尔**，不回传 reason、项目名称、存在性或计数——
 * 这些都会成为跨租侧信道（spec: MUST NOT reveal the inaccessible scope's
 * name, identifier, count or existence）。
 */

import { inject } from '@adonisjs/core'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { AI_TRIGGER, PROJECT_VIEW, isPermission } from '#rbac'

@inject()
export default class CopilotEntryPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** actor 在当前组织是否可用 Copilot。 */
  async canUseCopilot(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, AI_TRIGGER, organizationId)
    return result.allowed
  }

  /**
   * 请求的 project scope 是否可见。
   *
   * 跨组织、已删除、不存在与无权项目一律返回 false —— 调用方不得区分这四种情况。
   */
  async canAccessProject(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (!Number.isInteger(projectId) || projectId <= 0) return false
    const result = await this.rbac.check(user, PROJECT_VIEW, organizationId, projectId)
    return result.allowed
  }

  /** quick start 过滤用的通用权限判定（组织级，可带已授权 project scope）。 */
  async hasPermission(
    user: User,
    organizationId: number,
    permission: string,
    projectId?: number,
  ): Promise<boolean> {
    if (!isPermission(permission)) {
      return false
    }
    const result = await this.rbac.check(user, permission, organizationId, projectId)
    return result.allowed
  }
}
