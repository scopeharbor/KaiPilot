/**
 * v2-traceability-source-attribution —— TraceabilityPolicy（task 6.2）。
 *
 * 校验来源归因与追溯链的只读权限。
 * 所有请求经 JWT、RBAC、组织隔离。
 *
 * @aiproj/backend
 */
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { AI_TRIGGER, PROJECT_VIEW } from '#start/rbac/permissions'
import type { PermissionCheckResult } from '#types/auth'

@inject()
export default class TraceabilityPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 是否可以查看来源归因。 */
  async canViewAttribution(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, AI_TRIGGER, organizationId)
  }

  /** 是否可以查看追溯链。 */
  async canViewTraceability(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, PROJECT_VIEW, organizationId)
  }
}
