'use client'

import * as React from 'react'
import {
  useCreateEntityComment,
  useDeleteComment,
  useEntityComments,
  useReopenComment,
  useResolveComment,
  useUpdateComment,
} from '@/hooks/use-comments'
import { usePermissions } from '@/hooks/use-permissions'
import { useAuthStore } from '@/stores/auth-store'
import { CheckCircle2, Edit3, MessageSquareText, Reply, Send, Trash2, Undo2 } from 'lucide-react'
import type { Comment, CommentWithAuthor } from '@aiproj/types'
import { cn } from '@/lib/utils'

/**
 * 变更请求结构化审计评论区（v3-ui-next-risk-change-domains W2 · tasks 2.5，
 * design Decision 5.3 / spec「结构化审计评论区接入」）。
 *
 * 旧轨 CommentThread 复用评估（铁律：零旧轨视觉 import）：
 * - components/views/comments/CommentThread.tsx 为旧轨浅色视觉组件（消费
 *   ui/Textarea + gray/primary 系浅色类名，在白底卡片上设计），混入新轨暗黑仪器
 *   面板将造成对比度失效，判定为**不可整体复用**；
 * - 其承载的底层纯逻辑（hooks/use-comments 数据 Hook + @aiproj/types 评论类型）
 *   100% 复用：实体绑定 entityType="change_request" / entityId=变更 ID；
 * - 本组件按新轨方案 A 纯令牌重绘（写评论 / 回复 / 编辑 / 删除 / 解决·重开），
 *   满足审计留痕（作者、时间、已编辑/已解决标记随服务端数据回显）；
 * - 严禁设计浮动 IM 聊天气泡（铁律 1）：评论区为详情页常驻结构化区块。
 */

export interface ChangeAuditCommentsProps {
  projectId: number
  changeRequestId: number
}

/** 相对时间（简体中文），与服务端留痕时间戳配合展示。 */
function formatCommentTime(date: string): string {
  const diffMs = Date.now() - new Date(date).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(date).toLocaleDateString('zh-CN')
}

export function ChangeAuditComments({ projectId, changeRequestId }: ChangeAuditCommentsProps) {
  const { can } = usePermissions()
  const currentUser = useAuthStore((state) => state.user)
  const canView = can('comment:view')
  const canCreate = can('comment:create')
  const canModerate = can('comment:moderate')
  const canDeleteSelf = can('comment:delete:self')

  const [body, setBody] = React.useState('')
  const [replyTarget, setReplyTarget] = React.useState<number | null>(null)
  const [replyBody, setReplyBody] = React.useState('')
  const [editingId, setEditingId] = React.useState<number | null>(null)
  const [editBody, setEditBody] = React.useState('')
  const [actionError, setActionError] = React.useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useEntityComments(
    projectId,
    'change_request',
    changeRequestId,
    { perPage: 50, sort: '-createdAt' },
  )
  const createMutation = useCreateEntityComment(projectId)
  const updateMutation = useUpdateComment(projectId)
  const deleteMutation = useDeleteComment(projectId)
  const resolveMutation = useResolveComment(projectId)
  const reopenMutation = useReopenComment(projectId)

  if (!canView) return null

  const comments = data?.data ?? []

  const failWith = (error: unknown) => {
    setActionError(error instanceof Error ? error.message : '评论操作失败，请重试')
  }

  const submitNew = () => {
    const trimmed = body.trim()
    if (!trimmed || !canCreate || createMutation.isPending) return
    setActionError(null)
    createMutation.mutate(
      { entityType: 'change_request', entityId: changeRequestId, body: trimmed },
      {
        onSuccess: () => setBody(''),
        onError: failWith,
      },
    )
  }

  const submitReply = (comment: Comment) => {
    const trimmed = replyBody.trim()
    if (!trimmed || createMutation.isPending) return
    setActionError(null)
    createMutation.mutate(
      {
        entityType: 'change_request',
        entityId: changeRequestId,
        body: trimmed,
        parentId: comment.id,
      },
      {
        onSuccess: () => {
          setReplyBody('')
          setReplyTarget(null)
        },
        onError: failWith,
      },
    )
  }

  const saveEdit = (comment: Comment) => {
    const trimmed = editBody.trim()
    if (!trimmed || updateMutation.isPending) return
    setActionError(null)
    updateMutation.mutate(
      { commentId: comment.id, data: { body: trimmed } },
      {
        onSuccess: () => {
          setEditingId(null)
          setEditBody('')
        },
        onError: failWith,
      },
    )
  }

  const removeComment = (comment: Comment) => {
    if (!window.confirm('确定要删除这条评论吗？删除后仅保留删除标记用于审计留痕。')) return
    setActionError(null)
    deleteMutation.mutate(comment.id, { onError: failWith })
  }

  const toggleResolve = (comment: Comment) => {
    setActionError(null)
    const target = comment.isResolved ? reopenMutation : resolveMutation
    target.mutate(comment.id, { onError: failWith })
  }

  const canDelete = (comment: Comment) =>
    !comment.isDeleted && (canModerate || (canDeleteSelf && comment.authorId === currentUser?.id))
  const canEdit = (comment: Comment) => !comment.isDeleted && comment.authorId === currentUser?.id
  const canResolve = (comment: Comment) =>
    !comment.isDeleted && (canModerate || comment.authorId === currentUser?.id)

  const fieldClass =
    'w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1.5 text-xs leading-relaxed text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:opacity-50'

  return (
    <section
      data-cr-comments
      aria-label="变更讨论与审计评论"
      className="flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-4 py-4"
    >
      <header className="flex items-center gap-2">
        <MessageSquareText className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
        <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">讨论与审计评论</h3>
        {comments.length > 0 ? (
          <span
            data-cr-comments-count
            className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]"
          >
            {comments.length}
          </span>
        ) : null}
      </header>

      {actionError ? (
        <p
          role="alert"
          data-cr-comments-error
          className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.08)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
        >
          {actionError}
        </p>
      ) : null}

      {isLoading ? (
        <div
          data-cr-comments-loading
          role="status"
          aria-label="正在加载评论"
          aria-busy="true"
          className="space-y-2"
        >
          {[0, 1].map((index) => (
            <div
              key={index}
              className="h-14 animate-pulse rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
            />
          ))}
        </div>
      ) : null}

      {isError && !isLoading ? (
        <div
          data-cr-comments-load-error
          className="flex flex-wrap items-center gap-3 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5 text-xs text-[var(--nx-text-muted)]"
        >
          <span>评论记录加载失败。</span>
          <button
            type="button"
            data-cr-comments-retry
            onClick={() => void refetch()}
            className="inline-flex h-7 items-center rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            重新载入
          </button>
        </div>
      ) : null}

      {!isLoading && !isError && comments.length === 0 ? (
        <p
          data-cr-comments-empty
          className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-5 text-center text-xs text-[var(--nx-text-muted)]"
        >
          暂无评论，成为第一个发表评论的人吧（评论内容与操作人留痕，满足审计追踪要求）。
        </p>
      ) : null}

      {comments.length > 0 ? (
        <ul data-cr-comments-list className="flex flex-col gap-2">
          {comments.map((comment) => (
            <CommentAuditCard
              key={comment.id}
              comment={comment}
              currentUserId={currentUser?.id ?? null}
              canDelete={canDelete(comment)}
              canEdit={canEdit(comment)}
              canResolve={canResolve(comment)}
              canCreate={canCreate}
              editingId={editingId}
              editBody={editBody}
              replyTarget={replyTarget}
              replyBody={replyBody}
              busy={
                createMutation.isPending || updateMutation.isPending || resolveMutation.isPending
              }
              onStartEdit={() => {
                setEditingId(comment.id)
                setEditBody(comment.body ?? '')
              }}
              onCancelEdit={() => {
                setEditingId(null)
                setEditBody('')
              }}
              onEditChange={setEditBody}
              onSaveEdit={() => saveEdit(comment)}
              onDelete={() => removeComment(comment)}
              onToggleResolve={() => toggleResolve(comment)}
              onStartReply={() => {
                setReplyTarget(replyTarget === comment.id ? null : comment.id)
                setReplyBody('')
              }}
              onReplyChange={setReplyBody}
              onSubmitReply={() => submitReply(comment)}
              onCancelReply={() => {
                setReplyTarget(null)
                setReplyBody('')
              }}
            />
          ))}
        </ul>
      ) : null}

      {/* 新建评论输入（comment:create 门禁） */}
      {canCreate ? (
        <div className="flex flex-col gap-2 border-t border-[var(--nx-border-hairline)] pt-3">
          <textarea
            data-cr-comments-composer
            rows={3}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="写下评论或跟进说明…（留痕内容包括作者与时间）"
            className={cn(fieldClass, 'resize-y')}
          />
          <div className="flex justify-end">
            <button
              type="button"
              data-cr-comments-send
              disabled={body.trim() === '' || createMutation.isPending}
              onClick={submitNew}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-3.5 text-xs font-medium text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" aria-hidden />
              {createMutation.isPending ? '发送中…' : '发表评论'}
            </button>
          </div>
        </div>
      ) : (
        <p className="border-t border-[var(--nx-border-hairline)] pt-3 text-[11px] text-[var(--nx-text-muted)]">
          你没有评论权限（comment:create），如需发言请联系管理员开通。
        </p>
      )}
    </section>
  )
}

interface CommentAuditCardProps {
  comment: CommentWithAuthor
  currentUserId: number | null
  canDelete: boolean
  canEdit: boolean
  canResolve: boolean
  canCreate: boolean
  editingId: number | null
  editBody: string
  replyTarget: number | null
  replyBody: string
  busy: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onEditChange: (value: string) => void
  onSaveEdit: () => void
  onDelete: () => void
  onToggleResolve: () => void
  onStartReply: () => void
  onReplyChange: (value: string) => void
  onSubmitReply: () => void
  onCancelReply: () => void
}

function CommentAuditCard({
  comment,
  currentUserId,
  canDelete,
  canEdit,
  canResolve,
  canCreate,
  editingId,
  editBody,
  replyTarget,
  replyBody,
  busy,
  onStartEdit,
  onCancelEdit,
  onEditChange,
  onSaveEdit,
  onDelete,
  onToggleResolve,
  onStartReply,
  onReplyChange,
  onSubmitReply,
  onCancelReply,
}: CommentAuditCardProps) {
  const isEditing = editingId === comment.id
  const showReplyInput = replyTarget === comment.id
  const fieldClass =
    'w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1.5 text-xs leading-relaxed text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:opacity-50'

  return (
    <li
      data-cr-comment-card={comment.id}
      data-comment-status={comment.isResolved ? 'resolved' : 'open'}
      className={cn(
        'rounded-sm border px-2.5 py-2',
        comment.isResolved
          ? 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]/60'
          : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)]',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[10px] font-medium text-[var(--nx-text-secondary)]">
            {comment.author?.fullName?.charAt(0) ?? '?'}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium text-[var(--nx-text-primary)]">
              {comment.author?.fullName ?? '未知用户'}
              {comment.authorId === currentUserId ? (
                <span className="ml-1 text-[10px] text-[var(--nx-text-muted)]">（你）</span>
              ) : null}
            </p>
            <p data-cr-comment-meta className="text-[10px] text-[var(--nx-text-muted)]">
              {formatCommentTime(comment.createdAt)}
              {comment.isEdited ? ' · 已编辑' : ''}
              {comment.isResolved ? ' · 已解决' : ''}
              {comment.isDeleted ? ' · 已删除' : ''}
            </p>
          </div>
        </div>
        {!comment.isDeleted ? (
          <div className="flex shrink-0 items-center gap-0.5">
            {canResolve ? (
              <button
                type="button"
                data-cr-comment-resolve
                aria-label={comment.isResolved ? '重新打开' : '标记为解决'}
                title={comment.isResolved ? '重新打开' : '标记为解决'}
                disabled={busy}
                onClick={onToggleResolve}
                className="flex h-6 w-6 items-center justify-center rounded text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-status-success)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)] disabled:opacity-40"
              >
                {comment.isResolved ? (
                  <Undo2 className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                )}
              </button>
            ) : null}
            {canCreate && !comment.parentId ? (
              <button
                type="button"
                data-cr-comment-reply
                aria-label="回复"
                title="回复"
                onClick={onStartReply}
                className="flex h-6 w-6 items-center justify-center rounded text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
              >
                <Reply className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
            {canEdit && !isEditing ? (
              <button
                type="button"
                data-cr-comment-edit
                aria-label="编辑"
                title="编辑"
                onClick={onStartEdit}
                className="flex h-6 w-6 items-center justify-center rounded text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
              >
                <Edit3 className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                data-cr-comment-delete
                aria-label="删除评论"
                title="删除评论"
                onClick={onDelete}
                className="flex h-6 w-6 items-center justify-center rounded text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-status-danger)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {isEditing ? (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            data-cr-comment-edit-input
            rows={3}
            value={editBody}
            onChange={(event) => onEditChange(event.target.value)}
            className={fieldClass}
          />
          <div className="flex gap-2">
            <button
              type="button"
              data-cr-comment-edit-save
              disabled={editBody.trim() === '' || busy}
              onClick={onSaveEdit}
              className="inline-flex h-7 items-center rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] px-2.5 text-[11px] text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:opacity-40"
            >
              保存
            </button>
            <button
              type="button"
              data-cr-comment-edit-cancel
              onClick={onCancelEdit}
              className="inline-flex h-7 items-center rounded-sm border border-[var(--nx-border-hairline)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <p
          data-cr-comment-body
          className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-[var(--nx-text-secondary)]"
        >
          {comment.isDeleted ? '此评论已被删除（审计留痕）' : comment.body}
        </p>
      )}

      {/* 回复列表 */}
      {(comment.replies?.length ?? 0) > 0 ? (
        <ul className="mt-2 space-y-1.5 border-l border-[var(--nx-border-hairline)] pl-3">
          {comment.replies?.map((reply) => (
            <li
              key={reply.id}
              data-cr-comment-reply={reply.id}
              className={cn(
                'rounded-sm px-2 py-1.5',
                reply.isDeleted ? 'opacity-60' : 'bg-[var(--nx-bg-1)]',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium text-[var(--nx-text-secondary)]">
                  {reply.author?.fullName ?? '未知用户'}
                </span>
                <span className="text-[9px] text-[var(--nx-text-muted)]">
                  {formatCommentTime(reply.createdAt)}
                  {reply.isEdited ? ' · 已编辑' : ''}
                </span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
                {reply.isDeleted ? '此回复已被删除（审计留痕）' : reply.body}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {/* 回复输入 */}
      {showReplyInput ? (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            data-cr-comment-reply-input
            rows={2}
            value={replyBody}
            onChange={(event) => onReplyChange(event.target.value)}
            placeholder="写下回复…"
            className={fieldClass}
          />
          <div className="flex gap-2">
            <button
              type="button"
              data-cr-comment-reply-send
              disabled={replyBody.trim() === '' || busy}
              onClick={onSubmitReply}
              className="inline-flex h-7 items-center rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] px-2.5 text-[11px] text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:opacity-40"
            >
              回复
            </button>
            <button
              type="button"
              data-cr-comment-reply-cancel
              onClick={onCancelReply}
              className="inline-flex h-7 items-center rounded-sm border border-[var(--nx-border-hairline)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

export default ChangeAuditComments
