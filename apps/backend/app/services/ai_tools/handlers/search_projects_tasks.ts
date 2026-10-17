// v3-ai-tools-orchestration-layer W2 —— 工具 `search_projects_tasks`
//
// 委托 SearchService.search 做组织内全局检索：实体限定 project/task；
// 通过 SearchPolicy.getAllowedProjectIds 计算调用者在当前组织内可见的项目范围
// （任务适配器按 projectIds 过滤，必须注入组织范围，否则跨租户数据会泄漏，RL-05）。
import { PROJECT_VIEW, TASK_VIEW } from '#rbac'
import { ValidationException } from '#exceptions/api_exception'
import SearchService from '#services/search_service'
import SearchPolicy from '#policies/search_policy'
import type { SearchResultItem, SearchResultMeta } from '@aiproj/types'
import app from '@adonisjs/core/services/app'
import { asPage } from './input_guards.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'

export const SEARCH_PROJECTS_TASKS_TOOL_NAME = 'search_projects_tasks'

const SEARCH_ENTITY_TYPES = ['project', 'task'] as const

export interface SearchProjectsTasksParams {
  keyword: string
  page?: number
  perPage?: number
}

export interface SearchProjectsTasksResult {
  items: SearchResultItem[]
  meta: SearchResultMeta
}

export interface SearchProjectsTasksDeps {
  searchService: SearchService
  searchPolicy: SearchPolicy
}

let depsPromise: Promise<SearchProjectsTasksDeps> | null = null
function resolveDeps(): Promise<SearchProjectsTasksDeps> {
  depsPromise ??= (async () => ({
    searchService: await app.container.make(SearchService),
    searchPolicy: await app.container.make(SearchPolicy),
  }))()
  return depsPromise
}

export function createSearchProjectsTasksTool(
  deps?: SearchProjectsTasksDeps,
): ToolDefinition<SearchProjectsTasksParams, SearchProjectsTasksResult> {
  return {
    name: SEARCH_PROJECTS_TASKS_TOOL_NAME,
    description:
      '在当前用户所在组织内按关键词搜索项目与任务，返回带相关性评分的排序结果；严格限定在当前组织的可见项目范围内，绝不返回其他组织的数据。只读。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', minLength: 1, maxLength: 100, description: '搜索关键词' },
        page: { type: 'integer', minimum: 1, default: 1 },
        perPage: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
      required: ['keyword'],
      additionalProperties: false,
    },
    requiredPermissions: [PROJECT_VIEW, TASK_VIEW],
    sideEffect: 'read',
    handler: async (
      ctx: ToolExecutionContext,
      input: SearchProjectsTasksParams,
    ): Promise<ToolExecutionResult<SearchProjectsTasksResult>> => {
      const keyword = String(input.keyword ?? '').trim()
      if (!keyword) throw new ValidationException('keyword 不能为空')
      if (keyword.length > 100) throw new ValidationException('keyword 超出长度上限')
      const page = asPage(input.page, 'page', 1, 1000)
      const perPage = asPage(input.perPage, 'perPage', 20, 50)

      const services = deps ?? (await resolveDeps())

      // 组织可见项目范围（任务适配器按 projectIds 过滤；project 适配器按 organization_id 过滤）
      const allowedProjectIds = await services.searchPolicy.getAllowedProjectIds(
        ctx.user,
        ctx.organizationId,
      )

      const result = await services.searchService.search(
        {
          keyword,
          entityTypes: [...SEARCH_ENTITY_TYPES],
          page,
          perPage,
        },
        ctx.organizationId,
        ctx.user.id,
        allowedProjectIds,
      )

      return {
        status: 'SUCCESS',
        data: { items: result.data, meta: result.meta },
      }
    },
  }
}
