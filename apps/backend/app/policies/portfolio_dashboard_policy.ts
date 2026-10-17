import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { inject } from '@adonisjs/core'

/**
 * PortfolioDashboardPolicy —— PMO 组合 Dashboard 权限守卫（v3-pmo-portfolio-dashboard §3.3）。
 *
 * 权限层级：
 *   - portfolio:view → 可以查看 PMO 组合 Dashboard（组织级入口权限）。
 *   - portfolio:dashboard:view → 别名，映射到 portfolio:view。
 *   - 维度级权限：每个项目仍按组织隔离、项目可见性和细分权限过滤。
 *   - 无风险/资源/预测/交通灯权限时，不返回受限数量/名称/证据。
 */

/** 部署阶段暂不注册到 permissions.ts 的 `ALL_PERMISSIONS`，等 V3 RBAC baseline 裁决后再统一注册。 */
export const PORTFOLIO_VIEW = 'portfolio:view'

@inject()
export default class PortfolioDashboardPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 检查用户是否有组合 Dashboard 查看权限。 */
  async canView(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, PORTFOLIO_VIEW, Number(organizationId))
    return result.allowed
  }

  /** 断言组合 Dashboard 查看权限，无权限时抛 PERMISSION_DENIED。 */
  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canView(user, organizationId))) {
      throw new Error('PERMISSION_DENIED')
    }
  }
}
