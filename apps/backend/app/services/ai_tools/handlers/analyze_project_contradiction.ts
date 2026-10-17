// v3-triz-contradiction-copilot 任务 2.4 —— 只读工具 `analyze_project_contradiction`
//
// 语义：PM 用大白话陈述一条项目矛盾 → 后台完成 TRIZ 语义映射（1.4）→ Top 3 破局方案（1.5）→
// 落库**低敏**分析记录（2.1 表）。委托 W2a 的 `TrizCopilotAnalysisService.solve`，
// 不另起炉灶（上下文包组装 / 反幻觉白名单 / Autonomy Budget 全部复用同一链路）。
//
// 为什么 `sideEffect: 'read'` 却仍有写入：落库对象是本 change **自有**的分析草案表
// （`triz_copilot_analyses`，低敏：编号 / 枚举 / 摘要 / 有界标题），不含任何业务表写入；
// 业务落库（任务 / 风险 / 变更请求）一律走三个 `sideEffect: 'write'` 工具的两阶段确认
// （RL-01 / RL-06）。design D4 明确本工具为 `read`。
//
// RL-12：本工具**不落库**也不回显 PM 陈述原文（陈述只在请求生命周期内存在，落库前即折算为
// digest 与长度）；响应的 `statement` 字段只有摘要信息。
import { PROJECT_VIEW } from '#rbac'
import { ValidationException } from '#exceptions/api_exception'
import app from '@adonisjs/core/services/app'
import TrizCopilotAnalysisService, {
  type TrizCopilotAnalysisDTO,
  type TrizCopilotClarificationState,
  type TrizCopilotSolveResult,
} from '#services/triz_copilot/triz_copilot_analysis_service'
import type { TrizBudgetSnapshot } from '#services/triz_copilot/triz_copilot_budget'
import type { TrizContradictionMappingResult } from '#services/triz_copilot/triz_contradiction_mapping_service'
import type {
  TrizSolutionDraft,
  TrizSolutionDraftSet,
} from '#services/triz_copilot/triz_solution_draft_service'
import { asPositiveInt, asOptionalString, asBoolean } from './input_guards.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const ANALYZE_PROJECT_CONTRADICTION_TOOL_NAME = 'analyze_project_contradiction'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
/** 与对话流校验器同一输入界：超长陈述由映射服务确定性截断并诚实披露，不因长度拒绝。 */
const STATEMENT_MAX_CHARS = 4000

export interface AnalyzeProjectContradictionParams {
  projectId: number
  /** PM 的大白话矛盾陈述（原文不落库、不回显，RL-12） */
  statement: string
  asOfDate?: string
  /** 澄清链上的上一轮记录 ID（继承已发生的澄清轮数，硬上限 2 轮） */
  parentAnalysisId?: number
  /** 来源被动雷达信号 ID（可选） */
  sourceSignalId?: number
  forceRulePath?: boolean
}

/** 有界响应：映射依据 + Top 3 方案 + 澄清状态 + 预算快照（无陈述原文 / prompt / 模型输出全文）。 */
export interface AnalyzeProjectContradictionResult {
  projectId: number
  analysis: TrizCopilotAnalysisDTO
  mapping: TrizCopilotSolveResult['mapping']
  solutions: TrizSolutionDraft[]
  solutionSet: {
    entityBinding: TrizSolutionDraftSet['entityBinding']
    candidatePrincipleNumbers: number[]
    excludedPrincipleNumbers: number[]
    contextRefValidation: TrizSolutionDraftSet['contextRefValidation']
    qualityFlags: TrizSolutionDraftSet['qualityFlags']
    insufficientMapping: boolean
    knowledgePackVersion: string
    path: TrizSolutionDraftSet['path']
    contradictionType: TrizSolutionDraftSet['contradictionType']
  }
  clarification: TrizCopilotClarificationState
  budget: TrizBudgetSnapshot
  modelUsage: TrizContradictionMappingResult['modelUsage']
  /** 人工确认关卡：本工具只产草案，落库必须经写工具的两阶段确认 */
  requiresHumanConfirmation: true
  /** 本次草案已写入本 change 自有分析表（低敏），业务表零写入 */
  analysisPersisted: true
}

export interface AnalyzeProjectContradictionDeps {
  analysisService?: TrizCopilotAnalysisService
}

let analysisServicePromise: Promise<TrizCopilotAnalysisService> | null = null
function resolveAnalysisService(): Promise<TrizCopilotAnalysisService> {
  analysisServicePromise ??= app.container.make(TrizCopilotAnalysisService)
  return analysisServicePromise
}

export function createAnalyzeProjectContradictionTool(
  deps?: AnalyzeProjectContradictionDeps,
): ToolDefinition<AnalyzeProjectContradictionParams, AnalyzeProjectContradictionResult> {
  return {
    name: ANALYZE_PROJECT_CONTRADICTION_TOOL_NAME,
    description:
      '受理 PM 的大白话矛盾陈述，完成 TRIZ 语义映射并给出 Top 3 破局方案（含来源原则、可执行动作要点与绑定的项目实体），同时把低敏映射草案落库为分析记录。只产草案，不写任何业务表；落库为任务/风险/变更请求必须另行调用对应的写工具并显式确认。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', minimum: 1, description: '目标项目 ID' },
        statement: {
          type: 'string',
          minLength: 1,
          maxLength: STATEMENT_MAX_CHARS,
          description: 'PM 用大白话陈述的矛盾（例如「客户催进度，但再加人测试就跟不上了」）',
        },
        asOfDate: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: '评估日（YYYY-MM-DD），默认今日；只影响读数口径',
        },
        parentAnalysisId: {
          type: 'integer',
          minimum: 1,
          description: '澄清链上一轮的分析记录 ID（第 3 轮澄清会被硬上限拒绝）',
        },
        sourceSignalId: {
          type: 'integer',
          minimum: 1,
          description: '来源被动雷达信号 ID（可选）',
        },
        forceRulePath: {
          type: 'boolean',
          default: false,
          description: '强制走确定性规则路径（零 Token、零模型调用）',
        },
      },
      required: ['projectId', 'statement'],
      additionalProperties: false,
    },
    requiredPermissions: [PROJECT_VIEW],
    sideEffect: 'read',
    handler: async (
      ctx: ToolExecutionContext,
      input: AnalyzeProjectContradictionParams,
    ): Promise<ToolExecutionResult<AnalyzeProjectContradictionResult>> => {
      const projectId = asPositiveInt(input.projectId, 'projectId')
      const statement = typeof input.statement === 'string' ? input.statement.trim() : ''
      if (statement.length === 0) {
        throw new ValidationException('statement 不能为空')
      }
      const asOfDate = asOptionalString(input.asOfDate, 'asOfDate')
      if (asOfDate && !DATE_PATTERN.test(asOfDate)) {
        throw new ValidationException('asOfDate 必须是 YYYY-MM-DD 格式')
      }
      const parentAnalysisId =
        input.parentAnalysisId === undefined || input.parentAnalysisId === null
          ? null
          : asPositiveInt(input.parentAnalysisId, 'parentAnalysisId')
      const sourceSignalId =
        input.sourceSignalId === undefined || input.sourceSignalId === null
          ? null
          : asPositiveInt(input.sourceSignalId, 'sourceSignalId')
      const forceRulePath =
        input.forceRulePath === undefined ? false : asBoolean(input.forceRulePath, 'forceRulePath')

      const service = deps?.analysisService ?? (await resolveAnalysisService())
      const result = await service.solve({
        organizationId: ctx.organizationId,
        projectId,
        user: ctx.user,
        statement,
        asOfDate,
        parentAnalysisId,
        sourceSignalId,
        forceRulePath,
        requestId: ctx.requestId ?? null,
      })

      return {
        status: 'SUCCESS',
        data: {
          projectId,
          analysis: result.analysis,
          mapping: result.mapping,
          solutions: result.solutions,
          solutionSet: {
            entityBinding: result.solutionSet.entityBinding,
            candidatePrincipleNumbers: [...result.solutionSet.candidatePrincipleNumbers],
            excludedPrincipleNumbers: [...result.solutionSet.excludedPrincipleNumbers],
            contextRefValidation: result.solutionSet.contextRefValidation,
            qualityFlags: [...result.solutionSet.qualityFlags],
            insufficientMapping: result.solutionSet.insufficientMapping,
            knowledgePackVersion: result.solutionSet.knowledgePackVersion,
            path: result.solutionSet.path,
            contradictionType: result.solutionSet.contradictionType,
          },
          clarification: result.clarification,
          budget: result.budget,
          modelUsage: result.modelUsage,
          requiresHumanConfirmation: true,
          analysisPersisted: true,
        },
      }
    },
  }
}
