import { PermissionDeniedException } from '#exceptions/api_exception'
import type Task from '#models/task'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import {
  TASK_ASSIGN,
  TASK_CREATE,
  TASK_DELETE,
  TASK_UPDATE,
  TASK_UPDATE_SELF,
  TASK_VIEW,
  type Permission,
} from '#rbac'
import { inject } from '@adonisjs/core'

/**
 * 任务策略：薄封装 RBAC，附加 task:update:self 行级归属判定（design D3）。
 *
 * - 粗粒度（view/create/delete/assign）单权限判定；
 * - 编辑/状态走 canUpdate：task:update 任意改，否则 task:update:self 仅限 assignee_id=本人；
 * - assign 独立守护 assignee_id/reviewer_id 的「变更」（update 路径），create 初始值不要求。
 */
@inject()
export default class TaskPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(TASK_VIEW, user, organizationId, projectId)
  }

  async create(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(TASK_CREATE, user, organizationId, projectId)
  }

  async delete(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(TASK_DELETE, user, organizationId, projectId)
  }

  async assign(user: User, organizationId: number, projectId: number): Promise<boolean> {
    return this.allows(TASK_ASSIGN, user, organizationId, projectId)
  }

  /**
   * 编辑/状态变更的行级判定（spec task-status-workflow「状态变更权限」+ task-management「任务编辑」）：
   *   - task:update → 任意任务；
   *   - task:update:self → 仅 assignee_id === 本人；
   *   - 两者皆无 → 403。
   */
  async canUpdate(
    user: User,
    organizationId: number,
    projectId: number,
    task: Task,
  ): Promise<boolean> {
    if (user.isSuperAdmin) return true
    const full = await this.rbac.check(user, TASK_UPDATE, organizationId, projectId)
    if (full.allowed) return true
    const self = await this.rbac.check(user, TASK_UPDATE_SELF, organizationId, projectId)
    if (self.allowed) {
      return task.assigneeId !== null && Number(task.assigneeId) === user.id
    }
    return false
  }

  /** 断言可编辑，否则抛 PERMISSION_DENIED。 */
  async authorizeUpdate(
    user: User,
    organizationId: number,
    projectId: number,
    task: Task,
  ): Promise<void> {
    const ok = await this.canUpdate(user, organizationId, projectId, task)
    if (!ok) {
      throw new PermissionDeniedException('无权编辑该任务')
    }
  }

  /**
   * 断言可调整排期（开始 / 截止 / 工期）：仅 task:update（项目经理等）。
   * 只有 task:update:self 的成员可以推进自己任务的状态与进度，但改期要由项目经理处理或走变更申请。
   */
  async authorizeScheduleChange(
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<void> {
    if (user.isSuperAdmin) return
    const full = await this.rbac.check(user, TASK_UPDATE, organizationId, projectId)
    if (!full.allowed) {
      throw new PermissionDeniedException(
        '调整任务排期需要项目经理权限，请联系项目经理或提交变更申请',
      )
    }
  }

  /** 断言可改派（assignee/reviewer 变更），否则抛 PERMISSION_DENIED。 */
  async authorizeAssign(user: User, organizationId: number, projectId: number): Promise<void> {
    const ok = await this.assign(user, organizationId, projectId)
    if (!ok) {
      throw new PermissionDeniedException('无权指派任务负责人')
    }
  }

  /** 批量接口：对同一请求内的逐项权限判定开启短时记忆（避免每个任务重复 8~10 次查询）。 */
  enableRequestMemo(): this {
    this.rbac.enableRequestMemo()
    return this
  }

  async authorizeDelete(user: User, organizationId: number, projectId: number): Promise<void> {
    const ok = await this.delete(user, organizationId, projectId)
    if (!ok) {
      throw new PermissionDeniedException('没有删除或恢复任务的权限')
    }
  }

  private async allows(
    permission: Permission,
    user: User,
    organizationId: number,
    projectId: number,
  ): Promise<boolean> {
    const result = await this.rbac.check(user, permission, organizationId, projectId)
    return result.allowed
  }
}
