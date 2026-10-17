/**
 * v3-copilot-session-persistence-and-history —— 会话控制器（§8.1）。
 *
 * `/api/v1/copilot-sessions` 端点：
 * - POST / — 创建会话
 * - GET / — 列出会话
 * - GET /:sessionId — 会话详情
 * - GET /:sessionId/messages — 消息分页
 * - PATCH /:sessionId/rename — 重命名
 * - POST /:sessionId/archive — 归档
 * - DELETE /:sessionId — 删除
 * - GET /:sessionId/export — 导出
 * - POST /:sessionId/resume — 续接
 *
 * 挂 auth 中间件、Policy、validator、分页、稳定排序与统一 envelope。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { PermissionDeniedException } from '#exceptions/api_exception'
import { copilotSessionService } from '../services/copilot_session/index.js'

export default class CopilotSessionController {
  /**
   * 当前组织取自请求级租户上下文。
   *
   * 原实现读 `auth.user!.organizationId`——`User` 模型没有该字段，取值恒为 undefined，
   * 会话列表/详情/导出因此可能在没有组织过滤的情况下执行。组织是请求级上下文，
   * 唯一合法来源是 tenant 中间件（与 `ai_connections_controller.orgIdOf` 同一范式）。
   */
  private orgIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  /**
   * POST / — 创建会话
   */
  async store(ctx: HttpContext) {
    const { request, response } = ctx
    const organizationId = this.orgIdOf(ctx)
    try {
      const body = request.only(['scope', 'attribution', 'title', 'idempotencyKey'])

      const session = await copilotSessionService.createSession({
        organizationId,
        scope: body.scope ?? 'project',
        attribution: body.attribution ?? {},
        actorId: ctx.auth.getUserOrFail().id,
        title: body.title,
        idempotencyKey: body.idempotencyKey,
      })

      return response.created({
        data: {
          id: session.id,
          sessionId: session.sessionId,
          scope: session.scope,
          attribution: session.attribution,
          status: session.status,
          title: session.title,
          archived: session.archived,
          actorId: session.actorId,
          createdAt: session.createdAt.toISO(),
          updatedAt: session.updatedAt?.toISO(),
        },
      })
    } catch (error: any) {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: error.message },
      })
    }
  }

  /**
   * GET / — 列出会话
   */
  async index(ctx: HttpContext) {
    const { request, response } = ctx
    const organizationId = this.orgIdOf(ctx)
    const page = Number(request.input('page', 1))
    const perPage = Number(request.input('perPage', 20))
    const scope = request.input('scope')
    const status = request.input('status')
    const includeArchived = request.input('includeArchived', false)
    const sortField = request.input('sortField', 'updatedAt')
    const sortOrder = request.input('sortOrder', 'desc')

    const result = await copilotSessionService.listSessions({
      organizationId,
      actorId: ctx.auth.getUserOrFail().id,
      scope,
      status,
      includeArchived,
      page,
      perPage,
      sortField,
      sortOrder,
    })

    return response.ok({
      data: result.data.map((s) => ({
        id: s.id,
        sessionId: s.sessionId,
        scope: s.scope,
        attribution: s.attribution,
        status: s.status,
        title: s.title,
        archived: s.archived,
        actorId: s.actorId,
        createdAt: s.createdAt.toISO(),
        updatedAt: s.updatedAt?.toISO(),
      })),
      meta: result.meta,
    })
  }

  /**
   * GET /:sessionId — 会话详情
   */
  async show(ctx: HttpContext) {
    const { params, response } = ctx
    const organizationId = this.orgIdOf(ctx)
    const result = await copilotSessionService.listSessions({
      organizationId,
      actorId: ctx.auth.getUserOrFail().id,
    })
    const session = result.data.find((s) => s.sessionId === params.sessionId)
    if (!session) {
      return response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '会话不存在' },
      })
    }
    return response.ok({
      data: {
        id: session.id,
        sessionId: session.sessionId,
        scope: session.scope,
        attribution: session.attribution,
        status: session.status,
        title: session.title,
        archived: session.archived,
        actorId: session.actorId,
        createdAt: session.createdAt.toISO(),
        updatedAt: session.updatedAt?.toISO(),
      },
    })
  }

  /**
   * GET /:sessionId/messages — 消息分页
   */
  async messages(ctx: HttpContext) {
    const { params, request, response } = ctx
    const organizationId = this.orgIdOf(ctx)
    const page = Number(request.input('page', 1))
    const perPage = Number(request.input('perPage', 50))

    const result = await copilotSessionService.listMessages(
      organizationId,
      ctx.auth.getUserOrFail().id,
      params.sessionId,
      page,
      perPage,
    )

    if (!result) {
      return response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '会话不存在' },
      })
    }

    return response.ok({
      data: result.data.map((m) => ({
        id: m.id,
        messageId: m.messageId,
        sessionId: m.sessionId,
        role: m.role,
        contentSummary: m.contentSummary,
        truncated: m.truncated,
        sourceRefs: m.sourceRefs,
        routeDecisionId: m.routeDecisionId,
        actionId: m.actionId,
        warningCodes: m.warningCodes,
        degradedReason: m.degradedReason,
        costLedgerRef: m.costLedgerRef,
        sequence: m.sequence,
        createdAt: m.createdAt.toISO(),
      })),
      meta: result.meta,
    })
  }

  /**
   * PATCH /:sessionId/rename — 重命名
   */
  async rename(ctx: HttpContext) {
    const { params, request, response } = ctx
    const organizationId = this.orgIdOf(ctx)
    const { title } = request.only(['title'])
    if (!title || typeof title !== 'string') {
      return response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'title 必填' },
      })
    }

    const session = await copilotSessionService.renameSession(
      organizationId,
      ctx.auth.getUserOrFail().id,
      params.sessionId,
      title,
    )

    if (!session) {
      return response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '会话不存在' },
      })
    }

    return response.ok({
      data: {
        id: session.id,
        sessionId: session.sessionId,
        title: session.title,
        updatedAt: session.updatedAt?.toISO(),
      },
    })
  }

  /**
   * POST /:sessionId/archive — 归档
   */
  async archive(ctx: HttpContext) {
    const { params, response } = ctx
    const organizationId = this.orgIdOf(ctx)
    const session = await copilotSessionService.archiveSession(
      organizationId,
      ctx.auth.getUserOrFail().id,
      params.sessionId,
    )

    if (!session) {
      return response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '会话不存在' },
      })
    }

    return response.ok({
      data: {
        id: session.id,
        sessionId: session.sessionId,
        status: session.status,
        archived: session.archived,
      },
    })
  }

  /**
   * DELETE /:sessionId — 删除
   */
  async destroy(ctx: HttpContext) {
    const { params, response } = ctx
    const organizationId = this.orgIdOf(ctx)
    const result = await copilotSessionService.deleteSession(
      organizationId,
      ctx.auth.getUserOrFail().id,
      params.sessionId,
    )

    if (!result.deleted) {
      return response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '会话不存在' },
      })
    }

    return response.ok({ data: { deleted: true } })
  }

  /**
   * GET /:sessionId/export — 导出
   */
  async export(ctx: HttpContext) {
    const { params, response } = ctx
    const organizationId = this.orgIdOf(ctx)
    const result = await copilotSessionService.exportSession(
      organizationId,
      ctx.auth.getUserOrFail().id,
      params.sessionId,
    )

    if (!result) {
      return response.notFound({
        error: { code: 'RESOURCE_NOT_FOUND', message: '会话不存在' },
      })
    }

    if (!result.valid) {
      return response.internalServerError({
        error: {
          code: 'EXPORT_VALIDATION_FAILED',
          message: '导出载荷包含禁止内容',
          details: result.violations,
        },
      })
    }

    return response.ok({ data: result.payload })
  }

  /**
   * POST /:sessionId/resume — 续接
   */
  async resume(ctx: HttpContext) {
    const { params, request, response } = ctx
    const organizationId = this.orgIdOf(ctx)
    const { lastSequence, lastSseEventId } = request.only(['lastSequence', 'lastSseEventId'])

    const result = await copilotSessionService.resumeSession({
      organizationId,
      actorId: ctx.auth.getUserOrFail().id,
      sessionId: params.sessionId,
      lastSequence: Number(lastSequence ?? 0),
      lastSseEventId,
    })

    return response.ok({ data: result })
  }
}
