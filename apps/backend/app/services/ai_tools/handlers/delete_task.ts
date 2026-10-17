// AI 同事自然语言操作 —— 写工具 `delete_task`（「删除 #551」「把那个测试任务删掉」）
//
// 两阶段确认（RL-01 / RL-06，与 update_task_status 同一契约）：
// - execute → 读取任务、子任务与依赖，返回删除预览（影响说明）+ SHA-256 previewToken，零写入；
// - confirm → 单事务内重算令牌（预览后任务被改 → 409 SCHEDULE_STALE），再经
//   TaskService.delete 软删除（移入回收站，30 天内可恢复；复用子任务校验、审计、进度重算）。
// 有未删除子任务时预览即拒绝（与界面删除同一规则），不会出现「确认后才失败」。
import { createHash } from 'node:crypto'
import { TASK_DELETE } from '#rbac'
import {
  ConflictException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import TaskService from '#services/task_service'
import { broadcastTasksUpdated } from '#services/realtime/task_change_broadcast'
import { TASK_STATUS_LABELS, type TaskStatus } from '#services/task_status_machine'
import { formatTaskCode } from '@aiproj/types'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { asPositiveInt } from './input_guards.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const DELETE_TASK_TOOL_NAME = 'delete_task'

/** 软删除可恢复窗口（与 TaskService.restore 一致）。 */
export const DELETE_TASK_RESTORE_WINDOW_DAYS = 30

const PREVIEW_TOKEN_PATTERN = /^[0-9a-f]{64}$/

export interface DeleteTaskParams {
  projectId: number
  taskId: number
  previewToken?: string
}

export interface DeleteTaskDiff {
  projectId: number
  taskId: number
  taskCode: string
  taskName: string
  status: string
  statusLabel: string
  /** 依赖它的后续任务数（删除后这些依赖一并失效）。 */
  successorCount: number
  /** 它依赖的前置任务数。 */
  predecessorCount: number
  restoreWindowDays: number
}

export interface DeleteTaskDeps {
  taskService?: TaskService
}

/**
 * 每次提交新建一个 TaskService：它按实例收集「已按依赖自动顺延 / 往前拉 N 个任务」这类联动提示
 * （warnings），复用单例会让提示跨请求累积、也拿不到本次的提示。
 */
function resolveTaskService(): Promise<TaskService> {
  return app.container.make(TaskService)
}

export function deleteTaskPreviewToken(input: {
  taskId: number
  updatedAt: string | null
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        tool: DELETE_TASK_TOOL_NAME,
        taskId: input.taskId,
        updatedAt: input.updatedAt,
      }),
    )
    .digest('hex')
}

interface TaskSnapshot {
  id: number
  name: string
  status: string
  updatedAt: string | null
  projectCode: string | null
}

async function loadTask(
  client: TransactionClientContract | typeof db,
  organizationId: number,
  projectId: number,
  taskId: number,
): Promise<TaskSnapshot> {
  const row = (await client
    .from('tasks')
    .join('projects', 'projects.id', 'tasks.project_id')
    .where('tasks.id', taskId)
    .where('tasks.project_id', projectId)
    .where('projects.organization_id', organizationId)
    .whereNull('tasks.deleted_at')
    .whereNull('projects.deleted_at')
    .select(
      'tasks.id',
      'tasks.name',
      'tasks.status',
      'tasks.updated_at',
      'projects.code as project_code',
    )
    .first()) as Record<string, unknown> | null
  if (!row) throw new ResourceNotFoundException('任务不存在或无权访问')
  const updatedAt = row.updated_at
  return {
    id: Number(row.id),
    name: String(row.name ?? ''),
    status: String(row.status ?? ''),
    updatedAt:
      updatedAt instanceof Date
        ? updatedAt.toISOString()
        : updatedAt === null || updatedAt === undefined
          ? null
          : String(updatedAt),
    projectCode: (row.project_code as string | null) ?? null,
  }
}

async function countOf(
  client: TransactionClientContract | typeof db,
  table: string,
  column: string,
  taskId: number,
): Promise<number> {
  const query = client.from(table).where(column, taskId)
  if (table === 'tasks') query.whereNull('deleted_at')
  const row = (await query.count('* as total').first()) as { total?: unknown } | null
  return Number(row?.total ?? 0)
}

async function buildDiff(
  client: TransactionClientContract | typeof db,
  projectId: number,
  task: TaskSnapshot,
): Promise<DeleteTaskDiff> {
  const subtasks = await countOf(client, 'tasks', 'parent_task_id', task.id)
  if (subtasks > 0) {
    throw new ValidationException(
      `「${task.name}」还有 ${subtasks} 个子任务，请先删除或移走子任务再删它`,
    )
  }
  const [successorCount, predecessorCount] = await Promise.all([
    countOf(client, 'task_dependencies', 'predecessor_id', task.id),
    countOf(client, 'task_dependencies', 'successor_id', task.id),
  ])
  const status = task.status as TaskStatus
  return {
    projectId,
    taskId: task.id,
    taskCode: formatTaskCode({ id: projectId, code: task.projectCode }, task.id),
    taskName: task.name,
    status: task.status,
    statusLabel: TASK_STATUS_LABELS[status] ?? task.status,
    successorCount,
    predecessorCount,
    restoreWindowDays: DELETE_TASK_RESTORE_WINDOW_DAYS,
  }
}

export function createDeleteTaskTool(
  deps?: DeleteTaskDeps,
): ToolDefinition<DeleteTaskParams, DeleteTaskDiff & { committed?: boolean }> {
  return {
    name: DELETE_TASK_TOOL_NAME,
    description:
      '删除任务（移入回收站，30 天内可恢复）。execute 只返回删除预览与 previewToken（零写入），用户确认后携带 previewToken 再提交才真正删除。有子任务时拒绝。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', minimum: 1, description: '目标项目 ID' },
        taskId: { type: 'integer', minimum: 1, description: '目标任务 ID' },
      },
      required: ['projectId', 'taskId'],
      additionalProperties: false,
    },
    requiredPermissions: [TASK_DELETE],
    sideEffect: 'write',
    handler: async (
      ctx: ToolExecutionContext,
      input: DeleteTaskParams,
    ): Promise<ToolExecutionResult<DeleteTaskDiff & { committed?: boolean }>> => {
      const projectId = asPositiveInt(input.projectId, 'projectId')
      const taskId = asPositiveInt(input.taskId, 'taskId')

      const token = typeof input.previewToken === 'string' ? input.previewToken.trim() : ''
      if (token !== '') {
        if (!PREVIEW_TOKEN_PATTERN.test(token)) {
          throw new ValidationException('previewToken 必须是 64 位十六进制哈希')
        }
        const taskService = deps?.taskService ?? (await resolveTaskService())
        const diff = await db.transaction(async (trx) => {
          const task = await loadTask(trx, ctx.organizationId, projectId, taskId)
          if (deleteTaskPreviewToken({ taskId, updatedAt: task.updatedAt }) !== token) {
            throw new ConflictException('任务在预览后已被修改，请重新预览', {
              code: 'SCHEDULE_STALE',
            })
          }
          const planned = await buildDiff(trx, projectId, task)
          await taskService.delete(
            ctx.organizationId,
            projectId,
            taskId,
            Number(ctx.user.id),
            { requestId: ctx.requestId ?? undefined },
            trx,
          )
          return planned
        })
        broadcastTasksUpdated(ctx.organizationId, projectId, [taskId], Number(ctx.user.id))
        return { status: 'SUCCESS', data: { ...diff, committed: true } }
      }

      const task = await loadTask(db, ctx.organizationId, projectId, taskId)
      const diff = await buildDiff(db, projectId, task)
      return {
        status: 'PREVIEW_REQUIRED',
        data: diff,
        previewToken: deleteTaskPreviewToken({ taskId, updatedAt: task.updatedAt }),
        diff,
      }
    },
  }
}
