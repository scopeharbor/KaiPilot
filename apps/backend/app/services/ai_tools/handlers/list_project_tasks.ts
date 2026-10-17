// v3-ai-tools-orchestration-layer W2 —— 工具 `list_project_tasks`
//
// 委托 TaskService.list（内部完成组织隔离与分页，跨项目 404）。
// 支持 status / priority / assigneeId / search / page / perPage（pageSize 为别名，
// 兼容 spec「分页参数 page, pageSize」表述，设计文档使用 perPage）。
import { TASK_VIEW } from '#rbac'
import TaskService from '#services/task_service'
import app from '@adonisjs/core/services/app'
import { asPage, asPositiveInt, asOptionalString } from './input_guards.js'
import { toBoundedTask, type BoundedTaskItem } from './mappers.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const LIST_PROJECT_TASKS_TOOL_NAME = 'list_project_tasks'

export interface ListProjectTasksParams {
  projectId: number
  status?: string
  priority?: string
  assigneeId?: number
  search?: string
  page?: number
  perPage?: number
  /** spec 分页表述别名，等价于 perPage。 */
  pageSize?: number
}

export interface ListProjectTasksResult {
  items: BoundedTaskItem[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface ListProjectTasksDeps {
  taskService: TaskService
}

let taskServicePromise: Promise<TaskService> | null = null
function resolveTaskService(): Promise<TaskService> {
  taskServicePromise ??= app.container.make(TaskService)
  return taskServicePromise
}

export function createListProjectTasksTool(
  deps?: ListProjectTasksDeps,
): ToolDefinition<ListProjectTasksParams, ListProjectTasksResult> {
  return {
    name: LIST_PROJECT_TASKS_TOOL_NAME,
    description:
      '按状态、优先级、负责人、关键词或分页参数检索指定项目下的任务清单，返回有界任务条目与分页元信息。只读。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', minimum: 1, description: '目标项目 ID' },
        status: {
          type: 'string',
          enum: ['not_started', 'in_progress', 'completed', 'blocked', 'on_hold', 'cancelled'],
        },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        assigneeId: { type: 'integer', minimum: 1 },
        search: { type: 'string', maxLength: 100 },
        page: { type: 'integer', minimum: 1, default: 1 },
        perPage: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        pageSize: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    requiredPermissions: [TASK_VIEW],
    sideEffect: 'read',
    handler: async (
      ctx: ToolExecutionContext,
      input: ListProjectTasksParams,
    ): Promise<ToolExecutionResult<ListProjectTasksResult>> => {
      const projectId = asPositiveInt(input.projectId, 'projectId')
      const page = asPage(input.page, 'page', 1, 1000)
      const perPage = asPage(input.perPage ?? input.pageSize, 'perPage', 20, 100)

      const taskService = deps?.taskService ?? (await resolveTaskService())
      const { data, meta } = await taskService.list(ctx.organizationId, projectId, {
        status: asOptionalString(input.status, 'status'),
        priority: asOptionalString(input.priority, 'priority'),
        assigneeId:
          input.assigneeId === undefined
            ? undefined
            : asPositiveInt(input.assigneeId, 'assigneeId'),
        search: asOptionalString(input.search, 'search'),
        page,
        perPage,
      })

      return {
        status: 'SUCCESS',
        data: {
          items: data.map((task) => toBoundedTask(task)),
          meta: {
            total: meta.total,
            page: meta.page,
            perPage: meta.perPage,
            totalPages: meta.totalPages,
          },
        },
      }
    },
  }
}
