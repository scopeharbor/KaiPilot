// v3-ai-tools-orchestration-layer W2 —— 工具 `get_project_summary`
//
// 委托 ProjectService.get（组织隔离 + 404）取项目元数据与基础计数，
// 再委托 TaskService.list 统计已完成任务数；进度百分比取项目进度列
// （ProjectDashboardService.computeStats 为私有方法，设计文档引用的是
// 其读取期派生逻辑：progressPercent 列 + 任务状态分布，此处以等价的既有
// Service 委托实现，零新增 SQL）。只读，数据库零写入。
import { PROJECT_VIEW } from '#rbac'
import ProjectService from '#services/project_service'
import TaskService from '#services/task_service'
import app from '@adonisjs/core/services/app'
import { asPositiveInt } from './input_guards.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const GET_PROJECT_SUMMARY_TOOL_NAME = 'get_project_summary'

export interface GetProjectSummaryParams {
  projectId: number
}

export interface GetProjectSummaryResult {
  id: number
  name: string
  code: string | null
  status: string
  priority: string
  startDate: string | null
  endDate: string | null
  taskCount: number
  completedTaskCount: number
  progressPercent: number
  memberCount: number
}

export interface GetProjectSummaryDeps {
  projectService: ProjectService
  taskService: TaskService
}

let depsPromise: Promise<GetProjectSummaryDeps> | null = null
function resolveDeps(): Promise<GetProjectSummaryDeps> {
  depsPromise ??= (async () => ({
    projectService: await app.container.make(ProjectService),
    taskService: await app.container.make(TaskService),
  }))()
  return depsPromise
}

export function createGetProjectSummaryTool(
  deps?: GetProjectSummaryDeps,
): ToolDefinition<GetProjectSummaryParams, GetProjectSummaryResult> {
  return {
    name: GET_PROJECT_SUMMARY_TOOL_NAME,
    description:
      '查询指定项目的核心摘要：项目名称、代号、状态、优先级、起止时间跨度、任务总数、已完成任务数、进度百分比与成员数。用于 AI 同事快速把握项目全貌。只读。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', minimum: 1, description: '目标项目 ID' },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    requiredPermissions: [PROJECT_VIEW],
    sideEffect: 'read',
    handler: async (
      ctx: ToolExecutionContext,
      input: GetProjectSummaryParams,
    ): Promise<ToolExecutionResult<GetProjectSummaryResult>> => {
      const projectId = asPositiveInt(input.projectId, 'projectId')
      const services = deps ?? (await resolveDeps())
      const { project, stats } = await services.projectService.get(ctx.organizationId, projectId)
      const completed = await services.taskService.list(ctx.organizationId, projectId, {
        status: 'completed',
        perPage: 1,
      })

      return {
        status: 'SUCCESS',
        data: {
          id: project.id,
          name: project.name,
          code: project.code,
          status: project.status,
          priority: project.priority,
          startDate: project.startDate?.toISODate() ?? null,
          endDate: project.endDate?.toISODate() ?? null,
          taskCount: stats.taskCount,
          completedTaskCount: completed.meta.total,
          progressPercent: Number(project.progressPercent ?? 0),
          memberCount: stats.memberCount,
        },
      }
    },
  }
}
