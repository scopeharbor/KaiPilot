import { inject } from '@adonisjs/core'
import type User from '#models/user'
import OkrPolicy from '#policies/okr_policy'

/**
 * OkrDashboardPolicy —— OKR 只读 Dashboard 权限守卫（v3-okr-dashboard §3.3）。
 *
 * 只覆盖 view/dashboard/read 权限；写操作永远走 OkrPolicy。
 * 只依赖既有 OKR view 判定 + Backflow 摘要视图授权，不引入新的 permission scope。
 *
 * 红线：
 *   - 组织隔离由 assertOrganizationVisible 统一：非成员一律 RESOURCE_NOT_FOUND。
 *   - safe drill-down 只有在对应能力 policy 允许时才生效；未授权 target 一律不下发 href。
 */
@inject()
export default class OkrDashboardPolicy {
  constructor(private readonly okrPolicy: OkrPolicy) {}

  /** 第一层：组织隔离——非成员按 RESOURCE_NOT_FOUND 处理，不泄露组织 / OKR 存在。 */
  async assertOrganizationVisible(user: User, organizationId: number): Promise<void> {
    await this.okrPolicy.assertOrganizationVisible(user, organizationId)
  }

  /** 第二层：Dashboard view——复用 OKR view 判定，不引入独立 permission。 */
  async canView(user: User, organizationId: number): Promise<boolean> {
    return this.okrPolicy.canView(user, organizationId)
  }

  async authorizeView(user: User, organizationId: number): Promise<void> {
    await this.okrPolicy.authorizeView(user, organizationId)
  }

  /** Backflow 摘要视图——继承 OKR view 权限。 */
  async canViewBackflowSummary(user: User, organizationId: number): Promise<boolean> {
    return this.okrPolicy.canViewBackflow(user, organizationId)
  }

  /** 项目下钻——只有在 OKR project view 授权时才允许 drill-down。 */
  async canDrillDownProject(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<boolean> {
    return this.okrPolicy.canViewProject(user, organizationId, projectId)
  }

  /** 综合维度访问信息——复用 OKR policy 的 resolveAccess 输出。 */
  async resolveAccess(user: User, organizationId: number) {
    return this.okrPolicy.resolveAccess(user, organizationId)
  }
}
