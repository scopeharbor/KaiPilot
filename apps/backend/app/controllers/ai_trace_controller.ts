/**
 * v3-ai-request-tracing —— AI 追踪只读查询控制器。
 *
 * 端点：
 * - GET /api/v1/ai/traces/:traceId — 按 trace_id 查询 span 树
 * - GET /api/v1/ai/traces/sessions/:conversationId — 按会话聚合
 * - GET /api/v1/ai/traces/workflows/:workflowName — 按编排聚合
 * - GET /api/v1/ai/traces/orphans — 查询孤儿 span
 *
 * 组织隔离：从认证上下文提取 organizationId。
 * 低敏：只返回 ID、类型、时间、状态、错误分类与引用。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { PermissionDeniedException } from '#exceptions/api_exception'
import { TraceQueryService } from '#services/ai_tracing/trace_query_service'

const traceQueryService = new TraceQueryService()

export default class AiTraceController {
  /**
   * 当前组织取自请求级租户上下文。
   *
   * 原实现读 `auth.user.organizationId`——`User` 模型没有该字段，取值恒为 undefined，
   * 于是所有 trace 查询都在没有组织过滤的情况下执行。组织是请求级上下文（一个用户可属多个组织），
   * 唯一合法来源是 tenant 中间件（与 `ai_connections_controller.orgIdOf` 同一范式）。
   */
  private orgIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  /**
   * 按 trace_id 查询 span 树（含关键路径）。
   * GET /api/v1/ai/traces/:traceId
   */
  async show(ctx: HttpContext) {
    const { params, response } = ctx
    const organizationId = this.orgIdOf(ctx)

    const { traceId } = params
    if (!traceId || typeof traceId !== 'string') {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'traceId 无效' },
      })
    }

    const result = await traceQueryService.queryTraceTree(organizationId, traceId)
    if (!result) {
      return response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: 'trace 不存在' },
      })
    }

    return response.ok({ data: result })
  }

  /**
   * 按会话维度聚合。
   * GET /api/v1/ai/traces/sessions/:conversationId
   */
  async sessionAggregation(ctx: HttpContext) {
    const { params, request, response } = ctx
    const organizationId = this.orgIdOf(ctx)

    const { conversationId } = params
    if (!conversationId || typeof conversationId !== 'string') {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'conversationId 无效' },
      })
    }

    const windowStart = request.input('windowStart') as string | undefined
    const windowEnd = request.input('windowEnd') as string | undefined

    const result = await traceQueryService.aggregateBySession(
      organizationId,
      conversationId,
      windowStart,
      windowEnd,
    )

    return response.ok({ data: result })
  }

  /**
   * 按编排维度聚合。
   * GET /api/v1/ai/traces/workflows/:workflowName
   */
  async workflowAggregation(ctx: HttpContext) {
    const { params, request, response } = ctx
    const organizationId = this.orgIdOf(ctx)

    const { workflowName } = params
    if (!workflowName || typeof workflowName !== 'string') {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'workflowName 无效' },
      })
    }

    const windowStart = request.input('windowStart') as string | undefined
    const windowEnd = request.input('windowEnd') as string | undefined

    const result = await traceQueryService.aggregateByWorkflow(
      organizationId,
      workflowName,
      windowStart,
      windowEnd,
    )

    return response.ok({ data: result })
  }

  /**
   * 查询孤儿 span。
   * GET /api/v1/ai/traces/orphans?traceId=xxx
   */
  async orphans(ctx: HttpContext) {
    const { request, response } = ctx
    const organizationId = this.orgIdOf(ctx)

    const traceId = request.input('traceId') as string | undefined

    const result = await traceQueryService.queryOrphanSpans(organizationId, traceId)

    return response.ok({ data: result })
  }
}
