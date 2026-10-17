'use client'

import { useState } from 'react'
import type { Report, ReportExportFormat } from '@aiproj/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Download, RefreshCw } from 'lucide-react'
import { PermissionGuard } from '@/components/PermissionGuard'
import { useDownloadReport, useExportReport } from '@/hooks/use-reports'
import { ReportSnapshotRenderer } from './ReportSnapshotRenderer'
import { ReportWarningsPanel } from './ReportWarningsPanel'

/**
 * 报表详情预览 —— tasks 6.3 / 6.4。
 *
 * - 展示已保存快照（summary + 明细 + warnings），不重新拉取源数据；
 * - 导出/下载按 `report:export` / `report:download` 权限降级隐藏；
 * - 再生成入口触发 `onRegenerate` 回调，由父级把当前筛选转发到 useCreateReport。
 */

const TEMPLATE_LABEL: Record<Report['template'], string> = {
  progress: '进度',
  delay: '延期',
  workload: '工作量',
  milestone: '里程碑',
}

export interface ReportDetailPreviewProps {
  report: Report
  onRegenerate?: () => void
  regenerating?: boolean
}

export function ReportDetailPreview({
  report,
  onRegenerate,
  regenerating = false,
}: ReportDetailPreviewProps) {
  const [exportFormat, setExportFormat] = useState<ReportExportFormat>(
    report.fileFormat ?? 'markdown',
  )
  const [error, setError] = useState<string | null>(null)

  const exportMutation = useExportReport(report.id)
  const downloadMutation = useDownloadReport()

  const includeDetails = report.formatConfig?.includeDetails ?? true
  const includeWarnings = report.formatConfig?.includeWarnings ?? true
  const warnings = report.dataSnapshot.snapshotMetadata.warnings ?? []

  async function handleExport() {
    setError(null)
    try {
      await exportMutation.mutateAsync({
        format: exportFormat,
        formatConfig: report.formatConfig ?? undefined,
      })
    } catch (e) {
      setError(errorMessage(e, '导出失败'))
    }
  }

  async function handleDownload() {
    setError(null)
    try {
      const { blob, filename } = await downloadMutation.mutateAsync({
        reportId: report.id,
        format: exportFormat,
      })
      triggerBrowserDownload(blob, filename)
    } catch (e) {
      setError(errorMessage(e, '下载失败'))
    }
  }

  return (
    <article className="space-y-6 rounded-lg border border-border bg-white p-5">
      {/* 头部 */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="primary">{TEMPLATE_LABEL[report.template]}</Badge>
            <h2 className="truncate text-lg font-semibold text-gray-900">{report.title}</h2>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            生成于{' '}
            <time dateTime={report.generatedAt ?? report.createdAt}>
              {formatDateTime(report.generatedAt ?? report.createdAt)}
            </time>
            {report.generatedBy != null && <> · 生成者 #{report.generatedBy}</>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="radiogroup"
            aria-label="导出格式"
            className="inline-flex overflow-hidden rounded-md border border-border text-xs"
          >
            {(['markdown', 'csv'] as ReportExportFormat[]).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={exportFormat === f}
                onClick={() => setExportFormat(f)}
                className={[
                  'px-3 py-1 uppercase transition-colors',
                  exportFormat === f
                    ? 'bg-primary-500 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50',
                ].join(' ')}
              >
                {f}
              </button>
            ))}
          </div>

          <PermissionGuard require="report:export">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exportMutation.isPending}
            >
              <Download className="mr-1 h-4 w-4" />
              {exportMutation.isPending ? '导出中…' : '导出'}
            </Button>
          </PermissionGuard>

          <PermissionGuard require="report:download">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={
                downloadMutation.isPending ||
                (report.fileFormat !== exportFormat && !exportMutation.isSuccess)
              }
              title={
                report.fileFormat !== exportFormat && !exportMutation.isSuccess
                  ? '请先导出该格式再下载'
                  : undefined
              }
            >
              <Download className="mr-1 h-4 w-4" />
              {downloadMutation.isPending ? '下载中…' : '下载'}
            </Button>
          </PermissionGuard>

          {onRegenerate && (
            <PermissionGuard require="report:create">
              <Button variant="outline" size="sm" onClick={onRegenerate} disabled={regenerating}>
                <RefreshCw className="mr-1 h-4 w-4" />
                {regenerating ? '生成中…' : '重新生成'}
              </Button>
            </PermissionGuard>
          )}
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {/* 快照内容 */}
      <ReportSnapshotRenderer snapshot={report.dataSnapshot} includeDetails={includeDetails} />

      {/* Warnings（受 formatConfig.includeWarnings 控制） */}
      {includeWarnings && <ReportWarningsPanel warnings={warnings} />}
    </article>
  )
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function errorMessage(e: unknown, fallback: string): string {
  if (
    e &&
    typeof e === 'object' &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string'
  ) {
    return (e as { message: string }).message
  }
  return fallback
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
