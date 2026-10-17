'use client'

import React, { useState } from 'react'
import {
  useOcrSearchIndexList,
  useOcrSearchIndexPreview,
  useOcrSearchIndexExecute,
  useOcrSearchIndexUnindexPreview,
  useOcrSearchIndexUnindexExecute,
} from '@/hooks/use-ocr-search-index'
import type {
  OcrSearchIndexPreviewResponse,
  OcrSearchIndexEntrySummary,
  OcrSearchIndexPreviewEntry,
} from '@aiproj/types'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/Dialog'

interface OcrSearchIndexPanelProps {
  projectId: number
  readOnly?: boolean
}

/** 状态徽章颜色 */
const statusColor = (status: string): 'success' | 'danger' | 'neutral' | 'outline' => {
  switch (status) {
    case 'active':
      return 'success'
    case 'inactive':
      return 'neutral'
    case 'tombstoned':
      return 'danger'
    default:
      return 'outline'
  }
}

/** 阻塞原因中文映射 */
const blockedReasonLabel: Record<string, string> = {
  stale_source: '来源已变更',
  superseded_extraction: '提取已被取代',
  expired_extraction: '提取已过期',
  purged_extraction: '提取已清除',
  tombstoned_extraction: '提取已归档',
  hold_active: '保留 hold 已激活',
  hidden_source: '来源不可见',
  not_accepted: '未通过审查确认',
  candidate_only: '仅为候选文本',
}

export function OcrSearchIndexPanel({ projectId, readOnly }: OcrSearchIndexPanelProps) {
  const [showPreview, setShowPreview] = useState(false)
  const [showUnindex, setShowUnindex] = useState(false)
  const [previewData, setPreviewData] = useState<OcrSearchIndexPreviewResponse | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: listData, isLoading } = useOcrSearchIndexList(projectId)
  const previewMutation = useOcrSearchIndexPreview(projectId)
  const executeMutation = useOcrSearchIndexExecute(projectId)
  const unindexPreviewMutation = useOcrSearchIndexUnindexPreview(projectId)
  const unindexExecuteMutation = useOcrSearchIndexUnindexExecute(projectId)

  const handlePreview = async () => {
    setErrorMsg(null)
    try {
      const result = await previewMutation.mutateAsync({})
      setPreviewData(result)
      setShowPreview(true)
      setIdempotencyKey(`index-${Date.now()}`)
    } catch {
      setErrorMsg('预览失败，请检查权限或稍后重试')
    }
  }

  const handleExecute = async () => {
    if (!previewData) return
    setErrorMsg(null)
    try {
      await executeMutation.mutateAsync({
        previewHash: previewData.data.previewHash,
        idempotencyKey,
      })
      setShowPreview(false)
      setPreviewData(null)
    } catch {
      setErrorMsg('索引执行失败，预览可能已过期，请重新预览')
    }
  }

  const handleUnindexPreview = async (entryIds: number[]) => {
    setErrorMsg(null)
    try {
      const result = await unindexPreviewMutation.mutateAsync({ entryIds })
      setPreviewData(result)
      setShowUnindex(true)
      setIdempotencyKey(`unindex-${Date.now()}`)
    } catch {
      setErrorMsg('取消索引预览失败')
    }
  }

  const handleUnindexExecute = async () => {
    if (!previewData) return
    setErrorMsg(null)
    const entryIds = previewData.data.entries.map((e) => e.currentEntryId!).filter(Boolean)
    try {
      await unindexExecuteMutation.mutateAsync({
        previewHash: previewData.data.previewHash,
        idempotencyKey,
        entryIds,
      })
      setShowUnindex(false)
      setPreviewData(null)
    } catch {
      setErrorMsg('取消索引失败，预览可能已过期')
    }
  }

  const entries: OcrSearchIndexEntrySummary[] = listData?.data ?? []

  return (
    <div className="space-y-4">
      {errorMsg && (
        <Alert variant="danger">
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}

      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">OCR 搜索索引</h3>
          {!readOnly && (
            <div className="space-x-2">
              <Button
                onClick={handlePreview}
                disabled={previewMutation.isPending || executeMutation.isPending}
                variant="outline"
                size="sm"
              >
                {previewMutation.isPending ? '预览中…' : '预览索引'}
              </Button>
              {entries.length > 0 && (
                <Button
                  onClick={() => {
                    const activeIds = entries.filter((e) => e.status === 'active').map((e) => e.id)
                    handleUnindexPreview(activeIds)
                  }}
                  disabled={unindexPreviewMutation.isPending || unindexExecuteMutation.isPending}
                  variant="outline"
                  size="sm"
                >
                  取消索引
                </Button>
              )}
            </div>
          )}
        </div>

        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">暂无索引条目。请先预览并确认索引操作。</p>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between p-2 border rounded">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant={statusColor(entry.status)}>
                    {entry.status === 'active'
                      ? '活跃'
                      : entry.status === 'inactive'
                        ? '非活跃'
                        : '已归档'}
                  </Badge>
                  <span className="text-sm truncate">
                    {entry.sourceKind === 'document' ? '文档' : '附件'} #
                    {entry.sourceId ?? entry.extractionId}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 ml-2">
                  第 {entry.pageRefs.join(', ')} 页
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 预览对话框 */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>索引预览</DialogTitle>
            <DialogDescription>
              以下是将被索引的 OCR 已确认提取，请审查后确认执行。
            </DialogDescription>
          </DialogHeader>

          {previewData && (
            <div className="space-y-4 max-h-96 overflow-auto">
              <div className="flex gap-4 text-sm">
                <span>
                  可索引：<strong>{previewData.data.eligibleCount}</strong>
                </span>
                <span>
                  已阻止：<strong>{previewData.data.blockedCount}</strong>
                </span>
              </div>

              {previewData.data.blockedReasons.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">阻止原因：</p>
                  {previewData.data.blockedReasons.map((r) => (
                    <Badge key={r} variant="neutral" className="mr-1">
                      {blockedReasonLabel[r] ?? r}
                    </Badge>
                  ))}
                </div>
              )}

              {previewData.data.warnings.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-yellow-600">警告：</p>
                  {previewData.data.warnings.map((w) => (
                    <Badge key={w} variant="outline" className="mr-1 text-yellow-600">
                      {w}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">预览条目（前 10 条）：</p>
                {previewData.data.entries.slice(0, 10).map((e) => (
                  <PreviewEntryItem key={e.extractionId} entry={e} />
                ))}
                {previewData.data.entries.length > 10 && (
                  <p className="text-xs text-muted-foreground">
                    …及其他 {previewData.data.entries.length - 10} 条
                  </p>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreview(false)}>
              取消
            </Button>
            <Button
              onClick={handleExecute}
              disabled={
                !previewData || previewData.data.eligibleCount === 0 || executeMutation.isPending
              }
            >
              {executeMutation.isPending ? '执行中…' : '确认索引'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 取消索引对话框 */}
      <Dialog open={showUnindex} onOpenChange={setShowUnindex}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>取消索引确认</DialogTitle>
            <DialogDescription>
              以下条目将从搜索索引中移除。此操作不会影响原始 OCR 审查确认记录。
            </DialogDescription>
          </DialogHeader>

          {previewData && (
            <div className="space-y-2">
              <p className="text-sm">
                确认取消索引 <strong>{previewData.data.eligibleCount}</strong> 条记录？
              </p>
              <p className="text-xs text-muted-foreground">
                取消索引后，这些提取的 OCR 文本将不再出现在项目搜索结果中。
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUnindex(false)}>
              返回
            </Button>
            <Button
              onClick={handleUnindexExecute}
              disabled={
                !previewData ||
                previewData.data.eligibleCount === 0 ||
                unindexExecuteMutation.isPending
              }
              variant="danger"
            >
              {unindexExecuteMutation.isPending ? '执行中…' : '确认取消索引'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** 单条预览条目 */
function PreviewEntryItem({ entry }: { entry: OcrSearchIndexPreviewEntry }) {
  return (
    <div
      className={`flex items-center justify-between p-1.5 border rounded text-xs ${
        entry.eligible ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
      }`}
    >
      <div className="flex items-center gap-1 min-w-0">
        <Badge variant={entry.eligible ? 'success' : 'danger'} className="text-[10px]">
          {entry.eligible ? '可索引' : '已阻止'}
        </Badge>
        <span className="truncate">
          {entry.sourceKind === 'document' ? '文档' : '附件'} #
          {entry.sourceId ?? entry.extractionId}
        </span>
      </div>
      <span className="text-muted-foreground shrink-0 ml-1">第 {entry.pageRefs.join(',')} 页</span>
    </div>
  )
}
