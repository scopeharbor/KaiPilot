import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Project from '#models/project'
import Task from '#models/task'
import TaskDependency from '#models/task_dependency'
import AuditService, { AuditEvent } from '#services/audit_service'
import type { AuthContext } from '#types/auth'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

export type DependencyType = 'fs' | 'ss' | 'ff' | 'sf'

export interface CreateDependencyInput {
  predecessorId: number
  type?: string
  lagDays?: number
}

const DEPENDENCY_TYPES = new Set<DependencyType>(['fs', 'ss', 'ff', 'sf'])

export interface DependencyEdgeLike<TId = number> {
  predecessorId: TId
  successorId: TId
}

export function detectDependencyCycle<TId>(
  dependencies: Array<DependencyEdgeLike<TId>>,
  candidate?: DependencyEdgeLike<TId>,
): boolean {
  const graph = new Map<TId, TId[]>()
  for (const dependency of candidate ? [...dependencies, candidate] : dependencies) {
    graph.set(dependency.predecessorId, [
      ...(graph.get(dependency.predecessorId) ?? []),
      dependency.successorId,
    ])
  }

  const visiting = new Set<TId>()
  const visited = new Set<TId>()
  const visit = (nodeId: TId): boolean => {
    if (visiting.has(nodeId)) return true
    if (visited.has(nodeId)) return false
    visiting.add(nodeId)
    for (const nextId of graph.get(nodeId) ?? []) {
      if (visit(nextId)) return true
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
    return false
  }

  return [...graph.keys()].some((nodeId) => visit(nodeId))
}

@inject()
export default class TaskDependencyService {
  constructor(private audit: AuditService) {}

  async listByTask(organizationId: number, projectId: number, taskId: number) {
    await this.taskOrFail(organizationId, projectId, taskId)

    const [predecessors, successors] = await Promise.all([
      TaskDependency.query()
        .where('successor_id', taskId)
        .whereHas('predecessor', (task) =>
          task.where('project_id', projectId).whereNull('deleted_at'),
        )
        .whereHas('successor', (task) =>
          task.where('project_id', projectId).whereNull('deleted_at'),
        )
        .preload('predecessor')
        .preload('successor')
        .orderBy('created_at', 'asc'),
      TaskDependency.query()
        .where('predecessor_id', taskId)
        .whereHas('predecessor', (task) =>
          task.where('project_id', projectId).whereNull('deleted_at'),
        )
        .whereHas('successor', (task) =>
          task.where('project_id', projectId).whereNull('deleted_at'),
        )
        .preload('predecessor')
        .preload('successor')
        .orderBy('created_at', 'asc'),
    ])

    return { predecessors, successors }
  }

  /**
   * 列出整个项目的全部依赖（甘特渲染一次性拉取）。组织隔离由 `projectOrFail` 保证；
   * 只返回两端任务都属于本项目且未软删的依赖。
   */
  async listByProject(organizationId: number, projectId: number) {
    await this.projectOrFail(organizationId, projectId)

    return TaskDependency.query()
      .whereHas('predecessor', (task) =>
        task.where('project_id', projectId).whereNull('deleted_at'),
      )
      .whereHas('successor', (task) => task.where('project_id', projectId).whereNull('deleted_at'))
      .preload('predecessor')
      .preload('successor')
      .orderBy('created_at', 'asc')
  }

  async taskForAuthorize(organizationId: number, projectId: number, taskId: number) {
    return this.taskOrFail(organizationId, projectId, taskId)
  }

  async dependencyForAuthorize(organizationId: number, dependencyId: number) {
    const dependency = await TaskDependency.query()
      .where('id', dependencyId)
      .preload('predecessor')
      .preload('successor', (task) => task.preload('project'))
      .first()
    if (
      !dependency ||
      !dependency.predecessor ||
      !dependency.successor ||
      !dependency.successor.project ||
      dependency.predecessor.deletedAt ||
      dependency.successor.deletedAt ||
      dependency.predecessor.projectId !== dependency.successor.projectId ||
      Number(dependency.successor.project.organizationId) !== organizationId
    ) {
      throw new ResourceNotFoundException('任务依赖不存在')
    }
    return dependency
  }

  async createDependency(
    organizationId: number,
    projectId: number,
    successorId: number,
    input: CreateDependencyInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ) {
    const type = (input.type ?? 'fs') as DependencyType
    const lagDays = input.lagDays ?? 0
    if (!DEPENDENCY_TYPES.has(type)) throw new ValidationException('无效的依赖类型')
    if (!Number.isInteger(lagDays)) throw new ValidationException('lag_days 必须是整数')
    if (input.predecessorId === successorId) {
      throw new ValidationException('任务不能依赖自身')
    }

    return db.transaction(async (trx) => {
      await this.projectOrFail(organizationId, projectId, trx)
      const [predecessor, successor] = await Promise.all([
        Task.query({ client: trx })
          .where('id', input.predecessorId)
          .whereNull('deleted_at')
          .first(),
        this.taskOrFail(organizationId, projectId, successorId, trx, true),
      ])
      if (!predecessor || Number(predecessor.projectId) !== projectId) {
        throw new ValidationException('前置任务必须属于当前项目')
      }

      const duplicate = await TaskDependency.query({ client: trx })
        .where('predecessor_id', predecessor.id)
        .where('successor_id', successor.id)
        .first()
      if (duplicate) throw new ValidationException('该任务依赖已存在')

      if (await this.detectCycle(projectId, predecessor.id, successor.id, trx)) {
        throw new ValidationException('将形成循环依赖')
      }

      let dependency: TaskDependency
      try {
        dependency = await TaskDependency.create(
          {
            predecessorId: predecessor.id,
            successorId: successor.id,
            type,
            lagDays,
          },
          { client: trx },
        )
      } catch (error) {
        if (String(error).includes('UNIQUE constraint failed')) {
          throw new ValidationException('该任务依赖已存在')
        }
        throw error
      }

      await this.audit.log({
        event: AuditEvent.DEPENDENCY_CREATED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'task_dependency',
        entityId: dependency.id,
        requestId: ctx.requestId ?? null,
        metadata: {
          predecessorId: predecessor.id,
          successorId: successor.id,
          type,
          lagDays,
        },
        client: trx,
        strict: true,
      })

      await dependency.load('predecessor')
      await dependency.load('successor')
      return dependency
    })
  }

  async detectCycle(
    projectId: number,
    predecessorId: number,
    successorId: number,
    client?: TransactionClientContract,
  ): Promise<boolean> {
    const query = (client ?? db)
      .from('task_dependencies as dependency')
      .join('tasks as predecessor', 'predecessor.id', 'dependency.predecessor_id')
      .join('tasks as successor', 'successor.id', 'dependency.successor_id')
      .where('predecessor.project_id', projectId)
      .where('successor.project_id', projectId)
      .whereNull('predecessor.deleted_at')
      .whereNull('successor.deleted_at')
      .select('dependency.predecessor_id', 'dependency.successor_id')
    const rows = await query
    const edges = rows.map((row) => ({
      predecessorId: Number(row.predecessor_id),
      successorId: Number(row.successor_id),
    }))
    return detectDependencyCycle(edges, { predecessorId, successorId })
  }

  async deleteDependency(
    organizationId: number,
    dependencyId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ) {
    return db.transaction(async (trx) => {
      const dependency = await TaskDependency.query({ client: trx })
        .where('id', dependencyId)
        .preload('predecessor')
        .preload('successor', (task) => task.preload('project'))
        .first()
      if (
        !dependency ||
        !dependency.predecessor ||
        !dependency.successor ||
        !dependency.successor.project ||
        Number(dependency.successor.project.organizationId) !== organizationId
      ) {
        throw new ResourceNotFoundException('任务依赖不存在')
      }
      const projectId = Number(dependency.successor.projectId)
      const metadata = {
        predecessorId: Number(dependency.predecessorId),
        successorId: Number(dependency.successorId),
        type: dependency.type,
      }
      await dependency.delete()
      await this.audit.log({
        event: AuditEvent.DEPENDENCY_DELETED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'task_dependency',
        entityId: dependency.id,
        requestId: ctx.requestId ?? null,
        metadata,
        client: trx,
        strict: true,
      })
    })
  }

  private async projectOrFail(
    organizationId: number,
    projectId: number,
    client?: TransactionClientContract,
  ) {
    const project = await Project.query({ client })
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }

  private async taskOrFail(
    organizationId: number,
    projectId: number,
    taskId: number,
    client?: TransactionClientContract,
    projectAlreadyChecked = false,
  ) {
    if (!projectAlreadyChecked) await this.projectOrFail(organizationId, projectId, client)
    const task = await Task.query({ client })
      .where('id', taskId)
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .first()
    if (!task) throw new ResourceNotFoundException('任务不存在')
    return task
  }
}
