// @aiproj/backend — V3 TRIZ 矛盾矩阵审查 Policy
// v3-triz-contradiction-matrix-ui / design D2 §3.4
//
// Policy 职责：
// - contradiction:view → 矩阵查看
// - 项目成员身份（通过 `contradiction:view` 权限间接保证）
// - 组织隔离由 RBAC Service 校验
// - 可选 Workbench/Handoff 权限（用于可用操作标记）

import type User from '#models/user'
import RbacService from '#services/rbac_service'
import {
  CONTRADICTION_VIEW,
  TRIZ_INNOVATION_VIEW,
  TRIZ_INNOVATION_HANDOFF,
  RATIONALE_VIEW,
} from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class TrizContradictionMatrixPolicy {
  constructor(private rbac: RbacService) {}

  /**
   * 查看矩阵（仅需 contradiction:view + 项目成员身份）。
   */
  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, CONTRADICTION_VIEW, organizationId, projectId)
    return result.allowed
  }

  /**
   * 查询可选操作状态：Workbench 是否可用。
   */
  async canAccessWorkbench(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, TRIZ_INNOVATION_VIEW, organizationId, projectId)
    return result.allowed
  }

  /**
   * 查询 handoff 权限。
   */
  async canHandoff(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, TRIZ_INNOVATION_HANDOFF, organizationId, projectId)
    return result.allowed
  }

  /**
   * 查询 rationale 权限。
   */
  async canAccessRationale(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, RATIONALE_VIEW, organizationId, projectId)
    return result.allowed
  }

  /**
   * 批量获取矩阵 scope 信息。
   */
  async resolveScope(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<{
    hasViewPermission: boolean
    canAccessWorkbench: boolean
    canAccessRationale: boolean
  }> {
    const [view, workbench, rationale] = await Promise.all([
      this.view(user, organizationId, projectId),
      this.canAccessWorkbench(user, organizationId, projectId),
      this.canAccessRationale(user, organizationId, projectId),
    ])
    return {
      hasViewPermission: view,
      canAccessWorkbench: workbench,
      canAccessRationale: rationale,
    }
  }
}
