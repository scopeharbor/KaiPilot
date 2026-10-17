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
 * BI 风险热力图策略 —— 组织级维度权限与脱敏决策（v3-bi-risk-heatmap §3.1）。
 *
 * 分层：
 *   1. **组织隔离**：非成员按 `RESOURCE_NOT_FOUND` 拒绝，不泄露组织是否存在。
 *   2. **入口权限**：`org:view` 或 `portfolio:view` 任一满足即可进入 BI 风险热力图工作台。
 *   3. **维度权限**：项目/部门维度对 org:view 开放；风险维度需 risk:view；
 *      资源维度需 resource:view；交通灯/组合维度需 portfolio:view；
 *      健康诊断需 prediction:view。
 *      权限不足时返回低敏 redacted/unavailable，不暴露隐藏计数或名称。
 */
@inject()
export default class BiRiskHeatmapPolicy {
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

  /** 是否可查看 BI 风险热力图（入口权限）。 */
  async canView(user: User, organizationId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    if (await this.organizationPolicy.view(user, organizationId)) return true
    return this.check(user, PORTFOLIO_VIEW, organizationId)
  }

  /** 断言 BI 风险热力图查看权限。 */
  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canView(user, organizationId))) {
      throw new PermissionDeniedException('无权查看 BI 风险热力图')
    }
  }

  /**
   * 解析维度级权限，供 Service 做低敏脱敏。
   * 各维度独立判定；失败者返回 redacted，不拒绝整页。
   */
  async resolveDimensionAccess(
    user: User,
    organizationId: number,
  ): Promise<BiRiskHeatmapDimensionAccess> {
    const [canViewProject, canViewRisk, canViewResource, canViewPortfolio, canViewPrediction] =
      await Promise.all([
        this.check(user, ORG_VIEW, organizationId).catch(() => false),
        this.check(user, RISK_VIEW, organizationId).catch(() => false),
        this.check(user, RESOURCE_VIEW, organizationId).catch(() => false),
        this.check(user, PORTFOLIO_VIEW, organizationId).catch(() => false),
        this.check(user, PREDICTION_VIEW, organizationId).catch(() => false),
      ])

    return {
      canViewProject,
      canViewRisk,
      canViewResource,
      canViewPortfolio,
      canViewPrediction,
    }
  }

  /**
   * 判断是否需要对特定维度做脱敏处理。
   */
  needsRedaction(dimensionKey: string, access: BiRiskHeatmapDimensionAccess): boolean {
    switch (dimensionKey) {
      case 'project':
      case 'department':
        return !access.canViewProject
      case 'risk_category':
      case 'risk_level':
      case 'risk_status':
        return !access.canViewRisk
      case 'assignee':
        return !access.canViewResource
      case 'portfolio_group':
        return !access.canViewPortfolio
      default:
        return !access.canViewProject
    }
  }

  /**
   * 判断是否需要对特定指标做脱敏处理。
   */
  needsMetricRedaction(metricKey: string, access: BiRiskHeatmapDimensionAccess): boolean {
    switch (metricKey) {
      case 'risk_exposure_score':
      case 'risk_count':
      case 'high_risk_ratio':
      case 'overdue_risk_ratio':
        return !access.canViewRisk
      case 'risk_delta':
        return !access.canViewRisk
      case 'traffic_light_risk_ratio':
        return !access.canViewPortfolio
      default:
        return false
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

export interface BiRiskHeatmapDimensionAccess {
  canViewProject: boolean
  canViewRisk: boolean
  canViewResource: boolean
  canViewPortfolio: boolean
  canViewPrediction: boolean
}
