import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import User from '#models/user'
import OrganizationPolicy from '#policies/organization_policy'
import RbacService from '#services/rbac_service'
import {
  RESOURCE_VIEW,
  PORTFOLIO_VIEW,
  PROJECT_VIEW,
  AI_RESOURCE_GAP_EXPLAIN,
  type Permission,
} from '#start/rbac/permissions'

/**
 * ResourceGapAnalysisPolicy —— 资源缺口分析权限守卫（v3-resource-gap-analysis §3.2）。
 *
 * 分三层：
 *   1. 组织可见性：非成员按组织隔离规则返回 RESOURCE_NOT_FOUND，不泄露组织是否存在。
 *   2. 入口权限：复用 org:view、resource:view、portfolio:view 判定能否读取组织缺口分析。
 *   3. 维度权限与下钻重授权：技能可见性、项目可见性、组合可见性、AI 解释权限二次授权。
 */
@inject()
export default class ResourceGapAnalysisPolicy {
  constructor(
    private readonly rbac: RbacService,
    private readonly organizationPolicy: OrganizationPolicy,
  ) {}

  // ── 第一层：组织隔离 ─────────────────────────────────────────────────────

  async assertOrganizationVisible(user: User, organizationId: number): Promise<void> {
    if (user.isSuperAdmin) return

    const { default: OrganizationModel } = await import('#models/organization')
    const organization = await OrganizationModel.find(organizationId)
    if (!organization) throw new ResourceNotFoundException('组织不存在')

    if (Number(organization.ownerId) === Number(user.id)) return

    const { default: OrganizationMemberModel } = await import('#models/organization_member')
    const membership = await OrganizationMemberModel.query()
      .where('organization_id', organizationId)
      .where('user_id', user.id)
      .first()
    if (!membership) throw new ResourceNotFoundException('组织不存在')
  }

  // ── 第二层：入口权限 ────────────────────────────────────────────────────

  async canView(user: User, organizationId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    if (await this.organizationPolicy.view(user, organizationId)) return true
    if (await this.check(user, PORTFOLIO_VIEW, organizationId)) return true
    if (await this.check(user, RESOURCE_VIEW, organizationId)) return true
    return false
  }

  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canView(user, organizationId))) {
      throw new PermissionDeniedException('无权查看组织资源缺口分析')
    }
  }

  // ── 第三层：维度权限解析 ─────────────────────────────────────────────────

  async resolveAccess(user: User, organizationId: number): Promise<ResourceGapAccess> {
    const [canViewResourceDetails, canViewSkills, canViewPmo, canViewProjects] = await Promise.all([
      this.check(user, RESOURCE_VIEW, organizationId).catch(() => false),
      this.check(user, RESOURCE_VIEW, organizationId).catch(() => false), // 技能可见性复用 resource:view
      this.check(user, PORTFOLIO_VIEW, organizationId).catch(() => false),
      this.check(user, PROJECT_VIEW, organizationId).catch(() => false),
    ])

    return {
      canViewResourceDetails,
      canViewSkills,
      canViewPmo,
      canViewProjects,
      canViewAiExplanation: false, // 默认关闭，需细粒度 RBAC
    }
  }

  // ── AI 解释权限 ────────────────────────────────────────────────────────

  async canViewAiExplanation(user: User, organizationId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    return this.check(user, AI_RESOURCE_GAP_EXPLAIN, organizationId).catch(() => false)
  }

  async authorizeAiExplanation(user: User, organizationId: number): Promise<void> {
    if (!(await this.canViewAiExplanation(user, organizationId))) {
      throw new PermissionDeniedException('无权使用 AI 资源缺口解释')
    }
  }

  // ── 项目可见性 ──────────────────────────────────────────────────────────

  async resolveVisibleProjectIds(user: User, organizationId: number): Promise<number[]> {
    const { default: Project } = await import('#models/project')
    const projects = await Project.query().where('organization_id', organizationId).select('id')

    if (user.isSuperAdmin) return projects.map((p) => p.id)

    // 非管理员仅返回有 project:view 权限的项目
    const visibleIds: number[] = []
    for (const project of projects) {
      const canView = await this.check(user, PROJECT_VIEW, organizationId).catch(() => false)
      if (canView) visibleIds.push(project.id)
    }
    return visibleIds
  }

  // ── 内部 helper ──────────────────────────────────────────────────────────

  private async check(
    user: User,
    permission: Permission,
    organizationId: number,
  ): Promise<boolean> {
    try {
      const result = await this.rbac.check(user, permission, organizationId)
      return Boolean((result as any)?.allowed ?? result ?? false)
    } catch {
      return false
    }
  }
}

export interface ResourceGapAccess {
  canViewResourceDetails: boolean
  canViewSkills: boolean
  canViewPmo: boolean
  canViewProjects: boolean
  canViewAiExplanation: boolean
}
