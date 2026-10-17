import { PermissionDeniedException } from '#exceptions/api_exception'
import type Task from '#models/task'
import type User from '#models/user'
import TaskPolicy from '#policies/task_policy'
import { inject } from '@adonisjs/core'

/** 依赖写权限以 successor 为判定对象，复用任务行级权限。 */
@inject()
export default class TaskDependencyPolicy {
  constructor(private tasks: TaskPolicy) {}

  async authorizeView(user: User, organizationId: number, projectId: number) {
    if (!(await this.tasks.view(user, organizationId, projectId))) {
      throw new PermissionDeniedException('无权查看任务依赖')
    }
  }

  async authorizeWrite(user: User, organizationId: number, projectId: number, successor: Task) {
    await this.tasks.authorizeUpdate(user, organizationId, projectId, successor)
  }
}
