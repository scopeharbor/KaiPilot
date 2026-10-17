// v3-triz-contradiction-copilot 任务 2.4 —— 写工具 `create_task_from_intervention`
//
// 语义：把某次分析记录（`analysisId`）中的第 `solutionIndex` 条 Top 3 方案草案转为**项目任务**。
//
// 两阶段确认（RL-01 / RL-06，与既有写试点 `update_task_schedule` 同一契约）：
// - execute（无 `previewToken`）→ 返回 `PREVIEW_REQUIRED` + SHA-256 `previewToken` + 差异预览，
//   **业务表零写入**；
// - confirm（编排层把信封级 `previewToken` 合入 handler 入参）→ 单事务内比对快照 → 落库
//   → 返回 `SUCCESS`（不得再携带 previewToken）。预览后被改动 → 409 `SCHEDULE_STALE` 回滚。
//
// 快照 / 令牌 / 落库全部委托 `TrizInterventionCommitService`（本模块只做入参适配）。
// 落库对象是本能力限定三类之一（`task:create`），删除任务之类的不可逆动作不生成执行控件。
import { TASK_CREATE } from '#rbac'
import { ValidationException } from '#exceptions/api_exception'
import app from '@adonisjs/core/services/app'
import TrizInterventionCommitService, {
  TRIZ_INTERVENTION_TASK_DEFAULTS,
  type TrizInterventionCommitResult,
  type TrizInterventionTaskDraft,
} from '#services/triz_copilot/triz_intervention_commit_service'
import { TASK_PRIORITIES } from '#services/task_status_machine'
import { asPositiveInt, asOptionalString } from './input_guards.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const CREATE_TASK_FROM_INTERVENTION_TOOL_NAME = 'create_task_from_intervention'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
/** Top 3 上限：一期方案序号闭集 1–3（第 4 条及以后不呈现，spec「Top 3 破局方案」）。 */
const SOLUTION_INDEX_MAX = 3

export interface CreateTaskFromInterventionParams {
  projectId: number
  analysisId: number
  /** Top 3 内的方案序号（1 起） */
  solutionIndex: number
  startDate?: string
  endDate?: string
  priority?: string
  /** 编排层 confirm 信封合并的 previewToken：存在即阶段二（commit） */
  previewToken?: string
}

export interface CreateTaskFromInterventionDeps {
  interventionService?: TrizInterventionCommitService
}

let servicePromise: Promise<TrizInterventionCommitService> | null = null
function resolveService(): Promise<TrizInterventionCommitService> {
  servicePromise ??= app.container.make(TrizInterventionCommitService)
  return servicePromise
}

export function createCreateTaskFromInterventionTool(
  deps?: CreateTaskFromInterventionDeps,
): ToolDefinition<
  CreateTaskFromInterventionParams,
  TrizInterventionTaskDraft | TrizInterventionCommitResult
> {
  return {
    name: CREATE_TASK_FROM_INTERVENTION_TOOL_NAME,
    description:
      '把某次矛盾求解分析中选定的一条方案草案落库为项目任务（标题取方案标题，描述含来源原则与命中参数）。阶段一只返回字段差异预览与 previewToken，绝不落库；必须经用户显式确认后由确认端点携带 previewToken 提交才生效。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', minimum: 1, description: '目标项目 ID' },
        analysisId: { type: 'integer', minimum: 1, description: '来源分析记录 ID' },
        solutionIndex: {
          type: 'integer',
          minimum: 1,
          maximum: SOLUTION_INDEX_MAX,
          description: 'Top 3 内的方案序号（1 起）',
        },
        startDate: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: '任务开始日期（YYYY-MM-DD，与 endDate 成对提供）',
        },
        endDate: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: '任务结束日期（YYYY-MM-DD，与 startDate 成对提供）',
        },
        priority: {
          type: 'string',
          enum: [...TASK_PRIORITIES],
          description: `任务优先级，默认 ${TRIZ_INTERVENTION_TASK_DEFAULTS.priority}`,
        },
      },
      required: ['projectId', 'analysisId', 'solutionIndex'],
      additionalProperties: false,
    },
    requiredPermissions: [TASK_CREATE],
    sideEffect: 'write',
    handler: async (
      ctx: ToolExecutionContext,
      input: CreateTaskFromInterventionParams,
    ): Promise<ToolExecutionResult<TrizInterventionTaskDraft | TrizInterventionCommitResult>> => {
      const projectId = asPositiveInt(input.projectId, 'projectId')
      const analysisId = asPositiveInt(input.analysisId, 'analysisId')
      const solutionIndex = asPositiveInt(input.solutionIndex, 'solutionIndex')
      if (solutionIndex > SOLUTION_INDEX_MAX) {
        throw new ValidationException(
          `solutionIndex 不得超过 ${SOLUTION_INDEX_MAX}（一期只呈现 Top 3）`,
        )
      }
      const startDate = normalizeDate(input.startDate, 'startDate')
      const endDate = normalizeDate(input.endDate, 'endDate')
      if ((startDate && !endDate) || (!startDate && endDate)) {
        throw new ValidationException('任务起止日期必须成对提供（startDate 与 endDate）')
      }
      if (startDate && endDate && startDate > endDate) {
        throw new ValidationException('任务开始日期不得晚于结束日期')
      }
      const priority = asOptionalString(input.priority, 'priority')
      if (priority && !(TASK_PRIORITIES as readonly string[]).includes(priority)) {
        throw new ValidationException(`priority 必须是 ${TASK_PRIORITIES.join(' / ')} 之一`)
      }

      const service = deps?.interventionService ?? (await resolveService())
      const request = {
        organizationId: ctx.organizationId,
        projectId,
        analysisId,
        solutionIndex,
        actorUserId: Number(ctx.user.id),
        taskOptions: { startDate, endDate, priority },
      }

      const token = typeof input.previewToken === 'string' ? input.previewToken.trim() : ''
      if (token !== '') {
        const committed = await service.commit('task', { ...request, previewToken: token })
        return { status: 'SUCCESS', data: committed }
      }

      const preview = await service.preview('task', request)
      if (preview.diff.target !== 'task') {
        throw new ValidationException('干预预览目标与工具不一致')
      }
      return {
        status: 'PREVIEW_REQUIRED',
        data: preview.diff,
        previewToken: preview.previewToken,
        diff: preview.diff,
      }
    },
  }
}

function normalizeDate(value: unknown, name: string): string | null {
  const text = asOptionalString(value, name)
  if (!text) return null
  if (!DATE_PATTERN.test(text)) {
    throw new ValidationException(`${name} 必须是 YYYY-MM-DD 格式`)
  }
  return text
}
