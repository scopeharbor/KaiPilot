/**
 * RendererConfigPolicy —— 渲染器配置权限策略（§2.6 P0，§7.3 P0）。
 *
 * 3 层权限：查看/编辑/管理，对应 RBAC 的 renderer:view / renderer:manage / renderer:admin。
 */
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import CustomViewPolicy from '#policies/custom_view_policy'
import { PermissionDeniedException } from '#exceptions/api_exception'
import RbacService from '#services/rbac_service'
import {
  RENDERER_ADMIN,
  RENDERER_MANAGE,
  RENDERER_VIEW,
  CUSTOM_VIEW_MANAGE,
  type Permission,
} from '#start/rbac/permissions'

@inject()
export default class RendererConfigPolicy {
  constructor(
    private customViewPolicy: CustomViewPolicy,
    private rbac: RbacService,
  ) {}

  /**
   * 查看渲染器配置。
   * 项目成员默认可查看。
   */
  async canView(user: User, organizationId: number): Promise<boolean> {
    return (
      (await this.allows(user, RENDERER_VIEW, organizationId)) ||
      (await this.allows(user, RENDERER_MANAGE, organizationId))
    )
  }

  /**
   * 保存/编辑渲染器配置（可创建个人视图）。
   */
  async canSave(user: User, organizationId: number): Promise<boolean> {
    return this.allows(user, RENDERER_MANAGE, organizationId)
  }

  /**
   * 确认 AI 候选（创建/更新自定义视图）。
   */
  async canConfirmCandidate(user: User, organizationId: number): Promise<boolean> {
    return this.allows(user, RENDERER_MANAGE, organizationId)
  }

  /**
   * 管理共享视图、设置默认入口。
   */
  async canManageShared(user: User, organizationId: number, isShared: boolean): Promise<boolean> {
    if (!isShared) {
      return this.canSave(user, organizationId)
    }
    return (
      (await this.allows(user, RENDERER_ADMIN, organizationId)) ||
      (await this.allows(user, CUSTOM_VIEW_MANAGE, organizationId))
    )
  }

  /**
   * 查看共享视图（同 custom_view:view）。
   */
  async canViewShared(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.customViewPolicy
      .authorizeViewShared({ user } as any, organizationId, projectId)
      .then(() => true)
      .catch(() => false)
  }

  /**
   * 授权包装器（抛出异常而非返回 boolean）。
   */
  async authorizeView(user: User, organizationId: number): Promise<void> {
    if (!(await this.canView(user, organizationId))) {
      throw new PermissionDeniedException('无权查看渲染器配置')
    }
  }

  async authorizeSave(user: User, organizationId: number): Promise<void> {
    if (!(await this.canSave(user, organizationId))) {
      throw new PermissionDeniedException('无权保存渲染器配置')
    }
  }

  async authorizeConfirmCandidate(user: User, organizationId: number): Promise<void> {
    if (!(await this.canConfirmCandidate(user, organizationId))) {
      throw new PermissionDeniedException('无权确认 AI 候选渲染器配置')
    }
  }

  private async allows(
    user: User,
    permission: Permission,
    organizationId: number,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const result = await this.rbac.check(user, permission, organizationId)
    return result.allowed
  }
}
