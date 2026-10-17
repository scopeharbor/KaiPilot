import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'
import OrganizationPolicy from '#policies/organization_policy'
import RbacService from '#services/rbac_service'
import {
  ORG_VIEW,
  PORTFOLIO_VIEW,
  RESOURCE_VIEW,
  RISK_VIEW,
  PREDICTION_VIEW,
  type Permission,
} from '#start/rbac/permissions'

/**
 * BI 趋势分析策略 —— 组织级维度权限与脱敏决策（v3-bi-trend-analysis §3.1）。
 *
 * 分层：
 *   1. **组织隔离**：非成员按 `RESOURCE_NOT_FOUND` 拒绝，不泄露组织是否存在。
 *   2. **入口权限**：`org:view` 或 `portfolio:view` 任一满足即可进入 BI 趋势工作台。
 *   3. **维度权限**：进度/延期压力对 org:view 开放；风险压力需 risk:view；
 *      资源/预测压力需 resource:view/prediction:view；OKR 需 portfolio:view。
 *      权限不足时返回低敏 redacted/unavailable，不暴露隐藏计数或名称。
 */
@inject()
export default class BiTrendAnalysisPolicy {
  constructor(
    private readonly rbac: RbacService,
    private readonly organizationPolicy: OrganizationPolicy,
  ) {}

  /**
   * 组织隔离断言：actor 必须是该组织成员或所有者（超管放行）。
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

  /** 是否可查看 BI 趋势（入口权限）。 */
  async canView(user: User, organizationId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    if (await this.organizationPolicy.view(user, organizationId)) return true
    return this.check(user, PORTFOLIO_VIEW, organizationId)
  }

  /** 断言 BI 趋势查看权限。 */
  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canView(user, organizationId))) {
      throw new PermissionDeniedException('无权查看 BI 趋势分析')
    }
  }

  /**
   * 解析维度级权限，供 Service 做低敏脱敏。
   * 各维度独立判定；失败者返回 redacted，不拒绝整页。
   */
  async resolveDimensionAccess(
    user: User,
    organizationId: number,
  ): Promise<BiTrendDimensionAccess> {
    const [canViewProgress, canViewRisk, canViewResource, canViewPrediction, canViewOkr] =
      await Promise.all([
        // 进度与延期压力对 org:view 成员开放
        this.check(user, ORG_VIEW, organizationId).catch(() => false),
        this.check(user, RISK_VIEW, organizationId).catch(() => false),
        this.check(user, RESOURCE_VIEW, organizationId).catch(() => false),
        this.check(user, PREDICTION_VIEW, organizationId).catch(() => false),
        this.check(user, PORTFOLIO_VIEW, organizationId).catch(() => false),
      ])

    return {
      canViewProgress,
      canViewRisk,
      canViewResource,
      canViewPrediction,
      canViewOkr,
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

export interface BiTrendDimensionAccess {
  canViewProgress: boolean
  canViewRisk: boolean
  canViewResource: boolean
  canViewPrediction: boolean
  canViewOkr: boolean
}
