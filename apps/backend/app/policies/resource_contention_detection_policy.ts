import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'
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
 * ResourceContentionDetectionPolicy —— 资源争用检测权限守卫（v3-resource-contention-detection §3.2）。
 *
 * 分四层：
 *   1. 组织隔离：非成员按组织隔离规则返回 RESOURCE_NOT_FOUND。
 *   2. 入口权限：PMO/资源查看/组织查看权限。
 *   3. 维度权限：项目可见性、资源可见性、成员可见性、技能可见性、证据访问。
 *   4. 下钻重授权：每次 drill-down 必须二次检查目标权限。
 */
@inject()
export default class ResourceContentionDetectionPolicy {
  constructor(private readonly rbac: RbacService) {}

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
    const { default: OrganizationModel } = await import('#models/organization')
    const organization = await OrganizationModel.find(organizationId)
    if (organization && Number(organization.ownerId) === Number(user.id)) return true
    if (await this.check(user, PORTFOLIO_VIEW, organizationId)) return true
    if (await this.check(user, RESOURCE_VIEW, organizationId)) return true
    if (await this.check(user, ORG_VIEW, organizationId)) return true
    return false
  }

  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canView(user, organizationId))) {
      throw new PermissionDeniedException('无权查看资源争用检测')
    }
  }

  // ── 第三层：维度权限解析 ─────────────────────────────────────────────────

  async resolveAccess(
    user: User,
    organizationId: number,
  ): Promise<ResourceContentionDetectionAccess> {
    const [canViewResourceDetails, canViewProjectDetails, canViewMembers, canViewEvidence] =
      await Promise.all([
        this.check(user, RESOURCE_MANAGE, organizationId).catch(() => false),
        this.check(user, PROJECT_VIEW, organizationId).catch(() => false),
        this.check(user, ORG_VIEW, organizationId).catch(() => false),
        this.check(user, RESOURCE_MANAGE, organizationId).catch(() => false),
      ])

    return {
      canViewResourceDetails: canViewResourceDetails || user.isSuperAdmin,
      canViewProjectDetails: canViewProjectDetails || user.isSuperAdmin,
      canViewMembers: canViewMembers || user.isSuperAdmin,
      canViewEvidence: canViewEvidence || user.isSuperAdmin,
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

  async canViewResourceDetails(user: User, organizationId: number): Promise<boolean> {
    return user.isSuperAdmin || (await this.check(user, RESOURCE_VIEW, organizationId))
  }

  // ── 成员可见性 ──────────────────────────────────────────────────────────

  async canViewMembers(user: User, organizationId: number): Promise<boolean> {
    return user.isSuperAdmin || (await this.check(user, ORG_VIEW, organizationId))
  }

  // ── 技能可见性 ──────────────────────────────────────────────────────────

  async canViewSkills(user: User, organizationId: number): Promise<boolean> {
    return user.isSuperAdmin || (await this.check(user, RESOURCE_VIEW, organizationId))
  }

  // ── 证据访问 ────────────────────────────────────────────────────────────

  async canAccessEvidence(user: User, organizationId: number): Promise<boolean> {
    return user.isSuperAdmin || (await this.check(user, RESOURCE_MANAGE, organizationId))
  }

  // ── 下钻重授权 ──────────────────────────────────────────────────────────

  async authorizeDrillDown(
    user: User,
    organizationId: number,
    kind: string,
    targetProjectId?: number | null,
    targetResourceId?: number | null,
  ): Promise<void> {
    await this.assertOrganizationVisible(user, organizationId)

    switch (kind) {
      case 'project':
      case 'task':
      case 'allocation':
        if (targetProjectId) {
          if (!(await this.canViewProject(user, organizationId, targetProjectId))) {
            throw new PermissionDeniedException('无权查看该项目详情')
          }
        }
        break
      case 'resource':
        if (targetResourceId) {
          if (!(await this.canViewResourceDetails(user, organizationId))) {
            throw new PermissionDeniedException('无权查看该资源详情')
          }
        }
        break
      case 'skill':
        if (!(await this.canViewSkills(user, organizationId))) {
          throw new PermissionDeniedException('无权查看技能详情')
        }
        break
      case 'demand':
      case 'draft':
      case 'evidence':
        if (!(await this.canAccessEvidence(user, organizationId))) {
          throw new PermissionDeniedException('无权查看证据详情')
        }
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
export interface ResourceContentionDetectionAccess {
  canViewResourceDetails: boolean
  canViewProjectDetails: boolean
  canViewMembers: boolean
  canViewEvidence: boolean
}
