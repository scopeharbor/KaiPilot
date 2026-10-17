import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import {
  RESOURCE_VIEW,
  RESOURCE_MANAGE,
  PROJECT_VIEW,
  PORTFOLIO_VIEW,
  type Permission,
} from '#start/rbac/permissions'

/**
 * CrossProjectAllocationPolicy —— 跨项目资源调配权限守卫。
 *
 * 两层判定：
 *   1. 组织级：组织成员身份 + 组织调配权限 / PMO 角色
 *   2. 项目级：每个目标项目的 resource:view/resource:manage、任务可见性、维度权限
 */
@inject()
export default class CrossProjectAllocationPolicy {
  constructor(private readonly rbac: RbacService) {}

  // ── 组织隔离 ──────────────────────────────────────────────────────────────

  async assertOrganizationMember(user: User, organizationId: number): Promise<void> {
    if (user.isSuperAdmin) return

    const { default: Organization } = await import('#models/organization')
    const org = await Organization.find(organizationId)
    if (!org) throw new ResourceNotFoundException('组织不存在')

    if (Number(org.ownerId) === Number(user.id)) return

    const { default: OrganizationMember } = await import('#models/organization_member')
    const membership = await OrganizationMember.query()
      .where('organization_id', organizationId)
      .where('user_id', user.id)
      .first()
    if (!membership) throw new ResourceNotFoundException('组织不存在')
  }

  // ── 读取权限 ──────────────────────────────────────────────────────────────

  async canView(user: User, organizationId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    // 需要组织成员身份 + resource:view 或 portfolio:view
    try {
      await this.assertOrganizationMember(user, organizationId)
    } catch {
      return false
    }
    return (
      (await this.check(user, RESOURCE_VIEW, organizationId)) ||
      (await this.check(user, PORTFOLIO_VIEW, organizationId))
    )
  }

  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canView(user, organizationId))) {
      throw new PermissionDeniedException('无权查看跨项目资源调配')
    }
  }

  // ── 写入权限 ──────────────────────────────────────────────────────────────

  async canManage(user: User, organizationId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    try {
      await this.assertOrganizationMember(user, organizationId)
    } catch {
      return false
    }
    return (
      (await this.check(user, RESOURCE_MANAGE, organizationId)) ||
      (await this.check(user, PORTFOLIO_VIEW, organizationId))
    )
  }

  async authorizeManage(user: User, organizationId: number): Promise<void> {
    if (!(await this.canManage(user, organizationId))) {
      throw new PermissionDeniedException('无权管理跨项目资源调配')
    }
  }

  // ── 项目可见性 ────────────────────────────────────────────────────────────

  async canViewProject(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, PROJECT_VIEW, organizationId, projectId)
    if (result.allowed) return true
    const { default: Project } = await import('#models/project')
    const project = await Project.find(projectId)
    if (!project) return false
    return Number(project.createdBy) === Number(user.id)
  }

  // ── 目标项目资源权限 ──────────────────────────────────────────────────────

  async canManageResourceInProject(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    return this.check(user, RESOURCE_MANAGE, organizationId, projectId)
  }

  async canViewResourceInProject(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    return (
      (await this.check(user, RESOURCE_VIEW, organizationId, projectId)) ||
      (await this.check(user, RESOURCE_MANAGE, organizationId, projectId))
    )
  }

  // ── 下钻重授权 ────────────────────────────────────────────────────────────

  async authorizeDrillDown(
    user: User,
    organizationId: number,
    kind: string,
    targetProjectId?: number | null,
    targetResourceId?: number | null,
  ): Promise<void> {
    await this.assertOrganizationMember(user, organizationId)

    switch (kind) {
      case 'project':
      case 'task':
      case 'allocation':
        if (targetProjectId) {
          if (!(await this.canViewProject(user, organizationId, targetProjectId))) {
            throw new PermissionDeniedException('无权查看该目标详情')
          }
        }
        break
      case 'resource':
        if (targetResourceId) {
          if (!(await this.check(user, RESOURCE_VIEW, organizationId))) {
            throw new PermissionDeniedException('无权查看该资源详情')
          }
        }
        break
      case 'conflict':
      case 'evidence':
        // 已由入口权限覆盖
        break
      default:
        throw new PermissionDeniedException('不支持的 drill-down 目标类型')
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async check(
    user: User,
    permission: Permission,
    organizationId: number,
    projectId?: number,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, permission, organizationId, projectId)
    return result.allowed
  }
}
