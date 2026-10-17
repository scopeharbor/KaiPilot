/**
 * TRIZ Skill Layer Policy (v3-triz-skill-layer-integration §3.3)
 *
 * 强制认证、组织隔离、项目成员身份与 TRIZ Skill Layer 权限检查。
 * 拒绝时不泄露隐藏项目/Skill/来源/destination 存在性。
 */
import type User from '#models/user'
import type { Permission } from '#start/rbac/permissions'
import { inject } from '@adonisjs/core'
import RbacService from '#services/rbac_service'
import { TRIZ_SKILL_LAYER_VIEW, TRIZ_SKILL_LAYER_PREVIEW } from '#start/rbac/permissions'

@inject()
export default class TrizSkillLayerPolicy {
  constructor(private rbac: RbacService) {}

  /**
   * 是否能查看 Skill Layer summary 与 destinations。
   * 条件：认证 + 项目成员 + triz_skill_layer:view
   */
  async canView(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.#allows(user, TRIZ_SKILL_LAYER_VIEW, organizationId, projectId)
  }

  /**
   * 是否能请求 route preview 或 handoff preview。
   * 条件：认证 + 项目成员 + triz_skill_layer:preview
   */
  async canPreview(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.#allows(user, TRIZ_SKILL_LAYER_PREVIEW, organizationId, projectId)
  }

  /**
   * 判定链复用 RbacService.check：它内部已做超管放行、组织权限解析、
   * 项目归属组织校验（跨组织判 cross_org_denied）与项目成员权限交集。
   */
  async #allows(
    user: User,
    permission: Permission,
    organizationId: number,
    projectId: number,
  ): Promise<boolean> {
    if (!user) return false
    const result = await this.rbac.check(user, permission, organizationId, projectId)
    return result.allowed
  }
}
