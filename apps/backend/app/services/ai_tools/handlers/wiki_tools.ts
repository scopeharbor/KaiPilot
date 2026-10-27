// v3-llm-wiki-query-navigation —— AI 同事只读维基工具：`wiki_index` / `wiki_read` / `wiki_search`
//
// 委托 WikiQueryService（只读已存在且可读的空间；只给已发布版本；读时遮蔽；待审提议永不返回）。
// 维基业务错误转换为 ApiException（保留 code 与 status；404 不泄露存在性）。
import app from '@adonisjs/core/services/app'
import ApiException, { ValidationException } from '#exceptions/api_exception'
import { WIKI_VIEW } from '#rbac'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '#services/ai_tools/registry'
import { WikiError } from '#services/wiki_memory/errors'
import WikiQueryService from '#services/wiki_memory/query/wiki_query_service'
import type { WikiQueryIndexDto, WikiQueryReadDto, WikiQuerySearchDto } from '@aiproj/types'
import { asOptionalString, asPositiveInt } from './input_guards.js'

export const WIKI_INDEX_TOOL_NAME = 'wiki_index'
export const WIKI_READ_TOOL_NAME = 'wiki_read'
export const WIKI_SEARCH_TOOL_NAME = 'wiki_search'

export interface WikiToolDeps {
  queryService: WikiQueryService
}

let queryServicePromise: Promise<WikiQueryService> | null = null
function resolveQueryService(deps?: WikiToolDeps): Promise<WikiQueryService> {
  if (deps) return Promise.resolve(deps.queryService)
  queryServicePromise ??= app.container.make(WikiQueryService)
  return queryServicePromise
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof WikiError)
      throw new ApiException(error.message, { status: error.httpStatus, code: error.code })
    throw error
  }
}

function optionalProjectId(value: unknown): number | null {
  return value === undefined || value === null ? null : asPositiveInt(value, 'projectId')
}

const projectIdProperty = {
  type: 'integer',
  minimum: 1,
  description: '当前项目 ID（给出时先看该项目的维基，再看部门与组织维基）',
}

export function createWikiIndexTool(
  deps?: WikiToolDeps,
): ToolDefinition<{ projectId?: number }, WikiQueryIndexDto> {
  return {
    name: WIKI_INDEX_TOOL_NAME,
    description:
      '查看记忆维基目录：项目、部门、组织维基里已发布的页面（每页一行摘要）。用来找本组织的经验、教训、决策与规矩。只读。',
    parametersJsonSchema: {
      type: 'object',
      properties: { projectId: projectIdProperty },
      additionalProperties: false,
    },
    requiredPermissions: [WIKI_VIEW],
    sideEffect: 'read',
    handler: async (
      ctx: ToolExecutionContext,
      input: { projectId?: number },
    ): Promise<ToolExecutionResult<WikiQueryIndexDto>> => {
      const projectId = optionalProjectId(input.projectId)
      const service = await resolveQueryService(deps)
      const data = await guarded(() =>
        service.index({ user: ctx.user, organizationId: ctx.organizationId }, projectId),
      )
      return { status: 'SUCCESS', data }
    },
  }
}

export function createWikiReadTool(
  deps?: WikiToolDeps,
): ToolDefinition<{ pageId: number; section?: string }, WikiQueryReadDto> {
  return {
    name: WIKI_READ_TOOL_NAME,
    description:
      '读取一页记忆维基的已发布版本（可只读某个小标题下的一节）；每条主张带来源，可再用任务/风险等工具核对实时数据。只读。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        pageId: {
          type: 'integer',
          minimum: 1,
          description: '页面 ID（来自 wiki_index 或 wiki_search）',
        },
        section: { type: 'string', maxLength: 60, description: '可选：只读这个小标题下的内容' },
      },
      required: ['pageId'],
      additionalProperties: false,
    },
    requiredPermissions: [WIKI_VIEW],
    sideEffect: 'read',
    handler: async (
      ctx: ToolExecutionContext,
      input: { pageId: number; section?: string },
    ): Promise<ToolExecutionResult<WikiQueryReadDto>> => {
      const pageId = asPositiveInt(input.pageId, 'pageId')
      const section = asOptionalString(input.section, 'section') ?? null
      const service = await resolveQueryService(deps)
      const data = await guarded(() =>
        service.readPage({ user: ctx.user, organizationId: ctx.organizationId }, pageId, section),
      )
      return { status: 'SUCCESS', data }
    },
  }
}

export function createWikiSearchTool(
  deps?: WikiToolDeps,
): ToolDefinition<{ keyword: string; projectId?: number }, WikiQuerySearchDto> {
  return {
    name: WIKI_SEARCH_TOOL_NAME,
    description: '在记忆维基的标题、小标题与摘要中检索（目录太长或找不到时的兜底）。只读。',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', minLength: 1, maxLength: 60, description: '关键词' },
        projectId: projectIdProperty,
      },
      required: ['keyword'],
      additionalProperties: false,
    },
    requiredPermissions: [WIKI_VIEW],
    sideEffect: 'read',
    handler: async (
      ctx: ToolExecutionContext,
      input: { keyword: string; projectId?: number },
    ): Promise<ToolExecutionResult<WikiQuerySearchDto>> => {
      const keyword = asOptionalString(input.keyword, 'keyword')
      if (!keyword || keyword.length > 60) throw new ValidationException('keyword 必须是 1–60 字')
      const projectId = optionalProjectId(input.projectId)
      const service = await resolveQueryService(deps)
      const data = await guarded(() =>
        service.search({ user: ctx.user, organizationId: ctx.organizationId }, keyword, projectId),
      )
      return { status: 'SUCCESS', data }
    },
  }
}
