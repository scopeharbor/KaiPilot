/**
 * PortfolioPriorityPolicy —— PMO 优先级评分权限策略
 *
 * v3-pmo-priority-scoring-model §3.3
 *
 * 权限模型：
 *   - 入口权限：portfolio:view（复用 PMO 组合查看权限）
 *   - 维度二次权限：risk:view / resource:view / prediction:view / health:view / traffic_light:view
 *   - 项目级二次权限：在项目详情端点做二次校验
 *
 * 维度权限脱敏：用户缺少某维度权限时，该维度标记为 forbidden，
 * 不泄露隐藏计数、名称、证据文本或评分差异。
 */
import { inject } from '@adonisjs/core'
import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { PORTFOLIO_VIEW, RISK_VIEW, RESOURCE_VIEW, PREDICTION_VIEW } from '#start/rbac/permissions'
import type { Permission } from '#start/rbac/permissions'
import type { ScoreDimensionKey } from '@aiproj/types'

@inject()
export default class PortfolioPriorityPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 入口权限：PMO 组合查看 */
  async canViewPriority(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, PORTFOLIO_VIEW, organizationId)
    return result.allowed
  }

  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canViewPriority(user, organizationId))) {
      throw new PermissionDeniedException('无权查看 PMO 优先级评分')
    }
  }

  /** 项目级二次权限 */
  async canViewProject(user: User, organizationId: number, projectId: number): Promise<boolean> {
    const result = await this.rbac.check(user, PORTFOLIO_VIEW, organizationId, projectId)
    return result.allowed
  }

  async authorizeProjectView(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.canViewProject(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权查看此项目的优先级评分详情')
    }
  }

  /** 维度级权限探测（不抛异常，返回可用性） */
  async checkDimensionPermission(
    user: User,
    organizationId: number,
    dimension: ScoreDimensionKey,
  ): Promise<{ allowed: boolean; permissionKey?: string }> {
    switch (dimension) {
      case 'risk_pressure':
        return this.check(user, RISK_VIEW, organizationId, 'risk:view')
      case 'resource_pressure':
        return this.check(user, RESOURCE_VIEW, organizationId, 'resource:view')
      case 'prediction_pressure':
        return this.check(user, PREDICTION_VIEW, organizationId, 'prediction:view')
      case 'delivery_urgency':
      case 'traffic_light_severity':
        // 交通灯和交付紧急度复用 portfolio:view
        return { allowed: true }
      case 'management_attention':
      case 'freshness':
      case 'review_state':
        // 这些维度不需要额外权限，只要 portfolio:view 即可
        return { allowed: true }
      default:
        return { allowed: false, permissionKey: 'unknown' }
    }
  }

  private async check(
    user: User,
    permission: Permission,
    organizationId: number,
    permKey: string,
  ): Promise<{ allowed: boolean; permissionKey?: string }> {
    if (user.isSuperAdmin) return { allowed: true }
    const result = await this.rbac.check(user, permission, organizationId)
    return { allowed: result.allowed, permissionKey: result.allowed ? undefined : permKey }
  }
}
