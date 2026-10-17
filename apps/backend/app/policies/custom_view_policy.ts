import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import type CustomView from '#models/custom_view'
import RbacService from '#services/rbac_service'
import { CUSTOM_VIEW_MANAGE, TASK_VIEW, type Permission } from '#rbac'
import { inject } from '@adonisjs/core'
import type { AuthContext } from '#types/auth'

/**
 * 认证上下文扩展：注入 User 实例供 Policy 判定所有者身份使用。
 */
type AuthUserContext = AuthContext & { user: User }

/**
 * CustomViewPolicy —— 自定义视图权限判定（v2-custom-views-view-config）。
 *
 * 两种可见性层级：
 * - personal : 仅所有者可查看/管理
 * - shared   : 项目成员可查看（TASK_VIEW）；创建者/项目经理/组织管理员可管理
 *
 * 组织隔离由 Service 层 `projectExistsInOrg` 保证，跨组织访问返回 404，
 * 本 Policy 只负责在组织+项目上下文下评估 RBAC 与所有者关系，不判定资源存在性。
 */
@inject()
export default class CustomViewPolicy {
  constructor(private rbac: RbacService) {}

  // ─── 权限检查（布尔） ──────────────────────────────

  /**
   * 查看个人视图：必须是所有者本人。
   */
  async viewPersonal(auth: AuthUserContext, view: CustomView): Promise<boolean> {
    if (auth.user.isSuperAdmin) return true
    return auth.user.id === view.ownerUserId
  }

  /**
   * 查看共享视图：项目成员持有 TASK_VIEW 权限即可。
   */
  async viewShared(
    auth: AuthUserContext,
    organizationId: number,
    projectId: number,
  ): Promise<boolean> {
    return this.allows(TASK_VIEW, auth.user, organizationId, projectId)
  }

  /**
   * 创建自定义视图：需要 TASK_VIEW 权限（视图是任务视图的扩展）。
   */
  async create(
    auth: AuthUserContext,
    organizationId: number,
    projectId: number,
    visibility: CustomView['visibility'] = 'personal',
  ): Promise<boolean> {
    return this.allows(
      visibility === 'shared' ? CUSTOM_VIEW_MANAGE : TASK_VIEW,
      auth.user,
      organizationId,
      projectId,
    )
  }

  /**
   * 管理视图（更新/删除）：
   * - personal : 仅所有者
   * - shared   : 创建者、项目经理或组织管理员
   */
  async manage(auth: AuthUserContext, view: CustomView): Promise<boolean> {
    if (auth.user.isSuperAdmin) return true

    if (view.visibility === 'personal') {
      return auth.user.id === view.ownerUserId
    }

    // 共享视图：创建者自动拥有管理权限
    if (auth.user.id === view.ownerUserId) return true

    // 项目经理或组织管理员可管理共享视图
    return this.allows(CUSTOM_VIEW_MANAGE, auth.user, view.organizationId, view.projectId)
  }

  // ─── 授权检查（抛异常） ────────────────────────────

  async authorizeViewPersonal(auth: AuthUserContext, view: CustomView): Promise<void> {
    if (!(await this.viewPersonal(auth, view))) {
      throw new PermissionDeniedException('无权查看该个人视图')
    }
  }

  async authorizeViewShared(
    auth: AuthUserContext,
    organizationId: number,
    projectId: number,
  ): Promise<void> {
    if (!(await this.viewShared(auth, organizationId, projectId))) {
      throw new PermissionDeniedException('无权查看共享视图')
    }
  }

  async authorizeCreate(
    auth: AuthUserContext,
    organizationId: number,
    projectId: number,
    visibility: CustomView['visibility'] = 'personal',
  ): Promise<void> {
    if (!(await this.create(auth, organizationId, projectId, visibility))) {
      throw new PermissionDeniedException('无权创建自定义视图')
    }
  }

  async authorizeManage(auth: AuthUserContext, view: CustomView): Promise<void> {
    if (!(await this.manage(auth, view))) {
      throw new PermissionDeniedException('无权管理该自定义视图')
    }
  }

  // ─── 工具方法 ──────────────────────────────────────

  private async allows(
    permission: Permission,
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, permission, organizationId, projectId)
    return result.allowed
  }
}
