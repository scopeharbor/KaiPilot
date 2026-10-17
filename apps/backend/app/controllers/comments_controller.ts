import Comment from '#models/comment'
import CommentPolicy from '#policies/comment_policy'
import CommentService from '#services/comment_service'
import {
  createCommentValidator,
  listCommentsValidator,
  updateCommentValidator,
} from '#validators/comment'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

/**
 * V2 评论控制器（v2-collaboration-comments-mentions）。
 *
 * V1 兼容路由 + V2 新增：
 * - 统一实体评论列表（entity_type/entity_id 查询参数）
 * - 实体评论创建（自动从路由参数推导 entity_type）
 * - 评论解决/重新打开
 * - 提及候选列表
 */
@inject()
export default class CommentsController {
  constructor(
    private commentService: CommentService,
    private policy: CommentPolicy,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  // ---------------------------------------------------------------------------
  // V2：统一实体评论列表（3.2）
  // ---------------------------------------------------------------------------

  /**
   * 统一实体评论列表（entity_type + entity_id 查询参数）。
   * GET /api/v1/projects/:projectId/comments?entityType=task&entityId=1
   *
   * V1 兼容：无 entityType/entityId 时退回到项目级评论列表。
   */
  async index(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId, projectId)

    const entityType = ctx.request.input('entityType')
    const entityId = ctx.request.input('entityId')

    if (entityType && entityId) {
      // V2 路径：实体评论列表
      const qs = ctx.request.qs()
      const result = await this.commentService.listEntityComments(
        organizationId,
        projectId,
        entityType,
        Number(entityId),
        { page: qs.page, perPage: qs.perPage, sort: qs.sort, status: qs.status },
      )
      return ctx.response.ok(result)
    }

    // V1 兼容：项目级评论列表
    const filters = await ctx.request.validateUsing(listCommentsValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.commentService.listProjectComments(organizationId, projectId, filters)
    return ctx.response.ok(result)
  }

  // ---------------------------------------------------------------------------
  // V1 兼容路由
  // ---------------------------------------------------------------------------

  /**
   * V1 兼容：列出项目级评论。
   * GET /api/v1/projects/:projectId/comments (no entityType)
   */
  async indexProject(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId, projectId)

    const filters = await ctx.request.validateUsing(listCommentsValidator, {
      data: ctx.request.qs(),
    })

    const result = await this.commentService.listProjectComments(organizationId, projectId, filters)
    return ctx.response.ok(result)
  }

  /**
   * V1 兼容：列出任务级评论。
   * GET /api/v1/projects/:projectId/tasks/:taskId/comments
   */
  async indexTask(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const taskId = Number(ctx.params.taskId)
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId, projectId)

    const filters = await ctx.request.validateUsing(listCommentsValidator, {
      data: ctx.request.qs(),
    })

    const result = await this.commentService.listTaskComments(
      organizationId,
      projectId,
      taskId,
      filters,
    )
    return ctx.response.ok(result)
  }

  // ---------------------------------------------------------------------------
  // V2：创建评论（统一实体路由）
  // ---------------------------------------------------------------------------

  /**
   * 创建实体评论。
   * POST /api/v1/projects/:projectId/comments
   * Body: { entityType? , entityId?, body, bodyFormat?, parentId?, mentions? }
   *
   * V2：entityType/entityId 显式指定（project/task/milestone/risk/file/change_request）。
   * V1 兼容：无 entityType 时从 taskId（或默认 project）派生。
   */
  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createCommentValidator)
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const organizationId = ctx.tenant!.organizationId

    // V2 显式指定 entityType/entityId
    const entityType = ctx.request.input('entityType')
    const entityIdRaw = ctx.request.input('entityId')

    let resolvedType: string
    let resolvedId: number

    if (entityType && entityIdRaw) {
      // V2 路径
      resolvedType = entityType
      resolvedId = Number(entityIdRaw)
    } else {
      // V1 兼容：从请求体 taskId 或默认 project 派生
      const v1TaskId = ctx.request.input('taskId')
      resolvedType = v1TaskId ? 'task' : 'project'
      resolvedId = v1TaskId ? Number(v1TaskId) : projectId
    }

    await this.policy.authorizeCreate(user, organizationId, projectId)

    const comment = await this.commentService.create(
      organizationId,
      projectId,
      resolvedType,
      resolvedId,
      input,
      user.id,
      { requestId: ctx.request.id() ?? null },
    )

    await comment.load('author', (q) => q.select('id', 'full_name', 'email'))
    if (input.mentions?.length) {
      await comment.load('mentions', (q) =>
        q.preload('mentionedUser', (uq) => uq.select('id', 'full_name', 'email')),
      )
    }

    return ctx.response.created({ data: comment })
  }

  /**
   * V1 兼容：创建项目级评论。
   * POST /api/v1/projects/:projectId/comments (no entity)
   */
  async storeProject(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createCommentValidator)
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeCreate(user, organizationId, projectId)

    const comment = await this.commentService.create(
      organizationId,
      projectId,
      'project',
      projectId,
      input,
      user.id,
      { requestId: ctx.request.id() ?? null },
    )

    await comment.load('author', (q) => q.select('id', 'full_name', 'email'))

    return ctx.response.created({ data: comment })
  }

  /**
   * V1 兼容：创建任务级评论。
   * POST /api/v1/projects/:projectId/tasks/:taskId/comments
   */
  async storeTask(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createCommentValidator)
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const taskId = Number(ctx.params.taskId)
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeCreate(user, organizationId, projectId)

    const comment = await this.commentService.create(
      organizationId,
      projectId,
      'task',
      taskId,
      input,
      user.id,
      { requestId: ctx.request.id() ?? null },
    )

    await comment.load('author', (q) => q.select('id', 'full_name', 'email'))

    return ctx.response.created({ data: comment })
  }

  // ---------------------------------------------------------------------------
  // V2：评论操作
  // ---------------------------------------------------------------------------

  /**
   * 获取单条评论详情（含回复和提及）。
   * GET /api/v1/projects/:projectId/comments/:commentId
   */
  async show(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const commentId = Number(ctx.params.commentId)
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId, projectId)

    const comment = await this.commentService.getComment(organizationId, projectId, commentId)
    return ctx.response.ok({ data: comment })
  }

  /**
   * 编辑评论。
   * PATCH /api/v1/projects/:projectId/comments/:commentId
   */
  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateCommentValidator)
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const commentId = Number(ctx.params.commentId)
    const organizationId = ctx.tenant!.organizationId

    const comment = await Comment.query()
      .where('id', commentId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!comment) {
      return ctx.response.notFound({
        error: { code: 'COMMENT_NOT_FOUND', message: '评论不存在' },
      })
    }

    await this.policy.authorizeUpdate(user, organizationId, projectId, comment)

    const updated = await this.commentService.update(
      organizationId,
      projectId,
      commentId,
      input,
      user.id,
      { requestId: ctx.request.id() ?? null },
    )

    await updated.load('author', (q) => q.select('id', 'full_name', 'email'))

    return ctx.response.ok({ data: updated })
  }

  /**
   * 删除评论。
   * DELETE /api/v1/projects/:projectId/comments/:commentId
   */
  async destroy(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const commentId = Number(ctx.params.commentId)
    const organizationId = ctx.tenant!.organizationId

    const comment = await Comment.query()
      .where('id', commentId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!comment) {
      return ctx.response.notFound({
        error: { code: 'COMMENT_NOT_FOUND', message: '评论不存在' },
      })
    }

    await this.policy.authorizeDelete(user, organizationId, projectId, comment)

    await this.commentService.softDelete(organizationId, projectId, commentId, user.id, {
      requestId: ctx.request.id() ?? null,
    })

    return ctx.response.noContent()
  }

  /**
   * 解决评论线程。
   * POST /api/v1/projects/:projectId/comments/:commentId/resolve
   */
  async resolve(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const commentId = Number(ctx.params.commentId)
    const organizationId = ctx.tenant!.organizationId

    const comment = await Comment.query()
      .where('id', commentId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!comment) {
      return ctx.response.notFound({
        error: { code: 'COMMENT_NOT_FOUND', message: '评论不存在' },
      })
    }

    await this.policy.authorizeResolve(user, organizationId, projectId, comment)

    const resolved = await this.commentService.resolve(
      organizationId,
      projectId,
      commentId,
      user.id,
      {
        requestId: ctx.request.id() ?? null,
      },
    )

    return ctx.response.ok({ data: resolved })
  }

  /**
   * 重新打开评论线程。
   * POST /api/v1/projects/:projectId/comments/:commentId/reopen
   */
  async reopen(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const commentId = Number(ctx.params.commentId)
    const organizationId = ctx.tenant!.organizationId

    const comment = await Comment.query()
      .where('id', commentId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!comment) {
      return ctx.response.notFound({
        error: { code: 'COMMENT_NOT_FOUND', message: '评论不存在' },
      })
    }

    await this.policy.authorizeResolve(user, organizationId, projectId, comment)

    const reopened = await this.commentService.reopen(
      organizationId,
      projectId,
      commentId,
      user.id,
      {
        requestId: ctx.request.id() ?? null,
      },
    )

    return ctx.response.ok({ data: reopened })
  }

  /**
   * 获取提及候选列表。
   * GET /api/v1/projects/:projectId/comments/mention-candidates
   */
  async mentionCandidates(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeCreate(user, organizationId, projectId)

    const candidates = await this.commentService.getMentionCandidates(organizationId, projectId)
    return ctx.response.ok({ data: candidates })
  }
}
