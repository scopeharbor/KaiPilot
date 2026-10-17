import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { CONTRADICTION_VIEW } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * TRIZ Compiler Analysis 权限策略。
 *
 * view 控制 TRIZ 分析 artifact 列表/详情/Dashboard 摘要的读取权限；
 * handoff 控制从分析解决路径创建 Draft 候选的权限（需 contradiction:view + Draft Layer 读权限）。
 * 组织与项目存在性由 Controller/Service 负责。
 */
@inject()
export default class TrizCompilerAnalysisPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, CONTRADICTION_VIEW, organizationId, projectId)
    return result.allowed
  }

  async handoff(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    // contradiction:view 是 handoff 的最低准入条件（仅创建 advisory 候选元数据）
    const result = await this.rbac.check(user, CONTRADICTION_VIEW, organizationId, projectId)
    if (!result.allowed) return false
    // Draft Layer 读权限由 handoff 调用方（Service）二次判定，此处不做细粒度拦截
    return true
  }
}
