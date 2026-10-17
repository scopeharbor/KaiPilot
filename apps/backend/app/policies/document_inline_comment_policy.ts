import RbacService from '#services/rbac_service'
import { PermissionDeniedException } from '#exceptions/api_exception'
import type User from '#models/user'
import { inject } from '@adonisjs/core'

/**
 * 文档内联批注权限策略。
 *
 * 复用既有 comment:view/create/edit/delete/self/moderate 和 file:view 权限。
 * document_inline_comment:reanchor 为窄权限（作者或 moderator 可用）。
 */
@inject()
export default class DocumentInlineCommentPolicy {
  constructor(private rbac: RbacService) {}

  /** 查看内联批注 → comment:view 或 file:view */
  async view(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    const commentView = await this.rbac.check(user, 'comment:view', organizationId, projectId)
    if (commentView.allowed) return true
    const fileView = await this.rbac.check(user, 'file:view', organizationId, projectId)
    return fileView.allowed
  }

  /** 创建内联批注 → comment:create */
  async create(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    const result = await this.rbac.check(user, 'comment:create', organizationId, projectId)
    return result.allowed
  }

  /** 编辑自己的评论 → comment:update:self */
  async editSelf(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    const result = await this.rbac.check(user, 'comment:update:self', organizationId, projectId)
    return result.allowed
  }

  /** 删除自己的评论 → comment:delete:self */
  async deleteSelf(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    const result = await this.rbac.check(user, 'comment:delete:self', organizationId, projectId)
    return result.allowed
  }

  /** 管理/审核 → comment:moderate */
  async moderate(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    const result = await this.rbac.check(user, 'comment:moderate', organizationId, projectId)
    return result.allowed
  }

  /** 重设锚点 → comment:update:self（作者）或 comment:moderate */
  async reanchor(user: User, organizationId: number, projectId?: number): Promise<boolean> {
    const edit = await this.rbac.check(user, 'comment:update:self', organizationId, projectId)
    if (edit.allowed) return true
    const mod = await this.rbac.check(user, 'comment:moderate', organizationId, projectId)
    return mod.allowed
  }

  // ─── assert 方法 ────────────────────────────────────────────────

  async assertView(user: User, organizationId: number, projectId?: number): Promise<void> {
    const allowed = await this.view(user, organizationId, projectId)
    if (!allowed) throw new PermissionDeniedException('无权查看文档内联批注')
  }

  async assertCreate(user: User, organizationId: number, projectId?: number): Promise<void> {
    const allowed = await this.create(user, organizationId, projectId)
    if (!allowed) throw new PermissionDeniedException('无权创建内联批注')
  }

  async assertEditSelf(user: User, organizationId: number, projectId?: number): Promise<void> {
    const allowed = await this.editSelf(user, organizationId, projectId)
    if (!allowed) throw new PermissionDeniedException('无权编辑内联批注')
  }

  async assertDeleteSelf(user: User, organizationId: number, projectId?: number): Promise<void> {
    const allowed = await this.deleteSelf(user, organizationId, projectId)
    if (!allowed) throw new PermissionDeniedException('无权删除内联批注')
  }

  async assertModerate(user: User, organizationId: number, projectId?: number): Promise<void> {
    const allowed = await this.moderate(user, organizationId, projectId)
    if (!allowed) throw new PermissionDeniedException('无权管理内联批注')
  }

  async assertReanchor(user: User, organizationId: number, projectId?: number): Promise<void> {
    const allowed = await this.reanchor(user, organizationId, projectId)
    if (!allowed) throw new PermissionDeniedException('无权重设锚点')
  }
}
