/**
 * v3-knowledge-memory-operating-layer —— Operating layer Policy。
 *
 * 设计 D5 / §4.13-4.14：
 * - 入口级权限：用户对组织必须有 `KNOWLEDGE_MEMORY_OPERATING_VIEW` 权限。
 * - 跨组织 / 跨项目 / 隐藏对象访问由聚合器 + adapter 强制；policy 仅做
 *   入口准入判定（满足 "can X" → bool，不查 db）。
 * - 跨租/隐藏的 404/403 一致性在 controller + adapter 层实现。
 * - 不在 policy 内做角色名解析（用 RbacService）。
 *
 * @aiproj/backend
 */

import { inject } from '@adonisjs/core'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { KNOWLEDGE_MEMORY_OPERATING_VIEW } from '#start/rbac/permissions'
import type { PermissionCheckResult } from '#types/auth'

@inject()
export default class KnowledgeMemoryOperatingPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** summary / list / detail / surface resolve 入口准入。 */
  async canView(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, KNOWLEDGE_MEMORY_OPERATING_VIEW, organizationId)
  }
}
