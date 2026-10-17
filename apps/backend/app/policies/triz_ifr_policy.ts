/**
 * v3-triz-ifr-visualization —— IFR 可视化权限策略（tasks 4.1 P0）。
 *
 * view: 查看 IFR 预览/已保存审查列表/详情/新鲜度
 * manage: 保存 IFR 审查/请求 AI 草稿/handoff preview 和 candidate
 */

import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { TRIZ_IFR_VIEW, TRIZ_IFR_MANAGE } from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class TrizIfrPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, TRIZ_IFR_VIEW, organizationId, projectId)
    return result.allowed
  }

  async manage(user: User, organizationId: number, projectId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, TRIZ_IFR_MANAGE, organizationId, projectId)
    return result.allowed
  }
}
