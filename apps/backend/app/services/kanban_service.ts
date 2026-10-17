import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Task from '#models/task'
import AuditService, { AuditEvent } from '#services/audit_service'
import TaskService from '#services/task_service'
import type { TaskPriority, TaskStatus } from '#services/task_status_machine'
import type { AuthContext } from '#types/auth'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { RealtimeEvents } from '#types/realtime_events'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

export const KANBAN_COLUMN_STATUSES = {
  pending: ['not_started'],
  in_progress: ['in_progress'],
  completed: ['completed'],
  other: ['blocked', 'on_hold', 'cancelled'],
} as const satisfies Record<string, readonly TaskStatus[]>

export type KanbanColumn = keyof typeof KANBAN_COLUMN_STATUSES

export interface KanbanFilters {
  column: KanbanColumn
  priority?: TaskPriority
  assigneeId?: number
  search?: string
  page?: number
  perPage?: number
}

export interface MoveKanbanTaskInput {
  taskId: number
  targetColumn: KanbanColumn
  targetStatus?: TaskStatus
  beforeTaskId?: number
  afterTaskId?: number
  note?: string
}

const RANK_STEP = 1024

@inject()
export default class KanbanService {
  constructor(
    private tasks: TaskService,
    private audit: AuditService,
  ) {}

  async listColumn(organizationId: number, projectId: number, filters: KanbanFilters) {
    await this.tasks.assertProjectAccess(organizationId, projectId)
    const page = Math.max(1, filters.page ?? 1)
    const perPage = Math.min(100, Math.max(1, filters.perPage ?? 25))
    let query = Task.query()
      .where('project_id', projectId)
      .whereIn('status', [...KANBAN_COLUMN_STATUSES[filters.column]])
      .preload('assignee')
      .orderByRaw('kanban_rank IS NULL ASC')
      .orderBy('kanban_rank', 'asc')
      .orderBy('id', 'asc')

    if (filters.priority) query = query.where('priority', filters.priority)
    if (filters.assigneeId) query = query.where('assignee_id', filters.assigneeId)
    if (filters.search) {
      const keyword = `%${filters.search.replace(/[%_]/g, '\\$&')}%`
      query = query.where((builder) => {
        builder.whereILike('name', keyword).orWhereILike('description', keyword)
      })
    }

    const paginator = await query.paginate(page, perPage)
    const meta = paginator.getMeta()
    return {
      data: paginator.all(),
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
      },
    }
  }

  async move(
    organizationId: number,
    projectId: number,
    input: MoveKanbanTaskInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Task> {
    const targetStatus = await this.resolveTargetStatus(
      organizationId,
      projectId,
      input.taskId,
      input.targetColumn,
      input.targetStatus,
    )

    await db.transaction(async (trx) => {
      const task = await this.tasks.getForAuthorize(organizationId, projectId, input.taskId, trx)
      const previousStatus = task.status as TaskStatus

      const rank = await this.rankForMove(
        trx,
        projectId,
        task.id,
        targetStatus,
        input.beforeTaskId,
        input.afterTaskId,
      )

      const moved =
        previousStatus === targetStatus
          ? task
          : await this.tasks.changeStatus(
              organizationId,
              projectId,
              task.id,
              { status: targetStatus, note: input.note ?? null },
              actorUserId,
              ctx,
              trx,
            )

      moved.kanbanRank = rank
      moved.useTransaction(trx)
      await moved.save()

      await this.audit.log({
        event: AuditEvent.TASK_UPDATED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'task',
        entityId: task.id,
        requestId: ctx.requestId ?? null,
        metadata: {
          changed: ['kanbanRank'],
          kanbanMove: {
            fromStatus: previousStatus,
            toStatus: targetStatus,
            targetColumn: input.targetColumn,
          },
        },
        client: trx,
        strict: true,
      })
    })

    // 事务内的 changeStatus 不广播；提交后补发，其他成员的看板 / 甘特 / WBS 才会实时刷新
    this.tasks.broadcastTaskEvent(
      organizationId,
      projectId,
      input.taskId,
      actorUserId,
      RealtimeEvents.TASK_STATUS_CHANGED,
    )
    return this.tasks.get(organizationId, projectId, input.taskId)
  }

  /** 本次移动产生的提示（如前置任务未完成），供控制器放入响应 meta.warnings。 */
  warningsFor(taskId: number): string[] {
    return this.tasks.warnings.get(taskId) ?? []
  }

  private async resolveTargetStatus(
    organizationId: number,
    projectId: number,
    taskId: number,
    column: KanbanColumn,
    requested?: TaskStatus,
  ): Promise<TaskStatus> {
    const allowed = KANBAN_COLUMN_STATUSES[column] as readonly TaskStatus[]
    if (column !== 'other') return allowed[0]!
    if (requested && allowed.includes(requested)) return requested

    const task = await this.tasks.getForAuthorize(organizationId, projectId, taskId)
    const current = task.status as TaskStatus
    if (allowed.includes(current)) return current
    throw new ValidationException('移动到“其他”列时必须选择阻塞、暂停或已取消状态')
  }

  private async rankForMove(
    trx: TransactionClientContract,
    projectId: number,
    taskId: number,
    targetStatus: TaskStatus,
    beforeTaskId?: number,
    afterTaskId?: number,
  ): Promise<number> {
    if (
      beforeTaskId === taskId ||
      afterTaskId === taskId ||
      (beforeTaskId !== undefined && afterTaskId !== undefined && beforeTaskId === afterTaskId)
    ) {
      throw new ValidationException('看板排序锚点无效')
    }

    let rows = await this.orderedTargetRows(trx, projectId, taskId, targetStatus)
    this.assertAnchors(rows, beforeTaskId, afterTaskId)
    let rank = this.rankBetween(rows, beforeTaskId, afterTaskId)

    if (rank === null) {
      await this.rebalance(trx, rows)
      rows = await this.orderedTargetRows(trx, projectId, taskId, targetStatus)
      rank = this.rankBetween(rows, beforeTaskId, afterTaskId)
    }
    if (rank === null) throw new ValidationException('无法计算看板排序位置')
    return rank
  }

  private async orderedTargetRows(
    trx: TransactionClientContract,
    projectId: number,
    taskId: number,
    status: TaskStatus,
  ): Promise<Array<{ id: number; rank: number }>> {
    const rows = await trx
      .from('tasks')
      .where('project_id', projectId)
      .where('status', status)
      .whereNull('deleted_at')
      .whereNot('id', taskId)
      .orderByRaw('kanban_rank IS NULL ASC')
      .orderBy('kanban_rank', 'asc')
      .orderBy('id', 'asc')

    return rows.map((row) => ({ id: Number(row.id), rank: Number(row.kanban_rank ?? 0) }))
  }

  private assertAnchors(rows: Array<{ id: number }>, beforeTaskId?: number, afterTaskId?: number) {
    const beforeIndex = beforeTaskId ? rows.findIndex((row) => row.id === beforeTaskId) : -1
    const afterIndex = afterTaskId ? rows.findIndex((row) => row.id === afterTaskId) : -1
    if ((beforeTaskId && beforeIndex < 0) || (afterTaskId && afterIndex < 0)) {
      throw new ResourceNotFoundException('看板排序锚点不存在于目标列')
    }
    if (beforeTaskId && afterTaskId && afterIndex !== beforeIndex + 1) {
      throw new ValidationException('看板排序锚点必须相邻')
    }
    if (beforeTaskId && !afterTaskId && beforeIndex !== rows.length - 1) {
      throw new ValidationException('仅提供前锚点时，该任务必须位于目标列末尾')
    }
    if (!beforeTaskId && afterTaskId && afterIndex !== 0) {
      throw new ValidationException('仅提供后锚点时，该任务必须位于目标列首位')
    }
  }

  private rankBetween(
    rows: Array<{ id: number; rank: number }>,
    beforeTaskId?: number,
    afterTaskId?: number,
  ): number | null {
    if (rows.length === 0) return RANK_STEP
    if (!beforeTaskId && !afterTaskId) return rows.at(-1)!.rank + RANK_STEP

    const before = beforeTaskId ? rows.find((row) => row.id === beforeTaskId) : undefined
    const after = afterTaskId ? rows.find((row) => row.id === afterTaskId) : undefined
    if (before && !after) return before.rank + RANK_STEP
    if (!before && after) {
      const candidate = Math.floor(after.rank / 2)
      return candidate > 0 ? candidate : null
    }

    const gap = after!.rank - before!.rank
    return gap > 1 ? before!.rank + Math.floor(gap / 2) : null
  }

  private async rebalance(
    trx: TransactionClientContract,
    rows: Array<{ id: number; rank: number }>,
  ) {
    for (const [index, row] of rows.entries()) {
      await trx
        .from('tasks')
        .where('id', row.id)
        .update({ kanban_rank: (index + 1) * RANK_STEP })
    }
  }
}
