/**
 * v3-skill-knowledge-authoring —— SkillKnowledgeAuthoringPolicy（D8 三级 RBAC）。
 *
 * canViewDraft：读草稿/preview（复用 view 权限）
 * canAuthorDraft：创建/更新/丢弃草稿、aiAssist（复用 author 权限）
 * canReviewKnowledge：人审 commit 写回（新增 review 权限）
 * 组织归属双检：每个方法都校验 organization_id。
 */
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import {
  AI_COMPILER_SKILL_VIEW,
  AI_COMPILER_SKILL_AUTHOR,
  AI_COMPILER_SKILL_KNOWLEDGE_REVIEW,
} from '#start/rbac/permissions'
import type { PermissionCheckResult } from '#types/auth'

@inject()
export default class SkillKnowledgeAuthoringPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 是否可以读取草稿/preview（复用 view 权限）。 */
  async canViewDraft(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, AI_COMPILER_SKILL_VIEW, organizationId)
  }

  /** 是否可以创作草稿/aiAssist（复用 author 权限）。 */
  async canAuthorDraft(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, AI_COMPILER_SKILL_AUTHOR, organizationId)
  }

  /** 是否可以进行人审 commit 写回（新增 review 权限）。 */
  async canReviewKnowledge(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, AI_COMPILER_SKILL_KNOWLEDGE_REVIEW, organizationId)
  }
}
