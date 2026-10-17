'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Textarea } from '@/components/ui/Textarea'
import { useProjectComments, useCreateProjectComment, useDeleteComment } from '@/hooks/use-comments'
import { usePermissions } from '@/hooks/use-permissions'
import { useAuthStore } from '@/stores/auth-store'
import { Send, Trash2 } from 'lucide-react'
import type { Comment } from '@/lib/api/comments'

/**
 * 格式化相对时间（简体中文）。
 */
function formatDistanceToNow(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  if (days < 7) return `${days} 天前`

  return date.toLocaleDateString('zh-CN')
}

interface ProjectCommentsPanelProps {
  projectId: number
  commentCount?: number
}

/**
 * 项目级评论面板。
 * 复用评论列表与交互逻辑，用于项目协作入口。
 */
export function ProjectCommentsPanel({ projectId, commentCount }: ProjectCommentsPanelProps) {
  const [newComment, setNewComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const currentUser = useAuthStore((s) => s.user)

  const permissions = usePermissions()
  const canCreate = permissions.can('comment:create')
  const canDeleteSelf = permissions.can('comment:delete:self')
  const canModerate = permissions.can('comment:moderate')

  const { data, isLoading, isError } = useProjectComments(projectId, { perPage: 20 })
  const createMutation = useCreateProjectComment(projectId)
  const deleteMutation = useDeleteComment(projectId)

  const handleSubmit = async () => {
    const trimmed = newComment.trim()
    if (!trimmed || submitting) return

    setSubmitting(true)
    try {
      await createMutation.mutateAsync({ body: trimmed })
      setNewComment('')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (commentId: number) => {
    if (confirm('确定要删除这条评论吗？')) {
      await deleteMutation.mutateAsync(commentId)
    }
  }

  const canDelete = (comment: Comment) => {
    return canModerate || (canDeleteSelf && comment.authorId === currentUser?.id)
  }

  if (isLoading) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-gray-800">项目讨论</h3>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </section>
    )
  }

  if (isError) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-gray-800">项目讨论</h3>
        <p className="text-sm text-danger">评论加载失败</p>
      </section>
    )
  }

  const comments = data?.data ?? []
  const total = data?.meta?.total ?? commentCount ?? 0

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium text-gray-800">
        项目讨论 {total > 0 && <span className="text-gray-500">({total})</span>}
      </h3>

      {/* 评论列表 */}
      {comments.length === 0 ? (
        <p className="text-sm text-gray-500">暂无评论，成为第一个发表评论的人吧。</p>
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => (
            <div key={comment.id} className="rounded-[var(--radius-md)] border border-gray-200 p-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-sm font-medium text-primary">
                    {comment.author?.fullName?.charAt(0) ?? '?'}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {comment.author?.fullName ?? '未知用户'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatDistanceToNow(new Date(comment.createdAt))}
                      {comment.isEdited && ' · 已编辑'}
                      {comment.isDeleted && ' · 已删除'}
                    </p>
                  </div>
                </div>

                {/* 删除按钮 */}
                {!comment.isDeleted && canDelete(comment) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(comment.id)}
                    disabled={deleteMutation.isPending}
                    className="text-gray-400 hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">
                {comment.isDeleted ? '此评论已被删除' : comment.body}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* 评论输入 */}
      {canCreate && (
        <div className="space-y-2">
          <Textarea
            placeholder="写下你对项目的评论..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            rows={3}
            disabled={submitting}
            className="resize-none"
          />
          <div className="flex justify-end">
            <Button
              onClick={handleSubmit}
              disabled={!newComment.trim() || submitting}
              loading={submitting}
              size="sm"
            >
              <Send className="mr-1 h-4 w-4" />
              发送
            </Button>
          </div>
        </div>
      )}

      {!canCreate && <p className="text-sm text-gray-500">你没有权限发表评论。</p>}
    </section>
  )
}
