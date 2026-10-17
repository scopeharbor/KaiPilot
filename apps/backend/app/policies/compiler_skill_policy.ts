/**
 * v3-skill-registry-and-lifecycle —— CompilerSkillPolicy（D7 三级 RBAC）。
 *
 * canViewSkill：读/查询/匹配
 * canAuthorSkill：创建/编辑/删除本组织 draft
 * canManageSkill：生命周期治理转移
 * 组织归属双检：每个方法都校验 organization_id。
 */
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import {
  AI_COMPILER_SKILL_VIEW,
  AI_COMPILER_SKILL_AUTHOR,
  AI_COMPILER_SKILL_MANAGE,
} from '#start/rbac/permissions'
import type { PermissionCheckResult } from '#types/auth'

@inject()
export default class CompilerSkillPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 是否可以查看 Skill Registry（列表/详情/查询/匹配）。 */
  async canViewSkill(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, AI_COMPILER_SKILL_VIEW, organizationId)
  }

  /** 是否可以创建/编辑/删除本组织 draft Skill。 */
  async canAuthorSkill(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, AI_COMPILER_SKILL_AUTHOR, organizationId)
  }

  /** 是否可以进行生命周期治理转移（manage 级权限）。 */
  async canManageSkill(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, AI_COMPILER_SKILL_MANAGE, organizationId)
  }
}
