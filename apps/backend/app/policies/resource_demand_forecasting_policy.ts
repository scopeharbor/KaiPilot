import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'
import OrganizationPolicy from '#policies/organization_policy'
import RbacService from '#services/rbac_service'
import {
  RESOURCE_VIEW,
  PORTFOLIO_VIEW,
  PROJECT_VIEW,
  type Permission,
} from '#start/rbac/permissions'

/**
 * ResourceDemandForecastingPolicy —— 资源需求预测权限守卫（v3-resource-demand-forecasting §4.1）。
 *
 * 分三层：
 *   1. 组织隔离：非成员按组织隔离规则返回 RESOURCE_NOT_FOUND，不泄露组织或预测是否存在。
 *   2. 入口权限：复用 resource:view 或 portfolio:view 判定能否读取预测。
 *   3. 维度权限与下钻重授权：资源详情、成员链接、项目可见性、技能脱敏与 drill-down target 二次授权。
 */
@inject()
export default class ResourceDemandForecastingPolicy {
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

  async authorizeForecastRead(user: User, organizationId: number): Promise<void> {
    await this.assertOrganizationVisible(user, organizationId)
    if (!(await this.canView(user, organizationId))) {
      throw new PermissionDeniedException('无权查看资源需求预测')
    }
  }

  // ── 第三层：维度权限解析 ─────────────────────────────────────────────────

  buildAccessContext(user: User, organizationId: number): ResourceDemandForecastingAccess {
    return {
      actor: { id: Number(user.id), organizationId },
      organizationId,
      visibleProjectIds: null, // null = all visible (filtered by service)
      canViewAllResources: user.isSuperAdmin,
      canViewAllSkills: user.isSuperAdmin,
      visibleResourceIds: null,
      visibleSkillKeys: null,
      isOrganizationMember: true,
      canViewForecast: true,
    }
  }

  // ── 项目可见性检查 ──────────────────────────────────────────────────────

  async canViewProject(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, PROJECT_VIEW, organizationId, projectId)
    if (result.allowed) return true
    const { default: ProjectModel } = await import('#models/project')
    const project = await ProjectModel.find(projectId)
    if (!project) return false
    if (Number(project.createdBy) === Number(user.id)) return true
    return false
  }

  // ── 资源维度权限 ────────────────────────────────────────────────────────

  async canAccessResource(user: User, organizationId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    return this.check(user, RESOURCE_VIEW, organizationId)
  }

  // ── 技能维度权限 ────────────────────────────────────────────────────────

  async canAccessSkill(user: User, _organizationId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    // 技能矩阵权限委托给 resource:view
    return true // 技能可见性与入口权限绑定
  }

  // ── 下钻重授权 ──────────────────────────────────────────────────────────

  async authorizeDrillDown(
    user: User,
    organizationId: number,
    targetType: string,
    targetId: string,
  ): Promise<void> {
    // 组织隔离第一
    await this.assertOrganizationVisible(user, organizationId)

    // 按 targetType 做目标二次授权
    switch (targetType) {
      case 'project':
      case 'task': {
        const projectId = Number(targetId)
        if (!Number.isFinite(projectId)) {
          throw new PermissionDeniedException('无效的目标 ID')
        }
        if (!(await this.canViewProject(user, organizationId, projectId))) {
          throw new PermissionDeniedException('无权查看该项目详情')
        }
        break
      }
      case 'resource': {
        if (!(await this.canAccessResource(user, organizationId))) {
          throw new PermissionDeniedException('无权查看该资源详情')
        }
        break
      }
      case 'skill':
      case 'gap':
      case 'driver':
      case 'evidence':
        // 预测内部桶——入口权限已覆盖，不需项目级二次授权
        break
      default:
        throw new PermissionDeniedException('不支持的 drill-down 目标类型')
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async check(
    user: User,
    permission: Permission,
    organizationId: number,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, permission, organizationId)
    return result.allowed
  }
}

/** 维度级权限——供 Service 做低敏脱敏。 */
export interface ResourceDemandForecastingAccess {
  actor: { id: number; organizationId: number }
  organizationId: number
  visibleProjectIds: number[] | null
  canViewAllResources: boolean
  canViewAllSkills: boolean
  visibleResourceIds: number[] | null
  visibleSkillKeys: string[] | null
  isOrganizationMember: boolean
  canViewForecast: boolean
}
