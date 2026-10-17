// v3-triz-contradiction-copilot 任务 2.4 —— 写工具 `create_risk_from_intervention`
//
// 语义：把某次分析记录（`analysisId`）中的第 `solutionIndex` 条 Top 3 方案草案转为**风险登记条目**。
//
// 两阶段确认（RL-01 / RL-06）：execute → `PREVIEW_REQUIRED` + SHA-256 `previewToken` + 差异预览，
// 业务表零写入；confirm → 单事务内比对快照后落库；预览后被改动 → 409 `SCHEDULE_STALE` 回滚。
// 风险评分与等级口径与 `RiskService.create` 一致（score = probability × impact；等级由
// `RiskLevelService` 按组织/项目配置计算，不复制规则）。
import { RISK_MANAGE } from '#rbac'
import { ValidationException } from '#exceptions/api_exception'
import app from '@adonisjs/core/services/app'
import TrizInterventionCommitService, {
  type TrizInterventionCommitResult,
  type TrizInterventionRiskDraft,
} from '#services/triz_copilot/triz_intervention_commit_service'
import { asPositiveInt } from './input_guards.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const CREATE_RISK_FROM_INTERVENTION_TOOL_NAME = 'create_risk_from_intervention'

/** Top 3 上限：一期方案序号闭集 1–3。 */
const SOLUTION_INDEX_MAX = 3

export interface CreateRiskFromInterventionParams {
  projectId: number
  analysisId: number
  /** Top 3 内的方案序号（1 起） */
  solutionIndex: number
  /** 编排层 confirm 信封合并的 previewToken：存在即阶段二（commit） */
  previewToken?: string
}

export interface CreateRiskFromInterventionDeps {
  interventionService?: TrizInterventionCommitService
}

let servicePromise: Promise<TrizInterventionCommitService> | null = null
function resolveService(): Promise<TrizInterventionCommitService> {
  servicePromise ??= app.container.make(TrizInterventionCommitService)
  return servicePromise
}

export function createCreateRiskFromInterventionTool(
  deps?: CreateRiskFromInterventionDeps,
): ToolDefinition<
  CreateRiskFromInterventionParams,
  TrizInterventionRiskDraft | TrizInterventionCommitResult
> {
  return {
    name: CREATE_RISK_FROM_INTERVENTION_TOOL_NAME,
    description:
      '把某次矛盾求解分析中选定的一条方案草案落库为风险登记条目（标题取方案标题，描述含来源原则、命中参数与关联实体）。阶段一只返回字段差异预览与 previewToken，绝不落库；必须经用户显式确认后由确认端点携带 previewToken 提交才生效。',
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
      },
      required: ['projectId', 'analysisId', 'solutionIndex'],
      additionalProperties: false,
    },
    requiredPermissions: [RISK_MANAGE],
    sideEffect: 'write',
    handler: async (
      ctx: ToolExecutionContext,
      input: CreateRiskFromInterventionParams,
    ): Promise<ToolExecutionResult<TrizInterventionRiskDraft | TrizInterventionCommitResult>> => {
      const projectId = asPositiveInt(input.projectId, 'projectId')
      const analysisId = asPositiveInt(input.analysisId, 'analysisId')
      const solutionIndex = asPositiveInt(input.solutionIndex, 'solutionIndex')
      if (solutionIndex > SOLUTION_INDEX_MAX) {
        throw new ValidationException(
          `solutionIndex 不得超过 ${SOLUTION_INDEX_MAX}（一期只呈现 Top 3）`,
        )
      }

      const service = deps?.interventionService ?? (await resolveService())
      const request = {
        organizationId: ctx.organizationId,
        projectId,
        analysisId,
        solutionIndex,
        actorUserId: Number(ctx.user.id),
      }

      const token = typeof input.previewToken === 'string' ? input.previewToken.trim() : ''
      if (token !== '') {
        const committed = await service.commit('risk', { ...request, previewToken: token })
        return { status: 'SUCCESS', data: committed }
      }

      const preview = await service.preview('risk', request)
      if (preview.diff.target !== 'risk') {
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
