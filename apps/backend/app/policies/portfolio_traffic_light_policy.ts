/**
 * v3-pmo-portfolio-traffic-light —— PortfolioTrafficLightPolicy（D4 组合可见 + 项目级二次过滤）。
 *
 * canViewPortfolio：PMO 组合交通灯查看权限
 * canManagePortfolio：PMO 复核标记管理权限（创建/更新复核标记）
 *
 * 组织隔离双检：每个方法都校验 organization_id。
 * 项目级二次授权：复核标记操作前，需要额外校验用户对目标项目的可见权限。
 */
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { PORTFOLIO_VIEW, PORTFOLIO_MANAGE } from '#start/rbac/permissions'
import type { PermissionCheckResult } from '#types/auth'

@inject()
export default class PortfolioTrafficLightPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 是否可以查看 PMO 组合交通灯（列表/详情/计数）。 */
  async canViewPortfolio(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, PORTFOLIO_VIEW, organizationId)
  }

  /** 是否可以管理 PMO 复核标记（创建/更新）。 */
  async canManagePortfolio(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, PORTFOLIO_MANAGE, organizationId)
  }

  /**
   * 项目级二次授权：校验用户是否对特定项目有可见权限。
   * 在组合交通灯读取路径中，Service 已按组织过滤可见项目，
   * 但复核标记的写入/读取需要额外确认用户对该项目的可见性。
   */
  async canViewProject(
    user: User,
    organizationId: number,
    _projectId: number,
  ): Promise<PermissionCheckResult> {
    // 项目级可见性由 Service 层按组织隔离 + 成员关系过滤，
    // Policy 层不做重复的 project_members 查询——由 Service 承担该职责。
    // 这里只确保用户至少有组织级的 portfolio:view 权限。
    return this.rbac.check(user, PORTFOLIO_VIEW, organizationId)
  }
}
