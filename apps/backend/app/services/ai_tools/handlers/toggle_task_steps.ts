// AI 同事自然语言操作 —— 写工具 `toggle_task_steps`（「把第 2、3 步打勾」「取消最后一步」「全部勾上」）
//
// 任务的执行步骤存在 customFields.execution.steps / stepsDone（说明里的 `- [ ]` 同步）。
// 与界面打勾同一规则（task_status_sync.toggleTaskSteps）：进度按勾选比例；第一次打勾转进行中、
// 全部勾上转已完成、已完成的取消任一步退回进行中——状态变化经 TaskService.changeStatus，
// 与看板 / 详情改状态同一条路径（按依赖顺延 / 往前拉后续任务、通知、审计）。
//
// 两阶段确认（RL-01）：execute 只返回勾选前后对比与 previewToken（零写入）；confirm 单事务内
// 重算令牌（预览后被改 → 409），再写入步骤与状态。
import { createHash } from 'node:crypto'
import { TASK_UPDATE } from '#rbac'
import {
  ConflictException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import TaskService from '#services/task_service'
import { broadcastTasksUpdated } from '#services/realtime/task_change_broadcast'
import { TASK_STATUS_LABELS, findStatusPath, type TaskStatus } from '#services/task_status_machine'
import { readTaskSteps, toggleTaskSteps, type StepToggleResult } from '#services/task_status_sync'
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

export const TOGGLE_TASK_STEPS_TOOL_NAME = 'toggle_task_steps'

const PREVIEW_TOKEN_PATTERN = /^[0-9a-f]{64}$/

export interface ToggleTaskStepsParams {
  projectId: number
  taskId: number
  /** 要改的步骤（从 1 起）；不给且 all=true 时作用于全部步骤。 */
  steps?: number[]
  all?: boolean
  /** true = 打勾，false = 取消打勾。 */
  done: boolean
  previewToken?: string
}

export interface ToggleTaskStepsDiff {
  projectId: number
  taskId: number
  taskCode: string
  taskName: string
  /** 有变化的步骤：序号（从 1 起）、内容、前后勾选。 */
  changes: Array<{ n: number; text: string; from: boolean; to: boolean }>
  doneCount: number
  totalCount: number
  progressBefore: number
  progressAfter: number
  statusFrom: string
  statusFromLabel: string
  statusTo: string | null
  statusToLabel: string | null
}

export interface ToggleTaskStepsDeps {
  taskService?: TaskService
}

/** 每次提交新建：TaskService 按实例收集联动提示。 */
function resolveTaskService(): Promise<TaskService> {
  return app.container.make(TaskService)
}

interface TaskSnapshot {
  id: number
  name: string
  status: TaskStatus
  description: string | null
  customFields: Record<string, unknown> | null
  progressPercent: number
  updatedAt: string | null
  projectCode: string | null
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return value as Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
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
      'tasks.description',
      'tasks.custom_fields',
      'tasks.progress_percent',
      'tasks.updated_at',
      'projects.code as project_code',
    )
    .first()) as Record<string, unknown> | null
  if (!row) throw new ResourceNotFoundException('任务不存在或无权访问')
  const updatedAt = row.updated_at
  return {
    id: Number(row.id),
    name: String(row.name ?? ''),
    status: String(row.status ?? 'not_started') as TaskStatus,
    description: (row.description as string | null) ?? null,
    customFields: parseJson(row.custom_fields),
    progressPercent: Number(row.progress_percent ?? 0),
    updatedAt:
      updatedAt instanceof Date
        ? updatedAt.toISOString()
        : updatedAt === null || updatedAt === undefined
          ? null
          : String(updatedAt),
    projectCode: (row.project_code as string | null) ?? null,
  }
}

export function toggleStepsPreviewToken(input: {
  taskId: number
  updatedAt: string | null
  after: readonly boolean[]
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        tool: TOGGLE_TASK_STEPS_TOOL_NAME,
        taskId: input.taskId,
        updatedAt: input.updatedAt,
        after: input.after,
      }),
    )
    .digest('hex')
}

/** 入参 → 要改的步骤下标（从 0 起）。 */
function requestedChanges(
  input: ToggleTaskStepsParams,
  total: number,
): Array<{ index: number; done: boolean }> {
  if (typeof input.done !== 'boolean') throw new ValidationException('done 必须是 true 或 false')
  if (input.all === true) {
    return Array.from({ length: total }, (_, index) => ({ index, done: input.done }))
  }
  const numbers = Array.isArray(input.steps) ? input.steps : []
  const indexes = [...new Set(numbers.map(Number))].filter(
    (n) => Number.isInteger(n) && n >= 1 && n <= total,
  )
  if (indexes.length === 0) {
    throw new ValidationException(
      total === 0 ? '这个任务没有执行步骤可以勾选' : `步骤序号要在 1–${total} 之间`,
    )
  }
  return indexes.map((n) => ({ index: n - 1, done: input.done }))
}

function plan(task: TaskSnapshot, input: ToggleTaskStepsParams): StepToggleResult {
  const total = readTaskSteps(task).steps.length
  const result = toggleTaskSteps(task, requestedChanges(input, total))
  if (!result) throw new ValidationException('这些步骤已经是这个勾选状态，不需要改')
  return result
}

function buildDiff(
  projectId: number,
  task: TaskSnapshot,
  result: StepToggleResult,
): ToggleTaskStepsDiff {
  const changes = result.steps
    .map((text, index) => ({
      n: index + 1,
      text,
      from: result.before[index]!,
      to: result.after[index]!,
    }))
    .filter((change) => change.from !== change.to)
  return {
    projectId,
    taskId: task.id,
    taskCode: formatTaskCode({ id: projectId, code: task.projectCode }, task.id),
    taskName: task.name,
    changes,
    doneCount: result.after.filter(Boolean).length,
    totalCount: result.steps.length,
    progressBefore: task.progressPercent,
    progressAfter: result.progressPercent ?? task.progressPercent,
    statusFrom: task.status,
    statusFromLabel: TASK_STATUS_LABELS[task.status] ?? task.status,
    statusTo: result.targetStatus,
    statusToLabel: result.targetStatus ? TASK_STATUS_LABELS[result.targetStatus] : null,
  }
}

export function createToggleTaskStepsTool(
  deps?: ToggleTaskStepsDeps,
): ToolDefinition<
  ToggleTaskStepsParams,
  ToggleTaskStepsDiff & { committed?: boolean; linkedChanges?: string[] }
> {
  return {
    name: TOGGLE_TASK_STEPS_TOOL_NAME,
    description:
      '勾选 / 取消任务的执行步骤（与界面打勾同一规则：进度按比例，第一次打勾转进行中，全部勾上转已完成，已完成取消任一步退回进行中）。execute 只返回预览与 previewToken（零写入），确认后才写入。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', minimum: 1 },
        taskId: { type: 'integer', minimum: 1 },
        steps: { type: 'array', items: { type: 'integer', minimum: 1 }, maxItems: 100 },
        all: { type: 'boolean' },
        done: { type: 'boolean' },
      },
      required: ['projectId', 'taskId', 'done'],
      additionalProperties: false,
    },
    requiredPermissions: [TASK_UPDATE],
    sideEffect: 'write',
    handler: async (ctx: ToolExecutionContext, input: ToggleTaskStepsParams) => {
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
          const result = plan(task, input)
          if (
            toggleStepsPreviewToken({ taskId, updatedAt: task.updatedAt, after: result.after }) !==
            token
          ) {
            throw new ConflictException('任务在预览后已被修改，请重新预览', {
              code: 'SCHEDULE_STALE',
            })
          }
          const planned = buildDiff(projectId, task, result)
          const actor = Number(ctx.user.id)
          const auth = { requestId: ctx.requestId ?? undefined }
          await taskService.update(
            ctx.organizationId,
            projectId,
            taskId,
            {
              customFields: result.customFields,
              ...(result.description !== null && result.description !== task.description
                ? { description: result.description }
                : {}),
              ...(result.progressPercent !== null
                ? { progressPercent: result.progressPercent }
                : {}),
            },
            actor,
            auth,
            trx,
          )
          // 状态跟着勾选走：经 changeStatus（按依赖顺延 / 往前拉、通知、审计），状态机不能直达时逐步走
          if (result.targetStatus) {
            for (const step of findStatusPath(task.status, result.targetStatus) ?? []) {
              await taskService.changeStatus(
                ctx.organizationId,
                projectId,
                taskId,
                {
                  status: step,
                  ...(result.progressPercent !== null && step !== 'completed'
                    ? { progressPercent: result.progressPercent }
                    : {}),
                },
                actor,
                auth,
                trx,
              )
            }
          }
          return planned
        })
        broadcastTasksUpdated(ctx.organizationId, projectId, [taskId], Number(ctx.user.id))
        const linkedChanges = [...(taskService.warnings.get(taskId) ?? [])]
        taskService.warnings.delete(taskId)
        return { status: 'SUCCESS', data: { ...diff, committed: true, linkedChanges } }
      }

      const task = await loadTask(db, ctx.organizationId, projectId, taskId)
      const result = plan(task, input)
      const diff = buildDiff(projectId, task, result)
      return {
        status: 'PREVIEW_REQUIRED',
        data: diff,
        previewToken: toggleStepsPreviewToken({
          taskId,
          updatedAt: task.updatedAt,
          after: result.after,
        }),
        diff,
      } satisfies ToolExecutionResult<ToggleTaskStepsDiff>
    },
  }
}
