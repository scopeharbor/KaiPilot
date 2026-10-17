import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import OrganizationPolicy from '#policies/organization_policy'
import {
  ORG_MEMBER_MANAGE,
  ORG_VIEW,
  PORTFOLIO_VIEW,
  RESOURCE_VIEW,
  RISK_VIEW,
  AUDIT_VIEW,
  type Permission,
} from '#start/rbac/permissions'
import {
  ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS,
  type OrganizationDashboardLayoutModuleKey,
} from '@aiproj/types'

/**
 * OrganizationDashboardLayoutPolicy —— 组织 Dashboard 布局编排权限守卫（v3-organization-dashboard-layout-builder §3.1）。
 *
 * 分层：
 *   1. **组织隔离**：非成员一律 RESOURCE_NOT_FOUND，与 organization_dashboard_policy 一致。
 *   2. **读取权限**：具备 org:view 或 portfolio:view 即可读取布局。
 *   3. **个人写入**：actor 只能写入自己名下的个人布局。
 *   4. **共享管理**：只有 owner/admin/授权 PMO 管理角色可创建组织共享布局和设为默认。
 *   5. **模块级权限**：渲染时对每个模块做独立权限校验。
 */
@inject()
export default class OrganizationDashboardLayoutPolicy {
  constructor(
    private readonly rbac: RbacService,
    private readonly organizationPolicy: OrganizationPolicy,
  ) {}

  /** 组织隔离断言：非成员一律 RESOURCE_NOT_FOUND。 */
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

  /** 是否可查看布局（组织入口权限）。 */
  async canView(user: User, organizationId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    if (await this.organizationPolicy.view(user, organizationId)) return true
    return this.check(user, PORTFOLIO_VIEW, organizationId)
  }

  /** 断言布局查看权限。 */
  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canView(user, organizationId))) {
      throw new PermissionDeniedException('无权查看组织 Dashboard 布局')
    }
  }

  /** 是否可保存个人布局。 */
  async canSavePersonal(user: User, organizationId: number): Promise<boolean> {
    return this.canView(user, organizationId)
  }

  /** 断言个人布局保存权限。 */
  async authorizePersonalWrite(user: User, organizationId: number): Promise<void> {
    if (!(await this.canSavePersonal(user, organizationId))) {
      throw new PermissionDeniedException('无权保存个人组织 Dashboard 布局')
    }
  }

  /** 是否可管理组织共享布局（owner/admin/授权 PMO 管理角色）。 */
  async canManageShared(user: User, organizationId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    return this.check(user, ORG_MEMBER_MANAGE, organizationId)
  }

  /** 断言组织共享布局管理权限。 */
  async authorizeSharedWrite(user: User, organizationId: number): Promise<void> {
    if (!(await this.canManageShared(user, organizationId))) {
      throw new PermissionDeniedException('无权管理组织共享 Dashboard 布局')
    }
  }

  /** 校验模块级权限——返回该 actor 对模块是否可查看。 */
  async checkModulePermission(
    user: User,
    organizationId: number,
    moduleKey: OrganizationDashboardLayoutModuleKey,
  ): Promise<boolean> {
    const requiredPermissions = MODULE_PERMISSION_MAP[moduleKey]
    if (!requiredPermissions || requiredPermissions.length === 0) return true

    if (user.isSuperAdmin) return true

    for (const perm of requiredPermissions) {
      try {
        const result = await this.rbac.check(user, perm, organizationId)
        if (result.allowed) return true
      } catch {
        // 单权限判定失败继续检查下一项
      }
    }
    return false
  }

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

/** 模块 key → 所需权限列表。任一命中即放行。 */
const MODULE_PERMISSION_MAP: Partial<Record<OrganizationDashboardLayoutModuleKey, Permission[]>> = {
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.IDENTITY]: [ORG_VIEW],
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.KPI_STRIP]: [ORG_VIEW],
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.STATUS_DISTRIBUTION]: [ORG_VIEW],
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ATTENTION_PROJECTS]: [ORG_VIEW],
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.MEMBER_OVERVIEW]: [ORG_MEMBER_MANAGE, ORG_VIEW],
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RESOURCE_OVERVIEW]: [RESOURCE_VIEW],
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.RISK_REMINDERS]: [RISK_VIEW],
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.ACTIVITY]: [AUDIT_VIEW],
  [ORGANIZATION_DASHBOARD_LAYOUT_MODULE_KEYS.PMO_ENTRY]: [PORTFOLIO_VIEW],
}
