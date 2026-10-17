// v3-ai-tools-orchestration-layer W2 —— 工具 `get_task_detail`
//
// 委托 TaskService.get（组织隔离 + 项目校验 + 404；preload 责任人/审核人/父子任务
// 并挂载 dependencyCount）。返回结构化任务详情，只读。
import { TASK_VIEW } from '#rbac'
import TaskService from '#services/task_service'
import app from '@adonisjs/core/services/app'
import { asPositiveInt } from './input_guards.js'
import { toBoundedTaskDetail, type BoundedTaskDetail } from './mappers.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const GET_TASK_DETAIL_TOOL_NAME = 'get_task_detail'

export interface GetTaskDetailParams {
  projectId: number
  taskId: number
}

export interface GetTaskDetailDeps {
  taskService: TaskService
}

let taskServicePromise: Promise<TaskService> | null = null
function resolveTaskService(): Promise<TaskService> {
  taskServicePromise ??= app.container.make(TaskService)
  return taskServicePromise
}

export function createGetTaskDetailTool(
  deps?: GetTaskDetailDeps,
): ToolDefinition<GetTaskDetailParams, BoundedTaskDetail> {
  return {
    name: GET_TASK_DETAIL_TOOL_NAME,
    description:
      '获取指定项目中单项任务的完整详情：起止日期、工期人天、状态、优先级、负责人、审核人、父任务、所属 WBS 节点与前后置依赖数量。只读。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', minimum: 1, description: '目标项目 ID' },
        taskId: { type: 'integer', minimum: 1, description: '目标任务 ID' },
      },
      required: ['projectId', 'taskId'],
      additionalProperties: false,
    },
    requiredPermissions: [TASK_VIEW],
    sideEffect: 'read',
    handler: async (
      ctx: ToolExecutionContext,
      input: GetTaskDetailParams,
    ): Promise<ToolExecutionResult<BoundedTaskDetail>> => {
      const projectId = asPositiveInt(input.projectId, 'projectId')
      const taskId = asPositiveInt(input.taskId, 'taskId')
      const taskService = deps?.taskService ?? (await resolveTaskService())
      const task = await taskService.get(ctx.organizationId, projectId, taskId)

      return { status: 'SUCCESS', data: toBoundedTaskDetail(task) }
    },
  }
}
