import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'
import OrganizationPolicy from '#policies/organization_policy'
import RbacService from '#services/rbac_service'
import {
  ORG_VIEW,
  RESOURCE_VIEW,
  RESOURCE_MANAGE,
  PORTFOLIO_VIEW,
  PROJECT_VIEW,
  type Permission,
} from '#start/rbac/permissions'

/**
 * OrganizationResourcePoolPolicy —— 组织资源池权限守卫（v3-organization-resource-pool §3.2）。
 *
 * 分三层：
 *   1. 组织可见性：非成员按组织隔离规则返回 RESOURCE_NOT_FOUND，不泄露组织或资源池是否存在。
 *   2. 入口权限：复用 org:view、resource:view 或 portfolio:view 判定能否读取组织资源池。
 *   3. 维度权限与下钻重授权：资源详情、成员链接、项目可见性、技能/部门脱敏与 drill-down target 二次授权。
 */
@inject()
export default class OrganizationResourcePoolPolicy {
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
    // 组织所有者 / org:view / portfolio:view 任一满足即可进入
    if (await this.organizationPolicy.view(user, organizationId)) return true
    if (await this.check(user, PORTFOLIO_VIEW, organizationId)) return true
    if (await this.check(user, RESOURCE_VIEW, organizationId)) return true
    return false
  }

  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canView(user, organizationId))) {
      throw new PermissionDeniedException('无权查看组织资源池')
    }
  }

  // ── 第三层：维度权限解析 ─────────────────────────────────────────────────

  async resolveAccess(user: User, organizationId: number): Promise<OrganizationResourcePoolAccess> {
    const [canViewResourceDetails, canViewLinkedUsers, canViewPmo, canViewMembers] =
      await Promise.all([
        this.check(user, RESOURCE_MANAGE, organizationId).catch(() => false),
        this.check(user, ORG_VIEW, organizationId).catch(() => false),
        this.check(user, PORTFOLIO_VIEW, organizationId).catch(() => false),
        this.check(user, ORG_VIEW, organizationId).catch(() => false),
      ])

    return {
      canViewResourceDetails: canViewResourceDetails || user.isSuperAdmin,
      canViewLinkedUsers: canViewLinkedUsers || canViewMembers || user.isSuperAdmin,
      canViewPmo: canViewPmo || user.isSuperAdmin,
    }
  }

  // ── 项目可见性检查 ──────────────────────────────────────────────────────

  async canViewProject(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    // 检查 project:view
    const result = await this.rbac.check(user, PROJECT_VIEW, organizationId, projectId)
    if (result.allowed) return true
    // 项目创建者也能看
    const { default: ProjectModel } = await import('#models/project')
    const project = await ProjectModel.find(projectId)
    if (!project) return false
    if (Number(project.createdBy) === Number(user.id)) return true
    return false
  }

  // ── 资源维度权限 ────────────────────────────────────────────────────────

  async canViewResourceDetails(
    user: User,
    organizationId: number,
    _resourceId: number,
  ): Promise<boolean> {
    // 资源详情可见性与组织级资源查看权限绑定
    return user.isSuperAdmin || (await this.check(user, RESOURCE_VIEW, organizationId))
  }

  // ── 下钻重授权 ──────────────────────────────────────────────────────────

  async authorizeDrillDown(
    user: User,
    organizationId: number,
    kind: string,
    targetProjectId?: number | null,
    targetResourceId?: number | null,
  ): Promise<void> {
    // 组织隔离第一
    await this.assertOrganizationVisible(user, organizationId)

    // 按 kind 做目标二次授权
    switch (kind) {
      case 'project':
      case 'task':
        if (targetProjectId) {
          if (!(await this.canViewProject(user, organizationId, targetProjectId))) {
            throw new PermissionDeniedException('无权查看该项目详情')
          }
        }
        break
      case 'resource':
        if (targetResourceId) {
          if (!(await this.canViewResourceDetails(user, organizationId, targetResourceId))) {
            throw new PermissionDeniedException('无权查看该资源详情')
          }
        }
        break
      case 'conflict':
      case 'demand_gap':
      case 'skill':
        // 组织资源池内部桶——入口权限已覆盖，不需项目级二次授权
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
export interface OrganizationResourcePoolAccess {
  canViewResourceDetails: boolean
  canViewLinkedUsers: boolean
  canViewPmo: boolean
}
