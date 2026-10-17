'use client'

import type { V2ReportExportFormat } from '@aiproj/types'
import { AlertOctagon, FileText, Sparkles } from 'lucide-react'
import { AiCard } from '@/components/ui/AiCard'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ReportWarningsPanel } from '@/components/views/reports/ReportWarningsPanel'

/**
 * PeriodicPreviewPanel —— AI 周期报表预览面板。
 *
 * 展示数据源状态、警告、阻塞信息、周期对比。
 * 「生成报表」按钮在 blocking 警告时禁用。
 */

export interface PreviewData {
  templateId: string
  title: string
  dateRange: { fromDate?: string; toDate?: string }
  dataSources: { sourceKey: string; status: string; warnings?: unknown[] }[]
  warnings: { level: 'info' | 'warning' | 'critical'; message: string; code?: string }[]
  blocking: boolean
  exportFormats: V2ReportExportFormat[]
  aiEnabled: boolean
  aiEstimated: boolean
}

export interface PeriodicPreviewPanelProps {
  preview: PreviewData | null
  isPreviewing: boolean
  previewError: Error | null
  onGenerate: () => void
  isGenerating: boolean
  onRetryPreview?: () => void
}

function DataSourceBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    available: 'bg-success-bg text-success',
    unavailable: 'bg-danger-bg text-danger',
    forbidden: 'bg-warning-bg text-warning',
    timeout: 'bg-warning-bg text-warning',
  }
  const labelMap: Record<string, string> = {
    available: '可用',
    unavailable: '不可用',
    forbidden: '无权限',
    timeout: '超时',
  }
  const cls = colorMap[status] ?? 'bg-gray-100 text-gray-600'

  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {labelMap[status] ?? status}
    </span>
  )
}

export function PeriodicPreviewPanel({
  preview,
  isPreviewing,
  previewError,
  onGenerate,
  isGenerating,
  onRetryPreview,
}: PeriodicPreviewPanelProps) {
  // 加载态
  if (isPreviewing) {
    return (
      <div className="space-y-4 rounded-lg border border-border bg-white p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
    )
  }

  // 错误态
  if (previewError) {
    return (
      <div className="rounded-lg border border-border bg-white p-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertOctagon className="h-8 w-8 text-danger" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold text-gray-800">预览生成失败</h3>
            <p className="mt-1 text-sm text-gray-500">{previewError.message}</p>
          </div>
          {onRetryPreview && (
            <Button variant="outline" size="sm" onClick={onRetryPreview}>
              重试预览
            </Button>
          )}
        </div>
      </div>
    )
  }

  // 空态
  if (!preview) {
    return (
      <EmptyState
        icon={FileText}
        title="暂无预览"
        description="请选择 AI 周报或月报模板，并设定时间范围后生成预览"
      />
    )
  }

  const blockingWarnings = preview.warnings.filter((w) => w.level === 'critical')
  const hasBlockingWarnings = blockingWarnings.length > 0

  return (
    <AiCard chipLabel="AI 周期预览" className="space-y-4">
      {/* 标题 */}
      <div>
        <h3 className="text-md font-semibold text-gray-900">{preview.title}</h3>
        <p className="mt-1 text-xs text-gray-500">
          {preview.dateRange.fromDate} ~ {preview.dateRange.toDate}
        </p>
      </div>

      {/* 数据源状态 */}
      {preview.dataSources.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-semibold text-gray-600">数据源状态</h4>
          <div className="flex flex-wrap gap-2">
            {preview.dataSources.map((ds) => (
              <div key={ds.sourceKey} className="flex items-center gap-1.5">
                <span className="text-xs text-gray-700">{ds.sourceKey}</span>
                <DataSourceBadge status={ds.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {preview.warnings.length > 0 && (
        <div>
          {blockingWarnings.length > 0 && (
            <div className="mb-2 flex items-center gap-1.5 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
              <AlertOctagon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="font-medium">存在阻塞警告，生成功能受限</span>
            </div>
          )}
          <ReportWarningsPanel warnings={preview.warnings} />
        </div>
      )}

      {/* AI 启用标识 */}
      {preview.aiEnabled && (
        <div className="flex items-center gap-1.5 text-xs text-ai">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          <span>AI 草稿已启用</span>
        </div>
      )}

      {/* 生成按钮 */}
      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <Button
          variant="primary"
          size="sm"
          onClick={onGenerate}
          disabled={isGenerating || hasBlockingWarnings}
          loading={isGenerating}
        >
          {isGenerating ? '生成中…' : '生成报表'}
        </Button>
      </div>
    </AiCard>
  )
}
