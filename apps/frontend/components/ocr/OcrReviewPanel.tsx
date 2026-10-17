'use client'

import React, { useState } from 'react'
import {
  useOcrReviewDetail,
  useOcrAcceptedExtractions,
  useOcrConfirmationPreview,
  useOcrConfirmationSave,
} from '@/hooks/use-ocr-review'
import type {
  OcrReviewSelectionRequest,
  OcrAcceptedExtractionSummary,
  OcrConfirmationPreviewResponse,
} from '@aiproj/types'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert, AlertDescription } from '@/components/ui/Alert'
import { Checkbox } from '@/components/ui/Checkbox'
import { Textarea } from '@/components/ui/Textarea'

interface OcrReviewPanelProps {
  projectId: number
  jobId: number
}

export default function OcrReviewPanel({ projectId, jobId }: OcrReviewPanelProps) {
  const { data, isLoading, error } = useOcrReviewDetail(projectId, jobId)
  const { data: acceptedData } = useOcrAcceptedExtractions(projectId, jobId)
  const previewMutation = useOcrConfirmationPreview(projectId, jobId)
  const saveMutation = useOcrConfirmationSave(projectId, jobId)

  const [selectedText, setSelectedText] = useState('')
  // 选中文本所属的候选：预览/保存必须回传实际来源候选，
  // 固定取 candidateItems[0] 会把跨候选的选择错误归属到第一条。
  const [selectedCandidateId, setSelectedCandidateId] = useState(0)
  const [selectedPageRefs, setSelectedPageRefs] = useState<number[]>([])
  const [reviewNote, setReviewNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [previewResult, setPreviewResult] = useState<OcrConfirmationPreviewResponse | null>(null)

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <Alert variant="danger">
        <AlertDescription>
          {error instanceof Error ? error.message : '无法加载 OCR 审查数据'}
        </AlertDescription>
      </Alert>
    )
  }

  const isStale = data.jobStatus === 'stale_source'
  const canConfirm = data.allowedActions.includes('confirm')
  const canPreview = data.allowedActions.includes('preview_confirmation')
  const isReadOnly = !canConfirm

  const handleTextSelect = (candidateId: number, text: string, pageRefs: number[]) => {
    setSelectedCandidateId(candidateId)
    setSelectedText(text)
    setSelectedPageRefs(pageRefs)
    setShowPreview(false)
    setPreviewResult(null)
    setConfirmed(false)
  }

  const handlePreview = async () => {
    if (!selectedText || selectedPageRefs.length === 0) return

    const selection: OcrReviewSelectionRequest = {
      candidateId: selectedCandidateId,
      mode: 'full',
      selectedText,
      pageRefs: selectedPageRefs,
    }

    try {
      const result = await previewMutation.mutateAsync({
        selection,
        reviewNote: reviewNote || null,
      })
      setPreviewResult(result)
      setShowPreview(true)
    } catch {
      // mutation handles error state
    }
  }

  const handleSave = async () => {
    if (!previewResult || !confirmed) return

    const selection: OcrReviewSelectionRequest = {
      candidateId: selectedCandidateId,
      mode: 'full',
      selectedText,
      pageRefs: selectedPageRefs,
    }

    try {
      await saveMutation.mutateAsync({
        previewHash: previewResult.previewHash,
        selection,
        reviewNote: reviewNote || null,
      })
      setSelectedText('')
      setSelectedCandidateId(0)
      setReviewNote('')
      setConfirmed(false)
      setShowPreview(false)
      setPreviewResult(null)
    } catch {
      // mutation handles error state
    }
  }

  return (
    <div className="space-y-6 p-4">
      {/* 来源摘要 */}
      <Card className="p-4">
        <h3 className="text-lg font-semibold mb-2">OCR 审查工作台</h3>
        {isReadOnly && (
          <div
            className="mb-2 rounded border border-gray-200 bg-gray-50 p-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
            role="status"
            aria-label="OCR 权限状态"
          >
            当前角色无确认权限，仅可查看审查数据
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">来源类型：</span>
            {data.sourceSummary.sourceKind === 'attachment'
              ? '附件'
              : data.sourceSummary.sourceKind === 'document'
                ? '文档'
                : '未知'}
          </div>
          <div>
            <span className="text-muted-foreground">作业状态：</span>
            <Badge
              variant={
                isStale ? 'warning' : data.jobStatus === 'reviewable' ? 'success' : 'neutral'
              }
            >
              {data.jobStatus === 'reviewable'
                ? '可审查'
                : data.jobStatus === 'partially_reviewable'
                  ? '部分可审查'
                  : data.jobStatus === 'stale_source'
                    ? '来源已变更'
                    : data.jobStatus}
            </Badge>
          </div>
          {data.providerLabel && (
            <div>
              <span className="text-muted-foreground">供应商：</span>
              {data.providerLabel} / {data.modelLabel}
            </div>
          )}
          {data.warningSummary.totalWarnings > 0 && (
            <div>
              <span className="text-muted-foreground">警告：</span>
              <Badge variant="warning">{data.warningSummary.totalWarnings} 条</Badge>
            </div>
          )}
        </div>
        {isStale && (
          <Alert variant="warning" className="mt-3">
            <AlertDescription>
              来源文件已变更，请重新运行 OCR 后再次审查。当前确认功能已禁用。
            </AlertDescription>
          </Alert>
        )}
      </Card>

      {/* 候选文本 */}
      {data.pageGroups.length > 0 && (
        <Card className="p-4">
          <h4 className="font-medium mb-3">提取文本</h4>
          <div className="space-y-3">
            {data.pageGroups.map((pg) => (
              <div
                key={pg.pageIndex}
                className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                  selectedPageRefs.includes(pg.pageIndex)
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                } ${pg.candidateStatus === 'failed' ? 'opacity-60' : ''}`}
                onClick={() => {
                  if (pg.candidateStatus !== 'failed' && pg.extractedText) {
                    handleTextSelect(
                      data.candidateItems.find((c) => c.pageRefs.includes(pg.pageIndex))
                        ?.candidateId ?? 0,
                      pg.extractedText,
                      [pg.pageIndex],
                    )
                  }
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{pg.pageLabel}</span>
                  {pg.confidenceSummary && (
                    <Badge
                      variant={
                        pg.confidenceSummary.level === 'high'
                          ? 'success'
                          : pg.confidenceSummary.level === 'medium'
                            ? 'neutral'
                            : 'warning'
                      }
                    >
                      {pg.confidenceSummary.label}
                    </Badge>
                  )}
                  {pg.candidateStatus === 'failed' && <Badge variant="danger">提取失败</Badge>}
                </div>
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {pg.extractedText ?? '（无文本）'}
                </p>
                {pg.warningCodes.length > 0 && (
                  <div className="flex gap-1 mt-1">
                    {pg.warningCodes.map((code) => (
                      <Badge key={code} variant="warning" className="text-xs">
                        {code}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 无候选提示 */}
      {data.pageGroups.length === 0 && (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground text-center py-8">
            暂无 OCR 候选数据。上游 OCR 作业尚未完成或未实现。
          </p>
        </Card>
      )}

      {/* 确认预览 */}
      {canPreview && selectedText && (
        <Card className="p-4">
          <h4 className="font-medium mb-3">确认操作</h4>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">审查备注（可选）</label>
              <Textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="添加审查备注..."
                className="mt-1"
                rows={2}
                maxLength={2000}
                disabled={isReadOnly}
              />
            </div>

            {!showPreview && (
              <Button
                onClick={handlePreview}
                disabled={isReadOnly || previewMutation.isPending || !selectedText}
                className="w-full"
              >
                {previewMutation.isPending ? '预览中...' : '预览确认'}
              </Button>
            )}

            {previewMutation.isError && (
              <Alert variant="danger">
                <AlertDescription>
                  {previewMutation.error instanceof Error
                    ? previewMutation.error.message
                    : '预览失败'}
                </AlertDescription>
              </Alert>
            )}

            {showPreview && previewResult && (
              <div className="space-y-3 border rounded-lg p-3 bg-muted/30">
                <h5 className="text-sm font-semibold">确认预览</h5>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>来源哈希：{previewResult.sourceHash}</p>
                  <p>候选哈希：{previewResult.candidateHash}</p>
                  <p>选中文本哈希：{previewResult.selectedTextHash}</p>
                  <p>页面引用：{previewResult.pageRefs.join(', ')}</p>
                </div>
                <div className="text-xs text-muted-foreground">
                  <p className="font-medium">红线声明——以下系统不会被修改：</p>
                  <ul className="list-disc list-inside mt-1">
                    <li>任务/WBS/风险/报表/文档正文</li>
                    <li>Compiler 产物/AI 草稿</li>
                    <li>搜索索引/知识库/外部系统</li>
                  </ul>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="confirm-check"
                    checked={confirmed}
                    onCheckedChange={(v) => setConfirmed(v === true)}
                  />
                  <label htmlFor="confirm-check" className="text-sm font-medium">
                    我确认要保存此 OCR 提取文本。此操作不会自动修改任何项目数据。
                  </label>
                </div>
                <Button
                  onClick={handleSave}
                  disabled={!confirmed || saveMutation.isPending}
                  className="w-full"
                >
                  {saveMutation.isPending ? '保存中...' : '确认保存'}
                </Button>
              </div>
            )}

            {saveMutation.isError && (
              <Alert variant="danger">
                <AlertDescription>
                  {saveMutation.error instanceof Error ? saveMutation.error.message : '保存失败'}
                </AlertDescription>
              </Alert>
            )}

            {saveMutation.isSuccess && (
              <Alert variant="success">
                <AlertDescription>确认保存成功！</AlertDescription>
              </Alert>
            )}
          </div>
        </Card>
      )}

      {/* 已接受提取历史 */}
      {acceptedData && acceptedData.data.length > 0 && (
        <Card className="p-4">
          <h4 className="font-medium mb-3">已接受的提取记录</h4>
          <div className="space-y-2">
            {acceptedData.data.map((ext: OcrAcceptedExtractionSummary) => (
              <div
                key={ext.extractionId}
                className="flex items-center justify-between p-2 border rounded text-sm"
              >
                <div>
                  <Badge variant={ext.status === 'current' ? 'success' : 'neutral'}>
                    {ext.status === 'current' ? '当前' : '已替代'}
                  </Badge>
                  <span className="ml-2 text-muted-foreground">
                    {ext.reviewerName ?? `用户 #${ext.reviewerId}`}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {ext.confirmedAt ? new Date(ext.confirmedAt).toLocaleString('zh-CN') : ''}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 只读提示 */}
      {isReadOnly && (
        <Alert className="mt-4">
          <AlertDescription>
            您当前为只读访问。如需确认或替换 OCR 提取，请联系项目管理员。
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
