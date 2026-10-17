'use client'

/**
 * v2-ai-draft-layer-preview-diff-apply —— DraftReviewPanel 组件（task 10.2-10.6）。
 *
 * 展示 Draft Layer 审查界面：来源/PDM 摘要、Preview/Diff 视图、决策交互、dry-run/apply/放弃按钮。
 * blocking 或冲突存在时禁用 apply 入口。
 * 长任务展示品牌 loader；文案不得暗示 AI 已自动落库。
 */
import React, { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { DraftLayerDiffEntity, DraftLayerSessionSummary } from '@aiproj/types'
import { aiDraftLayerApi, aiDraftLayerKeys } from '@/lib/api/ai-draft-layer'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert } from '@/components/ui/Alert'

interface DraftLayerReviewPanelProps {
  sessionId: number
}

type ViewMode = 'preview' | 'diff' | 'summary'

export function DraftLayerReviewPanel({ sessionId }: DraftLayerReviewPanelProps) {
  const queryClient = useQueryClient()
  const [viewMode, setViewMode] = useState<ViewMode>('summary')
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null)

  // ── Queries ──

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: aiDraftLayerKeys.detail(sessionId),
    queryFn: () => aiDraftLayerApi.get(sessionId),
  })

  const { data: preview } = useQuery({
    queryKey: aiDraftLayerKeys.preview(sessionId),
    queryFn: () => aiDraftLayerApi.preview(sessionId),
    enabled: !!detail?.session && viewMode === 'preview',
  })

  const { data: diff } = useQuery({
    queryKey: aiDraftLayerKeys.diff(sessionId),
    queryFn: () => aiDraftLayerApi.diff(sessionId),
    enabled: !!detail?.session && viewMode === 'diff',
  })

  // ── Mutations ──

  const previewMutation = useMutation({
    mutationFn: () => {
      setLoadingMessage('正在生成 Preview...')
      return aiDraftLayerApi.preview(sessionId)
    },
    onSuccess: () => {
      setLoadingMessage(null)
      queryClient.invalidateQueries({ queryKey: aiDraftLayerKeys.detail(sessionId) })
    },
    onError: () => setLoadingMessage(null),
  })

  const diffMutation = useMutation({
    mutationFn: () => {
      setLoadingMessage('正在计算 Diff...')
      return aiDraftLayerApi.diff(sessionId)
    },
    onSuccess: () => {
      setLoadingMessage(null)
      queryClient.invalidateQueries({ queryKey: aiDraftLayerKeys.detail(sessionId) })
    },
    onError: () => setLoadingMessage(null),
  })

  const applyMutation = useMutation({
    mutationFn: () => {
      setLoadingMessage('正在应用变更...')
      return aiDraftLayerApi.apply(sessionId)
    },
    onSuccess: () => {
      setLoadingMessage(null)
      queryClient.invalidateQueries({ queryKey: aiDraftLayerKeys.detail(sessionId) })
    },
    onError: () => setLoadingMessage(null),
  })

  const discardMutation = useMutation({
    mutationFn: () => {
      setLoadingMessage('正在放弃草案...')
      return aiDraftLayerApi.discard(sessionId)
    },
    onSuccess: () => {
      setLoadingMessage(null)
      queryClient.invalidateQueries({ queryKey: aiDraftLayerKeys.detail(sessionId) })
    },
    onError: () => setLoadingMessage(null),
  })

  const handleDecide = useCallback(
    async (changeId: number, reviewStatus: string) => {
      await aiDraftLayerApi.decide(sessionId, { changeId, reviewStatus })
      queryClient.invalidateQueries({ queryKey: aiDraftLayerKeys.detail(sessionId) })
    },
    [sessionId, queryClient],
  )

  const handleBulkAccept = useCallback(async () => {
    await aiDraftLayerApi.bulkDecide(sessionId, {
      sessionId,
      entityTypes: [],
      operations: [],
      action: 'accepted',
    })
    queryClient.invalidateQueries({ queryKey: aiDraftLayerKeys.detail(sessionId) })
  }, [sessionId, queryClient])

  // ── Render ──

  if (detailLoading) {
    return (
      <div className="space-y-4 p-6" role="status" aria-label="加载中">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  const session = detail?.session
  const changes = detail?.changes ?? []
  const hasApplyResult = detail?.applyResult
  const isApplied = hasApplyResult?.status === 'applied' || session?.status === 'applied'
  const blocked = session?.status === 'expired'
  const hasConflicts = changes.some((c) => c.reviewStatus === 'pending' && c.operation === 'update')
  const summary: DraftLayerSessionSummary | null = session?.summary ?? null

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* 加载状态覆盖层 */}
      {loadingMessage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80"
          role="alert"
        >
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">{loadingMessage}</p>
          </div>
        </div>
      )}

      {/* 会话摘要 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            AI 草案审查
            <Badge variant={isApplied ? 'success' : blocked ? 'danger' : 'neutral'}>
              {isApplied ? '已应用' : blocked ? '已过期' : (session?.status ?? '未知')}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">来源：</span>
              <span>
                {session?.sourceType === 'v2_compiler_pdm'
                  ? 'Compiler PDM'
                  : String(session?.sourceType)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">版本：</span>
              <span>v{session?.version}</span>
            </div>
            {session?.compilerRunId && (
              <div>
                <span className="text-muted-foreground">Compiler Run：</span>
                <span>#{session.compilerRunId}</span>
              </div>
            )}
            {session?.pdmHash && (
              <div>
                <span className="text-muted-foreground">PDM Hash：</span>
                <code className="rounded bg-muted px-1 text-xs">
                  {session.pdmHash.slice(0, 12)}...
                </code>
              </div>
            )}
          </div>

          {/* 统计 */}
          {summary && (
            <div className="flex flex-wrap gap-3 text-sm">
              <span>变更：{summary.totalChanges} 项</span>
              <span className="text-green-600">已接受：{summary.acceptedChanges}</span>
              <span className="text-destructive">已拒绝：{summary.rejectedChanges}</span>
              <span className="text-muted-foreground">待处理：{summary.pendingChanges}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 视图切换 */}
      <div className="flex gap-2">
        <Button
          variant={viewMode === 'summary' ? 'primary' : 'outline'}
          size="sm"
          onClick={() => setViewMode('summary')}
        >
          摘要
        </Button>
        <Button
          variant={viewMode === 'preview' ? 'primary' : 'outline'}
          size="sm"
          onClick={() => {
            setViewMode('preview')
            if (!preview) previewMutation.mutate()
          }}
        >
          Preview
        </Button>
        <Button
          variant={viewMode === 'diff' ? 'primary' : 'outline'}
          size="sm"
          onClick={() => {
            setViewMode('diff')
            if (!diff) diffMutation.mutate()
          }}
        >
          Diff
        </Button>
      </div>

      {/* Preview 视图 */}
      {viewMode === 'preview' && preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preview 预览（只读）</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-sm text-muted-foreground">
              PDM 到正式业务实体的投影。以下数据尚未写入正式项目。
            </p>
            {preview.preview && (
              <div className="space-y-2 text-sm">
                <p>
                  Preview Hash:{' '}
                  <code className="rounded bg-muted px-1">
                    {preview.preview.previewHash.slice(0, 16)}...
                  </code>
                </p>
                <p>Version: {preview.preview.version}</p>
                <p>Changes: {preview.preview.computedFromChangeIds.length} 项</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Diff 视图 */}
      {viewMode === 'diff' && diff && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>Diff 差异</span>
              {hasConflicts && <Badge variant="danger">存在冲突</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {diff.diff.entities.length === 0 ? (
              <p className="text-sm text-muted-foreground">无差异。</p>
            ) : (
              <div className="space-y-2">
                {diff.diff.entities.map((entity: DraftLayerDiffEntity) => (
                  <div key={entity.tempId} className="rounded border p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{entity.entityType}</Badge>
                      <span className="font-mono text-xs">{entity.tempId}</span>
                      <Badge
                        variant={
                          entity.operation === 'add'
                            ? 'success'
                            : entity.operation === 'modify'
                              ? 'neutral'
                              : 'outline'
                        }
                      >
                        {entity.operation}
                      </Badge>
                    </div>
                    {entity.fieldDiffs.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {entity.fieldDiffs.map((fd, i) => (
                          <div key={i} className="flex gap-2 text-xs text-muted-foreground">
                            <span className="w-24 truncate font-medium">{fd.field}</span>
                            <span>{fd.operation}</span>
                            {fd.conflict && <Badge variant="danger">冲突</Badge>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 变更列表（决策交互） */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>变更项（{changes.length}）</span>
            <Button size="sm" variant="outline" onClick={handleBulkAccept} disabled={blocked}>
              全部接受
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无变更项。请先生成 Preview。</p>
          ) : (
            changes.map((change) => (
              <div
                key={change.id}
                className="flex items-center justify-between rounded border p-3 text-sm"
              >
                <div className="flex flex-1 items-center gap-3">
                  <Badge variant="outline" className="w-16 shrink-0">
                    {change.target.entityType}
                  </Badge>
                  <span className="truncate font-mono text-xs">{change.target.entityId}</span>
                  <Badge variant="neutral">{change.operation}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {change.confidence ? `${Math.round(change.confidence * 100)}%` : ''}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={change.reviewStatus === 'accepted' || blocked}
                    onClick={() => handleDecide(change.id, 'accepted')}
                  >
                    接受
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={change.reviewStatus === 'rejected' || blocked}
                    onClick={() => handleDecide(change.id, 'rejected')}
                  >
                    拒绝
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* 阻塞/冲突提示 */}
      {blocked && (
        <Alert variant="danger" title="草案已过期">
          该草案已过期，无法执行 apply 或变更操作。
        </Alert>
      )}
      {hasConflicts && !blocked && (
        <Alert variant="danger" title="存在未解决的冲突">
          草案中还有{' '}
          {changes.filter((c) => c.reviewStatus === 'pending' && c.operation === 'update').length}{' '}
          项更新变更未处理。 请在接受、拒绝或编辑所有冲突项后执行 dry-run。
        </Alert>
      )}

      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => {
            diffMutation.mutate()
            aiDraftLayerApi.dryRun(sessionId).then((res) => {
              if (!res.result.canApply) {
                alert(`Dry-run 阻断：${res.result.blocking.join('\n')}`)
              } else {
                queryClient.invalidateQueries({ queryKey: aiDraftLayerKeys.detail(sessionId) })
              }
            })
          }}
          disabled={blocked || changes.length === 0 || isApplied}
        >
          Dry-run & 校验
        </Button>
        <Button
          variant="primary"
          onClick={() => applyMutation.mutate()}
          disabled={
            blocked || hasConflicts || changes.length === 0 || isApplied || applyMutation.isPending
          }
        >
          {applyMutation.isPending ? '正在应用...' : '确认应用'}
        </Button>
        <Button
          variant="outline"
          onClick={() => discardMutation.mutate()}
          disabled={blocked || isApplied}
        >
          放弃草案
        </Button>
      </div>
    </div>
  )
}
