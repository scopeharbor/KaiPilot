'use client'

import { useState, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Textarea } from '@/components/ui/Textarea'
import {
  useDocumentInlineComments,
  useDocumentInlineComment,
  useCreateDocumentInlineComment,
  useReplyDocumentInlineComment,
  useResolveDocumentInlineComment,
  useReopenDocumentInlineComment,
  useDeleteDocumentInlineComment,
  useReanchorDocumentInlineComment,
} from '@/hooks/useDocumentInlineComments'
import {
  MessageSquarePlus,
  CheckCircle2,
  RotateCcw,
  Trash2,
  Send,
  AlertTriangle,
  X,
} from 'lucide-react'
import type { DocumentInlineCommentListItem, DocumentInlineCommentDetail } from '@aiproj/types'

/** 格式化相对时间。 */
function formatTime(date: string): string {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return d.toLocaleDateString('zh-CN')
}

// ─── Props ────────────────────────────────────────────────────────────────

interface DocumentInlineCommentsReviewProps {
  projectId: number
  documentId: number
  documentContent: string
  /** 当前用户在该项目中的权限（由父组件传入）。 */
  canCreate: boolean
  canModerate: boolean
}

// ─── 主组件 ────────────────────────────────────────────────────────────────

export default function DocumentInlineCommentsReview({
  projectId,
  documentId,
  documentContent,
  canCreate,
  canModerate,
}: DocumentInlineCommentsReviewProps) {
  const [selectedAnchorId, setSelectedAnchorId] = useState<number | null>(null)
  const [selectionRange, setSelectionRange] = useState<{
    start: number
    end: number
    text: string
  } | null>(null)
  const [newCommentBody, setNewCommentBody] = useState('')
  const [replyBody, setReplyBody] = useState('')
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  // 查询
  const { data: listData, isLoading } = useDocumentInlineComments(projectId, documentId, {
    sort: 'created_at',
  })

  // 详情
  const { data: detailData } = useDocumentInlineComment(
    projectId,
    documentId,
    selectedAnchorId ?? 0,
  )

  // Mutations
  const createMutation = useCreateDocumentInlineComment(projectId, documentId)
  const replyMutation = useReplyDocumentInlineComment(projectId, documentId)
  const resolveMutation = useResolveDocumentInlineComment(projectId, documentId)
  const reopenMutation = useReopenDocumentInlineComment(projectId, documentId)
  const deleteMutation = useDeleteDocumentInlineComment(projectId, documentId)
  const reanchorMutation = useReanchorDocumentInlineComment(projectId, documentId)

  const anchors = listData?.data ?? []
  const detail = detailData?.data ?? null

  // ─── 文本选择处理 ────────────────────────────────────────────────────────
  const handleTextSelect = useCallback(() => {
    if (!canCreate) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setSelectionRange(null)
      return
    }

    const range = sel.getRangeAt(0)
    const text = range.toString().trim()
    if (!text || text.length > 500) {
      setSelectionRange(null)
      return
    }

    // 获取在文档内容中的偏移
    const contentEl = contentRef.current
    if (!contentEl) return

    // 简单计算：使用选中文本的索引
    const fullText = contentEl.textContent ?? ''
    const start = fullText.indexOf(text)
    if (start === -1) return

    setSelectionRange({ start, end: start + text.length, text })
  }, [canCreate])

  const handleCreateComment = useCallback(async () => {
    if (!selectionRange || !newCommentBody.trim()) return
    try {
      await createMutation.mutateAsync({
        rangeStart: selectionRange.start,
        rangeEnd: selectionRange.end,
        selectedQuote: selectionRange.text,
        documentVersion: 'current',
        body: newCommentBody.trim(),
      })
      setNewCommentBody('')
      setSelectionRange(null)
    } catch {
      // 错误由 mutation state 处理
    }
  }, [selectionRange, newCommentBody, createMutation])

  const handleReply = useCallback(async () => {
    if (!selectedAnchorId || !replyBody.trim()) return
    try {
      await replyMutation.mutateAsync({
        anchorId: selectedAnchorId,
        data: { body: replyBody.trim() },
      })
      setReplyBody('')
    } catch {
      /* handled by mutation */
    }
  }, [selectedAnchorId, replyBody, replyMutation])

  // ─── 高亮渲染 ────────────────────────────────────────────────────────────
  const renderContentWithHighlights = () => {
    if (!anchors.length) {
      return <div className="whitespace-pre-wrap text-sm">{documentContent}</div>
    }

    // 按范围排序的锚点
    const sorted = [...anchors].sort((a, b) => a.anchor.rangeStart - b.anchor.rangeStart)
    const parts: React.ReactNode[] = []
    let cursor = 0

    for (const item of sorted) {
      const { rangeStart, rangeEnd, staleStatus, id } = item.anchor
      if (rangeStart > cursor) {
        parts.push(documentContent.slice(cursor, rangeStart))
      }

      const isSelected = selectedAnchorId === id
      const isStale = staleStatus !== 'fresh'
      const isResolved = item.rootComment.status === 'resolved'

      let highlightClass = 'bg-yellow-100 dark:bg-yellow-900/30 cursor-pointer border-b-2 '
      if (isSelected) {
        highlightClass =
          'bg-blue-200 dark:bg-blue-800/40 cursor-pointer border-b-2 border-blue-500 '
      } else if (isStale) {
        highlightClass =
          'bg-orange-100 dark:bg-orange-900/30 cursor-pointer border-b-2 border-orange-400 '
      } else if (isResolved) {
        highlightClass =
          'bg-green-50 dark:bg-green-900/20 cursor-pointer border-b-2 border-green-300 '
      }

      parts.push(
        <mark
          key={id}
          className={highlightClass + 'rounded-sm px-0.5'}
          onClick={() => {
            setSelectedAnchorId(id)
            setMobileSidebarOpen(true)
          }}
          title={isStale ? '批注已失效 - 文档内容已变更' : item.rootComment.bodyPreview}
        >
          {documentContent.slice(rangeStart, rangeEnd)}
        </mark>,
      )
      cursor = rangeEnd
    }

    if (cursor < documentContent.length) {
      parts.push(documentContent.slice(cursor))
    }

    return <div className="whitespace-pre-wrap text-sm">{parts}</div>
  }

  // ─── 侧面板 ──────────────────────────────────────────────────────────────
  const renderSidebar = () => {
    return (
      <div className="flex flex-col h-full">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-sm">内联批注 ({anchors.length})</h3>
          <Button variant="ghost" size="sm" onClick={() => setSelectedAnchorId(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 锚点列表 */}
        {!selectedAnchorId ? (
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : anchors.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                暂无内联批注。选中文本后可创建新批注。
              </div>
            ) : (
              <div className="divide-y">
                {anchors.map((item) => (
                  <AnchorListItem
                    key={item.anchor.id}
                    item={item}
                    isSelected={selectedAnchorId === item.anchor.id}
                    onSelect={() => setSelectedAnchorId(item.anchor.id)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <ThreadDetailView
            detail={detail}
            replyBody={replyBody}
            onReplyBodyChange={setReplyBody}
            onReply={handleReply}
            onResolve={() => selectedAnchorId && resolveMutation.mutate(selectedAnchorId)}
            onReopen={() => selectedAnchorId && reopenMutation.mutate(selectedAnchorId)}
            onDelete={() => {
              if (selectedAnchorId && confirm('确认删除此批注？')) {
                deleteMutation.mutate(selectedAnchorId)
                setSelectedAnchorId(null)
              }
            }}
            onReanchor={() => {
              if (!selectedAnchorId) return
              const newQuote = prompt('请输入新的引文文本（从文档中重新选择后粘贴）：')
              if (newQuote) {
                reanchorMutation.mutate({
                  anchorId: selectedAnchorId,
                  data: {
                    rangeStart: 0,
                    rangeEnd: newQuote.length,
                    selectedQuote: newQuote,
                    documentVersion: 'reanchor',
                  },
                })
              }
            }}
            canModerate={canModerate}
            isReplyLoading={replyMutation.isPending}
          />
        )}
      </div>
    )
  }

  // ─── 渲染 ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full">
      {/* 文档内容区 */}
      <div className="flex-1 overflow-y-auto p-6" ref={contentRef} onMouseUp={handleTextSelect}>
        {renderContentWithHighlights()}
      </div>

      {/* 桌面端侧面板 */}
      <div className="hidden lg:flex w-80 border-l flex-col bg-card">{renderSidebar()}</div>

      {/* 移动端抽屉 */}
      {mobileSidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-background">
          <div className="flex flex-col h-full">
            {renderSidebar()}
            <Button variant="ghost" className="m-4" onClick={() => setMobileSidebarOpen(false)}>
              关闭
            </Button>
          </div>
        </div>
      )}

      {/* 选中文本创建工具栏 */}
      {selectionRange && canCreate && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-popover border rounded-lg shadow-lg p-3 flex items-center gap-3">
          <span className="text-xs text-muted-foreground max-w-48 truncate">
            「{selectionRange.text.slice(0, 80)}
            {selectionRange.text.length > 80 ? '...' : ''}」
          </span>
          <Textarea
            className="w-64 h-20 text-sm"
            placeholder="输入批注内容..."
            value={newCommentBody}
            onChange={(e) => setNewCommentBody(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreateComment} disabled={createMutation.isPending}>
              <MessageSquarePlus className="h-4 w-4 mr-1" />
              创建
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectionRange(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 子组件 ────────────────────────────────────────────────────────────────

/** 锚点列表项。 */
function AnchorListItem({
  item,
  isSelected,
  onSelect,
}: {
  item: DocumentInlineCommentListItem
  isSelected: boolean
  onSelect: () => void
}) {
  const { anchor, rootComment } = item
  const isStale = anchor.staleStatus !== 'fresh'
  const isResolved = rootComment.status === 'resolved'

  return (
    <button
      className={`w-full text-left p-4 hover:bg-muted/50 transition-colors ${isSelected ? 'bg-muted' : ''}`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isStale && (
              <Badge variant="warning" className="text-xs">
                <AlertTriangle className="h-3 w-3 mr-0.5" />
                已失效
              </Badge>
            )}
            {isResolved && (
              <Badge variant="success" className="text-xs">
                <CheckCircle2 className="h-3 w-3 mr-0.5" />
                已解决
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1 mb-1">
            「{anchor.selectedQuote.slice(0, 60)}
            {anchor.selectedQuote.length > 60 ? '...' : ''}」
          </p>
          <p className="text-xs line-clamp-2">{rootComment.bodyPreview}</p>
        </div>
        <div className="text-xs text-muted-foreground whitespace-nowrap">
          {formatTime(rootComment.createdAt)}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
        <span>{rootComment.authorName}</span>
        <span>{rootComment.replyCount} 条回复</span>
        {anchor.headingPath && <span className="truncate">{anchor.headingPath}</span>}
      </div>
    </button>
  )
}

/** 线程详情视图。 */
function ThreadDetailView({
  detail,
  replyBody,
  onReplyBodyChange,
  onReply,
  onResolve,
  onReopen,
  onDelete,
  onReanchor,
  isReplyLoading,
}: {
  detail: DocumentInlineCommentDetail | null
  replyBody: string
  onReplyBodyChange: (v: string) => void
  onReply: () => void
  onResolve: () => void
  onReopen: () => void
  onDelete: () => void
  onReanchor: () => void
  canModerate: boolean
  isReplyLoading: boolean
}) {
  if (!detail) {
    return (
      <div className="flex-1 p-4">
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  const { anchor, rootComment, replies, permissions } = detail
  const isStale = anchor.staleStatus !== 'fresh'
  const isResolved = rootComment.status === 'resolved'

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Stale 警告 */}
      {isStale && (
        <div className="mx-4 mt-3 p-3 bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 rounded-md">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-600 mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="font-medium text-orange-700 dark:text-orange-400">批注已失效</p>
              <p className="text-orange-600 dark:text-orange-500 mt-1">
                {anchor.staleReason ?? '文档内容已变更'}
              </p>
              <p className="mt-1 text-orange-600/70">
                保存的引文：「{anchor.selectedQuote.slice(0, 100)}」
              </p>
              {permissions.canReanchor && (
                <Button variant="outline" size="sm" className="mt-2 text-xs" onClick={onReanchor}>
                  重设锚点
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Root comment */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{rootComment.authorName}</span>
            <span className="text-xs text-muted-foreground">
              {formatTime(rootComment.createdAt)}
            </span>
          </div>
          {isResolved ? (
            <Badge variant="success" className="text-xs">
              已解决
            </Badge>
          ) : (
            <Badge variant="info" className="text-xs">
              进行中
            </Badge>
          )}
        </div>

        {/* 引文 */}
        <div className="mb-3 p-2 bg-muted/50 rounded text-xs text-muted-foreground italic">
          「{anchor.selectedQuote}」
        </div>

        <p className="text-sm whitespace-pre-wrap">{rootComment.body}</p>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 mt-3">
          {permissions.canReply && !isResolved && (
            <Button variant="ghost" size="sm" onClick={() => {}}>
              回复
            </Button>
          )}
          {permissions.canResolve && !isResolved && (
            <Button variant="ghost" size="sm" onClick={onResolve}>
              <CheckCircle2 className="h-4 w-4 mr-1" />
              解决
            </Button>
          )}
          {permissions.canReopen && isResolved && (
            <Button variant="ghost" size="sm" onClick={onReopen}>
              <RotateCcw className="h-4 w-4 mr-1" />
              重开
            </Button>
          )}
          {(permissions.canDeleteSelf || permissions.canModerate) && (
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 className="h-4 w-4 mr-1" />
              删除
            </Button>
          )}
        </div>
      </div>

      {/* Replies */}
      {replies.length > 0 && (
        <div className="border-t">
          <div className="px-4 py-2 text-xs text-muted-foreground">{replies.length} 条回复</div>
          {replies.map((reply) => (
            <div key={reply.id} className="px-4 py-3 border-t">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium">{reply.authorName}</span>
                <span className="text-xs text-muted-foreground">{formatTime(reply.createdAt)}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{reply.body}</p>
            </div>
          ))}
        </div>
      )}

      {/* 回复输入框 */}
      {permissions.canReply && !isResolved && (
        <div className="p-4 border-t">
          <Textarea
            className="w-full text-sm mb-2"
            placeholder="输入回复..."
            value={replyBody}
            onChange={(e) => onReplyBodyChange(e.target.value)}
            rows={3}
          />
          <Button size="sm" onClick={onReply} disabled={!replyBody.trim() || isReplyLoading}>
            <Send className="h-4 w-4 mr-1" />
            回复
          </Button>
        </div>
      )}
    </div>
  )
}
