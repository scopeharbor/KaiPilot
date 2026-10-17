/**
 * v3-four-layer-knowledge-system —— KnowledgePolicy（D7 三级 RBAC）。
 *
 * canViewKnowledge：读/检索
 * canAuthorKnowledge：创建/编辑知识
 * canManageKnowledge：生命周期治理/确认
 * 组织归属双检：每个方法都校验 organization_id。
 *
 * @aiproj/backend
 */
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { KNOWLEDGE_VIEW, KNOWLEDGE_AUTHOR, KNOWLEDGE_MANAGE } from '#start/rbac/permissions'
import type { PermissionCheckResult } from '#types/auth'

@inject()
export default class KnowledgePolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 是否可以查看知识库（列表/详情/查询/检索）。 */
  async canView(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, KNOWLEDGE_VIEW, organizationId)
  }

  /** 是否可以创建/编辑本组织知识记录。 */
  async canAuthor(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, KNOWLEDGE_AUTHOR, organizationId)
  }

  /** 是否可以进行生命周期治理（确认/降级/过时标记）。 */
  async canManage(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, KNOWLEDGE_MANAGE, organizationId)
  }
}
