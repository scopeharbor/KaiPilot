// AI 同事自然语言操作 —— 写工具 `create_task`（「新建一个任务：接口联调，下周一到周三，交给小王」）
//
// 两阶段确认（RL-01）：execute 校验并返回将要新建的任务（名称、日期、负责人、所属父任务、执行步骤）
// 与 previewToken（零写入）；confirm 携带同一参数与令牌，令牌按参数重算一致才经 TaskService.create
// 新建（复用日期 / 父任务 / 负责人校验、审计、进度重算与通知）。执行步骤写入
// customFields.execution.steps，并在说明里写成 `- [ ] 步骤`，界面可直接打勾。
import { createHash } from 'node:crypto'
import { TASK_CREATE } from '#rbac'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import TaskService from '#services/task_service'
import { broadcastTasksUpdated } from '#services/realtime/task_change_broadcast'
import { formatTaskCode } from '@aiproj/types'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { asPositiveInt } from './input_guards.js'
import { loadMember, type AssigneeRef } from './update_task_assignee.js'
import type { ToolDefinition, ToolExecutionContext } from '#services/ai_tools/registry'

export const CREATE_TASK_TOOL_NAME = 'create_task'

const PREVIEW_TOKEN_PATTERN = /^[0-9a-f]{64}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
const PRIORITY_LABELS: Record<(typeof PRIORITIES)[number], string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
}
/** 执行步骤上限（条）与单条长度。 */
const MAX_STEPS = 30
const STEP_MAX = 200

export interface CreateTaskParams {
  projectId: number
  name: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  priority?: string | null
  assigneeId?: number | null
  parentTaskId?: number | null
  steps?: string[]
  previewToken?: string
}

export interface CreateTaskPreview {
  projectId: number
  projectName: string
  name: string
  description: string | null
  startDate: string | null
  endDate: string | null
  priority: string
  priorityLabel: string
  assignee: AssigneeRef | null
  parent: { id: number; code: string; name: string } | null
  steps: string[]
}

export interface CreateTaskDeps {
  taskService?: TaskService
}

function resolveTaskService(): Promise<TaskService> {
  return app.container.make(TaskService)
}

function optionalDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !DATE_PATTERN.test(value) || !DateTime.fromISO(value).isValid) {
    throw new ValidationException(`${field} 必须是 YYYY-MM-DD 日期`)
  }
  return value
}

/** 规范化入参（令牌按规范化后的值计算，预览与确认一致）。 */
export function normalizeCreateTaskParams(input: CreateTaskParams) {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 200) : ''
  if (!name) throw new ValidationException('任务名称不能为空')
  const startDate = optionalDate(input.startDate, 'startDate')
  const endDate = optionalDate(input.endDate, 'endDate')
  if (startDate && endDate && endDate < startDate) {
    throw new ValidationException('结束日期不能早于开始日期')
  }
  const priority = PRIORITIES.includes(input.priority as (typeof PRIORITIES)[number])
    ? (input.priority as (typeof PRIORITIES)[number])
    : 'medium'
  const steps = (Array.isArray(input.steps) ? input.steps : [])
    .map((step) =>
      String(step ?? '')
        .trim()
        .slice(0, STEP_MAX),
    )
    .filter(Boolean)
    .slice(0, MAX_STEPS)
  const description =
    typeof input.description === 'string' && input.description.trim()
      ? input.description.trim().slice(0, 4000)
      : null
  return {
    projectId: asPositiveInt(input.projectId, 'projectId'),
    name,
    description,
    startDate,
    endDate,
    priority,
    assigneeId:
      input.assigneeId === null || input.assigneeId === undefined
        ? null
        : asPositiveInt(input.assigneeId, 'assigneeId'),
    parentTaskId:
      input.parentTaskId === null || input.parentTaskId === undefined
        ? null
        : asPositiveInt(input.parentTaskId, 'parentTaskId'),
    steps,
  }
}

type NormalizedParams = ReturnType<typeof normalizeCreateTaskParams>

export function createTaskPreviewToken(params: NormalizedParams): string {
  return createHash('sha256')
    .update(JSON.stringify({ tool: CREATE_TASK_TOOL_NAME, ...params }))
    .digest('hex')
}

/** 说明 + 执行步骤（`- [ ] 步骤`，界面打勾会同步这些勾选框）。 */
export function describeWithSteps(
  description: string | null,
  steps: readonly string[],
): string | null {
  if (steps.length === 0) return description
  const checklist = steps.map((step) => `- [ ] ${step}`).join('\n')
  return description ? `${description}\n\n执行步骤：\n${checklist}` : `执行步骤：\n${checklist}`
}

async function buildPreview(
  organizationId: number,
  params: NormalizedParams,
): Promise<CreateTaskPreview> {
  const project = (await db
    .from('projects')
    .where('id', params.projectId)
    .where('organization_id', organizationId)
    .whereNull('deleted_at')
    .select('id', 'name', 'code')
    .first()) as Record<string, unknown> | null
  if (!project) throw new ResourceNotFoundException('项目不存在或无权访问')
  const assignee =
    params.assigneeId === null
      ? null
      : await loadMember(db, organizationId, params.assigneeId, params.projectId)
  if (params.assigneeId !== null && !assignee) {
    throw new ValidationException('要指派的人不是这个项目的在职成员')
  }
  let parent: CreateTaskPreview['parent'] = null
  if (params.parentTaskId !== null) {
    const row = (await db
      .from('tasks')
      .where('id', params.parentTaskId)
      .where('project_id', params.projectId)
      .whereNull('deleted_at')
      .select('id', 'name')
      .first()) as Record<string, unknown> | null
    if (!row) throw new ValidationException('父任务不在这个项目里')
    parent = {
      id: Number(row.id),
      code: formatTaskCode(
        { id: params.projectId, code: (project.code as string | null) ?? null },
        Number(row.id),
      ),
      name: String(row.name ?? ''),
    }
  }
  return {
    projectId: params.projectId,
    projectName: String(project.name ?? ''),
    name: params.name,
    description: params.description,
    startDate: params.startDate,
    endDate: params.endDate,
    priority: params.priority,
    priorityLabel: PRIORITY_LABELS[params.priority],
    assignee,
    parent,
    steps: params.steps,
  }
}

export function createCreateTaskTool(
  deps?: CreateTaskDeps,
): ToolDefinition<
  CreateTaskParams,
  CreateTaskPreview & { committed?: boolean; taskId?: number; taskCode?: string }
> {
  return {
    name: CREATE_TASK_TOOL_NAME,
    description:
      '新建任务（可带日期、优先级、负责人、父任务与执行步骤）。execute 只返回将要新建的任务与 previewToken（零写入），确认后才新建。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', minimum: 1 },
        name: { type: 'string', minLength: 1, maxLength: 200 },
        description: { type: ['string', 'null'], maxLength: 4000 },
        startDate: { type: ['string', 'null'] },
        endDate: { type: ['string', 'null'] },
        priority: { type: ['string', 'null'] },
        assigneeId: { type: ['integer', 'null'] },
        parentTaskId: { type: ['integer', 'null'] },
        steps: { type: 'array', items: { type: 'string' }, maxItems: MAX_STEPS },
      },
      required: ['projectId', 'name'],
      additionalProperties: false,
    },
    requiredPermissions: [TASK_CREATE],
    sideEffect: 'write',
    handler: async (ctx: ToolExecutionContext, input: CreateTaskParams) => {
      const params = normalizeCreateTaskParams(input)
      const preview = await buildPreview(ctx.organizationId, params)
      const expected = createTaskPreviewToken(params)

      const token = typeof input.previewToken === 'string' ? input.previewToken.trim() : ''
      if (token === '') {
        return { status: 'PREVIEW_REQUIRED', data: preview, previewToken: expected, diff: preview }
      }
      if (!PREVIEW_TOKEN_PATTERN.test(token)) {
        throw new ValidationException('previewToken 必须是 64 位十六进制哈希')
      }
      if (token !== expected) {
        throw new ValidationException('确认的内容与预览不一致，请重新预览')
      }
      const taskService = deps?.taskService ?? (await resolveTaskService())
      const task = await taskService.create(
        ctx.organizationId,
        params.projectId,
        {
          name: params.name,
          description: describeWithSteps(params.description, params.steps),
          startDate: params.startDate,
          endDate: params.endDate,
          priority: params.priority,
          assigneeId: params.assigneeId,
          parentTaskId: params.parentTaskId,
          customFields: {
            source: 'ai_colleague',
            ...(params.steps.length > 0
              ? { execution: { steps: params.steps, stepsDone: params.steps.map(() => false) } }
              : {}),
          },
        },
        Number(ctx.user.id),
        { requestId: ctx.requestId ?? undefined },
      )
      broadcastTasksUpdated(ctx.organizationId, params.projectId, [task.id], Number(ctx.user.id))
      const projectCode = (
        (await db.from('projects').where('id', params.projectId).select('code').first()) as {
          code?: string | null
        } | null
      )?.code
      return {
        status: 'SUCCESS',
        data: {
          ...preview,
          committed: true,
          taskId: task.id,
          taskCode: formatTaskCode({ id: params.projectId, code: projectCode ?? null }, task.id),
        },
      }
    },
  }
}
