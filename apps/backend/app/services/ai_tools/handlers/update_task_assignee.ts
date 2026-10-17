// AI 同事自然语言操作 —— 写工具 `update_task_assignee`（「把 A 任务指派给小王」「交给我」「取消指派」）
//
// 两阶段确认（RL-01 / RL-06，与 update_task_status 同一契约）：
// - execute → 读取任务与目标成员（必须是该项目在职成员），返回前后负责人差异 +
//   SHA-256 previewToken，零写入；
// - confirm → 单事务内重算令牌（预览后任务被改 → 409 SCHEDULE_STALE），再经
//   TaskService.update 落库（复用成员校验、指派通知、审计）。
//
// 隐私：模型只见〔成员·编码〕代号；本工具的结果只给界面（含真实姓名），不回传模型。
import { createHash } from 'node:crypto'
import { TASK_UPDATE } from '#rbac'
import {
  ConflictException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import TaskService from '#services/task_service'
import { broadcastTasksUpdated } from '#services/realtime/task_change_broadcast'
import { formatTaskCode } from '@aiproj/types'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { asPositiveInt } from './input_guards.js'
import { memberAlias } from '#services/ai_colleague/member_alias'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const UPDATE_TASK_ASSIGNEE_TOOL_NAME = 'update_task_assignee'

const PREVIEW_TOKEN_PATTERN = /^[0-9a-f]{64}$/

export interface UpdateTaskAssigneeParams {
  projectId: number
  taskId: number
  /** 目标负责人（用户 ID）；null = 取消指派。 */
  assigneeId: number | null
  previewToken?: string
}

export interface AssigneeRef {
  id: number
  name: string
  alias: string
}

export interface UpdateTaskAssigneeDiff {
  projectId: number
  taskId: number
  taskCode: string
  taskName: string
  from: AssigneeRef | null
  to: AssigneeRef | null
  noop: boolean
}

export interface UpdateTaskAssigneeDeps {
  taskService?: TaskService
}

/**
 * 每次提交新建一个 TaskService：它按实例收集「已按依赖自动顺延 / 往前拉 N 个任务」这类联动提示
 * （warnings），复用单例会让提示跨请求累积、也拿不到本次的提示。
 */
function resolveTaskService(): Promise<TaskService> {
  return app.container.make(TaskService)
}

export function taskAssigneePreviewToken(input: {
  taskId: number
  assigneeId: number | null
  updatedAt: string | null
  target: number | null
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        tool: UPDATE_TASK_ASSIGNEE_TOOL_NAME,
        taskId: input.taskId,
        assigneeId: input.assigneeId,
        updatedAt: input.updatedAt,
        target: input.target,
      }),
    )
    .digest('hex')
}

interface TaskSnapshot {
  id: number
  name: string
  assigneeId: number | null
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
      'tasks.assignee_id',
      'tasks.updated_at',
      'projects.code as project_code',
    )
    .first()) as Record<string, unknown> | null
  if (!row) throw new ResourceNotFoundException('任务不存在或无权访问')
  const updatedAt = row.updated_at
  return {
    id: Number(row.id),
    name: String(row.name ?? ''),
    assigneeId:
      row.assignee_id === null || row.assignee_id === undefined ? null : Number(row.assignee_id),
    updatedAt:
      updatedAt instanceof Date
        ? updatedAt.toISOString()
        : updatedAt === null || updatedAt === undefined
          ? null
          : String(updatedAt),
    projectCode: (row.project_code as string | null) ?? null,
  }
}

/** 取成员姓名；`requireActiveMemberOf` 给出时还要求是该项目在职成员。 */
export async function loadMember(
  client: TransactionClientContract | typeof db,
  organizationId: number,
  userId: number,
  requireActiveMemberOf?: number,
): Promise<AssigneeRef | null> {
  const query = client
    .from('users')
    .where('users.id', userId)
    .select('users.id', 'users.full_name', 'users.email')
  if (requireActiveMemberOf !== undefined) {
    query
      .join('project_members', 'project_members.user_id', 'users.id')
      .where('project_members.project_id', requireActiveMemberOf)
      .where('project_members.is_active', true)
  }
  const row = (await query.first()) as Record<string, unknown> | null
  if (!row) return null
  const name =
    (typeof row.full_name === 'string' && row.full_name.trim()) ||
    (typeof row.email === 'string' ? row.email : `成员 ${userId}`)
  return { id: Number(row.id), name, alias: memberAlias(organizationId, Number(row.id)) }
}

async function buildDiff(
  client: TransactionClientContract | typeof db,
  organizationId: number,
  projectId: number,
  task: TaskSnapshot,
  target: number | null,
): Promise<UpdateTaskAssigneeDiff> {
  const to = target === null ? null : await loadMember(client, organizationId, target, projectId)
  if (target !== null && !to) {
    throw new ValidationException('要指派的人不是这个项目的在职成员')
  }
  const from =
    task.assigneeId === null ? null : await loadMember(client, organizationId, task.assigneeId)
  return {
    projectId,
    taskId: task.id,
    taskCode: formatTaskCode({ id: projectId, code: task.projectCode }, task.id),
    taskName: task.name,
    from,
    to,
    noop: (task.assigneeId ?? null) === target,
  }
}

export function createUpdateTaskAssigneeTool(
  deps?: UpdateTaskAssigneeDeps,
): ToolDefinition<UpdateTaskAssigneeParams, UpdateTaskAssigneeDiff & { committed?: boolean }> {
  return {
    name: UPDATE_TASK_ASSIGNEE_TOOL_NAME,
    description:
      '修改项目中单个任务的负责人（指派给某位项目成员，或取消指派）。目标成员必须是该项目的在职成员。阶段一仅返回前后差异与 previewToken，绝不落库；必须经用户确认后由确认端点携带 previewToken 提交才生效。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', minimum: 1, description: '目标项目 ID' },
        taskId: { type: 'integer', minimum: 1, description: '目标任务 ID' },
        assigneeId: {
          type: ['integer', 'null'],
          minimum: 1,
          description: '目标负责人用户 ID；null 表示取消指派',
        },
      },
      required: ['projectId', 'taskId', 'assigneeId'],
      additionalProperties: false,
    },
    requiredPermissions: [TASK_UPDATE],
    sideEffect: 'write',
    handler: async (
      ctx: ToolExecutionContext,
      input: UpdateTaskAssigneeParams,
    ): Promise<ToolExecutionResult<UpdateTaskAssigneeDiff & { committed?: boolean }>> => {
      const projectId = asPositiveInt(input.projectId, 'projectId')
      const taskId = asPositiveInt(input.taskId, 'taskId')
      const target =
        input.assigneeId === null || input.assigneeId === undefined
          ? null
          : asPositiveInt(input.assigneeId, 'assigneeId')
      const taskService = deps?.taskService ?? (await resolveTaskService())

      const token = typeof input.previewToken === 'string' ? input.previewToken.trim() : ''
      if (token !== '') {
        if (!PREVIEW_TOKEN_PATTERN.test(token)) {
          throw new ValidationException('previewToken 必须是 64 位十六进制哈希')
        }
        const diff = await db.transaction(async (trx) => {
          const task = await loadTask(trx, ctx.organizationId, projectId, taskId)
          const current = taskAssigneePreviewToken({
            taskId,
            assigneeId: task.assigneeId,
            updatedAt: task.updatedAt,
            target,
          })
          if (current !== token) {
            throw new ConflictException('任务在预览后已被修改，请重新预览', {
              code: 'SCHEDULE_STALE',
            })
          }
          const planned = await buildDiff(trx, ctx.organizationId, projectId, task, target)
          if (!planned.noop) {
            await taskService.update(
              ctx.organizationId,
              projectId,
              taskId,
              { assigneeId: target },
              Number(ctx.user.id),
              { requestId: ctx.requestId ?? undefined },
              trx,
            )
          }
          return planned
        })
        if (!diff.noop) {
          broadcastTasksUpdated(ctx.organizationId, projectId, [taskId], Number(ctx.user.id))
        }
        return { status: 'SUCCESS', data: { ...diff, committed: true } }
      }

      const task = await loadTask(db, ctx.organizationId, projectId, taskId)
      const diff = await buildDiff(db, ctx.organizationId, projectId, task, target)
      return {
        status: 'PREVIEW_REQUIRED',
        data: diff,
        previewToken: taskAssigneePreviewToken({
          taskId,
          assigneeId: task.assigneeId,
          updatedAt: task.updatedAt,
          target,
        }),
        diff,
      }
    },
  }
}
