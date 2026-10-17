import DocumentInlineCommentService from '#services/document_inline_comment_service'
import DocumentInlineCommentPolicy from '#policies/document_inline_comment_policy'
import AuditService from '#services/audit_service'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import {
  createInlineCommentValidator,
  createReplyValidator,
  reanchorValidator,
  listInlineCommentsValidator,
} from '#validators/document_inline_comment_validator'

/**
 * 文档内联批注 Controller（v3-document-inline-comments §5.1）。
 *
 * 路由前缀：/api/v1/projects/:projectId/documents/:documentId/inline-comments
 */
@inject()
export default class DocumentInlineCommentsController {
  constructor(
    private service: DocumentInlineCommentService,
    private policy: DocumentInlineCommentPolicy,
    private audit: AuditService,
  ) {}

  /**
   * GET / — 列出文档的所有内联批注。
   */
  async index(ctx: HttpContext) {
    const { request, response, params, auth } = ctx
    const user = auth.user as User
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(params.projectId)
    const documentId = Number(params.documentId)

    try {
      await this.policy.assertView(user, organizationId, projectId)
    } catch (err) {
      await this.audit.log({
        event: 'DOCUMENT_INLINE_ANCHOR_PERMISSION_DENIED',
        userId: user.id,
        organizationId,
        projectId,
        entityType: 'document_comment_anchor',
        metadata: { documentId },
      })
      throw err
    }

    const query = await listInlineCommentsValidator.validate(request.qs())
    const result = await this.service.list(user, organizationId, projectId, documentId, query)

    return response.json(result)
  }

  /**
   * POST / — 创建内联批注。
   */
  async store(ctx: HttpContext) {
    const { request, response, params, auth } = ctx
    const user = auth.user as User
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(params.projectId)
    const documentId = Number(params.documentId)

    try {
      await this.policy.assertCreate(user, organizationId, projectId)
    } catch (err) {
      await this.audit.log({
        event: 'DOCUMENT_INLINE_ANCHOR_PERMISSION_DENIED',
        userId: user.id,
        organizationId,
        projectId,
        entityType: 'document_comment_anchor',
        metadata: { documentId },
      })
      throw err
    }

    const payload = await createInlineCommentValidator.validate(request.body())
    const result = await this.service.createAnchorThread(
      user,
      organizationId,
      projectId,
      documentId,
      {
        rangeStart: payload.rangeStart,
        rangeEnd: payload.rangeEnd,
        selectedQuote: payload.selectedQuote,
        documentVersion: payload.documentVersion,
        body: payload.body,
        bodyFormat: payload.bodyFormat,
        mentions: payload.mentions,
      },
      { requestId: request.id() },
    )

    return response.status(201).json({ data: result.detail })
  }

  /**
   * GET /:anchorId — 获取单条内联批注详情。
   */
  async show(ctx: HttpContext) {
    const { response, params, auth } = ctx
    const user = auth.user as User
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(params.projectId)
    const documentId = Number(params.documentId)
    const anchorId = Number(params.anchorId)

    try {
      await this.policy.assertView(user, organizationId, projectId)
    } catch (err) {
      await this.audit.log({
        event: 'DOCUMENT_INLINE_ANCHOR_PERMISSION_DENIED',
        userId: user.id,
        organizationId,
        projectId,
        entityType: 'document_comment_anchor',
        metadata: { documentId, anchorId },
      })
      throw err
    }

    const detail = await this.service.getDetail(
      user,
      organizationId,
      projectId,
      documentId,
      anchorId,
    )

    return response.json({ data: detail })
  }

  /**
   * POST /:anchorId/replies — 回复内联批注。
   */
  async reply(ctx: HttpContext) {
    const { request, response, params, auth } = ctx
    const user = auth.user as User
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(params.projectId)
    const documentId = Number(params.documentId)
    const anchorId = Number(params.anchorId)

    try {
      await this.policy.assertCreate(user, organizationId, projectId)
    } catch (err) {
      await this.audit.log({
        event: 'DOCUMENT_INLINE_ANCHOR_PERMISSION_DENIED',
        userId: user.id,
        organizationId,
        projectId,
        entityType: 'document_comment_anchor',
        metadata: { documentId, anchorId },
      })
      throw err
    }

    const payload = await createReplyValidator.validate(request.body())
    const detail = await this.service.createReply(
      user,
      organizationId,
      projectId,
      documentId,
      anchorId,
      {
        body: payload.body,
        bodyFormat: payload.bodyFormat,
        mentions: payload.mentions,
      },
      { requestId: request.id() },
    )

    return response.status(201).json({ data: detail })
  }

  /**
   * POST /:anchorId/resolve — 解决内联批注线程。
   */
  async resolve(ctx: HttpContext) {
    const { request, response, params, auth } = ctx
    const user = auth.user as User
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(params.projectId)
    const documentId = Number(params.documentId)
    const anchorId = Number(params.anchorId)

    const detail = await this.service.resolve(
      user,
      organizationId,
      projectId,
      documentId,
      anchorId,
      { requestId: request.id() },
    )

    return response.json({ data: detail })
  }

  /**
   * POST /:anchorId/reopen — 重开内联批注线程。
   */
  async reopen(ctx: HttpContext) {
    const { request, response, params, auth } = ctx
    const user = auth.user as User
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(params.projectId)
    const documentId = Number(params.documentId)
    const anchorId = Number(params.anchorId)

    const detail = await this.service.reopen(
      user,
      organizationId,
      projectId,
      documentId,
      anchorId,
      { requestId: request.id() },
    )

    return response.json({ data: detail })
  }

  /**
   * DELETE /:anchorId — 软删除内联批注。
   */
  async destroy(ctx: HttpContext) {
    const { request, response, params, auth } = ctx
    const user = auth.user as User
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(params.projectId)
    const documentId = Number(params.documentId)
    const anchorId = Number(params.anchorId)

    await this.service.softDelete(user, organizationId, projectId, documentId, anchorId, {
      requestId: request.id(),
    })

    return response.status(204).send('')
  }

  /**
   * PATCH /:anchorId/reanchor — 重设锚点。
   */
  async reanchor(ctx: HttpContext) {
    const { request, response, params, auth } = ctx
    const user = auth.user as User
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(params.projectId)
    const documentId = Number(params.documentId)
    const anchorId = Number(params.anchorId)

    try {
      await this.policy.assertReanchor(user, organizationId, projectId)
    } catch (err) {
      await this.audit.log({
        event: 'DOCUMENT_INLINE_ANCHOR_PERMISSION_DENIED',
        userId: user.id,
        organizationId,
        projectId,
        entityType: 'document_comment_anchor',
        metadata: { documentId, anchorId },
      })
      throw err
    }

    const payload = await reanchorValidator.validate(request.body())
    const detail = await this.service.reanchor(
      user,
      organizationId,
      projectId,
      documentId,
      anchorId,
      {
        rangeStart: payload.rangeStart,
        rangeEnd: payload.rangeEnd,
        selectedQuote: payload.selectedQuote,
        documentVersion: payload.documentVersion,
      },
      { requestId: request.id() },
    )

    return response.json({ data: detail })
  }
}
