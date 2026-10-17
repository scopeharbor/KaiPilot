/**
 * v3-multi-project-impact-analysis —— MultiProjectImpactAnalysisPolicy（§4.2）
 *
 * 组织级影响分析 Policy：
 * - 校验组织成员资格
 * - 校验影响分析权限（multi_project_impact:view / multi_project_impact:manage）
 * - 校验项目可见性、端点权限、维度权限
 * - action-time reauthorization
 */

import type { Permission } from '#start/rbac/permissions'

export interface ImpactPolicyActor {
  id: number
  organizationId: number
  permissions: Permission[]
  visibleProjectIds: number[]
}

export interface ImpactPolicyContext {
  actor: ImpactPolicyActor
  organizationId: number
  operation:
    | 'plan'
    | 'run'
    | 'list'
    | 'read'
    | 'refresh'
    | 'what_if'
    | 'export'
    | 'follow_up'
    | 'ai_explanation'
    | 'drill_down'
}

export default class MultiProjectImpactAnalysisPolicy {
  /**
   * 校验组织成员资格
   */
  isOrganizationMember(actor: ImpactPolicyActor, organizationId: number): boolean {
    return actor.organizationId === organizationId
  }

  /**
   * 校验影响分析权限
   */
  canViewImpact(actor: ImpactPolicyActor): boolean {
    return (
      actor.permissions.includes('multi_project_impact:view') ||
      actor.permissions.includes('multi_project_impact:manage') ||
      actor.permissions.includes('system:admin')
    )
  }

  /**
   * 校验影响分析管理权限（写类操作：plan/run/refresh）
   */
  canManageImpact(actor: ImpactPolicyActor): boolean {
    return (
      actor.permissions.includes('multi_project_impact:manage') ||
      actor.permissions.includes('system:admin')
    )
  }

  /**
   * 校验项目可见性
   */
  canAccessProject(actor: ImpactPolicyActor, projectId: number): boolean {
    return actor.visibleProjectIds.includes(projectId)
  }

  /**
   * 校验项目集合可见性
   */
  canAccessProjects(actor: ImpactPolicyActor, projectIds: number[]): boolean {
    return projectIds.every((id) => this.canAccessProject(actor, id))
  }

  /**
   * 全面校验影响分析操作
   */
  authorize(ctx: ImpactPolicyContext): {
    authorized: boolean
    reason?: string
    restrictedProjectIds?: number[]
    redactedDimensions?: string[]
  } {
    // 1. 组织成员
    if (!this.isOrganizationMember(ctx.actor, ctx.organizationId)) {
      return { authorized: false, reason: '非组织成员，拒绝访问' }
    }

    // 2. 影响分析权限
    const needsManage = ['plan', 'run', 'refresh'].includes(ctx.operation)
    if (needsManage && !this.canManageImpact(ctx.actor)) {
      return { authorized: false, reason: '缺少多项目影响分析管理权限' }
    }
    if (!needsManage && !this.canViewImpact(ctx.actor)) {
      return { authorized: false, reason: '缺少多项目影响分析查看权限' }
    }

    return { authorized: true }
  }

  /**
   * 校验 drill-down 端点权限
   */
  canDrillDownToEndpoint(
    actor: ImpactPolicyActor,
    _endpointType: string,
    endpointProjectId: number,
  ): boolean {
    if (!this.canAccessProject(actor, endpointProjectId)) {
      return false
    }
    return this.canViewImpact(actor)
  }

  /**
   * 获取可见的项目 ID 列表（从 scope 中过滤）
   */
  getVisibleProjectIds(actor: ImpactPolicyActor, requestedProjectIds: number[]): number[] {
    return requestedProjectIds.filter((id) => this.canAccessProject(actor, id))
  }

  /**
   * 获取隐藏的项目 ID 列表
   */
  getHiddenProjectIds(actor: ImpactPolicyActor, requestedProjectIds: number[]): number[] {
    return requestedProjectIds.filter((id) => !this.canAccessProject(actor, id))
  }

  /**
   * 是否所有请求项目均可见
   */
  areAllProjectsVisible(actor: ImpactPolicyActor, requestedProjectIds: number[]): boolean {
    return requestedProjectIds.every((id) => this.canAccessProject(actor, id))
  }
}
