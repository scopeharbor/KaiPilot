import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'
import OrganizationPolicy from '#policies/organization_policy'
import RbacService from '#services/rbac_service'
import {
  ORG_VIEW,
  ORG_MANAGE,
  PORTFOLIO_VIEW,
  PROJECT_VIEW,
  type Permission,
} from '#start/rbac/permissions'

/**
 * OkrPolicy —— OKR 层级管理权限守卫（v3-okr-hierarchy-management §4.3）。
 *
 * 分层权限模型：
 *   1. 组织隔离：非成员按组织隔离规则返回 RESOURCE_NOT_FOUND，不泄露组织或 OKR 是否存在。
 *   2. 入口权限：复用 org:view、org:manage、portfolio:view 判定能否查看/管理 OKR。
 *   3. 维度脱敏：受限证据、受限项目、跨组织数据在返回前脱敏。
 *   4. 写操作需 org:manage 或 super_admin。
 */
@inject()
export default class OkrPolicy {
  constructor(
    private readonly rbac: RbacService,
    private readonly organizationPolicy: OrganizationPolicy,
  ) {}

  // ── 第一层：组织隔离 ───────────────────────────────────────────────────

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

  // ── 第二层：入口权限 ──────────────────────────────────────────────────

  async canView(user: User, organizationId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    if (await this.organizationPolicy.view(user, organizationId)) return true
    if (await this.check(user, PORTFOLIO_VIEW, organizationId)) return true
    if (await this.check(user, ORG_VIEW, organizationId)) return true
    return false
  }

  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canView(user, organizationId))) {
      throw new PermissionDeniedException('无权查看组织 OKR')
    }
  }

  async canManage(user: User, organizationId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    if (await this.check(user, ORG_MANAGE, organizationId)) return true
    return false
  }

  async authorizeManage(user: User, organizationId: number): Promise<void> {
    if (!(await this.canManage(user, organizationId))) {
      throw new PermissionDeniedException('无权管理组织 OKR')
    }
  }

  // ── 操作级权限 ─────────────────────────────────────────────────────────

  async canCreate(user: User, organizationId: number): Promise<boolean> {
    return this.canManage(user, organizationId)
  }

  async authorizeCreate(user: User, organizationId: number): Promise<void> {
    await this.authorizeManage(user, organizationId)
  }

  async canUpdate(user: User, organizationId: number): Promise<boolean> {
    return this.canManage(user, organizationId)
  }

  async authorizeUpdate(user: User, organizationId: number): Promise<void> {
    await this.authorizeManage(user, organizationId)
  }

  async canArchive(user: User, organizationId: number): Promise<boolean> {
    return this.canManage(user, organizationId)
  }

  async authorizeArchive(user: User, organizationId: number): Promise<void> {
    await this.authorizeManage(user, organizationId)
  }

  async canRestore(user: User, organizationId: number): Promise<boolean> {
    return this.canManage(user, organizationId)
  }

  async authorizeRestore(user: User, organizationId: number): Promise<void> {
    await this.authorizeManage(user, organizationId)
  }

  async canUpdateProgress(user: User, organizationId: number): Promise<boolean> {
    return this.canManage(user, organizationId)
  }

  async authorizeProgress(user: User, organizationId: number): Promise<void> {
    await this.authorizeManage(user, organizationId)
  }

  async canManageEvidence(user: User, organizationId: number): Promise<boolean> {
    return this.canManage(user, organizationId)
  }

  async authorizeEvidence(user: User, organizationId: number): Promise<void> {
    await this.authorizeManage(user, organizationId)
  }

  async canUseAiDraft(user: User, organizationId: number): Promise<boolean> {
    return this.canManage(user, organizationId)
  }

  async authorizeAiDraft(user: User, organizationId: number): Promise<void> {
    await this.authorizeManage(user, organizationId)
  }

  // ── Backflow Permissions ───────────────────────────────────────────────

  async canViewBackflow(user: User, organizationId: number): Promise<boolean> {
    return this.canView(user, organizationId)
  }

  async authorizeViewBackflow(user: User, organizationId: number): Promise<void> {
    await this.authorizeView(user, organizationId)
  }

  async canRecalculateBackflow(user: User, organizationId: number): Promise<boolean> {
    return this.canManage(user, organizationId)
  }

  async authorizeRecalculateBackflow(user: User, organizationId: number): Promise<void> {
    await this.authorizeManage(user, organizationId)
  }

  async canConfirmBackflow(user: User, organizationId: number): Promise<boolean> {
    return this.canManage(user, organizationId)
  }

  async authorizeConfirmBackflow(user: User, organizationId: number): Promise<void> {
    await this.authorizeManage(user, organizationId)
  }

  async canRejectBackflow(user: User, organizationId: number): Promise<boolean> {
    return this.canManage(user, organizationId)
  }

  async authorizeRejectBackflow(user: User, organizationId: number): Promise<void> {
    await this.authorizeManage(user, organizationId)
  }

  async canBatchBackflow(user: User, organizationId: number): Promise<boolean> {
    return this.canManage(user, organizationId)
  }

  async authorizeBatchBackflow(user: User, organizationId: number): Promise<void> {
    await this.authorizeManage(user, organizationId)
  }

  // ── Cascade & Alignment Permissions ─────────────────────────────────────

  async canCreateCascadePlan(user: User, organizationId: number): Promise<boolean> {
    return this.canManage(user, organizationId)
  }

  async authorizeCreateCascadePlan(user: User, organizationId: number): Promise<void> {
    await this.authorizeManage(user, organizationId)
  }

  async canConfirmCascade(user: User, organizationId: number): Promise<boolean> {
    return this.canManage(user, organizationId)
  }

  async authorizeConfirmCascade(user: User, organizationId: number): Promise<void> {
    await this.authorizeManage(user, organizationId)
  }

  async canManageRelations(user: User, organizationId: number): Promise<boolean> {
    return this.canManage(user, organizationId)
  }

  async authorizeManageRelations(user: User, organizationId: number): Promise<void> {
    await this.authorizeManage(user, organizationId)
  }

  async canViewHealth(user: User, organizationId: number): Promise<boolean> {
    return this.canView(user, organizationId)
  }

  async authorizeViewHealth(user: User, organizationId: number): Promise<void> {
    await this.authorizeView(user, organizationId)
  }

  async canViewMatrix(user: User, organizationId: number): Promise<boolean> {
    return this.canView(user, organizationId)
  }

  async authorizeViewMatrix(user: User, organizationId: number): Promise<void> {
    await this.authorizeView(user, organizationId)
  }

  async canUseAiCascade(user: User, organizationId: number): Promise<boolean> {
    return this.canManage(user, organizationId)
  }

  async authorizeAiCascade(user: User, organizationId: number): Promise<void> {
    await this.authorizeManage(user, organizationId)
  }

  // ── 项目可见性 ────────────────────────────────────────────────────────

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

  // ── 维度权限解析 ──────────────────────────────────────────────────────

  async resolveAccess(user: User, organizationId: number): Promise<OkrAccess> {
    const [canViewEvidence, canViewProjects, canViewPmo] = await Promise.all([
      this.canManage(user, organizationId).catch(() => false),
      this.check(user, PROJECT_VIEW, organizationId).catch(() => false),
      this.check(user, PORTFOLIO_VIEW, organizationId).catch(() => false),
    ])

    return {
      canViewEvidence: canViewEvidence || user.isSuperAdmin,
      canViewProjects: canViewProjects || user.isSuperAdmin,
      canViewPmo: canViewPmo || user.isSuperAdmin,
      canManage: user.isSuperAdmin || (await this.canManage(user, organizationId)),
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────

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
export interface OkrAccess {
  canViewEvidence: boolean
  canViewProjects: boolean
  canViewPmo: boolean
  canManage: boolean
}
