import type TaskDependency from '#models/task_dependency'
import type Task from '#models/task'
import type User from '#models/user'
import TaskDependencyPolicy from '#policies/task_dependency_policy'
import TaskDependencyService from '#services/task_dependency_service'
import { createTaskDependencyValidator } from '#validators/task_dependency'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

function taskSummary(task: Task) {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    startDate: task.startDate?.toISODate() ?? null,
    endDate: task.endDate?.toISODate() ?? null,
  }
}

function dependencyDto(dependency: TaskDependency) {
  return {
    id: dependency.id,
    predecessorId: Number(dependency.predecessorId),
    successorId: Number(dependency.successorId),
    type: dependency.type,
    lagDays: dependency.lagDays,
    predecessor: taskSummary(dependency.predecessor),
    successor: taskSummary(dependency.successor),
    createdAt: dependency.createdAt.toISO(),
    updatedAt: dependency.updatedAt?.toISO() ?? null,
  }
}

@inject()
export default class TaskDependenciesController {
  constructor(
    private dependencies: TaskDependencyService,
    private policy: TaskDependencyPolicy,
  ) {}

  private user(ctx: HttpContext) {
    return ctx.auth.getUserOrFail() as User
  }

  async index(ctx: HttpContext) {
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(this.user(ctx), organizationId, projectId)
    const groups = await this.dependencies.listByTask(
      organizationId,
      projectId,
      Number(ctx.params.taskId),
    )
    return ctx.response.ok({
      data: {
        predecessors: groups.predecessors.map(dependencyDto),
        successors: groups.successors.map(dependencyDto),
      },
    })
  }

  /** 项目级：一次性返回整个项目的依赖（甘特渲染用），组织隔离沿用。 */
  async projectIndex(ctx: HttpContext) {
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(this.user(ctx), organizationId, projectId)
    const dependencies = await this.dependencies.listByProject(organizationId, projectId)
    return ctx.response.ok({ data: dependencies.map(dependencyDto) })
  }

  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createTaskDependencyValidator)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const successorId = Number(ctx.params.taskId)
    const user = this.user(ctx)
    const successor = await this.dependencies.taskForAuthorize(
      organizationId,
      projectId,
      successorId,
    )
    await this.policy.authorizeWrite(user, organizationId, projectId, successor)
    const dependency = await this.dependencies.createDependency(
      organizationId,
      projectId,
      successorId,
      input,
      user.id,
      { requestId: ctx.request.id() ?? null },
    )
    return ctx.response.created({ data: dependencyDto(dependency) })
  }

  async destroy(ctx: HttpContext) {
    const organizationId = ctx.tenant!.organizationId
    const user = this.user(ctx)
    const dependency = await this.dependencies.dependencyForAuthorize(
      organizationId,
      Number(ctx.params.id),
    )
    const projectId = Number(dependency.successor.projectId)
    await this.policy.authorizeWrite(user, organizationId, projectId, dependency.successor)
    await this.dependencies.deleteDependency(organizationId, dependency.id, user.id, {
      requestId: ctx.request.id() ?? null,
    })
    return ctx.response.noContent()
  }
}
