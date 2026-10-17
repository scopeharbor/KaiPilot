// v3-triz-contradiction-copilot 任务 2.4 —— 只读工具 `get_triz_analysis`
//
// 语义：按 ID 取回单条矛盾求解分析记录与它的**映射依据**（矛盾类型 / 改善与恶化参数 /
// 候选原则及其知识包释义 / 置信度 / 路径 `ai|rule` / 预算快照 / Top 3 低敏投影）。
// 委托 W2a 的 `TrizCopilotAnalysisService.findById` + `toDTO`（组织 + 项目双隔离，
// 跨组织 / 不存在 / 已软删统一 404 `RESOURCE_NOT_FOUND`，不泄露存在性——RL-05）。
//
// 只读：不触发任何求解、模型调用或写入（包括本 change 自有表）。
import { PROJECT_VIEW } from '#rbac'
import app from '@adonisjs/core/services/app'
import TrizCopilotAnalysisService, {
  type TrizCopilotAnalysisDTO,
} from '#services/triz_copilot/triz_copilot_analysis_service'
import { asPositiveInt } from './input_guards.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const GET_TRIZ_ANALYSIS_TOOL_NAME = 'get_triz_analysis'

export interface GetTrizAnalysisParams {
  projectId: number
  analysisId: number
}

export interface GetTrizAnalysisDeps {
  analysisService?: TrizCopilotAnalysisService
}

let analysisServicePromise: Promise<TrizCopilotAnalysisService> | null = null
function resolveAnalysisService(): Promise<TrizCopilotAnalysisService> {
  analysisServicePromise ??= app.container.make(TrizCopilotAnalysisService)
  return analysisServicePromise
}

export function createGetTrizAnalysisTool(
  deps?: GetTrizAnalysisDeps,
): ToolDefinition<GetTrizAnalysisParams, TrizCopilotAnalysisDTO> {
  return {
    name: GET_TRIZ_ANALYSIS_TOOL_NAME,
    description:
      '按分析记录 ID 读取一次矛盾求解的完整依据：矛盾类型、改善/恶化参数（编号 + 中文名）、候选原则编号与知识包释义、置信度、结果路径（ai=模型推理 / rule=规则匹配）、上下文实体引用与自主权预算快照，以及已落库的 Top 3 方案低敏投影。只读，不发起新的求解。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', minimum: 1, description: '目标项目 ID' },
        analysisId: { type: 'integer', minimum: 1, description: '分析记录 ID' },
      },
      required: ['projectId', 'analysisId'],
      additionalProperties: false,
    },
    requiredPermissions: [PROJECT_VIEW],
    sideEffect: 'read',
    handler: async (
      ctx: ToolExecutionContext,
      input: GetTrizAnalysisParams,
    ): Promise<ToolExecutionResult<TrizCopilotAnalysisDTO>> => {
      const projectId = asPositiveInt(input.projectId, 'projectId')
      const analysisId = asPositiveInt(input.analysisId, 'analysisId')
      const service = deps?.analysisService ?? (await resolveAnalysisService())
      const record = await service.findById(ctx.organizationId, projectId, analysisId)
      return { status: 'SUCCESS', data: service.toDTO(record) }
    },
  }
}
