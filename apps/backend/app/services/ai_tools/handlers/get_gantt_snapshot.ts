// v3-ai-tools-orchestration-layer W2 —— 工具 `get_gantt_snapshot`
//
// 委托 GanttBaselineService.get（内部组织级项目断言，跨组织 404）取基线快照；
// 再以 Task 模型读取当前活跃任务，筛查逾期任务（endDate < 今日且未完成）与
// 关键路径任务 ID（is_critical_path 标记）。只读，数据库零写入。
import { GANTT_VIEW } from '#rbac'
import type GanttBaseline from '#models/gantt_baseline'
import Task from '#models/task'
import GanttBaselineService from '#services/gantt_baseline_service'
import app from '@adonisjs/core/services/app'
import { DateTime } from 'luxon'
import { asPositiveInt } from './input_guards.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const GET_GANTT_SNAPSHOT_TOOL_NAME = 'get_gantt_snapshot'

export interface GetGanttSnapshotParams {
  projectId: number
}

export interface GanttSnapshotBaseline {
  id: number
  projectId: number
  savedAt: string
  snapshot: {
    tasks: Array<{ id: number; startDate: string | null; endDate: string | null }>
    milestones: Array<{ id: number; plannedDate: string | null }>
  }
}

export interface OverdueTaskItem {
  id: number
  name: string
  status: string
  taskType: string
  startDate: string | null
  endDate: string | null
  durationDays: number | null
}

export interface GetGanttSnapshotResult {
  baseline: GanttSnapshotBaseline | null
  taskCount: number
  overdueTasks: OverdueTaskItem[]
  criticalPathTaskIds: number[]
}

export interface GetGanttSnapshotDeps {
  ganttBaselineService: GanttBaselineService
}

let baselineServicePromise: Promise<GanttBaselineService> | null = null
function resolveBaselineService(): Promise<GanttBaselineService> {
  baselineServicePromise ??= app.container.make(GanttBaselineService)
  return baselineServicePromise
}

export function createGetGanttSnapshotTool(
  deps?: GetGanttSnapshotDeps,
): ToolDefinition<GetGanttSnapshotParams, GetGanttSnapshotResult> {
  return {
    name: GET_GANTT_SNAPSHOT_TOOL_NAME,
    description:
      '获取项目甘特快照：已保存基线数据、当前任务总数、已延期任务（截止日早于今日且未完成）列表与关键路径任务 ID，用于 AI 同事判断排期健康状况。只读。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', minimum: 1, description: '目标项目 ID' },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    requiredPermissions: [GANTT_VIEW],
    sideEffect: 'read',
    handler: async (
      ctx: ToolExecutionContext,
      input: GetGanttSnapshotParams,
    ): Promise<ToolExecutionResult<GetGanttSnapshotResult>> => {
      const projectId = asPositiveInt(input.projectId, 'projectId')

      // 内部组织级项目断言（跨组织 404，RL-05）
      const baselineService = deps?.ganttBaselineService ?? (await resolveBaselineService())
      const baseline = await baselineService.get(ctx.organizationId, projectId)

      const tasks = await Task.query()
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .orderBy('id')

      const today = DateTime.now().startOf('day')
      const overdueTasks: OverdueTaskItem[] = tasks
        .filter(
          (task) =>
            task.status !== 'completed' &&
            task.endDate !== null &&
            task.endDate.toMillis() < today.toMillis(),
        )
        .map((task) => ({
          id: task.id,
          name: task.name,
          status: task.status,
          taskType: task.taskType,
          startDate: task.startDate?.toISODate() ?? null,
          endDate: task.endDate?.toISODate() ?? null,
          durationDays: task.durationDays,
        }))

      const criticalPathTaskIds = tasks.filter((task) => task.isCriticalPath).map((task) => task.id)

      return {
        status: 'SUCCESS',
        data: {
          baseline: toBoundedBaseline(baseline),
          taskCount: tasks.length,
          overdueTasks,
          criticalPathTaskIds,
        },
      }
    },
  }
}

function toBoundedBaseline(baseline: GanttBaseline | null): GanttSnapshotBaseline | null {
  if (!baseline) return null
  return {
    id: baseline.id,
    projectId: baseline.projectId,
    savedAt: baseline.snapshot.savedAt,
    snapshot: baseline.snapshot,
  }
}
