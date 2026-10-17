// v3-bi-dashboard-builder §4.3 — BI Dashboard Builder Policy。
// 组织成员、BI dashboard view/manage、personal owner、shared default 管理、widget permission tags。

import type User from '#models/user'
import type OrganizationPolicy from '#policies/organization_policy'
import type BiDashboardDefinition from '#models/bi_dashboard_definition'

export default class BiDashboardPolicy {
  constructor(private readonly orgPolicy: OrganizationPolicy) {}

  /** 确认用户是组织成员 */
  async assertOrganizationVisible(user: User, organizationId: number): Promise<void> {
    const allowed = await this.orgPolicy.view(user, organizationId)
    if (!allowed) {
      throw new Error('Organization not visible')
    }
  }

  /** BI Dashboard 查看权限（组织成员即可查看 shared，owner 可查看 personal） */
  async authorizeView(user: User, dashboard: BiDashboardDefinition): Promise<boolean> {
    const allowed = await this.orgPolicy.view(user, dashboard.organizationId)
    if (!allowed) return false

    if (dashboard.scope === 'organization_shared') {
      return true
    }
    return dashboard.ownerActorId === user.id
  }

  /** BI Dashboard 管理权限 */
  async authorizeManage(user: User, dashboard: BiDashboardDefinition): Promise<boolean> {
    const allowed = await this.orgPolicy.view(user, dashboard.organizationId)
    if (!allowed) return false

    if (dashboard.scope === 'personal') {
      return dashboard.ownerActorId === user.id
    }

    return this.orgPolicy.manage(user, dashboard.organizationId)
  }

  /** 创建个人 dashboard 权限 */
  async authorizeCreatePersonal(user: User, organizationId: number): Promise<boolean> {
    return this.orgPolicy.view(user, organizationId)
  }

  /** 创建/管理共享 dashboard 权限 */
  async authorizeCreateShared(user: User, organizationId: number): Promise<boolean> {
    return this.orgPolicy.manage(user, organizationId)
  }

  /** 设置默认 dashboard */
  async authorizeSetDefault(user: User, dashboard: BiDashboardDefinition): Promise<boolean> {
    if (dashboard.scope !== 'organization_shared') {
      return false
    }
    return this.authorizeManage(user, dashboard)
  }

  /** 检查 widget permission tags */
  async authorizeWidgetTags(
    user: User,
    organizationId: number,
    requiredTags: string[],
  ): Promise<boolean> {
    if (requiredTags.length === 0) return true
    const isOrgMember = await this.orgPolicy.view(user, organizationId)
    if (!isOrgMember) return false

    for (const tag of requiredTags) {
      if (tag === 'pmo' || tag === 'bi_dashboard_manage') {
        const isAdmin = await this.orgPolicy.manage(user, organizationId)
        if (!isAdmin) return false
      }
    }
    return true
  }
}
