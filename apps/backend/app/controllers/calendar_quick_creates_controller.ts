/**
 * 日历快速新建的 AI 补全端点（日历第 2 批）。
 *
 * `POST /api/v1/projects/:projectId/tasks/calendar-suggest`
 * - 默认：模型补全（名称、起止、负责人与理由、工作包、优先级；一句话拆多条；空输入给建议）；
 *   模型不可用时退回规则补全，响应 `source` 标明来源；
 * - `ai: false`：只要规则补全（双击后秒出卡片）；
 * - `check`：用户改过卡片后只重算冲突。
 *
 * 只返回建议、不落库；建任务仍走 `POST /projects/:projectId/tasks`（用户按 Enter / 建立确认，记审计）。
 * 权限同建任务（task:create，路由级 RBAC 注册）。
 */
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import { resolveAdapter } from '#services/ai_m0/resolver'
import {
  loadQuickCreateContext,
  quickCreateOptions,
  quickCreateConflicts,
  ruleQuickCreate,
  suggestQuickCreateWithAi,
} from '#services/calendar/calendar_quick_create_service'
import { calendarQuickCreateValidator } from '#validators/calendar_quick_create'

export default class CalendarQuickCreatesController {
  async store(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const input = await ctx.request.validateUsing(calendarQuickCreateValidator)
    const now = new Date()

    const context = await loadQuickCreateContext({
      organizationId,
      projectId,
      userId: user.id,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      now,
    })

    if (input.check) {
      return ctx.response.ok({
        data: { conflicts: input.check.map((task) => quickCreateConflicts(task, context)) },
      })
    }

    const text = input.text ?? ''
    const options = quickCreateOptions(context)
    if (input.ai === false) {
      return ctx.response.ok({ data: { ...ruleQuickCreate(context, text), options } })
    }

    let note = 'AI 这次没能补全，先按规则填好了，可以直接改'
    try {
      const resolved = await resolveAdapter({
        connectionId: input.connectionId,
        modelId: input.modelId,
        organizationId,
        requiredCapabilities: ['chat'],
        recordContext: {
          organizationId,
          userId: user.id,
          connectionId: input.connectionId ?? null,
          modelId: input.modelId ?? null,
          capability: 'chat',
          surface: 'calendar-quick-create',
          workflowName: 'calendar-quick-create',
        },
      })
      // 没配模型时解析器给的是联调用 Mock（不可用于判定）→ 视同模型不可用，走规则补全
      const result =
        resolved.source === 'mock'
          ? null
          : await suggestQuickCreateWithAi({ gateway: resolved.gateway, context, text, now })
      if (result) return ctx.response.ok({ data: { ...result, options } })
      if (resolved.source === 'mock') note = '还没配置 AI 模型，先按规则填好了，可以直接改'
    } catch (error) {
      ctx.logger.warn({ err: error }, '日历快速新建 AI 补全失败，改用规则补全')
    }
    const fallback = ruleQuickCreate(context, text)
    return ctx.response.ok({
      data: { ...fallback, note, options },
    })
  }
}
