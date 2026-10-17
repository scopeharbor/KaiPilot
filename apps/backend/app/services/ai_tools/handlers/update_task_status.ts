// AI 同事自然语言操作 —— 写工具 `update_task_status`（勾选完成 / 移到进行中 / 退回待处理等）
//
// 两阶段确认（RL-01 / RL-06，与 `update_task_schedule` 同一契约）：
// - execute（无 previewToken）→ 读取任务当前状态，按状态机求出合法转换路径
//   （如 未开始 → 进行中 → 已完成），返回 PREVIEW_REQUIRED + SHA-256 previewToken
//   与前后差异，**零写入**；
// - confirm（编排层合入 previewToken）→ 单事务内重算令牌（任务在预览后被改动 →
//   409 SCHEDULE_STALE 全量回滚），再按路径逐步调用 TaskService.changeStatus
//   （复用状态副作用、排期联动、项目进度重算与审计），返回 SUCCESS。
import { createHash } from 'node:crypto'
import { TASK_UPDATE } from '#rbac'
import {
  ConflictException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import Task from '#models/task'
import TaskService from '#services/task_service'
import { broadcastTasksUpdated } from '#services/realtime/task_change_broadcast'
import {
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  findStatusPath,
  type TaskStatus,
} from '#services/task_status_machine'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { asPositiveInt, asOptionalString } from './input_guards.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const UPDATE_TASK_STATUS_TOOL_NAME = 'update_task_status'

const PREVIEW_TOKEN_PATTERN = /^[0-9a-f]{64}$/

export interface UpdateTaskStatusParams {
  projectId: number
  taskId: number
  status: TaskStatus
  note?: string
  previewToken?: string
}

export interface UpdateTaskStatusDiff {
  projectId: number
  taskId: number
  taskName: string
  from: TaskStatus
  to: TaskStatus
  fromLabel: string
  toLabel: string
  /** 实际经过的状态（不含起点）；同状态时为空数组。 */
  path: TaskStatus[]
  pathLabels: string[]
  /** 目标与当前相同：确认后无变化。 */
  noop: boolean
}

export interface UpdateTaskStatusResult extends UpdateTaskStatusDiff {
  committed: boolean
  /** 提交后的联动说明（如「已按依赖把 2 个任务的开工日往前拉」）。 */
  linkedChanges?: string[]
}

export interface UpdateTaskStatusDeps {
  taskService?: TaskService
}

/**
 * 每次提交新建一个 TaskService：它按实例收集「已按依赖自动顺延 / 往前拉 N 个任务」这类联动提示
 * （warnings），复用单例会让提示跨请求累积、也拿不到本次的提示。
 */
function resolveTaskService(): Promise<TaskService> {
  return app.container.make(TaskService)
}

/** 预览令牌：任务身份 + 当前状态 + 最后更新时间 + 目标状态（任一变化即失效）。 */
export function taskStatusPreviewToken(input: {
  taskId: number
  status: string
  updatedAt: string | null
  target: TaskStatus
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        tool: UPDATE_TASK_STATUS_TOOL_NAME,
        taskId: input.taskId,
        status: input.status,
        updatedAt: input.updatedAt,
        target: input.target,
      }),
    )
    .digest('hex')
}

interface TaskSnapshot {
  id: number
  name: string
  status: string
  updatedAt?: { toISO?: () => string | null } | null
}

function updatedAtOf(task: TaskSnapshot): string | null {
  return task.updatedAt?.toISO?.() ?? null
}

function buildDiff(
  projectId: number,
  task: TaskSnapshot,
  target: TaskStatus,
): UpdateTaskStatusDiff {
  const from = task.status as TaskStatus
  if (!(TASK_STATUSES as readonly string[]).includes(from)) {
    throw new ValidationException('任务当前状态无法识别')
  }
  const path = findStatusPath(from, target)
  if (path === null) {
    throw new ValidationException(
      `任务「${task.name}」不能从「${TASK_STATUS_LABELS[from]}」改为「${TASK_STATUS_LABELS[target]}」`,
    )
  }
  return {
    projectId,
    taskId: task.id,
    taskName: task.name,
    from,
    to: target,
    fromLabel: TASK_STATUS_LABELS[from],
    toLabel: TASK_STATUS_LABELS[target],
    path,
    pathLabels: path.map((status) => TASK_STATUS_LABELS[status]),
    noop: path.length === 0,
  }
}

export function createUpdateTaskStatusTool(
  deps?: UpdateTaskStatusDeps,
): ToolDefinition<UpdateTaskStatusParams, UpdateTaskStatusResult | UpdateTaskStatusDiff> {
  return {
    name: UPDATE_TASK_STATUS_TOOL_NAME,
    description:
      '修改项目中单个任务的状态（如勾选完成、移到进行中、标记受阻、退回未开始）。状态机不允许直达时自动走合法中间状态。阶段一仅返回前后差异与 previewToken，绝不落库；必须经用户确认后由确认端点携带 previewToken 提交才生效。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', minimum: 1, description: '目标项目 ID' },
        taskId: { type: 'integer', minimum: 1, description: '目标任务 ID' },
        status: {
          type: 'string',
          enum: [...TASK_STATUSES],
          description: '目标状态',
        },
        note: { type: 'string', maxLength: 200, description: '可选备注（写入审计）' },
      },
      required: ['projectId', 'taskId', 'status'],
      additionalProperties: false,
    },
    requiredPermissions: [TASK_UPDATE],
    sideEffect: 'write',
    handler: async (
      ctx: ToolExecutionContext,
      input: UpdateTaskStatusParams,
    ): Promise<ToolExecutionResult<UpdateTaskStatusResult | UpdateTaskStatusDiff>> => {
      const projectId = asPositiveInt(input.projectId, 'projectId')
      const taskId = asPositiveInt(input.taskId, 'taskId')
      const target = String(input.status ?? '') as TaskStatus
      if (!(TASK_STATUSES as readonly string[]).includes(target)) {
        throw new ValidationException(`status 必须是 ${TASK_STATUSES.join(' / ')} 之一`)
      }
      const note = asOptionalString(input.note, 'note')
      const taskService = deps?.taskService ?? (await resolveTaskService())

      const token = typeof input.previewToken === 'string' ? input.previewToken.trim() : ''
      if (token !== '') {
        if (!PREVIEW_TOKEN_PATTERN.test(token)) {
          throw new ValidationException('previewToken 必须是 64 位十六进制哈希')
        }
        const diff = await db.transaction(async (trx) => {
          const task = (await Task.query({ client: trx })
            .where('id', taskId)
            .where('project_id', projectId)
            // tasks 表无 organization_id：经项目表收口组织隔离
            .whereIn(
              'project_id',
              trx.from('projects').select('id').where('organization_id', ctx.organizationId),
            )
            .whereNull('deleted_at')
            .first()) as unknown as TaskSnapshot | null
          if (!task) throw new ResourceNotFoundException('任务不存在或无权访问')
          const current = taskStatusPreviewToken({
            taskId,
            status: task.status,
            updatedAt: updatedAtOf(task),
            target,
          })
          if (current !== token) {
            throw new ConflictException('任务在预览后已被修改，请重新预览', {
              code: 'SCHEDULE_STALE',
            })
          }
          const planned = buildDiff(projectId, task, target)
          for (const step of planned.path) {
            await taskService.changeStatus(
              ctx.organizationId,
              projectId,
              taskId,
              { status: step, ...(note ? { note } : {}) },
              Number(ctx.user.id),
              { requestId: ctx.requestId ?? undefined },
              trx,
            )
          }
          return planned
        })
        broadcastTasksUpdated(ctx.organizationId, projectId, [taskId], Number(ctx.user.id))
        // 状态变化带来的联动（按依赖顺延 / 提前完成往前拉后续任务）告诉用户
        const linkedChanges = [...(taskService.warnings.get(taskId) ?? [])]
        taskService.warnings.delete(taskId)
        return { status: 'SUCCESS', data: { ...diff, committed: true, linkedChanges } }
      }

      const task = (await taskService.get(
        ctx.organizationId,
        projectId,
        taskId,
      )) as unknown as TaskSnapshot
      const diff = buildDiff(projectId, task, target)
      return {
        status: 'PREVIEW_REQUIRED',
        data: diff,
        previewToken: taskStatusPreviewToken({
          taskId,
          status: task.status,
          updatedAt: updatedAtOf(task),
          target,
        }),
        diff,
      }
    },
  }
}
