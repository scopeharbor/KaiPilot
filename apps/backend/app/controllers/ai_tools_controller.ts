// apps/backend — v3-ai-tools-orchestration-layer —— AI 工具编排层控制器（W1）。
//
// 五层职责：本控制器只做 HTTP 解析与响应格式化，业务编排全部委托
// `AiToolsExecutorService`；权限判定在 `AiToolsPolicy`；入参校验在
// `ai_tools_validator.ts`（信封层 VineJS + 工具层 JSON Schema 二次校验）。
//
// 端点（auth 中间件统一收敛身份认证）：
// - GET  /api/v1/ai/tools      → 只读工具清单（注册表元数据投影）
// - POST /api/v1/ai/tools/execute → 统一执行入口（read/navigate 直执行，write 预览拦截）
// - POST /api/v1/ai/tools/confirm → 写工具两阶段人工确认（单事务落库）
// - POST /api/v1/ai/tools/plan    → AI 同事：一句话 → 操作建议序列（零写入，逐条仍走 execute/confirm）
// - POST /api/v1/ai/tools/page-vision     → AI 同事：页面截图 → 看图模型的文字描述（零写入）
// - POST /api/v1/ai/tools/suggest-replies → AI 同事：输入框按 Tab 采用的预填建议（零写入）
// - POST /api/v1/ai/tools/theater-answer → AI 同事：全自动一键生成时由模型审阅追问与全部选项后代答（零写入）

import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { sanitizeColleagueAppMap, sanitizeColleagueUiPreferences } from '@aiproj/types'
import type User from '#models/user'
import AiColleagueActionPlannerService from '#services/ai_colleague/action_planner_service'
import AiColleagueAssistService from '#services/ai_colleague/assist_service'
import MemberDirectoryService from '#services/ai_colleague/member_directory_service'
import SearchPolicy from '#policies/search_policy'
import AiToolsExecutorService from '#services/ai_tools/ai_tools_executor_service'
import { AiToolsRegistry } from '#services/ai_tools/registry'
import WikiQueryService from '#services/wiki_memory/query/wiki_query_service'
import {
  aiColleagueMemberNamesValidator,
  aiColleaguePageVisionValidator,
  aiColleaguePlanValidator,
  aiColleagueSuggestValidator,
  aiColleagueTheaterAnswerValidator,
  aiToolsConfirmValidator,
  aiToolsExecuteValidator,
} from '#validators/ai_tools_validator'

@inject()
export default class AiToolsController {
  constructor(
    private executor: AiToolsExecutorService,
    private planner: AiColleagueActionPlannerService,
    private searchPolicy: SearchPolicy,
    private assist: AiColleagueAssistService,
    private wikiQuery: WikiQueryService,
  ) {}

  async index(ctx: HttpContext) {
    const tools = AiToolsRegistry.getInstance().getAllMetadata()
    return ctx.response.ok({ data: tools, meta: { total: tools.length } })
  }

  async execute(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(aiToolsExecuteValidator)
    const user = ctx.auth.getUserOrFail() as User
    const outcome = await this.executor.execute({
      toolName: input.toolName,
      parameters: input.parameters,
      user,
      organizationId: ctx.tenant!.organizationId,
      requestId: ctx.request.id() ?? null,
    })
    return ctx.response.ok({
      data: outcome.data,
      meta: {
        toolName: outcome.meta.toolName,
        status: outcome.meta.status,
        durationMs: outcome.meta.durationMs,
        ...(outcome.previewToken !== undefined ? { previewToken: outcome.previewToken } : {}),
        ...(outcome.diff !== undefined ? { diff: outcome.diff } : {}),
      },
    })
  }

  async confirm(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(aiToolsConfirmValidator)
    const user = ctx.auth.getUserOrFail() as User
    const outcome = await this.executor.confirm({
      toolName: input.toolName,
      previewToken: input.previewToken,
      parameters: input.parameters,
      user,
      organizationId: ctx.tenant!.organizationId,
      requestId: ctx.request.id() ?? null,
    })
    return ctx.response.ok({ data: outcome.data, meta: outcome.meta })
  }

  async plan(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(aiColleaguePlanValidator)
    const user = ctx.auth.getUserOrFail() as User
    const plan = await this.planner.plan({
      user,
      organizationId: ctx.tenant!.organizationId,
      projectId: input.projectId ?? null,
      text: input.text,
      appDestinations: sanitizeColleagueAppMap(input.appDestinations),
      uiPreferences: sanitizeColleagueUiPreferences(input.uiPreferences),
      selectedTaskId: input.selectedTaskId ?? null,
      recentTaskIds: input.recentTaskIds ?? [],
      modelPreference: input.modelPreference ?? null,
      conversation: input.conversation ?? [],
      observations: input.observations ?? [],
      iteration: input.iteration,
      page: input.page ?? null,
      // 记忆维基：组织已开启且有 wiki:view 时才把查阅动作交给模型（规划器本身不读维基）
      wikiAvailable: await this.wikiQuery.isAvailable({
        user,
        organizationId: ctx.tenant!.organizationId,
      }),
    })
    return ctx.response.ok({ data: plan })
  }

  /** 成员代号编码 → 姓名（只给界面展示；只解析同在已授权项目里的成员）。 */
  async memberNames(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(aiColleagueMemberNamesValidator)
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId
    const allowed = await this.searchPolicy.getAllowedProjectIds(user, organizationId)
    const names = await new MemberDirectoryService().resolveNames(
      organizationId,
      allowed,
      input.codes,
    )
    return ctx.response.ok({ data: names })
  }

  /** 页面截图 → 看图模型的文字描述（「看一眼当前页面」）。 */
  async pageVision(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(aiColleaguePageVisionValidator)
    const user = ctx.auth.getUserOrFail() as User
    const data = await this.assist.describePage({
      user,
      organizationId: ctx.tenant!.organizationId,
      imageDataUrl: input.imageDataUrl,
      question: input.question ?? null,
      connectionId: input.connectionId ?? null,
      modelId: input.modelId ?? null,
    })
    return ctx.response.ok({ data })
  }

  /** 输入框预填建议（按 Tab 采用）。 */
  async suggestReplies(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(aiColleagueSuggestValidator)
    const user = ctx.auth.getUserOrFail() as User
    const data = await this.assist.suggestReplies({
      user,
      organizationId: ctx.tenant!.organizationId,
      conversation: input.conversation,
      question: input.question ?? null,
      options: input.options ?? [],
      draft: input.draft ?? null,
      connectionId: input.connectionId ?? null,
      modelId: input.modelId ?? null,
    })
    return ctx.response.ok({ data })
  }

  /** 全自动代答剧场追问（模型审阅题目与全部选项；没有可用的真实模型时 data=null，由前端兜底）。 */
  async theaterAnswer(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(aiColleagueTheaterAnswerValidator)
    const user = ctx.auth.getUserOrFail() as User
    const scalar = (value: unknown): string | number | string[] | null =>
      typeof value === 'string' || typeof value === 'number'
        ? value
        : Array.isArray(value)
          ? value.map(String)
          : null
    const data = await this.assist.chooseTheaterAnswer({
      user,
      organizationId: ctx.tenant!.organizationId,
      projectInput: input.projectInput,
      previousAnswers: input.previousAnswers ?? [],
      question: {
        ...input.question,
        options: input.question.options
          .filter((option) => typeof option.value === 'string' || typeof option.value === 'number')
          .map((option) => ({ ...option, value: option.value as string | number })),
        defaultValue: scalar(input.question.defaultValue),
        suggestedValue: scalar(input.question.suggestedValue),
      },
      connectionId: input.connectionId ?? null,
      modelId: input.modelId ?? null,
    })
    return ctx.response.ok({ data })
  }
}
