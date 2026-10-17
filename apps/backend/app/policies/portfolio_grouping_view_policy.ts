import type User from '#models/user'
import type PmoGroupingView from '#models/pmo_grouping_view'
import RbacService from '#services/rbac_service'
import { inject } from '@adonisjs/core'
import { PMO_GROUPING_VIEW_SCOPES, isSystemPreset } from '@aiproj/types'

/**
 * PortfolioGroupingViewPolicy —— PMO 组合分组视图权限守卫（v3-pmo-portfolio-grouping-views §3.5）。
 *
 * 权限层级：
 *   - portfolio:view → 可以查看/预览分组视图（组织级入口权限）。
 *   - portfolio:manage → 可以创建/修改组织共享视图、设组织默认、删除共享视图。
 *   - 个人视图写入 → 需要当前用户可访问 PMO Dashboard（portfolio:view）。
 *   - 系统预设 → 只读，不可通过 API 删除或覆盖。
 *   - 所有者 → 可以编辑/删除自己的个人视图。
 */

/** 部署阶段暂不注册新权限到 permissions.ts，复用既有 portfolio:view / portfolio:manage。 */
const PORTFOLIO_VIEW = 'portfolio:view'
const PORTFOLIO_MANAGE = 'portfolio:manage'

@inject()
export default class PortfolioGroupingViewPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 检查用户是否有组合 Dashboard 查看权限（基础入口权限）。 */
  async canViewPortfolio(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, PORTFOLIO_VIEW, Number(organizationId))
    return result.allowed
  }

  /** 检查用户是否有组合管理权限。 */
  async canManagePortfolio(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, PORTFOLIO_MANAGE, Number(organizationId))
    return result.allowed
  }

  /** 断言组合 Dashboard 查看权限，无权限时抛 PERMISSION_DENIED。 */
  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canViewPortfolio(user, organizationId))) {
      throw new Error('PERMISSION_DENIED')
    }
  }

  /** 断言组合管理权限，无权限时抛 PERMISSION_DENIED。 */
  async authorizeManage(user: User, organizationId: number): Promise<void> {
    if (!(await this.canManagePortfolio(user, organizationId))) {
      throw new Error('PERMISSION_DENIED')
    }
  }

  /** 检查是否可以读取某个视图。 */
  async canReadView(
    user: User,
    organizationId: number,
    view: { scope: string; ownerUserId: number | null },
  ): Promise<boolean> {
    // 系统预设所有人可读（有 portfolio:view 即可）
    if (view.scope === PMO_GROUPING_VIEW_SCOPES.SYSTEM) {
      return this.canViewPortfolio(user, organizationId)
    }
    // 个人视图只有所有者可读。原先给管理员开了口子，但规范
    // 「Personal and organization views are separated」写的是无条件排除他人个人视图
    // （excluding personal views owned by other users），没有管理员例外；
    // 而组织所有者/超管天然带 portfolio:manage，那个口子等于让个人视图对管理员全透明。
    if (view.scope === PMO_GROUPING_VIEW_SCOPES.PERSONAL) {
      return view.ownerUserId === Number(user.id)
    }
    // 组织视图需要 portfolio:view
    return this.canViewPortfolio(user, organizationId)
  }

  /** 检查是否可以创建个人视图。 */
  async canCreatePersonal(user: User, organizationId: number): Promise<boolean> {
    return this.canViewPortfolio(user, organizationId)
  }

  /** 检查是否可以创建/编辑组织共享视图。 */
  async canWriteShared(user: User, organizationId: number): Promise<boolean> {
    return this.canManagePortfolio(user, organizationId)
  }

  /** 检查是否可以编辑某个视图。 */
  async canEditView(user: User, organizationId: number, view: PmoGroupingView): Promise<boolean> {
    // 系统预设不可编辑
    if (isSystemPreset({ scope: view.scope, id: view.viewId })) return false

    // 个人视图只有所有者可编辑
    if (view.scope === PMO_GROUPING_VIEW_SCOPES.PERSONAL) {
      return view.ownerUserId === Number(user.id)
    }

    // 组织共享视图需要 portfolio:manage
    return this.canManagePortfolio(user, organizationId)
  }

  /** 检查是否可以删除某个视图。 */
  async canDeleteView(user: User, organizationId: number, view: PmoGroupingView): Promise<boolean> {
    // 系统预设不可删除
    if (isSystemPreset({ scope: view.scope, id: view.viewId })) return false

    // 个人视图只有所有者可删除
    if (view.scope === PMO_GROUPING_VIEW_SCOPES.PERSONAL) {
      return view.ownerUserId === Number(user.id)
    }

    // 组织共享视图需要 portfolio:manage
    return this.canManagePortfolio(user, organizationId)
  }

  /** 检查是否可以复制某个视图。 */
  async canDuplicateView(
    user: User,
    organizationId: number,
    view: PmoGroupingView,
  ): Promise<boolean> {
    // 系统预设可被任何人复制（有 portfolio:view 即可）
    if (isSystemPreset({ scope: view.scope, id: view.viewId })) {
      return this.canViewPortfolio(user, organizationId)
    }
    // 其他视图复用读取权限
    return this.canReadView(user, organizationId, view)
  }

  /** 检查是否可以设置个人默认视图。 */
  async canSetPersonalDefault(user: User, organizationId: number): Promise<boolean> {
    return this.canViewPortfolio(user, organizationId)
  }

  /** 检查是否可以设置组织默认视图。 */
  async canSetOrganizationDefault(user: User, organizationId: number): Promise<boolean> {
    return this.canManagePortfolio(user, organizationId)
  }

  /** 检查是否可以修改视图默认标记。 */
  async canSetDefault(user: User, organizationId: number, scope: string): Promise<boolean> {
    if (scope === 'organization') {
      return this.canSetOrganizationDefault(user, organizationId)
    }
    return this.canSetPersonalDefault(user, organizationId)
  }
}
