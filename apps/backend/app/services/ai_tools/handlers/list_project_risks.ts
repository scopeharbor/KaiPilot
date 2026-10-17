// v3-ai-tools-orchestration-layer W2 —— 工具 `list_project_risks`
//
// 委托 RiskService.list 做风险登记册检索。注意：RiskService.list 自身不做项目
// 存在性断言（跨组织 projectId 会空返回而非 404），为恪守 RL-05（跨组织/不存在
// 统一 404，严禁泄露存在性），handler 先按 ProjectService.get 同构的
// TenantScope 组织级断言项目归属，再委托检索。只读，数据库零写入。
import { RISK_VIEW } from '#rbac'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import Project from '#models/project'
import RiskService, { type RiskListFilters } from '#services/risk_service'
import TenantScope from '#services/tenant_scope'
import app from '@adonisjs/core/services/app'
import { asPage, asPositiveInt, asOptionalString, asFiniteNumber } from './input_guards.js'
import { toBoundedRisk, type BoundedRiskItem } from './mappers.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const LIST_PROJECT_RISKS_TOOL_NAME = 'list_project_risks'

export interface ListProjectRisksParams {
  projectId: number
  category?: string
  status?: string
  ownerId?: number
  minScore?: number
  search?: string
  page?: number
  perPage?: number
}

export interface ListProjectRisksResult {
  items: BoundedRiskItem[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface ListProjectRisksDeps {
  riskService: RiskService
}

let riskServicePromise: Promise<RiskService> | null = null
function resolveRiskService(): Promise<RiskService> {
  riskServicePromise ??= app.container.make(RiskService)
  return riskServicePromise
}

export function createListProjectRisksTool(
  deps?: ListProjectRisksDeps,
): ToolDefinition<ListProjectRisksParams, ListProjectRisksResult> {
  return {
    name: LIST_PROJECT_RISKS_TOOL_NAME,
    description:
      '查询指定项目的风险登记条目：按类别、状态、负责人、评分下限（minScore）、关键词与分页过滤，返回风险等级、发生概率、影响度、评分与应对措施摘要。只读。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'integer', minimum: 1, description: '目标项目 ID' },
        category: { type: 'string', maxLength: 50 },
        status: { type: 'string', maxLength: 50 },
        ownerId: { type: 'integer', minimum: 1 },
        minScore: { type: 'number', minimum: 0, maximum: 25 },
        search: { type: 'string', maxLength: 100 },
        page: { type: 'integer', minimum: 1, default: 1 },
        perPage: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    requiredPermissions: [RISK_VIEW],
    sideEffect: 'read',
    handler: async (
      ctx: ToolExecutionContext,
      input: ListProjectRisksParams,
    ): Promise<ToolExecutionResult<ListProjectRisksResult>> => {
      const projectId = asPositiveInt(input.projectId, 'projectId')

      // RL-05：先做组织级项目存在性断言（跨组织一律 404），RiskService.list 不再兜底
      const project = await TenantScope.forOrganization(Project.query(), ctx.organizationId)
        .where('id', projectId)
        .whereNull('deleted_at')
        .first()
      if (!project) throw new ResourceNotFoundException('项目不存在')

      const page = asPage(input.page, 'page', 1, 1000)
      const perPage = asPage(input.perPage, 'perPage', 20, 100)

      const riskService = deps?.riskService ?? (await resolveRiskService())
      const { data, meta } = await riskService.list(ctx.organizationId, projectId, {
        category: asOptionalString(input.category, 'category') as RiskListFilters['category'],
        status: asOptionalString(input.status, 'status') as RiskListFilters['status'],
        ownerId: input.ownerId === undefined ? undefined : asPositiveInt(input.ownerId, 'ownerId'),
        minScore:
          input.minScore === undefined ? undefined : asFiniteNumber(input.minScore, 'minScore'),
        search: asOptionalString(input.search, 'search'),
        page,
        perPage,
      })

      return {
        status: 'SUCCESS',
        data: {
          items: data.map((risk) => toBoundedRisk(risk)),
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
