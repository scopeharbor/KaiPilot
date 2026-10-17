import { PermissionDeniedException } from '#exceptions/api_exception'
import type ChangeRequest from '#models/change_request'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { CHANGE_REQUEST_APPROVE, CHANGE_REQUEST_CREATE, type Permission } from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * 变更请求策略（simple-change-approval / design D5）。
 *
 * - 创建/查看：change_request:create（项目成员）
 * - 审批：change_request:approve（项目经理/组织管理员），请求人不得自批
 * - 编辑：仅 draft 状态下的请求人
 * - 取消：请求人（未审批前），项目经理（项目内请求）
 * - 关闭：项目经理/组织管理员
 */
@inject()
export default class ChangeRequestPolicy {
  constructor(private rbac: RbacService) {}

  /** 可以创建变更请求 */
  async create(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(CHANGE_REQUEST_CREATE, user, organizationId, projectId)
  }

  /** 可以查看变更请求（项目成员即可） */
  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(CHANGE_REQUEST_CREATE, user, organizationId, projectId)
  }

  /** 可以编辑变更请求（仅 draft 状态的请求人） */
  async update(
    user: User,
    _organizationId: number,
    _projectId: number,
    changeRequest: ChangeRequest,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    // 仅请求人可编辑自己的草稿
    if (changeRequest.requesterId !== null && Number(changeRequest.requesterId) === user.id) {
      if (changeRequest.status === 'draft' || changeRequest.status === 'returned') {
        return true
      }
    }
    return false
  }

  /** 可以提交变更请求（仅请求人，草稿或退回状态） */
  async submit(
    user: User,
    _organizationId: number,
    _projectId: number,
    changeRequest: ChangeRequest,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    if (changeRequest.requesterId !== null && Number(changeRequest.requesterId) === user.id) {
      return changeRequest.status === 'draft' || changeRequest.status === 'returned'
    }
    return false
  }

  /** 可以审批变更请求（项目经理/组织管理员，请求人不可自批） */
  async approve(
    user: User,
    organizationId: number,
    projectId: number,
    changeRequest: ChangeRequest,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    // 请求人不得自批
    if (changeRequest.requesterId !== null && Number(changeRequest.requesterId) === user.id) {
      return false
    }
    return this.allows(CHANGE_REQUEST_APPROVE, user, organizationId, projectId)
  }

  /** 可以取消变更请求（请求人未审批前，或项目经理） */
  async cancel(
    user: User,
    organizationId: number,
    projectId: number,
    changeRequest: ChangeRequest,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    // 请求人可取消（未审批）
    if (changeRequest.requesterId !== null && Number(changeRequest.requesterId) === user.id) {
      const cancellable = ['draft', 'submitted', 'returned']
      if (cancellable.includes(changeRequest.status)) return true
    }
    // 项目经理可取消项目内请求
    return this.allows(CHANGE_REQUEST_APPROVE, user, organizationId, projectId)
  }

  /** 可以标记已实施（已批准的变更请求） */
  async markImplemented(
    user: User,
    organizationId: number,
    projectId: number,
    changeRequest: ChangeRequest,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    // 已批准或有条件批准的请求可标记实施
    if (changeRequest.status === 'approved') {
      return this.allows(CHANGE_REQUEST_CREATE, user, organizationId, projectId)
    }
    return false
  }

  /** 可以关闭（项目经理/组织管理员） */
  async close(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(CHANGE_REQUEST_APPROVE, user, organizationId, projectId)
  }

  // ──── 断言方法（抛出 PermissionDeniedException） ────

  async authorizeCreate(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.create(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权创建变更请求')
    }
  }

  async authorizeView(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.view(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权查看变更请求')
    }
  }

  async authorizeUpdate(
    user: User,
    organizationId: number,
    projectId: number,
    changeRequest: ChangeRequest,
  ): Promise<void> {
    if (!(await this.update(user, organizationId, projectId, changeRequest))) {
      throw new PermissionDeniedException('无权编辑变更请求')
    }
  }

  async authorizeSubmit(
    user: User,
    organizationId: number,
    projectId: number,
    changeRequest: ChangeRequest,
  ): Promise<void> {
    if (!(await this.submit(user, organizationId, projectId, changeRequest))) {
      throw new PermissionDeniedException('无权提交变更请求')
    }
  }

  async authorizeApprove(
    user: User,
    organizationId: number,
    projectId: number,
    changeRequest: ChangeRequest,
  ): Promise<void> {
    if (!(await this.approve(user, organizationId, projectId, changeRequest))) {
      throw new PermissionDeniedException('无权审批变更请求')
    }
  }

  async authorizeCancel(
    user: User,
    organizationId: number,
    projectId: number,
    changeRequest: ChangeRequest,
  ): Promise<void> {
    if (!(await this.cancel(user, organizationId, projectId, changeRequest))) {
      throw new PermissionDeniedException('无权取消变更请求')
    }
  }

  async authorizeMarkImplemented(
    user: User,
    organizationId: number,
    projectId: number,
    changeRequest: ChangeRequest,
  ): Promise<void> {
    if (!(await this.markImplemented(user, organizationId, projectId, changeRequest))) {
      throw new PermissionDeniedException('无权标记变更请求为已实施')
    }
  }

  async authorizeClose(user: User, organizationId: number, projectId: number): Promise<void> {
    if (!(await this.close(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权关闭变更请求')
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
