import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'
import OrganizationPolicy from '#policies/organization_policy'
import RbacService from '#services/rbac_service'
import {
  AUDIT_VIEW,
  ORG_MEMBER_MANAGE,
  ORG_VIEW,
  PORTFOLIO_VIEW,
  RESOURCE_VIEW,
  RISK_VIEW,
  type Permission,
} from '#start/rbac/permissions'
import type { OrganizationDashboardAccess } from '#services/organization_dashboard_service'

/**
 * OrganizationDashboardPolicy —— 组织 Dashboard 权限守卫（v3-organization-dashboard §4.3）。
 *
 * 分层：
 *   1. **组织可见性**：非成员按组织隔离规则返回 `RESOURCE_NOT_FOUND`，不泄露组织或 Dashboard 是否存在。
 *   2. **入口权限**：复用 `OrganizationPolicy.view`（`org:view`）判定能否读取组织 Dashboard。
 *   3. **维度权限**：风险/资源/成员/活动/PMO 各自独立判定，不足者返回低敏脱敏而非拒绝整页。
 */
@inject()
export default class OrganizationDashboardPolicy {
  constructor(
    private readonly rbac: RbacService,
    private readonly organizationPolicy: OrganizationPolicy,
  ) {}

  /**
   * 组织隔离断言：actor 必须是该组织成员或所有者（超管放行）。
   * 非成员一律 `RESOURCE_NOT_FOUND`，与 `organization-management` 既有裁决一致。
   */
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

  /** 是否可查看组织 Dashboard（组织入口权限）。 */
  async canView(user: User, organizationId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    if (await this.organizationPolicy.view(user, organizationId)) return true
    // `org:view` 未授予时，允许具备组合查看权限的 PMO 角色进入组织总览。
    return this.check(user, PORTFOLIO_VIEW, organizationId)
  }

  /** 断言组织 Dashboard 查看权限。 */
  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canView(user, organizationId))) {
      throw new PermissionDeniedException('无权查看组织 Dashboard')
    }
  }

  /** 解析各维度权限，供 Service 做低敏脱敏。任一维度判定失败按拒绝处理。 */
  async resolveAccess(user: User, organizationId: number): Promise<OrganizationDashboardAccess> {
    const [canViewMembers, canViewResources, canViewRisks, canViewActivity, canViewPmo] =
      await Promise.all([
        this.check(user, ORG_MEMBER_MANAGE, organizationId).catch(() => false),
        this.check(user, RESOURCE_VIEW, organizationId).catch(() => false),
        this.check(user, RISK_VIEW, organizationId).catch(() => false),
        this.check(user, AUDIT_VIEW, organizationId).catch(() => false),
        this.check(user, PORTFOLIO_VIEW, organizationId).catch(() => false),
      ])

    return {
      // 组织成员概览对具备 `org:view` 的成员开放；成员明细管理仍需 `org:member:manage`。
      canViewMembers: canViewMembers || (await this.check(user, ORG_VIEW, organizationId)),
      canViewResources,
      canViewRisks,
      canViewActivity,
      canViewPmo,
    }
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
