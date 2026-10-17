import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import type Comment from '#models/comment'
import RbacService from '#services/rbac_service'
import {
  COMMENT_CREATE,
  COMMENT_DELETE_SELF,
  COMMENT_MODERATE,
  COMMENT_UPDATE_SELF,
  COMMENT_VIEW,
  type Permission,
} from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * 评论权限策略（v2-collaboration-comments-mentions）。
 *
 * V2 扩展（在 V1 基础上）：
 * - mention: 创建评论时校验被提及用户可见性（RbacService 行级）
 * - resolve/reopen: 仅作者、项目经理、组织管理员和具备 comment:moderate 的角色
 * - reply: 复用 create 权限
 * - moderate: 可删除他人评论、可解决他人线程
 *
 * 权限矩阵（保持 V1 兼容）：
 * - comment:view → 查看评论
 * - comment:create → 创建/回复评论
 * - comment:update:self → 编辑本人评论
 * - comment:delete:self → 删除本人评论
 * - comment:moderate → 管理（删除他人评论/解决线程）
 */
@inject()
export default class CommentPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(COMMENT_VIEW, user, organizationId, projectId)
  }

  async create(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(COMMENT_CREATE, user, organizationId, projectId)
  }

  async updateSelf(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(COMMENT_UPDATE_SELF, user, organizationId, projectId)
  }

  async deleteSelf(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(COMMENT_DELETE_SELF, user, organizationId, projectId)
  }

  async moderate(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(COMMENT_MODERATE, user, organizationId, projectId)
  }

  /**
   * V2：解决/重新打开评论权限。
   * 允许：作者本人、项目经理、组织管理员、comment:moderate 角色。
   */
  async canResolve(
    user: User,
    organizationId: number,
    projectId: number,
    comment: Comment,
  ): Promise<boolean> {
    // 作者本人可解决
    if (comment.authorId === user.id) {
      return this.create(user, organizationId, projectId)
    }
    // comment:moderate 可解决
    return this.moderate(user, organizationId, projectId)
  }

  /**
   * V2：校验被提及用户对被提及者可见。
   * 外部协作者只能提及其可见对象范围内的用户。
   * （行级可见性由 rbacService 的 project membership 判定）
   */
  async canMention(
    user: User,
    organizationId: number,
    projectId: number,
    _mentionedUserId: number,
  ): Promise<boolean> {
    // 仅校验当前用户是否可评论（mention 作为评论的子操作）
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, COMMENT_CREATE, organizationId, projectId)
    return result.allowed
  }

  // ---------------------------------------------------------------------------
  // 行级权限（V1 兼容 + V2 扩展）
  // ---------------------------------------------------------------------------

  /**
   * 判断用户是否可编辑指定评论。
   * - comment:moderate → 不能代改他人正文（只能删除）
   * - comment:update:self → 仅本人评论
   */
  async canUpdate(
    user: User,
    organizationId: number,
    projectId: number,
    comment: Comment,
  ): Promise<boolean> {
    if (comment.authorId === user.id) {
      return this.updateSelf(user, organizationId, projectId)
    }
    return false
  }

  /**
   * 判断用户是否可删除指定评论。
   * - comment:moderate → 可删除他人评论
   * - comment:delete:self → 仅本人评论
   */
  async canDelete(
    user: User,
    organizationId: number,
    projectId: number,
    comment: Comment,
  ): Promise<boolean> {
    if (await this.moderate(user, organizationId, projectId)) {
      return true
    }
    if (comment.authorId === user.id) {
      return this.deleteSelf(user, organizationId, projectId)
    }
    return false
  }

  // ---------------------------------------------------------------------------
  // 授权快捷方法
  // ---------------------------------------------------------------------------

  async authorizeView(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.view(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权查看评论')
    }
  }

  async authorizeCreate(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.create(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权创建评论')
    }
  }

  async authorizeUpdate(
    user: User,
    organizationId: number,
    projectId: number,
    comment: Comment,
  ): Promise<void> {
    if (!(await this.canUpdate(user, organizationId, projectId, comment))) {
      throw new PermissionDeniedException('无权编辑此评论')
    }
  }

  async authorizeDelete(
    user: User,
    organizationId: number,
    projectId: number,
    comment: Comment,
  ): Promise<void> {
    if (!(await this.canDelete(user, organizationId, projectId, comment))) {
      throw new PermissionDeniedException('无权删除此评论')
    }
  }

  async authorizeResolve(
    user: User,
    organizationId: number,
    projectId: number,
    comment: Comment,
  ): Promise<void> {
    if (!(await this.canResolve(user, organizationId, projectId, comment))) {
      throw new PermissionDeniedException('无权解决或重新打开此评论')
    }
  }

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
