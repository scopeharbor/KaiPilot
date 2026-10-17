// v3-ai-tools-orchestration-layer W2 —— 写操作试点工具 `update_task_schedule`
//
// 两阶段确认（RL-01 / RL-06），单 handler 按入参区分阶段（W1 executor 契约：
// confirm 端点把信封级 previewToken 合入 handler 入参）：
// - 阶段一（execute，无 previewToken）：委托 GanttSchedulingService 以
//   mode:'preview' 试算，产出 SHA-256 previewToken 与变更 Diff，正式任务表零写入，
//   结果状态恒为 PREVIEW_REQUIRED；
// - 阶段二（confirm，携带 previewToken）：委托 GanttSchedulingService 以
//   mode:'commit' 在单事务内重算快照哈希并原子落库，返回 SUCCESS（不含
//   previewToken，满足 executor 的 RL-01 断言）；预览后被并发修改时领域服务
//   抛出 ConflictException(SCHEDULE_STALE) → 409 全量回滚。
//
// 所有调度算法/TOCTOU/事务均复用 GanttSchedulingService，本模块只做入参适配。
import { TASK_UPDATE } from '#rbac'
import { ValidationException } from '#exceptions/api_exception'
import GanttSchedulingService, {
  type GanttScheduleResponse,
} from '#services/gantt_scheduling_service'
import type { ScheduleChange, ScheduleConflict } from '#services/gantt_scheduling_engine'
import app from '@adonisjs/core/services/app'
import { asPositiveInt, asBoolean, asOptionalString } from './input_guards.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const UPDATE_TASK_SCHEDULE_TOOL_NAME = 'update_task_schedule'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const PREVIEW_TOKEN_PATTERN = /^[0-9a-f]{64}$/

export interface UpdateTaskScheduleParams {
  projectId: number
  taskId: number
  operation: 'move' | 'resize'
  startDate: string
  endDate?: string
  autoSchedule?: boolean
  /** 编排层 confirm 信封合并的 previewToken：存在即阶段二（commit）。 */
  previewToken?: string
}

export interface UpdateTaskScheduleResult {
  projectId: number
  committed: boolean
  changes: ScheduleChange[]
  conflicts: ScheduleConflict[]
  warnings: string[]
  affectedTaskIds: number[]
  calendar: {
    version: number
    workdays: number[]
    holidays: string[]
    extraWorkdays: string[]
  }
}

export interface UpdateTaskScheduleDeps {
  ganttSchedulingService: GanttSchedulingService
}

let ganttServicePromise: Promise<GanttSchedulingService> | null = null
function resolveGanttService(): Promise<GanttSchedulingService> {
  ganttServicePromise ??= app.container.make(GanttSchedulingService)
  return ganttServicePromise
}

export function createUpdateTaskScheduleTool(
  deps?: UpdateTaskScheduleDeps,
): ToolDefinition<UpdateTaskScheduleParams, UpdateTaskScheduleResult> {
  return {
    name: UPDATE_TASK_SCHEDULE_TOOL_NAME,
    description:
      '调整项目中单任务的排程（移动/改期或伸缩/改工期），并可按依赖拓扑自动联动下游任务。阶段一仅生成预览 Diff 与 previewToken，绝不落库；必须经用户确认后由确认端点携带 previewToken 提交才生效。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', minimum: 1, description: '目标项目 ID' },
        taskId: { type: 'integer', minimum: 1, description: '目标任务 ID' },
        operation: {
          type: 'string',
          enum: ['move', 'resize'],
          description: 'move=移动，resize=伸缩',
        },
        startDate: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: '目标开始日期（YYYY-MM-DD）',
        },
        endDate: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: '目标结束日期（resize 时必填）',
        },
        autoSchedule: {
          type: 'boolean',
          default: false,
          description: '是否按依赖拓扑联动下游任务',
        },
      },
      required: ['projectId', 'taskId', 'operation', 'startDate'],
      additionalProperties: false,
    },
    requiredPermissions: [TASK_UPDATE],
    sideEffect: 'write',
    handler: async (
      ctx: ToolExecutionContext,
      input: UpdateTaskScheduleParams,
    ): Promise<ToolExecutionResult<UpdateTaskScheduleResult>> => {
      const normalized = normalizeParams(input)
      const ganttService = deps?.ganttSchedulingService ?? (await resolveGanttService())

      // 阶段二：confirm 提交（previewToken 由编排层 confirm 端点合并进入参）
      if (typeof input.previewToken === 'string' && input.previewToken.trim() !== '') {
        const previewToken = input.previewToken.trim()
        if (!PREVIEW_TOKEN_PATTERN.test(previewToken)) {
          throw new ValidationException('previewToken 必须是 64 位十六进制哈希')
        }
        const response = await ganttService.execute(
          ctx.organizationId,
          normalized.projectId,
          { mode: 'commit', previewToken, ...normalized.intent },
          ctx.user.id,
          { requestId: ctx.requestId ?? undefined },
        )
        // RL-01：确认成功不得携带 previewToken（executor 据此 fail-closed）
        return { status: 'SUCCESS', data: toBoundedResult(normalized.projectId, response) }
      }

      // 阶段一：预览拦截（RL-01，preview 模式下领域服务零写入，committed 恒为 false）
      const response = await ganttService.execute(
        ctx.organizationId,
        normalized.projectId,
        { mode: 'preview', ...normalized.intent },
        ctx.user.id,
        { requestId: ctx.requestId ?? undefined },
      )
      return {
        status: 'PREVIEW_REQUIRED',
        data: toBoundedResult(normalized.projectId, response),
        previewToken: response.previewToken,
        diff: response.changes,
      }
    },
  }
}

function normalizeParams(input: UpdateTaskScheduleParams): {
  projectId: number
  intent: {
    taskId: number
    operation: 'move' | 'resize'
    startDate: string
    endDate: string | null
    autoSchedule: boolean
  }
} {
  const projectId = asPositiveInt(input.projectId, 'projectId')
  const taskId = asPositiveInt(input.taskId, 'taskId')
  const operation = input.operation === 'resize' ? 'resize' : 'move'
  const startDate = String(input.startDate ?? '').trim()
  if (!DATE_PATTERN.test(startDate)) {
    throw new ValidationException('startDate 必须是 YYYY-MM-DD 格式')
  }
  const endDateRaw = asOptionalString(input.endDate, 'endDate')
  if (endDateRaw && !DATE_PATTERN.test(endDateRaw)) {
    throw new ValidationException('endDate 必须是 YYYY-MM-DD 格式')
  }
  return {
    projectId,
    intent: {
      taskId,
      operation,
      startDate,
      endDate: endDateRaw ?? null,
      autoSchedule:
        input.autoSchedule === undefined ? false : asBoolean(input.autoSchedule, 'autoSchedule'),
    },
  }
}

function toBoundedResult(
  projectId: number,
  response: GanttScheduleResponse,
): UpdateTaskScheduleResult {
  return {
    projectId,
    committed: response.committed,
    changes: response.changes,
    conflicts: response.conflicts,
    warnings: response.warnings,
    affectedTaskIds: response.affectedTaskIds,
    calendar: response.calendar,
  }
}
