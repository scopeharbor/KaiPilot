'use client'

import React, { useState } from 'react'
import { useOcrPrivacyExportPreview, useOcrPrivacyExportExecute } from '@/hooks/use-ocr-privacy'
import type { OcrPrivacyCopyExportPreviewResponse, OcrPrivacyWarningCode } from '@aiproj/types'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Checkbox } from '@/components/ui/Checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/Dialog'

/**
 * OCR 隐私导出对话框（v3-ocr-privacy-policy-controls §7.4）
 *
 * 包含预览摘要、精确作用域、策略哈希、警告、显式确认与禁用状态。
 * 中文文案，无"自动应用"用语。
 */

interface OcrPrivacyExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  acceptedExtractionIds: number[]
  policyHash: string
  sourceKind?: string
}

export function OcrPrivacyExportDialog({
  open,
  onOpenChange,
  projectId,
  acceptedExtractionIds,
  policyHash,
  sourceKind = 'attachment',
}: OcrPrivacyExportDialogProps) {
  const [confirmed, setConfirmed] = useState(false)
  const [preview, setPreview] = useState<OcrPrivacyCopyExportPreviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const previewMutation = useOcrPrivacyExportPreview(projectId)
  const executeMutation = useOcrPrivacyExportExecute(projectId)

  const handlePreview = async () => {
    setError(null)
    try {
      const result = await previewMutation.mutateAsync({
        purpose: 'export_metadata',
        scope: {
          organizationId: 0, // 由后端根据 auth 解析
          projectId,
          acceptedExtractionIds,
          sourceKind,
        },
        format: 'json_summary',
        policyHash,
      })
      setPreview(result)
      setConfirmed(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '预览失败')
    }
  }

  const handleExecute = async () => {
    if (!preview) return
    setError(null)
    try {
      await executeMutation.mutateAsync({
        previewHash: preview.previewHash,
        policyHash,
        idempotencyKey: `export_${projectId}_${Date.now()}`,
      })
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出执行失败')
    }
  }

  const handleOpen = (open: boolean) => {
    if (open) {
      handlePreview()
    } else {
      setPreview(null)
      setConfirmed(false)
      setError(null)
    }
    onOpenChange(open)
  }

  const warningLabel: Record<OcrPrivacyWarningCode, string> = {
    SOURCE_HIDDEN: '来源不可见',
    LIFECYCLE_WARNING: '生命周期警告',
    STALE_SOURCE: '来源已过期',
    POLICY_HASH_MISMATCH: '策略不匹配',
    EXPORT_LIMIT_APPROACHING: '接近导出上限',
    CONFIRM_REQUIRED: '需要显式确认',
    READ_ONLY_DEGRADED: '只读降级',
    PERMISSION_DENIED: '权限拒绝',
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>OCR 隐私导出预览</DialogTitle>
          <DialogDescription>
            即将从 {acceptedExtractionIds.length} 个已接收提取中导出数据
          </DialogDescription>
        </DialogHeader>

        {previewMutation.isPending && (
          <div className="text-sm text-muted-foreground">正在验证隐私策略...</div>
        )}

        {error && (
          <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {preview && (
          <div className="space-y-3">
            <Card className="p-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">输出模式：</span>
                  <Badge variant="outline" className="ml-1">
                    {preview.outputMode === 'metadata_only' ? '仅元数据' : preview.outputMode}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">记录数：</span>
                  <span className="font-medium">{preview.recordCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">预估字符：</span>
                  <span className="font-medium">{preview.estimatedCharacters}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">页数：</span>
                  <span className="font-medium">{preview.pageCount}</span>
                </div>
              </div>
            </Card>

            {preview.warnings.length > 0 && (
              <div className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <ul className="list-disc pl-4">
                  {preview.warnings.map((w) => (
                    <li key={w}>{warningLabel[w] ?? w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              作用域摘要：{preview.scopeSummary.textLengthSummary}
            </div>
            <div className="text-xs font-mono text-muted-foreground truncate">
              预览哈希：{preview.previewHash}
            </div>

            {preview.requiresExplicitConfirmation && (
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="export-confirm"
                  checked={confirmed}
                  onCheckedChange={(v) => setConfirmed(v === true)}
                />
                <label htmlFor="export-confirm" className="text-sm">
                  我确认此次导出行为，并理解所导出数据仅用于本项目管理用途
                </label>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={
              !preview ||
              (preview.requiresExplicitConfirmation && !confirmed) ||
              executeMutation.isPending
            }
            onClick={handleExecute}
          >
            {executeMutation.isPending ? '执行中...' : '确认导出'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
