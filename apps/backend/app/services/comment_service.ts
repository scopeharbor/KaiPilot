import Comment from '#models/comment'
import CommentMention from '#models/comment_mention'
import CommentTargetResolver from '#services/comment_target_resolver'
import CommentNotificationService from '#services/comment_notification_service'
import AuditService, { AuditEvent } from '#services/audit_service'
import RealtimeBroadcaster from '#services/realtime/realtime_broadcaster'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import type { CommentBodyFormat, CommentStatus } from '@aiproj/types'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import { RealtimeEvents } from '#types/realtime_events'
import type { AuthContext } from '#types/auth'

export interface CreateCommentInput {
  body: string
  bodyFormat?: CommentBodyFormat
  parentId?: number | null
  /** 被提及用户 ID 列表 */
  mentions?: number[]
  /** V1 兼容：taskId */
  taskId?: number | null
  /** V3：作者类型（user | agent），区分真人与 Copilot */
  authorType?: 'user' | 'agent'
}

export interface UpdateCommentInput {
  body?: string
  bodyFormat?: CommentBodyFormat
}

export interface CommentListFilters {
  /** 目标实体类型 */
  entityType?: string
  /** 目标实体 ID */
  entityId?: number
  /** V1 兼容：taskId */
  taskId?: number | null
  /** 状态筛选 */
  status?: CommentStatus
  page?: number
  perPage?: number
  sort?: string
}

/**
 * V2 评论服务（v2-collaboration-comments-mentions）。
 *
 * 覆盖：
 * - 统一实体评论列表（2.3）
 * - 评论创建和回复（2.4）
 * - 评论编辑和软删除（2.5）
 * - 评论解决/重新打开（2.6）
 * - 结构化 mention 校验、去重和落库（2.7）
 *
 * 所有操作遵守组织隔离和项目权限。
 */
@inject()
export default class CommentService {
  constructor(
    private audit: AuditService,
    private targetResolver: CommentTargetResolver,
    private notificationService: CommentNotificationService,
  ) {}

  // ---------------------------------------------------------------------------
  // 2.3 统一评论列表服务
  // ---------------------------------------------------------------------------

  /**
   * 列出实体评论（支持根评论分页 + 回复折叠）。
   */
  async listEntityComments(
    organizationId: number,
    projectId: number,
    entityType: string,
    entityId: number,
    filters: CommentListFilters = {},
  ): Promise<{
    data: Comment[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    // 校验目标对象
    await this.targetResolver.resolve(organizationId, projectId, entityType, entityId)

    const page = filters.page ?? 1
    const perPage = filters.perPage ?? 20

    const query = Comment.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('entity_type', entityType)
      .where('entity_id', entityId)
      .whereNull('parent_id') // 仅根评论
      .preload('author', (q) => q.select('id', 'full_name', 'email'))
      .preload('mentions', (q) =>
        q.preload('mentionedUser', (uq) => uq.select('id', 'full_name', 'email')),
      )

    // 状态筛选
    if (filters.status) {
      query.where('status', filters.status)
    }

    // 排序
    const sort = filters.sort ?? '-createdAt'
    const desc = sort.startsWith('-')
    const sortField = sort.replace(/^-/, '')
    if (sortField === 'createdAt' || sortField === 'id') {
      query.orderBy(sortField === 'createdAt' ? 'created_at' : 'id', desc ? 'desc' : 'asc')
    } else {
      query.orderBy('created_at', 'desc')
    }

    const result = await query.paginate(page, perPage)

    // 为每个根评论预加载回复
    const rootComments = result.all()
    for (const root of rootComments) {
      await root.load('replies', (q) =>
        q
          .where('organization_id', organizationId)
          .where('project_id', projectId)
          .preload('author', (aq) => aq.select('id', 'full_name', 'email'))
          .preload('mentions', (mq) =>
            mq.preload('mentionedUser', (uq) => uq.select('id', 'full_name', 'email')),
          )
          .orderBy('created_at', 'asc'),
      )
    }

    return {
      data: rootComments,
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  /**
   * V1 兼容：列出项目级评论（taskId = null）。
   */
  async listProjectComments(
    organizationId: number,
    projectId: number,
    filters: CommentListFilters = {},
  ): Promise<{
    data: Comment[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.targetResolver.resolve(organizationId, projectId, 'project', projectId)

    const page = filters.page ?? 1
    const perPage = filters.perPage ?? 20

    const query = Comment.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereNull('task_id')
      .whereNull('parent_id')
      .preload('author', (q) => q.select('id', 'full_name', 'email'))

    const sort = filters.sort ?? 'createdAt'
    const desc = sort.startsWith('-')
    const sortField = sort.replace(/^-/, '')
    if (sortField === 'createdAt') {
      query.orderBy('created_at', desc ? 'desc' : 'asc')
    }

    const result = await query.paginate(page, perPage)
    return {
      data: result.all(),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  /**
   * V1 兼容：列出任务级评论。
   */
  async listTaskComments(
    organizationId: number,
    projectId: number,
    taskId: number,
    filters: CommentListFilters = {},
  ): Promise<{
    data: Comment[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    // V1 兼容：通过 task_id 查询，也支持 entity_type='task'
    const page = filters.page ?? 1
    const perPage = filters.perPage ?? 20

    const query = Comment.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where((qb) => {
        qb.where('task_id', taskId).orWhere((q) => {
          q.where('entity_type', 'task').where('entity_id', taskId)
        })
      })
      .whereNull('parent_id')
      .preload('author', (q) => q.select('id', 'full_name', 'email'))

    const sort = filters.sort ?? 'createdAt'
    const desc = sort.startsWith('-')
    const sortField = sort.replace(/^-/, '')
    if (sortField === 'createdAt') {
      query.orderBy('created_at', desc ? 'desc' : 'asc')
    }

    const result = await query.paginate(page, perPage)
    return {
      data: result.all(),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  // ---------------------------------------------------------------------------
  // 2.4 评论创建和回复
  // ---------------------------------------------------------------------------

  /**
   * 创建评论。
   * - 支持实体评论（entity_type + entity_id）
   * - 支持回复（parent_id）
   * - 支持 @提及
   */
  async create(
    organizationId: number,
    projectId: number,
    entityType: string,
    entityId: number,
    input: CreateCommentInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Comment> {
    // 校验目标对象
    await this.targetResolver.resolve(organizationId, projectId, entityType, entityId)

    // 验证正文
    const body = input.body.trim()
    if (body.length < 1 || body.length > 5000) {
      throw new ValidationException('评论正文长度必须在 1-5000 字符之间')
    }

    // 验证回复关系
    if (input.parentId) {
      const parent = await Comment.query()
        .where('id', input.parentId)
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .first()

      if (!parent) {
        throw new ResourceNotFoundException('回复的父评论不存在')
      }

      // 禁止回复已删除评论
      if (parent.deletedAt !== null) {
        throw new ValidationException('不能回复已删除的评论')
      }

      // 禁止二级回复（parent 本身不能有 parent_id）
      if (parent.parentId !== null) {
        throw new ValidationException('已回复的评论不能再回复，请直接在根评论下回复')
      }

      // 禁止跨实体回复
      if (parent.entityType !== entityType || parent.entityId !== entityId) {
        throw new ValidationException('回复必须与父评论属于同一实体')
      }
    }

    // 创建评论
    const comment = await Comment.create({
      organizationId,
      projectId,
      entityType,
      entityId,
      taskId: entityType === 'task' ? entityId : (input.taskId ?? null),
      authorId: actorUserId,
      authorType: input.authorType ?? 'user',
      body,
      bodyFormat: input.bodyFormat ?? 'plain',
      parentId: input.parentId ?? null,
      status: 'open',
    })

    // 处理提及（2.7）
    if (input.mentions && input.mentions.length > 0) {
      await this.createMentions(organizationId, projectId, comment.id, input.mentions, actorUserId)
    }

    // 审计
    await this.audit.log({
      event: AuditEvent.COMMENT_CREATED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType,
      entityId: comment.id,
      metadata: {
        targetEntityType: entityType,
        targetEntityId: entityId,
        bodyLength: body.length,
        isReply: !!input.parentId,
        mentionCount: input.mentions?.length ?? 0,
      },
      requestId: ctx.requestId ?? null,
    })

    // 集成通知和实时广播
    this.triggerCreateNotifications(
      comment,
      input,
      organizationId,
      projectId,
      entityType,
      entityId,
      actorUserId,
    )

    return comment
  }

  /**
   * 触发评论创建后的通知和实时广播。
   */
  private triggerCreateNotifications(
    comment: Comment,
    input: CreateCommentInput,
    organizationId: number,
    projectId: number,
    entityType: string,
    entityId: number,
    actorUserId: number,
  ): void {
    // 如果是回复，通知父评论作者
    if (input.parentId) {
      void Comment.query()
        .where('id', input.parentId)
        .first()
        .then((parent) => {
          if (parent) {
            this.notificationService.notifyReply(
              comment,
              parent.authorId,
              actorUserId,
              organizationId,
              projectId,
              entityType,
              entityId,
            )
          }
        })
        .catch((err) => logger.warn({ err }, '评论回复通知查询失败'))
    }

    // @提及通知
    if (input.mentions && input.mentions.length > 0) {
      setImmediate(() => {
        this.notificationService.notifyMentions(
          comment,
          input.mentions!,
          actorUserId,
          organizationId,
          projectId,
          entityType,
          entityId,
        )
      })
    }

    // 向项目 room 广播评论变更
    this.broadcastCommentInvalidation(organizationId, projectId, comment, actorUserId)
  }

  /**
   * 向项目 room 广播评论失效信号（4.6）。
   */
  private broadcastCommentInvalidation(
    organizationId: number,
    projectId: number,
    comment: Comment,
    actorUserId: number,
  ): void {
    try {
      const broadcaster = new RealtimeBroadcaster()
      broadcaster.broadcastToProject(organizationId, projectId, {
        type: RealtimeEvents.COMMENT_INVALIDATED,
        projectId,
        entityId: comment.id,
        actorId: actorUserId,
        occurredAt: new Date().toISOString(),
        metadata: {
          entityType: comment.entityType,
          entityId: comment.entityId,
        },
      })
    } catch (error) {
      logger.warn({ err: error }, '评论实时广播失败')
    }
  }

  /**
   * V1 兼容创建（走旧 task_id 路径）。
   */
  async createV1(
    organizationId: number,
    projectId: number,
    input: CreateCommentInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Comment> {
    const entityType = input.taskId ? 'task' : 'project'
    const entityId = input.taskId ?? projectId
    return this.create(organizationId, projectId, entityType, entityId, input, actorUserId, ctx)
  }

  // ---------------------------------------------------------------------------
  // 2.5 评论编辑和软删除
  // ---------------------------------------------------------------------------

  /**
   * 编辑评论正文。
   */
  async update(
    organizationId: number,
    projectId: number,
    commentId: number,
    input: UpdateCommentInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Comment> {
    const comment = await this.commentOrFail(organizationId, projectId, commentId)

    if (comment.deletedAt !== null) {
      throw new ValidationException('已删除的评论不能编辑')
    }

    comment.merge({
      ...(input.body !== undefined && { body: input.body }),
      ...(input.bodyFormat !== undefined && { bodyFormat: input.bodyFormat }),
      editedAt: DateTime.now(),
    })
    await comment.save()

    await this.audit.log({
      event: AuditEvent.COMMENT_UPDATED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: comment.entityType ?? comment.targetType,
      entityId: comment.id,
      metadata: {
        targetEntityType: comment.entityType,
        targetEntityId: comment.entityId,
      },
      requestId: ctx.requestId ?? null,
    })

    return comment
  }

  /**
   * 软删除评论。
   */
  async softDelete(
    organizationId: number,
    projectId: number,
    commentId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<void> {
    const comment = await this.commentOrFail(organizationId, projectId, commentId)

    if (comment.deletedAt !== null) return // 幂等

    comment.deletedAt = DateTime.now()
    comment.deletedBy = actorUserId
    await comment.save()

    await this.audit.log({
      event: AuditEvent.COMMENT_DELETED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: comment.entityType ?? comment.targetType,
      entityId: comment.id,
      metadata: {
        targetEntityType: comment.entityType,
        targetEntityId: comment.entityId,
        deletedBy: actorUserId,
      },
      requestId: ctx.requestId ?? null,
    })
  }

  // ---------------------------------------------------------------------------
  // 2.6 评论解决/重新打开
  // ---------------------------------------------------------------------------

  /**
   * 解决评论线程（仅根评论）。
   */
  async resolve(
    organizationId: number,
    projectId: number,
    commentId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Comment> {
    const comment = await this.commentOrFail(organizationId, projectId, commentId)

    // 禁止回复被单独解决
    if (comment.parentId !== null) {
      throw new ValidationException('只能解决根评论线程，不能单独解决回复')
    }

    if (comment.deletedAt !== null) {
      throw new ValidationException('已删除的评论不能解决')
    }

    comment.status = 'resolved'
    comment.resolvedBy = actorUserId
    comment.resolvedAt = DateTime.now()
    await comment.save()

    await this.audit.log({
      event: AuditEvent.COMMENT_RESOLVED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: comment.entityType ?? comment.targetType,
      entityId: comment.id,
      metadata: {
        targetEntityType: comment.entityType,
        targetEntityId: comment.entityId,
      },
      requestId: ctx.requestId ?? null,
    })

    // 通知作者
    if (comment.authorId !== actorUserId) {
      setImmediate(() => {
        this.notificationService.notifyResolveChange(comment, true, actorUserId)
      })
    }

    // 广播
    this.broadcastCommentInvalidation(organizationId, projectId, comment, actorUserId)

    return comment
  }

  /**
   * 重新打开评论线程。
   */
  async reopen(
    organizationId: number,
    projectId: number,
    commentId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Comment> {
    const comment = await this.commentOrFail(organizationId, projectId, commentId)

    if (comment.parentId !== null) {
      throw new ValidationException('只能重新打开根评论线程')
    }

    if (comment.deletedAt !== null) {
      throw new ValidationException('已删除的评论不能重新打开')
    }

    comment.status = 'open'
    comment.resolvedBy = null
    comment.resolvedAt = null
    await comment.save()

    await this.audit.log({
      event: AuditEvent.COMMENT_REOPENED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: comment.entityType ?? comment.targetType,
      entityId: comment.id,
      metadata: {
        targetEntityType: comment.entityType,
        targetEntityId: comment.entityId,
      },
      requestId: ctx.requestId ?? null,
    })

    // 通知作者
    if (comment.authorId !== actorUserId) {
      setImmediate(() => {
        this.notificationService.notifyResolveChange(comment, false, actorUserId)
      })
    }

    // 广播
    this.broadcastCommentInvalidation(organizationId, projectId, comment, actorUserId)

    return comment
  }

  // ---------------------------------------------------------------------------
  // 2.7 结构化 mention
  // ---------------------------------------------------------------------------

  /**
   * 创建提及记录（去重）。
   */
  private async createMentions(
    organizationId: number,
    projectId: number,
    commentId: number,
    mentionedUserIds: number[],
    actorUserId: number,
  ): Promise<void> {
    // 去重
    const uniqueIds = [...new Set(mentionedUserIds)]
    if (uniqueIds.length === 0) return

    // v3-multitenant-database-isolation §6.1：被提及的 user id 是**客户端提交的批量 ID**，
    // 原实现直接写入 `comment_mentions` 而不校验这些用户是否属于当前组织，后果有两个：
    // ① 他租用户会收到本组织评论的提及通知（跨租内容外泄）；
    // ② `getComment` 的 `preload('mentions' → 'mentionedUser')` 会把该用户的
    //    full_name / email 返回给本组织（他租 PII 泄露）。
    // 按 spec「Mixed-tenant IDs fail atomically」整批拒绝，且不指明是哪个 ID 越界。
    // 组织 owner 可能没有 organization_members 行（owner fallback，见
    // v3-multitenant-tenant-identification），故成员与 owner 都算组织内用户。
    const memberRows = await db
      .from('organization_members')
      .where('organization_id', organizationId)
      .whereIn('user_id', uniqueIds)
      .select('user_id')
    const ownerRows = await db
      .from('organizations')
      .where('id', organizationId)
      .whereIn('owner_id', uniqueIds)
      .select('owner_id')
    const allowed = new Set<number>([
      ...memberRows.map((r: Record<string, unknown>) => Number(r.user_id)),
      ...ownerRows.map((r: Record<string, unknown>) => Number(r.owner_id)),
    ])
    if (allowed.size !== uniqueIds.length) {
      throw new ResourceNotFoundException('资源不存在')
    }

    for (const mentionedUserId of uniqueIds) {
      try {
        await CommentMention.create({
          organizationId,
          projectId,
          commentId,
          mentionedUserId,
          createdBy: actorUserId,
        })
      } catch {
        // 唯一约束冲突（同一评论中同一用户重复提及）→ 跳过，不阻塞评论创建
      }
    }
  }

  /**
   * 获取单条评论（含回复和提及）。
   */
  async getComment(organizationId: number, projectId: number, commentId: number): Promise<Comment> {
    const comment = await Comment.query()
      .where('id', commentId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .preload('author', (q) => q.select('id', 'full_name', 'email'))
      .preload('mentions', (q) =>
        q.preload('mentionedUser', (uq) => uq.select('id', 'full_name', 'email')),
      )
      .preload('replies', (q) =>
        q
          .preload('author', (aq) => aq.select('id', 'full_name', 'email'))
          .preload('mentions', (mq) =>
            mq.preload('mentionedUser', (uq) => uq.select('id', 'full_name', 'email')),
          )
          .orderBy('created_at', 'asc'),
      )
      .first()

    if (!comment) throw new ResourceNotFoundException('评论不存在')
    return comment
  }

  /**
   * 获取提及候选列表（项目内有 comment:view 权限的用户 + Copilot）。
   *
   * v3-copilot-comment-thread-agent：Copilot 作为特殊候选条目，
   * 不写入 users 表，通过 userId=-1 标识。
   */
  async getMentionCandidates(
    _organizationId: number,
    projectId: number,
  ): Promise<
    Array<{
      userId: number
      fullName: string
      email: string
      avatarUrl: string | null
      authorType?: string
    }>
  > {
    const { default: ProjectMember } = await import('#models/project_member')
    const members = await ProjectMember.query()
      .where('project_id', projectId)
      .preload('user', (q) => q.select('id', 'full_name', 'email'))
      .whereHas('user', (q) => q.where('is_active', true))

    const candidates = members
      .filter((m) => m.user)
      .map((m) => ({
        userId: m.user.id,
        fullName: m.user.fullName ?? '',
        email: m.user.email,
        avatarUrl: null as string | null,
        authorType: 'user' as 'user' | 'agent',
      }))

    // v3-copilot-comment-thread-agent：追加 Copilot 特殊候选条目
    candidates.push({
      userId: -1,
      fullName: 'Copilot',
      email: '',
      avatarUrl: null,
      authorType: 'agent',
    })

    return candidates
  }

  /**
   * V1 兼容：获取任务的评论数量。
   */
  async getTaskCommentCount(
    organizationId: number,
    projectId: number,
    taskId: number,
  ): Promise<number> {
    return Comment.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where((qb) => {
        qb.where('task_id', taskId).orWhere((q) => {
          q.where('entity_type', 'task').where('entity_id', taskId)
        })
      })
      .count('* as total')
      .first()
      .then((result) => Number(result?.$extras.total ?? 0))
  }

  /**
   * V1 兼容：批量获取任务的评论数量。
   */
  async getTaskCommentCounts(
    organizationId: number,
    projectId: number,
    taskIds: number[],
  ): Promise<Map<number, number>> {
    if (taskIds.length === 0) return new Map()

    // 合并 V1（task_id）和 V2（entity_type='task'）的统计

    // V1 task_id paths
    const v1Results = await Comment.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereIn('task_id', taskIds)
      .select('task_id')
      .count('* as count')
      .groupBy('task_id')

    const map = new Map<number, number>()
    for (const row of v1Results) {
      if (row.taskId !== null) {
        const count = Number(row.$extras.count)
        map.set(row.taskId, count)
      }
    }

    // V2 entity_type paths
    const v2Results = await Comment.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('entity_type', 'task')
      .whereIn('entity_id', taskIds)
      .select('entity_id')
      .count('* as count')
      .groupBy('entity_id')

    for (const row of v2Results) {
      if (row.entityId !== null) {
        const existing = map.get(row.entityId) ?? 0
        map.set(row.entityId, existing + Number(row.$extras.count))
      }
    }

    return map
  }

  // ---------------------------------------------------------------------------
  // 内部工具
  // ---------------------------------------------------------------------------

  private async commentOrFail(organizationId: number, projectId: number, commentId: number) {
    const comment = await Comment.query()
      .where('id', commentId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
    if (!comment) throw new ResourceNotFoundException('评论不存在')
    return comment
  }
}
