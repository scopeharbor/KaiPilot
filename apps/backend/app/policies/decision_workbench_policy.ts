import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import {
  PMO_DECISION_DECIDE,
  PMO_DECISION_HANDOFF,
  PMO_DECISION_MANAGE,
  PMO_DECISION_REQUEST_AI,
  PMO_DECISION_VIEW,
  PORTFOLIO_VIEW,
  PREDICTION_VIEW,
  RESOURCE_VIEW,
  RISK_VIEW,
  MULTI_PROJECT_IMPACT_VIEW,
  type Permission,
} from '#start/rbac/permissions'
import type { PmoDecisionSource } from '@aiproj/types'

/**
 * v3-pmo-decision-intelligence-workbench —— DecisionWorkbenchPolicy（tasks 3.5）。
 *
 * 授权顺序（design D8 / spec「APIs and authorization」）：
 *   1. non-leaking 404：资源不存在或不属于本组织 → ResourceNotFoundException，
 *      不泄露资源类型/标题/参与者/计数/来源存在性；
 *   2. action permission：pmo_decision:view|manage|decide|handoff|request_ai；
 *   3. source dimension permission：证据来源维度（资源/风险/预测等）保持独立
 *      权限，缺失时以 forbidden 状态脱敏，不抛错、不以零值补齐。
 */

/** 来源维度 → 现有维度权限映射（来源维度权限独立于 pmo_decision:*）。 */
const SOURCE_DIMENSION_PERMISSIONS: Record<PmoDecisionSource, Permission> = {
  portfolio_dashboard: PORTFOLIO_VIEW,
  portfolio_traffic_light: PORTFOLIO_VIEW,
  priority_scoring: PORTFOLIO_VIEW,
  ai_priority_recommendations: PORTFOLIO_VIEW,
  investment_distribution: PORTFOLIO_VIEW,
  resource_contention: RESOURCE_VIEW,
  resource_forecast: RESOURCE_VIEW,
  allocation_preview: RESOURCE_VIEW,
  risk_register: RISK_VIEW,
  progress_prediction: PREDICTION_VIEW,
  multi_project_impact: MULTI_PROJECT_IMPACT_VIEW,
}

export function sourceDimensionPermission(source: PmoDecisionSource): Permission {
  return SOURCE_DIMENSION_PERMISSIONS[source]
}

@inject()
export default class DecisionWorkbenchPolicy {
  constructor(private readonly rbac: RbacService) {}

  // ── 第 1 层：non-leaking 404 ────────────────────────────────────────────────

  /**
   * 组织可见性：非成员按组织隔离规则返回 RESOURCE_NOT_FOUND，
   * 不泄露决策工作台/议题/来源存在性（先于 action 权限判定）。
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

  /**
   * 资源不存在或跨租户时统一抛 not-found；调用方必须先做组织隔离查询，
   * 把「不存在」与「无权查看」折叠为同一响应。
   */
  assertFound<T>(resource: T | null | undefined): T {
    if (resource === null || resource === undefined) {
      throw new ResourceNotFoundException('资源不存在')
    }
    return resource
  }

  // ── 第 2 层：action permission ──────────────────────────────────────────────

  async can(
    user: User,
    permission: Permission,
    organizationId: number,
    projectId?: number,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, permission, organizationId, projectId)
    return result.allowed
  }

  canView(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    return this.can(user, PMO_DECISION_VIEW, organizationId, projectId)
  }

  async authorizeView(user: User, organizationId: number, projectId?: number): Promise<void> {
    if (!(await this.canView(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权查看 PMO 决策工作台')
    }
  }

  async authorizeManage(user: User, organizationId: number, projectId?: number): Promise<void> {
    if (!(await this.can(user, PMO_DECISION_MANAGE, organizationId, projectId))) {
      throw new PermissionDeniedException('无权管理 PMO 决策议题')
    }
  }

  async authorizeDecide(user: User, organizationId: number): Promise<void> {
    if (!(await this.can(user, PMO_DECISION_DECIDE, organizationId))) {
      throw new PermissionDeniedException('无权记录 PMO 决策结论')
    }
  }

  async authorizeHandoff(user: User, organizationId: number): Promise<void> {
    if (!(await this.can(user, PMO_DECISION_HANDOFF, organizationId))) {
      throw new PermissionDeniedException('无权创建 PMO 决策交接')
    }
  }

  async authorizeRequestAi(user: User, organizationId: number): Promise<void> {
    if (!(await this.can(user, PMO_DECISION_REQUEST_AI, organizationId))) {
      throw new PermissionDeniedException('无权触发决策 AI 叙述')
    }
  }

  /** 参与者立场写入：view 权限 + 组织成员资格（rbac.check 已隐含成员校验）。 */
  async authorizePosition(user: User, organizationId: number): Promise<void> {
    if (!(await this.canView(user, organizationId))) {
      throw new PermissionDeniedException('无权记录决策立场')
    }
  }

  // ── 第 3 层：source dimension permission ────────────────────────────────────

  /**
   * 来源维度可见性：返回 false 时上层把该来源标记为 forbidden 脱敏，
   * 不抛错、不计入失败、不以零值补齐。
   */
  async canViewSourceDimension(
    user: User,
    organizationId: number,
    source: PmoDecisionSource,
    projectId?: number,
  ): Promise<boolean> {
    return this.can(user, sourceDimensionPermission(source), organizationId, projectId)
  }
}
