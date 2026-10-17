import { inject } from '@adonisjs/core'
import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { PORTFOLIO_VIEW, RESOURCE_VIEW, type Permission } from '#start/rbac/permissions'
import type { PmoInvestmentDistributionDimension } from '@aiproj/types'

@inject()
export default class PmoInvestmentDistributionPolicy {
  constructor(private readonly rbac: RbacService) {}

  async canView(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, PORTFOLIO_VIEW, organizationId)
    return result.allowed
  }

  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canView(user, organizationId))) {
      throw new PermissionDeniedException('无权查看 PMO 投入分布')
    }
  }

  async canViewProject(user: User, organizationId: number, projectId: number): Promise<boolean> {
    const result = await this.rbac.check(user, PORTFOLIO_VIEW, organizationId, projectId)
    return result.allowed
  }

  async canViewResourceFacts(
    user: User,
    organizationId: number,
    projectId?: number,
  ): Promise<boolean> {
    return this.check(user, RESOURCE_VIEW, organizationId, projectId)
  }

  async canViewDimension(
    user: User,
    organizationId: number,
    dimension: PmoInvestmentDistributionDimension,
  ): Promise<boolean> {
    if (dimension === 'manager' || dimension === 'department') {
      return this.canViewResourceFacts(user, organizationId)
    }
    return this.canView(user, organizationId)
  }

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
