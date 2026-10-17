import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import RiskPolicy from '#policies/risk_policy'
import ResourcePolicy from '#policies/resource_policy'
import { CHANGE_IMPACT_VIEW, PROJECT_VIEW, type Permission } from '#start/rbac/permissions'

/**
 * ProjectHealthRiskCommandCenterAccess —— 维度权限裁剪结果。
 * 在 reader 调用前下推：无对应权限时该领域 reader 根本不会执行（D5）。
 */
export interface CommandCenterAccess {
  canViewRisk: boolean
  canViewResource: boolean
  canViewChangeImpact: boolean
}

/**
 * ProjectHealthRiskCommandCenterPolicy —— 项目健康风险指挥中心项目门（§3.1）。
 *
 * 分层：
 *   1. 项目可见性：有效组织 + 未删除项目 + project:view；跨组织/不可见项目
 *      统一以非泄露 RESOURCE_NOT_FOUND 收束，不暴露任何来源存在性。
 *   2. 维度权限：risk:view / resource:view / change_impact:view 各自独立判定，
 *      失败者仅表现为来源缺席（forbidden），不影响其它来源与整页可读性。
 */
@inject()
export default class ProjectHealthRiskCommandCenterPolicy {
  constructor(
    private readonly rbac: RbacService,
    private readonly riskPolicy: RiskPolicy,
    private readonly resourcePolicy: ResourcePolicy,
  ) {}

  /**
   * 项目门：解析有效组织内的可见项目并校验 project:view。
   * 跨租/不可见/软删除项目一律 RESOURCE_NOT_FOUND（非泄露）。
   * 使用查询构造器而非模型静态方法（避免 policy 层静态模型依赖）。
   */
  async assertProjectVisible(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<{ id: number }> {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const project = await db
      .from('projects')
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')

    if (!(await this.canViewProject(user, organizationId, projectId))) {
      // 权限不足与不存在同形返回，避免存在性泄露。
      throw new ResourceNotFoundException('项目不存在')
    }
    return { id: Number(project.id) }
  }

  async canViewProject(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    return this.check(user, PROJECT_VIEW, organizationId, projectId)
  }

  /** 维度权限解析：全部并行、失败按 false 收束（不抛出）。 */
  async resolveAccess(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<CommandCenterAccess> {
    const [canViewRisk, canViewResource, canViewChangeImpact] = await Promise.all([
      this.riskPolicy.view(user, organizationId, projectId).catch(() => false),
      this.resourcePolicy.view(user, organizationId, projectId).catch(() => false),
      this.check(user, CHANGE_IMPACT_VIEW, organizationId, projectId).catch(() => false),
    ])
    return { canViewRisk, canViewResource, canViewChangeImpact }
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

/** 导出给单元测试的显式拒绝助手（保持与其它 Policy 一致的异常语义）。 */
export async function assertPermissionOrDenied(allowed: boolean, message: string): Promise<void> {
  if (!allowed) throw new PermissionDeniedException(message)
}
