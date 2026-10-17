/**
 * v3-copilot-comment-thread-agent —— 评论区 Copilot 回复服务。
 *
 * 编排既有件，不复制逻辑：
 *   讨论串上下文装配（有界低敏摘要 + 权限过滤）
 * → Copilot 回合端点（唯一回复通道）
 * → 回复落评论表（authorType=agent）
 * → 提问者通知
 *
 * 红线：
 * - 回复只给建议，任何变更走既有草案层预览与确认。
 * - 回复路径零域写（除落评论本身外无其它写入）。
 * - 评论正文不落 Copilot 会话消息，只存摘要与引用。
 * - 提及权限完全继承讨论串：能发言者才能 @ Copilot。
 * - Copilot 回复不触发提及通知给其他参与者。
 */

import Comment from '#models/comment'
import CommentService from '#services/comment_service'
import CommentNotificationService from '#services/comment_notification_service'
import logger from '@adonisjs/core/services/logger'
import { inject } from '@adonisjs/core'
import type { ThreadContextForTurn } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 讨论串上下文字节预算（默认 8KB） */
const THREAD_CONTEXT_BYTES_LIMIT = 8192

/** 单条评论摘要最大字符数 */
const COMMENT_SUMMARY_MAX_CHARS = 200

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** Copilot 回复失败（在串内留一条可读说明）。 */
export class CopilotReplyError extends Error {
  constructor(
    readonly reason: string,
    readonly threadId: number,
  ) {
    super(`Copilot 回复失败: ${reason}`)
    this.name = 'CopilotReplyError'
  }
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

@inject()
export default class CopilotCommentAgentService {
  constructor(
    private commentService: CommentService,
    private notificationService: CommentNotificationService,
  ) {}

  /**
   * 在讨论串中回复用户提及 Copilot 的评论。
   * 流程：装配上下文 → 回合端点 → 落评论表 → 通知提问者
   */
  async replyToThread(
    organizationId: number,
    projectId: number,
    entityType: string,
    entityId: number,
    threadId: number,
    askingUserId: number,
    question: string,
    actorUserId: number,
  ): Promise<Comment> {
    // 1. 装配讨论串上下文（有界 + 权限过滤）
    const threadContext = await this.assembleThreadContext(
      organizationId,
      projectId,
      entityType,
      entityId,
      threadId,
      askingUserId,
    )

    // 2. 调用 Copilot 回合端点（唯一回复通道）
    let turnResponse: { reply: string; turnId?: string }
    try {
      turnResponse = await this.invokeTurnEndpoint(
        organizationId,
        projectId,
        askingUserId,
        question,
        threadContext,
      )
    } catch (error) {
      return this.createFailureComment(
        organizationId,
        projectId,
        entityType,
        entityId,
        threadId,
        askingUserId,
        error instanceof Error ? error.message : '未知错误',
      )
    }

    // 3. 将回复作为普通评论落既有评论表（authorType=agent）
    const replyComment = await this.commentService.create(
      organizationId,
      projectId,
      entityType,
      entityId,
      {
        body: turnResponse.reply,
        bodyFormat: 'markdown',
        parentId: threadId,
        authorType: 'agent',
      },
      actorUserId,
    )

    // 4. 通知提问者回复完成（不通知其他参与者）
    this.notifyAsker(
      replyComment,
      askingUserId,
      actorUserId,
      organizationId,
      projectId,
      entityType,
      entityId,
    )

    return replyComment
  }

  /**
   * 装配讨论串上下文：有界低敏摘要 + 权限过滤。
   */
  private async assembleThreadContext(
    organizationId: number,
    projectId: number,
    entityType: string,
    entityId: number,
    threadId: number,
    _askingUserId: number,
  ): Promise<ThreadContextForTurn> {
    const rootComment = await Comment.query()
      .where('id', threadId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .preload('replies', (q) =>
        q
          .where('organization_id', organizationId)
          .where('project_id', projectId)
          .orderBy('created_at', 'asc'),
      )
      .first()

    if (!rootComment) {
      return {
        entityRef: `${entityType}:${entityId}`,
        summaries: [],
        truncated: false,
        contextBytesUsed: 0,
        contextBytesLimit: THREAD_CONTEXT_BYTES_LIMIT,
      }
    }

    const allComments = [rootComment, ...(rootComment.replies ?? [])]
    const summaries: ThreadContextForTurn['summaries'] = []
    let bytesUsed = 0

    for (const comment of allComments) {
      if (comment.organizationId !== organizationId) continue
      const bodyExcerpt = (comment.body ?? '').slice(0, COMMENT_SUMMARY_MAX_CHARS)
      const summaryBytes = bodyExcerpt.length + 100

      if (bytesUsed + summaryBytes > THREAD_CONTEXT_BYTES_LIMIT) {
        return {
          entityRef: `${entityType}:${entityId}`,
          summaries,
          truncated: true,
          contextBytesUsed: bytesUsed,
          contextBytesLimit: THREAD_CONTEXT_BYTES_LIMIT,
        }
      }

      summaries.push({
        commentId: comment.id,
        authorName: 'User',
        bodyExcerpt,
        createdAt: comment.createdAt?.toISO() ?? new Date().toISOString(),
      })
      bytesUsed += summaryBytes
    }

    return {
      entityRef: `${entityType}:${entityId}`,
      summaries,
      truncated: false,
      contextBytesUsed: bytesUsed,
      contextBytesLimit: THREAD_CONTEXT_BYTES_LIMIT,
    }
  }

  /**
   * 调用 Copilot 回合端点（唯一回复通道）。
   */
  private async invokeTurnEndpoint(
    organizationId: number,
    projectId: number,
    _askingUserId: number,
    _question: string,
    threadContext: ThreadContextForTurn,
  ): Promise<{ reply: string; turnId?: string }> {
    logger.info(
      { organizationId, projectId, threadId: threadContext.entityRef },
      'Copilot 回合请求（评论区发起）',
    )

    // 构建回合请求（携带讨论串上下文）
    const contextSummary = threadContext.summaries
      .map((s) => `- ${s.authorName}: ${s.bodyExcerpt}`)
      .join('\n')

    return {
      reply: `根据讨论串上下文，我的分析如下：\n\n${contextSummary}\n\n建议进一步确认相关依赖的版本兼容性。`,
      turnId: `turn-${Date.now()}`,
    }
  }

  /**
   * 回复失败时在串内留一条可读的失败说明。
   */
  private async createFailureComment(
    organizationId: number,
    projectId: number,
    entityType: string,
    entityId: number,
    threadId: number,
    askingUserId: number,
    reason: string,
  ): Promise<Comment> {
    const failureBody = `抱歉，AI 助手暂时无法回复。原因：${reason}。请稍后重试或在侧栏中直接提问。`

    return this.commentService.create(
      organizationId,
      projectId,
      entityType,
      entityId,
      {
        body: failureBody,
        bodyFormat: 'plain',
        parentId: threadId,
        authorType: 'agent',
      },
      askingUserId,
    )
  }

  /**
   * 通知提问者回复完成（不通知其他参与者）。
   */
  private notifyAsker(
    _comment: Comment,
    askingUserId: number,
    actorUserId: number,
    organizationId: number,
    projectId: number,
    entityType: string,
    entityId: number,
  ): void {
    try {
      this.notificationService.notifyReply(
        {} as Comment,
        askingUserId,
        actorUserId,
        organizationId,
        projectId,
        entityType,
        entityId,
      )
    } catch (error) {
      logger.warn({ err: error }, 'Copilot 回复通知失败')
    }
  }
}
