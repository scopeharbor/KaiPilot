import { inject } from '@adonisjs/core'
import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { AI_COMPILER_SKILL_VIEW, PORTFOLIO_VIEW, RESOURCE_VIEW } from '#start/rbac/permissions'

/**
 * 资源技能矩阵权限策略（v3-resource-skill-matrix §3.3）。
 * 组合组织成员身份、项目可见性、resource:view 与 ai:compiler:skill:view 权限，
 * 并定义维度脱敏结果。
 */
@inject()
export default class ResourceSkillMatrixPolicy {
  constructor(private readonly rbac: RbacService) {}

  /**
   * 基础准入：必须有组织成员身份。
   * 通过检查权限解析结果判断是否为组织成员。
   */
  async isOrgMember(user: User, organizationId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const perms = await this.rbac.resolveOrganizationPermissions(user, organizationId)
    return perms.size > 0
  }

  /**
   * 矩阵查看权限：组织成员 + 至少一个可见维度。
   */
  async canView(user: User, organizationId: number): Promise<boolean> {
    // 组织成员即可访问基本矩阵
    return this.isOrgMember(user, organizationId)
  }

  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canView(user, organizationId))) {
      throw new PermissionDeniedException('无权查看资源技能矩阵')
    }
  }

  /**
   * 资源事实查看权限。
   */
  async canViewResourceFacts(
    user: User,
    organizationId: number,
    projectId?: number,
  ): Promise<boolean> {
    return this.checkPermission(user, RESOURCE_VIEW, organizationId, projectId)
  }

  /**
   * Skill 详情查看权限。
   */
  async canViewSkillDetails(user: User, organizationId: number): Promise<boolean> {
    return this.checkPermission(user, AI_COMPILER_SKILL_VIEW, organizationId)
  }

  /**
   * 返回当前用户的维度脱敏配置。
   * 不同维度缺少权限时，在矩阵响应中做不同程度脱敏。
   */
  async resolveDimensionAccess(
    user: User,
    organizationId: number,
  ): Promise<ResourceSkillMatrixDimensionAccess> {
    const [canViewResource, canViewSkill] = await Promise.all([
      this.canViewResourceFacts(user, organizationId).catch(() => false),
      this.canViewSkillDetails(user, organizationId).catch(() => false),
    ])

    return {
      canViewResourceFacts: canViewResource,
      canViewSkillDetails: canViewSkill,
    }
  }

  /**
   * 下钻二次授权：针对具体资源、任务需求或项目再做权限检查。
   */
  async authorizeDrillDown(
    user: User,
    organizationId: number,
    itemType: 'resource' | 'task_requirement' | 'project',
    projectId?: number,
  ): Promise<void> {
    const isMember = await this.isOrgMember(user, organizationId)
    if (!isMember) {
      throw new PermissionDeniedException('无权查看该组织')
    }

    if (itemType === 'resource') {
      const canView = await this.canViewResourceFacts(user, organizationId, projectId)
      if (!canView) throw new PermissionDeniedException('无权查看资源详情')
    } else if (itemType === 'task_requirement') {
      const canView = await this.checkPermission(user, RESOURCE_VIEW, organizationId, projectId)
      if (!canView) throw new PermissionDeniedException('无权查看任务资源需求')
    } else if (itemType === 'project') {
      const canView = await this.checkPermission(user, PORTFOLIO_VIEW, organizationId, projectId)
      if (!canView) throw new PermissionDeniedException('无权查看项目')
    }
  }

  private async checkPermission(
    user: User,
    permission: typeof RESOURCE_VIEW | typeof AI_COMPILER_SKILL_VIEW | typeof PORTFOLIO_VIEW,
    organizationId: number,
    projectId?: number,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, permission, organizationId, projectId)
    return result.allowed
  }
}

/** 维度访问配置（传递给 Service 用于脱敏决策） */
export interface ResourceSkillMatrixDimensionAccess {
  canViewResourceFacts: boolean
  canViewSkillDetails: boolean
}
