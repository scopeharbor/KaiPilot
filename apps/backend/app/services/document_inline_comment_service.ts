import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import type User from '#models/user'
import Document from '#models/document'
import DocumentCommentAnchor from '#models/document_comment_anchor'
import Comment from '#models/comment'
import CommentService from '#services/comment_service'
import AuditService from '#services/audit_service'
import type { AuditEventType } from '#services/audit_service'
import DocumentInlineCommentPolicy from '#policies/document_inline_comment_policy'
import * as Contracts from '@aiproj/types'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'

/**
 * 文档内联批注服务。
 * 编排 document anchor, comment 和 stale detection。
 */
@inject()
export default class DocumentInlineCommentService {
  constructor(
    private commentService: CommentService,
    private audit: AuditService,
    private policy: DocumentInlineCommentPolicy,
  ) {}

  // ─── 内部辅助 ─────────────────────────────────────────────────

  /** 解析并验证文档 */
  private async resolveDocument(
    user: User,
    organizationId: number,
    projectId: number,
    documentId: number,
  ): Promise<Document> {
    const doc = await Document.query()
      .where('id', documentId)
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .first()

    if (!doc) {
      throw new ResourceNotFoundException('文档不存在')
    }

    // 验证文档类型
    const supportedTypes = Contracts.SUPPORTED_INLINE_COMMENT_DOCUMENT_TYPES as readonly string[]
    if (!supportedTypes.includes(doc.documentType)) {
      throw new ValidationException('此文档类型不支持内联批注')
    }

    // 每次调用前验证权限
    await this.policy.assertView(user, organizationId, projectId)

    return doc
  }

  /** 计算当前 content hash（从文档内容）。 */
  private currentContentHash(doc: Document): string {
    const content = doc.content ?? ''
    return Contracts.computeDocumentContentHash(content)
  }

  /** 获取文档内容。 */
  private getContent(doc: Document): string {
    return doc.content ?? ''
  }

  // ─── Anchor 创建 ─────────────────────────────────────────────────

  /**
   * 创建内联批注（anchor + root comment）。
   */
  async createAnchorThread(
    user: User,
    organizationId: number,
    projectId: number,
    documentId: number,
    input: {
      rangeStart: number
      rangeEnd: number
      selectedQuote: string
      documentVersion: string
      body: string
      bodyFormat?: 'plain' | 'markdown'
      mentions?: number[]
    },
    ctx: { requestId?: string | null } = {},
  ): Promise<{
    anchor: DocumentCommentAnchor
    detail: Contracts.DocumentInlineCommentDetail
  }> {
    const doc = await this.resolveDocument(user, organizationId, projectId, documentId)

    // 权限检查
    await this.policy.assertCreate(user, organizationId, projectId)

    // 验证范围
    const content = this.getContent(doc)
    const rangeValid = Contracts.validateDocumentRange(
      input.rangeStart,
      input.rangeEnd,
      content.length,
    )
    if (!rangeValid.valid) {
      throw new ValidationException(rangeValid.error)
    }

    const quoteValid = Contracts.validateQuoteLength(input.selectedQuote)
    if (!quoteValid.valid) {
      throw new ValidationException(quoteValid.error)
    }

    const { start, end } = Contracts.normalizeRange(input.rangeStart, input.rangeEnd)
    const contentHash = this.currentContentHash(doc)
    const prefixHash = Contracts.computeSnippetHash(content, 'prefix')
    const suffixHash = Contracts.computeSnippetHash(content, 'suffix')
    const headingPath = Contracts.extractHeadingPath(content, start)

    // 短事务：创建 root comment + anchor
    const trx = await db.transaction()

    try {
      // 通过 CommentService 创建 root comment，entityType='document'
      const rootComment = await this.commentService.create(
        organizationId,
        projectId,
        'document',
        documentId,
        {
          body: input.body,
          bodyFormat: input.bodyFormat ?? 'plain',
          mentions: input.mentions,
        },
        user.id,
        { requestId: ctx.requestId ?? null },
      )

      const anchor = await DocumentCommentAnchor.create(
        {
          organizationId,
          projectId,
          documentId,
          rootCommentId: rootComment.id,
          documentVersion: input.documentVersion,
          contentHash,
          rangeStart: start,
          rangeEnd: end,
          selectedQuote: input.selectedQuote,
          prefixHash,
          suffixHash,
          headingPath,
          staleStatus: 'fresh',
          staleReason: null,
          isHidden: false,
          createdBy: user.id,
        },
        { client: trx },
      )

      await trx.commit()

      // 审计
      await this.audit.log({
        event: 'DOCUMENT_INLINE_ANCHOR_CREATED' as AuditEventType,
        userId: user.id,
        organizationId,
        projectId,
        entityType: 'document_comment_anchor',
        entityId: anchor.id,
        requestId: ctx.requestId ?? null,
        metadata: {
          documentId,
          rootCommentId: rootComment.id,
          documentVersion: input.documentVersion,
          rangeLength: end - start,
          contentHash,
        },
      })

      const detail = await this.getDetail(user, organizationId, projectId, documentId, anchor.id)

      return { anchor, detail }
    } catch (error) {
      await trx.rollback()
      throw error
    }
  }

  // ─── 列表 ─────────────────────────────────────────────────────

  /**
   * 列出文档的所有内联批注。
   */
  async list(
    user: User,
    organizationId: number,
    projectId: number,
    documentId: number,
    query: {
      page?: number
      perPage?: number
      sort?: string
      staleFilter?: string
      threadStatus?: string
    } = {},
  ): Promise<{
    data: Contracts.DocumentInlineCommentListItem[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const doc = await this.resolveDocument(user, organizationId, projectId, documentId)
    await this.policy.assertView(user, organizationId, projectId)

    const page = query.page ?? 1
    const perPage = query.perPage ?? 20
    const sortField = query.sort ?? 'created_at'
    const content = this.getContent(doc)
    const currentHash = this.currentContentHash(doc)

    const anchorQuery = DocumentCommentAnchor.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('document_id', documentId)
      .where('is_hidden', false)

    if (query.staleFilter === 'fresh') {
      anchorQuery.where('stale_status', 'fresh')
    } else if (query.staleFilter === 'stale') {
      anchorQuery.whereNot('stale_status', 'fresh')
    }

    // 排序
    switch (sortField) {
      case 'range_start':
        anchorQuery.orderBy('range_start', 'asc')
        break
      case 'stale_status':
        anchorQuery.orderBy('stale_status', 'asc')
        break
      case 'updated_at':
        anchorQuery.orderBy('updated_at', 'desc')
        break
      default:
        anchorQuery.orderBy('created_at', 'desc')
    }

    const result = await anchorQuery.paginate(page, perPage)
    const meta = result.getMeta()

    // 构建列表项并做 stale 重算
    const items: Contracts.DocumentInlineCommentListItem[] = []
    for (const anchor of result.all()) {
      // 确定性 stale 重算
      const staleness = Contracts.detectAnchorStaleness(
        anchor.contentHash,
        currentHash,
        anchor.prefixHash,
        Contracts.computeSnippetHash(
          content.slice(0, Contracts.DOCUMENT_SNIPPET_HASH_LENGTH),
          'prefix',
        ),
        anchor.suffixHash,
        Contracts.computeSnippetHash(
          content.slice(-Contracts.DOCUMENT_SNIPPET_HASH_LENGTH),
          'suffix',
        ),
        content,
        anchor.selectedQuote,
        anchor.rangeStart,
        anchor.rangeEnd,
      )

      if (staleness.staleStatus !== anchor.staleStatus) {
        anchor.staleStatus = staleness.staleStatus
        anchor.staleReason = staleness.staleReason
        await anchor.save()
      }

      // 获取 root comment 摘要
      const rootComment = await Comment.query()
        .where('id', anchor.rootCommentId)
        .whereNull('deleted_at')
        .preload('author')
        .first()

      if (!rootComment) continue

      const replyCount = await Comment.query()
        .where('parent_id', anchor.rootCommentId)
        .whereNull('deleted_at')
        .count('* as total')
        .first()

      // 如果指定了 threadStatus 过滤
      if (query.threadStatus && rootComment.status !== query.threadStatus) {
        continue
      }

      items.push({
        anchor: {
          id: anchor.id,
          organizationId: anchor.organizationId,
          projectId: anchor.projectId,
          documentId: anchor.documentId,
          rootCommentId: anchor.rootCommentId,
          documentVersion: anchor.documentVersion,
          contentHash: anchor.contentHash,
          rangeStart: anchor.rangeStart,
          rangeEnd: anchor.rangeEnd,
          selectedQuote: anchor.selectedQuote,
          prefixHash: anchor.prefixHash,
          suffixHash: anchor.suffixHash,
          headingPath: anchor.headingPath,
          staleStatus: anchor.staleStatus as Contracts.DocumentAnchorStaleStatus,
          staleReason: anchor.staleReason,
          hasUnresolvedReplies: rootComment.status === 'open',
          createdAt: anchor.createdAt.toISO()!,
          updatedAt: anchor.updatedAt.toISO()!,
        },
        rootComment: {
          id: rootComment.id,
          authorId: rootComment.authorId,
          authorName: rootComment.author?.fullName ?? '未知用户',
          // User 模型尚无头像列，契约允许 null
          authorAvatarUrl: null,
          bodyPreview: (rootComment.body ?? '').slice(0, 200),
          status: rootComment.status as Contracts.DocumentInlineThreadStatus,
          replyCount: Number(replyCount?.$extras?.total ?? 0),
          createdAt: rootComment.createdAt.toISO()!,
          updatedAt: (rootComment.updatedAt ?? rootComment.createdAt).toISO()!,
        },
      })
    }

    return {
      data: items,
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
      },
    }
  }

  // ─── 详情 ───────────────────────────────────────────────────

  /**
   * 获取单条内联批注详情（含 replies 和权限）。
   */
  async getDetail(
    user: User,
    organizationId: number,
    projectId: number,
    documentId: number,
    anchorId: number,
  ): Promise<Contracts.DocumentInlineCommentDetail> {
    await this.resolveDocument(user, organizationId, projectId, documentId)
    await this.policy.assertView(user, organizationId, projectId)

    const anchor = await DocumentCommentAnchor.query()
      .where('id', anchorId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('document_id', documentId)
      .where('is_hidden', false)
      .first()

    if (!anchor) {
      throw new ResourceNotFoundException('内联批注不存在')
    }

    const rootComment = await Comment.query()
      .where('id', anchor.rootCommentId)
      .whereNull('deleted_at')
      .preload('author')
      .first()

    if (!rootComment) {
      throw new ResourceNotFoundException('批注评论不存在')
    }

    const replies = await Comment.query()
      .where('parent_id', anchor.rootCommentId)
      .whereNull('deleted_at')
      .preload('author')
      .orderBy('created_at', 'asc')

    const isAuthor = rootComment.authorId === user.id

    const permissions: Contracts.DocumentInlineCommentPermissions = {
      canView: true,
      canCreate: await this.policy.create(user, organizationId, projectId),
      canReply: await this.policy.create(user, organizationId, projectId),
      canEditSelf: isAuthor && (await this.policy.editSelf(user, organizationId, projectId)),
      canDeleteSelf: isAuthor && (await this.policy.deleteSelf(user, organizationId, projectId)),
      canModerate: await this.policy.moderate(user, organizationId, projectId),
      canResolve: isAuthor || (await this.policy.moderate(user, organizationId, projectId)),
      canReopen: isAuthor || (await this.policy.moderate(user, organizationId, projectId)),
      canReanchor: await this.policy.reanchor(user, organizationId, projectId),
    }

    return {
      anchor: {
        id: anchor.id,
        organizationId: anchor.organizationId,
        projectId: anchor.projectId,
        documentId: anchor.documentId,
        rootCommentId: anchor.rootCommentId,
        documentVersion: anchor.documentVersion,
        contentHash: anchor.contentHash,
        rangeStart: anchor.rangeStart,
        rangeEnd: anchor.rangeEnd,
        selectedQuote: anchor.selectedQuote,
        prefixHash: anchor.prefixHash,
        suffixHash: anchor.suffixHash,
        headingPath: anchor.headingPath,
        staleStatus: anchor.staleStatus as Contracts.DocumentAnchorStaleStatus,
        staleReason: anchor.staleReason,
        hasUnresolvedReplies: rootComment.status === 'open',
        createdAt: anchor.createdAt.toISO()!,
        updatedAt: anchor.updatedAt.toISO()!,
      },
      rootComment: {
        id: rootComment.id,
        authorId: rootComment.authorId,
        authorName: rootComment.author?.fullName ?? '未知用户',
        // User 模型尚无头像列，契约允许 null
        authorAvatarUrl: null,
        body: rootComment.body ?? '',
        bodyFormat: (rootComment.bodyFormat as 'plain' | 'markdown') ?? 'plain',
        status: rootComment.status as Contracts.DocumentInlineThreadStatus,
        replyCount: replies.length,
        createdAt: rootComment.createdAt.toISO()!,
        updatedAt: (rootComment.updatedAt ?? rootComment.createdAt).toISO()!,
      },
      replies: replies.map((r) => ({
        id: r.id,
        authorId: r.authorId,
        authorName: r.author?.fullName ?? '未知用户',
        authorAvatarUrl: null,
        body: r.body ?? '',
        bodyFormat: (r.bodyFormat as 'plain' | 'markdown') ?? 'plain',
        createdAt: r.createdAt.toISO()!,
        updatedAt: (r.updatedAt ?? r.createdAt).toISO()!,
      })),
      permissions,
    }
  }

  // ─── 回复 ───────────────────────────────────────────────────

  async createReply(
    user: User,
    organizationId: number,
    projectId: number,
    documentId: number,
    anchorId: number,
    input: { body: string; bodyFormat?: 'plain' | 'markdown'; mentions?: number[] },
    ctx: { requestId?: string | null } = {},
  ): Promise<Contracts.DocumentInlineCommentDetail> {
    await this.resolveDocument(user, organizationId, projectId, documentId)
    await this.policy.assertCreate(user, organizationId, projectId)

    const anchor = await this.findAnchor(organizationId, projectId, documentId, anchorId)

    await this.commentService.create(
      organizationId,
      projectId,
      'document',
      documentId,
      {
        body: input.body,
        bodyFormat: input.bodyFormat ?? 'plain',
        parentId: anchor.rootCommentId,
        mentions: input.mentions,
      },
      user.id,
      { requestId: ctx.requestId ?? null },
    )

    return this.getDetail(user, organizationId, projectId, documentId, anchorId)
  }

  // ─── Resolve / Reopen / Delete（委托给 CommentService）───────────────────

  async resolve(
    user: User,
    organizationId: number,
    projectId: number,
    documentId: number,
    anchorId: number,
    ctx: { requestId?: string | null } = {},
  ): Promise<Contracts.DocumentInlineCommentDetail> {
    await this.resolveDocument(user, organizationId, projectId, documentId)
    const anchor = await this.findAnchor(organizationId, projectId, documentId, anchorId)

    const isAuthor = anchor.createdBy === user.id
    const canMod = await this.policy.moderate(user, organizationId, projectId)
    if (!isAuthor && !canMod) {
      throw new ValidationException('无权限解决此批注')
    }

    await this.commentService.resolve(organizationId, projectId, anchor.rootCommentId, user.id, {
      requestId: ctx.requestId ?? null,
    })

    await this.audit.log({
      event: 'DOCUMENT_INLINE_ANCHOR_RESOLVED' as AuditEventType,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'document_comment_anchor',
      entityId: anchorId,
      metadata: { documentId, rootCommentId: anchor.rootCommentId },
    })

    return this.getDetail(user, organizationId, projectId, documentId, anchorId)
  }

  async reopen(
    user: User,
    organizationId: number,
    projectId: number,
    documentId: number,
    anchorId: number,
    ctx: { requestId?: string | null } = {},
  ): Promise<Contracts.DocumentInlineCommentDetail> {
    await this.resolveDocument(user, organizationId, projectId, documentId)
    const anchor = await this.findAnchor(organizationId, projectId, documentId, anchorId)

    const isAuthor = anchor.createdBy === user.id
    const canMod = await this.policy.moderate(user, organizationId, projectId)
    if (!isAuthor && !canMod) {
      throw new ValidationException('无权限重开此批注')
    }

    await this.commentService.reopen(organizationId, projectId, anchor.rootCommentId, user.id, {
      requestId: ctx.requestId ?? null,
    })

    await this.audit.log({
      event: 'DOCUMENT_INLINE_ANCHOR_REOPENED' as AuditEventType,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'document_comment_anchor',
      entityId: anchorId,
      metadata: { documentId, rootCommentId: anchor.rootCommentId },
    })

    return this.getDetail(user, organizationId, projectId, documentId, anchorId)
  }

  async softDelete(
    user: User,
    organizationId: number,
    projectId: number,
    documentId: number,
    anchorId: number,
    ctx: { requestId?: string | null } = {},
  ): Promise<void> {
    await this.resolveDocument(user, organizationId, projectId, documentId)
    const anchor = await this.findAnchor(organizationId, projectId, documentId, anchorId)

    const isAuthor = anchor.createdBy === user.id
    const canMod = await this.policy.moderate(user, organizationId, projectId)
    if (!isAuthor && !canMod) {
      throw new ValidationException('无权限删除此批注')
    }

    await this.commentService.softDelete(organizationId, projectId, anchor.rootCommentId, user.id, {
      requestId: ctx.requestId ?? null,
    })

    anchor.isHidden = true
    await anchor.save()

    await this.audit.log({
      event: 'DOCUMENT_INLINE_ANCHOR_DELETED' as AuditEventType,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'document_comment_anchor',
      entityId: anchorId,
      metadata: { documentId, rootCommentId: anchor.rootCommentId },
    })
  }

  // ─── Reanchor ─────────────────────────────────────────────────

  async reanchor(
    user: User,
    organizationId: number,
    projectId: number,
    documentId: number,
    anchorId: number,
    input: {
      rangeStart: number
      rangeEnd: number
      selectedQuote: string
      documentVersion: string
    },
    _ctx: { requestId?: string | null } = {},
  ): Promise<Contracts.DocumentInlineCommentDetail> {
    const doc = await this.resolveDocument(user, organizationId, projectId, documentId)
    await this.policy.assertReanchor(user, organizationId, projectId)

    const anchor = await this.findAnchor(organizationId, projectId, documentId, anchorId)

    // 验证新范围
    const content = this.getContent(doc)
    const rangeValid = Contracts.validateDocumentRange(
      input.rangeStart,
      input.rangeEnd,
      content.length,
    )
    if (!rangeValid.valid) {
      throw new ValidationException(rangeValid.error)
    }

    const quoteValid = Contracts.validateQuoteLength(input.selectedQuote)
    if (!quoteValid.valid) {
      throw new ValidationException(quoteValid.error)
    }

    const { start, end } = Contracts.normalizeRange(input.rangeStart, input.rangeEnd)
    const contentHash = this.currentContentHash(doc)
    const prefixHash = Contracts.computeSnippetHash(content, 'prefix')
    const suffixHash = Contracts.computeSnippetHash(content, 'suffix')
    const headingPath = Contracts.extractHeadingPath(content, start)

    // 更新 anchor 元数据
    anchor.documentVersion = input.documentVersion
    anchor.contentHash = contentHash
    anchor.rangeStart = start
    anchor.rangeEnd = end
    anchor.selectedQuote = input.selectedQuote
    anchor.prefixHash = prefixHash
    anchor.suffixHash = suffixHash
    anchor.headingPath = headingPath
    anchor.staleStatus = 'fresh'
    anchor.staleReason = null
    await anchor.save()

    await this.audit.log({
      event: 'DOCUMENT_INLINE_ANCHOR_REANCHORED' as AuditEventType,
      userId: user.id,
      organizationId,
      projectId,
      entityType: 'document_comment_anchor',
      entityId: anchorId,
      metadata: {
        documentId,
        rootCommentId: anchor.rootCommentId,
        beforeRangeLength: end - start,
        afterRangeLength: end - start,
        beforeStaleStatus: anchor.staleStatus,
        contentHash,
      },
    })

    return this.getDetail(user, organizationId, projectId, documentId, anchorId)
  }

  // ─── 内部辅助方法 ───────────────────────────────────────────

  private async findAnchor(
    organizationId: number,
    projectId: number,
    documentId: number,
    anchorId: number,
  ): Promise<DocumentCommentAnchor> {
    const anchor = await DocumentCommentAnchor.query()
      .where('id', anchorId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('document_id', documentId)
      .where('is_hidden', false)
      .first()

    if (!anchor) {
      throw new ResourceNotFoundException('内联批注不存在')
    }

    return anchor
  }

  /** Record audit for stale recalculation */
  async auditStaleRecalc(
    userId: number,
    organizationId: number,
    projectId: number,
    anchorId: number,
    documentId: number,
    rootCommentId: number,
    oldStatus: string,
    newStatus: string,
  ): Promise<void> {
    if (oldStatus !== newStatus) {
      await this.audit.log({
        event: 'DOCUMENT_INLINE_ANCHOR_STALE_RECALCULATED' as AuditEventType,
        userId,
        organizationId,
        projectId,
        entityType: 'document_comment_anchor',
        entityId: anchorId,
        metadata: {
          documentId,
          rootCommentId,
          beforeStatus: oldStatus,
          afterStatus: newStatus,
        },
      })
    }
  }
}
