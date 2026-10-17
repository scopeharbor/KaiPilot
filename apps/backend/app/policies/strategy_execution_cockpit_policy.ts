import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'
import OrganizationPolicy from '#policies/organization_policy'
import RbacService from '#services/rbac_service'
import {
  AUDIT_VIEW,
  PORTFOLIO_VIEW,
  RESOURCE_VIEW,
  RISK_VIEW,
  type Permission,
} from '#start/rbac/permissions'
import type { CockpitAccess } from '#services/strategy_execution_cockpit_service'

/**
 * StrategyExecutionCockpitPolicy —— 战略执行驾驶舱权限守卫（v3-strategy-execution-cockpit §4.1）。
 *
 * 分层：
 *   1. 组织可见性：非成员按组织隔离规则返回 RESOURCE_NOT_FOUND，不泄露驾驶舱/来源存在性。
 *   2. 入口权限：复用 OrganizationPolicy.view（org:view）或组合查看权限（portfolio:view）。
 *   3. 维度权限：PMO/优先级/投入/资源/风险/回流各自独立判定，不足者返回低敏脱敏而非拒绝整页。
 */
@inject()
export default class StrategyExecutionCockpitPolicy {
  constructor(
    private readonly rbac: RbacService,
    private readonly organizationPolicy: OrganizationPolicy,
  ) {}

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

  async canView(user: User, organizationId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    if (await this.organizationPolicy.view(user, organizationId)) return true
    return this.check(user, PORTFOLIO_VIEW, organizationId)
  }

  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canView(user, organizationId))) {
      throw new PermissionDeniedException('无权查看战略执行驾驶舱')
    }
  }

  async resolveAccess(user: User, organizationId: number): Promise<CockpitAccess> {
    const [
      canViewPmo,
      canViewPriority,
      canViewInvestment,
      canViewResource,
      canViewRisk,
      canViewBackflow,
    ] = await Promise.all([
      this.check(user, PORTFOLIO_VIEW, organizationId).catch(() => false),
      this.check(user, PORTFOLIO_VIEW, organizationId).catch(() => false),
      this.check(user, PORTFOLIO_VIEW, organizationId).catch(() => false),
      this.check(user, RESOURCE_VIEW, organizationId).catch(() => false),
      this.check(user, RISK_VIEW, organizationId).catch(() => false),
      this.check(user, AUDIT_VIEW, organizationId).catch(() => false),
    ])
    return {
      canViewPmo,
      canViewPriority,
      canViewInvestment,
      canViewResource,
      canViewRisk,
      canViewBackflow,
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
